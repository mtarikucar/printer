/**
 * Anlık teklifin GÖZETİMSİZ yarısı: süre dolumu, iki hatırlatma ve dosya
 * saklama süresi. Saatte bir `quote-maintenance` işi çağırır.
 *
 * Üç kural bütün dosyayı biçimlendirir:
 *
 * 1. **Hatırlatma ÖNCE damgalanır, SONRA gönderilir.** Her damga, kendi
 *    kolonunun boş olmasını arayan koşullu bir `UPDATE … RETURNING`tır; iki
 *    eşzamanlı tur (işçi yeniden başladı, zamanlayıcı iki kez tetikledi) aynı
 *    satırı sahiplenemez, çünkü ikinci `UPDATE` kilidi bekler ve satırın YENİ
 *    hâlini yeniden süzer. Sıralama bilinçlidir: gönderim çökerse hatırlatma
 *    KAYBOLUR, ama müşteri aynı mektubu iki kez almaz — tersi, bir SMTP
 *    arızasında aynı adrese tur tur mektup yağdırırdı.
 * 2. **Terk hatırlatması TİCARİ İLETİDİR.** Sorgunun kendisi
 *    `users.marketing_consent = true` arar (ETK 6563 / İYS); `quote-notify`
 *    ayrıca kendi içinde de bakar. İki kapı bilerek üst üstedir: biri bir gün
 *    yanlış yazılırsa öteki hâlâ tutuyor olur. Süre dolumu hatırlatması
 *    İŞLEMSELDİR ve izin aramaz.
 * 3. **Silme geri alınamaz.** Saklama süpürmesi yalnız siparişe DÖNMEMİŞ,
 *    süresi dolmuş/iptal edilmiş tekliflerin parçalarına bakar ve bir dosyayı
 *    ancak onu gösteren başka bir (henüz süpürülmemiş) parça kalmadığında
 *    siler. Ayar satırı okunamazsa hiçbir şey silinmez.
 *
 * NOT: `import "server-only"` YOK ve zincirine de sızmamalı — bu modülü
 * standalone BullMQ worker süreci yükler. Özellikle `quote-checkout.ts`
 * import EDİLMEZ: o `attribution-server`i çeker, o da `server-only`dir ve
 * worker'ı crash-loop'a sokar (depo tarihindeki worker-server-only tuzağı).
 */
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  quoteCheckouts,
  quoteParts,
  quotePricingSettings,
  quotes,
  users,
} from "@/lib/db/schema";
import type { QuoteStatus } from "@/lib/config/quote-types";
import { notifyQuoteAbandoned, notifyQuoteExpiring } from "@/lib/services/quote-notify";
import { deleteFile } from "@/lib/services/storage";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Süresi dolmadan kaç gün önce işlemsel hatırlatma gider. */
export const EXPIRY_REMINDER_DAYS = 3;

/** Teklif kaç saat dokunulmadan kalırsa "terk edilmiş" sayılır. */
export const ABANDONED_AFTER_HOURS = 24;

/**
 * Bir turda en çok kaç hatırlatma gönderilir.
 *
 * Her hatırlatma bir SMTP çağrısıdır ve tur saatte bir koşar: sınırsız bir
 * tur, tek seferde binlerce mektupla hem sağlayıcının hız sınırına hem de iş
 * kilidine çarpardı. Artanı bir sonraki tur alır (damga kolonu sayesinde
 * kaldığı yerden).
 */
export const REMINDER_BATCH = 200;

/** Bir turda en çok kaç parçanın dosyaları silinir (disk IO sınırı). */
export const PURGE_BATCH = 200;

/** Süresi dolabilen durumlar (spec §"Teklif yaşam döngüsü"). */
const EXPIRABLE: QuoteStatus[] = ["draft", "needs_review", "quoted"];

/**
 * Hatırlatma gönderilebilen durumlar.
 *
 * `needs_review` DIŞARIDA: fiyatını admin'in girmesi beklenen teklife
 * "fiyatınız bekliyor" demek olurdu.
 */
const REMINDABLE: QuoteStatus[] = ["draft", "quoted"];

/** Dosyaları saklama süresi dolunca silinebilen durumlar. */
const PURGEABLE: QuoteStatus[] = ["expired", "cancelled"];

/** Parçanın diskte yer tutan bütün anahtar kolonları. */
const PART_KEY_COLUMNS = [
  quoteParts.sourceKey,
  quoteParts.canonicalStlKey,
  quoteParts.previewGlbKey,
  quoteParts.thumbnailKey,
  quoteParts.drawingKey,
];

/**
 * Süresi geçen teklifleri kapatır ve kaç tanesinin kapandığını döner.
 *
 * `order_id IS NULL` koşulu, durum süzgecinin üstüne konan İKİNCİ kapıdır:
 * ödenmiş bir teklifin satırı `ordered`dır, ama ödeme yolu ile bu tur
 * çakışırsa (webhook tam bu saniyede bağlıyorsa) teklif yine de
 * kapatılmamalı. Ters yön zararsızdır: `linkQuoteToOrderTx` yalnız
 * `order_id IS NULL` arar ve durumu `ordered` yazar, yani bu tur bir ödemeyi
 * kilitleyemez.
 */
export async function expireQuotes(now: Date): Promise<number> {
  const expired = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(inArray(quotes.status, EXPIRABLE), isNull(quotes.orderId), lt(quotes.expiresAt, now))
    )
    .returning({ id: quotes.id });
  return expired.length;
}

/**
 * Hatırlatmayı SAHİPLENİR: damgayı yalnız boş kolona yazar ve yazabildiği
 * satırları döner. İki eşzamanlı tur aynı satırı sahiplenemez.
 *
 * `updated_at`e DOKUNULMAZ. Dokunsaydı terk ölçüsü ("24 saattir
 * dokunulmadı") işin kendi yan etkisiyle sıfırlanır, terk hatırlatması hiçbir
 * zaman gitmezdi.
 */
async function claimReminders(
  kind: "expiry" | "abandoned",
  due: SQLWrapper,
  now: Date
): Promise<string[]> {
  const column =
    kind === "expiry" ? quotes.expiryReminderSentAt : quotes.abandonedReminderSentAt;
  const claimed = await db
    .update(quotes)
    .set(kind === "expiry" ? { expiryReminderSentAt: now } : { abandonedReminderSentAt: now })
    .where(and(inArray(quotes.id, due), isNull(column)))
    .returning({ id: quotes.id });
  return claimed.map((row) => row.id);
}

/**
 * Süresi dolmak üzere olan tekliflerin sahiplerine işlemsel hatırlatma.
 *
 * İZİN ARANMAZ: müşterinin elindeki teklifin sonlanacağını bildirmek bir satış
 * iletisi değildir. Anonim teklif atlanır (yazacak adres yok) ve fiyatsız
 * teklif atlanır (hatırlatılacak bir fiyat yok).
 */
export async function sendExpiryReminders(now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * DAY_MS);
  const due = db
    .select({ id: quotes.id })
    .from(quotes)
    .where(
      and(
        inArray(quotes.status, REMINDABLE),
        isNull(quotes.orderId),
        isNotNull(quotes.userId),
        isNotNull(quotes.totalKurus),
        isNull(quotes.expiryReminderSentAt),
        gt(quotes.expiresAt, now),
        lte(quotes.expiresAt, horizon)
      )
    )
    // En yakın vade önce: sınıra takılan teklif, bir sonraki tura kalırken
    // süresini doldurmuş olmasın.
    .orderBy(asc(quotes.expiresAt))
    .limit(REMINDER_BATCH);

  const claimed = await claimReminders("expiry", due, now);
  for (const id of claimed) {
    // `notifyQuoteExpiring` kendi içinde try/catch'lidir: bir adresin
    // düşmesi kalan hatırlatmaları düşürmez.
    await notifyQuoteExpiring(id);
  }
  return claimed.length;
}

/**
 * Yarım kalan teklifler için terk hatırlatması — YALNIZ ticari ileti izniyle.
 *
 * Ödemesi başlamış teklif (bir `quote_checkouts` satırı varsa) DIŞARIDA
 * kalır: o müşteri satış hunisinde değil, ödeme hunisindedir ve oranın kendi
 * hatırlatma/son tarih işleri vardır. "Yarım kalan teklifiniz duruyor" demek,
 * ödeme ekranını terk etmiş birine yanlış hikâyeyi anlatmak olurdu.
 */
export async function sendAbandonedReminders(now: Date): Promise<number> {
  const idleBefore = new Date(now.getTime() - ABANDONED_AFTER_HOURS * HOUR_MS);
  const due = db
    .select({ id: quotes.id })
    .from(quotes)
    .innerJoin(users, eq(users.id, quotes.userId))
    .where(
      and(
        inArray(quotes.status, REMINDABLE),
        isNull(quotes.orderId),
        isNotNull(quotes.totalKurus),
        isNull(quotes.abandonedReminderSentAt),
        gt(quotes.expiresAt, now),
        lt(quotes.updatedAt, idleBefore),
        eq(users.marketingConsent, true),
        notExists(
          db
            .select({ one: sql`1` })
            .from(quoteCheckouts)
            .where(eq(quoteCheckouts.quoteId, quotes.id))
        )
      )
    )
    // En uzun süredir bekleyen önce.
    .orderBy(asc(quotes.updatedAt))
    .limit(REMINDER_BATCH);

  const claimed = await claimReminders("abandoned", due, now);
  for (const id of claimed) {
    await notifyQuoteAbandoned(id);
  }
  return claimed.length;
}

/**
 * Saklama süresi: `quote_pricing_settings` tek satırından okunur.
 *
 * Satır yoksa `null` döner ve süpürme HİÇ koşmaz. Uydurma bir varsayılanla
 * silmek, kurulumu yarım kalmış bir ortamda müşteri dosyalarını yok etmek
 * olurdu; silinmeyen dosya ise bir sonraki turda hâlâ orada.
 */
async function retentionDays(): Promise<number | null> {
  const [row] = await db
    .select({ days: quotePricingSettings.retentionDaysAfterExpiry })
    .from(quotePricingSettings)
    .where(eq(quotePricingSettings.id, 1))
    .limit(1);
  if (!row) {
    console.error("[quote-maintenance] fiyat ayarı satırı yok; saklama süpürmesi atlandı");
    return null;
  }
  return row.days;
}

/**
 * Bu anahtarı gösteren BAŞKA bir (henüz süpürülmemiş) parça var mı?
 *
 * Aynı depolama anahtarı meşru olarak iki satıra bağlanabilir: `duplicatePart`
 * kopyaya AYNI anahtarı verir ve `splitByTechnology` satırı başka bir teklife
 * taşır — yani paylaşan satırlar ayrı tekliflerde de olabilir. Yalnız kendi
 * satırına bakan bir silici, ötekinin parçasını dosyasız bırakırdı.
 *
 * Süpürülmüş satır referans SAYILMAZ: dosyası zaten silinmiş bir parçanın
 * anahtarı, hayatta kalan bir dosyayı sonsuza dek korumamalı. Böylece
 * paylaşan satırların sonuncusu süpürüldüğünde dosya gerçekten gider.
 */
async function keyReferencedElsewhere(key: string, partId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: quoteParts.id })
    .from(quoteParts)
    .where(
      and(
        ne(quoteParts.id, partId),
        isNull(quoteParts.filesPurgedAt),
        or(...PART_KEY_COLUMNS.map((column) => eq(column, key)))
      )
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Saklama süresi dolan tekliflerin dosyalarını siler; süpürülen parça sayısını
 * döner.
 *
 * Seçim üç kapıdan geçer: durum `expired|cancelled`, `order_id IS NULL` ve
 * vade + saklama günü geçmiş. Siparişe dönmüş teklif İKİ kez korunur — dosyası
 * zaten `models/<orderId>/` altına fiziksel olarak kopyalanmıştır (Task 4.2),
 * yani teklif dosyasını silmek siparişi bozmazdı; kapı yine de duruyor, çünkü
 * "siparişin kaynağını sildim" diyebilmek için tek bir hatalı durum yazımı
 * yeter.
 *
 * Damga (`files_purged_at`) silmeden SONRA yazılır: tur ortasında çökersek
 * parça yeniden seçilir ve silme zaten tekrar edilebilir. Referans sayımı
 * okunamazsa parça hiç damgalanmaz — dosya korunur ve bir sonraki tur yeniden
 * dener (`photo-file-retention.ts` ile aynı duruş).
 */
export async function purgeExpiredQuoteFiles(now: Date): Promise<number> {
  const days = await retentionDays();
  if (days === null) return 0;
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  const due = await db
    .select({
      id: quoteParts.id,
      sourceKey: quoteParts.sourceKey,
      canonicalStlKey: quoteParts.canonicalStlKey,
      previewGlbKey: quoteParts.previewGlbKey,
      thumbnailKey: quoteParts.thumbnailKey,
      drawingKey: quoteParts.drawingKey,
    })
    .from(quoteParts)
    .innerJoin(quotes, eq(quotes.id, quoteParts.quoteId))
    .where(
      and(
        isNull(quoteParts.filesPurgedAt),
        inArray(quotes.status, PURGEABLE),
        isNull(quotes.orderId),
        lt(quotes.expiresAt, cutoff)
      )
    )
    // En eski vade önce: süresi en çok geçmiş dosya turlarca beklemesin.
    .orderBy(asc(quotes.expiresAt))
    .limit(PURGE_BATCH);

  let purged = 0;
  for (const part of due) {
    const keys = [
      ...new Set(
        [
          part.sourceKey,
          part.canonicalStlKey,
          part.previewGlbKey,
          part.thumbnailKey,
          part.drawingKey,
        ].filter((key): key is string => key !== null && key !== "")
      ),
    ];

    let unreadable = false;
    for (const key of keys) {
      let shared: boolean;
      try {
        shared = await keyReferencedElsewhere(key, part.id);
      } catch (err) {
        console.error("[quote-maintenance] referans sayımı okunamadı, dosya korundu", err);
        unreadable = true;
        continue;
      }
      if (shared) continue;
      // Dosya zaten yoksa da sorun değil: amaç "diskte kalmasın".
      await deleteFile(key).catch((err) =>
        console.error(`[quote-maintenance] ${key} silinemedi`, err)
      );
    }
    // Sayım okunamadıysa damga YAZILMAZ: parça bir sonraki turda yeniden
    // denenir, yoksa korunan dosya bir daha hiç aranmazdı.
    if (unreadable) continue;

    await db
      .update(quoteParts)
      .set({ filesPurgedAt: now })
      .where(and(eq(quoteParts.id, part.id), isNull(quoteParts.filesPurgedAt)));
    purged++;
  }
  return purged;
}

export interface QuoteMaintenanceOutcome {
  expired: number;
  expiryReminders: number;
  abandonedReminders: number;
  purgedParts: number;
}

/**
 * Saatlik turun kendisi.
 *
 * SIRA ÖNEMLİ: süre dolumu en başta koşar, böylece bu saat içinde kapanan bir
 * teklife "birkaç gün içinde bitiyor" yazılmaz.
 *
 * Her aşama kendi try/catch'indedir ve sonunda toplu bir hata fırlatılır.
 * Tek bir `try` olsaydı diskteki bir arıza (süpürme) yasal olarak gitmesi
 * gereken süre dolumu hatırlatmalarını haftalarca durdurabilirdi; fırlatmamak
 * ise arızayı kuyruğun gözünden saklardı. Bütün aşamalar tekrar
 * edilebilirdir, bu yüzden bullmq'nun yeniden denemesi zararsızdır.
 */
export async function runQuoteMaintenance(now: Date): Promise<QuoteMaintenanceOutcome> {
  const outcome: QuoteMaintenanceOutcome = {
    expired: 0,
    expiryReminders: 0,
    abandonedReminders: 0,
    purgedParts: 0,
  };
  const failures: string[] = [];

  const phase = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      console.error(`[quote-maintenance] ${name} başarısız`, err);
      failures.push(`${name}: ${(err as Error)?.message ?? err}`);
    }
  };

  await phase("expireQuotes", async () => {
    outcome.expired = await expireQuotes(now);
  });
  await phase("sendExpiryReminders", async () => {
    outcome.expiryReminders = await sendExpiryReminders(now);
  });
  await phase("sendAbandonedReminders", async () => {
    outcome.abandonedReminders = await sendAbandonedReminders(now);
  });
  await phase("purgeExpiredQuoteFiles", async () => {
    outcome.purgedParts = await purgeExpiredQuoteFiles(now);
  });

  if (failures.length > 0) throw new Error(`bakım turu eksik kaldı — ${failures.join(" | ")}`);
  return outcome;
}
