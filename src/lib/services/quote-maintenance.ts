/**
 * Anlık teklifin GÖZETİMSİZ yarısı: sahipsiz kalmış hediye kartı
 * rezervasyonları, son tarih işi kaybolmuş ödeme taslakları, süre dolumu, iki
 * hatırlatma, dosya saklama süresi, yetim dizinler ve çerçeve anlaşmaların iki
 * aşaması (serbest bırakma penceresi hatırlatması + fiyat kilidinin dolması).
 * Saatte bir `quote-maintenance` işi çağırır.
 *
 * ÇERÇEVE ANLAŞMALARIN TEKLİF TARAFINA ETKİSİ DÖRT KAPIDIR: süre dolumu ve
 * saklama süpürmesi, kapanmamış bir anlaşmanın KAYNAK teklifine dokunmaz (R2 —
 * dokunursa `copyPartInto` `files_purged` ile patlar ve planlı partiler bir daha
 * serbest bırakılamaz); iki hatırlatma da klon PARTİ tekliflerini dışarıda
 * bırakır (R6 — müşteri o teklifi hiç kurmadı). Dördü de `notExists(...)` ile
 * SORGUDA kurulur, sorgudan sonra JS'te süzülmez: sayfalama tavanları korunan
 * satırlarla doldurulup gerçek adayları sessizce kaydırırdı.
 *
 * Üç kural bütün dosyayı biçimlendirir:
 *
 * 1. **Hatırlatma SATIR SATIR damgalanır, damgadan hemen sonra gönderilir.**
 *    Damga, kendi kolonunun boş olmasını arayan koşullu bir
 *    `UPDATE … RETURNING`tır ve O SATIRIN mektubundan hemen önce yazılır; iki
 *    eşzamanlı tur (işçi yeniden başladı, zamanlayıcı iki kez tetikledi) aynı
 *    satırı sahiplenemez, çünkü ikinci `UPDATE` kilidi bekler ve satırın YENİ
 *    hâlini yeniden süzer.
 *
 *    PARTİYİ önden damgalamak bunun yerine GEÇMEZ: turun ortasına düşen bir
 *    SIGTERM (dağıtım) 200 satırın 195'ini "gönderildi" sayar, mektup hiç
 *    yazılmaz ve damga kolonu dolduğu için bir daha da yazılmaz. Satır başına
 *    damga ile kaybın tavanı, tam o an elde olan TEK mektuptur.
 *
 *    Gönderim başarısız olursa damga GERİ ALINMAZ. İki sebep: (a) `quote-notify`
 *    sözleşme gereği fırlatmaz (kendi içinde `try/catch`lidir), yani
 *    "başarısız" bilgisi buraya hiç ulaşmaz — ulaşsaydı da bir SMTP hatası
 *    mektubun kabul EDİLMEDİĞİ anlamına gelmezdi; (b) geri alınan damga, bir
 *    SMTP arızasında aynı adrese tur tur mektup yağdırır ve terk hatırlatması
 *    izin gerektiren bir TİCARİ İLETİDİR (ETK 6563/İYS). Kaybolan hatırlatma
 *    bir makbuz değil bir dürtmedir; iki kez gitmesi daha pahalıdır.
 * 2. **Terk hatırlatması TİCARİ İLETİDİR.** Sorgunun kendisi
 *    `users.marketing_consent = true` arar (ETK 6563 / İYS); `quote-notify`
 *    ayrıca kendi içinde de bakar. İki kapı bilerek üst üstedir: biri bir gün
 *    yanlış yazılırsa öteki hâlâ tutuyor olur. Süre dolumu hatırlatması
 *    İŞLEMSELDİR ve izin aramaz.
 * 3. **Silme geri alınamaz.** Saklama süpürmesi yalnız siparişe DÖNMEMİŞ,
 *    süresi dolmuş/iptal edilmiş tekliflerin parçalarına bakar ve bir dosyayı
 *    ancak onu gösteren başka bir (henüz süpürülmemiş) parça kalmadığında
 *    siler. Ayar satırı okunamazsa hiçbir şey silinmez. Yetim dizin süpürmesi
 *    aynı duruşun disk tarafıdır: SATIRI OLMAYAN dizine bakar, satırı olana ve
 *    beklemesi dolmayana asla dokunmaz.
 *
 * NOT: `import "server-only"` YOK ve zincirine de sızmamalı — bu modülü
 * standalone BullMQ worker süreci yükler. Özellikle `quote-checkout.ts`
 * import EDİLMEZ: o `attribution-server`i çeker, o da `server-only`dir ve
 * worker'ı crash-loop'a sokar (depo tarihindeki worker-server-only tuzağı).
 * `order-draft.ts` (terfi) bu kısıtı zaten taşıyor — ödeme son tarihi işçisi de
 * onu yüklüyor — ve graf `scripts/test-quote-maintenance-db.ts`te statik olarak
 * yürünerek çivilenmiş durumda.
 */
import {
  and,
  asc,
  eq,
  exists,
  gt,
  gte,
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
import type { SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderDrafts,
  quoteCheckouts,
  quoteFrameworkBatchLines,
  quoteFrameworkBatches,
  quoteFrameworks,
  quoteParts,
  quotePricingSettings,
  quotes,
  users,
} from "@/lib/db/schema";
import { CARD_DEADLINE_HOURS } from "@/lib/config/payment";
import {
  frameworkBatchLeadDays,
  frameworkReleaseWindowOpen,
  type FrameworkStatus,
} from "@/lib/config/quote-framework";
import type { QuoteStatus } from "@/lib/config/quote-types";
import { expireDraft, promoteDraftToOrder } from "@/lib/services/order-draft";
import {
  notifyFrameworkReleaseWindow,
  notifyQuoteAbandoned,
  notifyQuoteExpiring,
} from "@/lib/services/quote-notify";
import { deleteFile, deleteStoredDir, listStoredDirs } from "@/lib/services/storage";
import {
  QUOTE_PART_KEY_PREFIX,
  quotePartKeyReferenced,
  quotePartKeysExistUnder,
} from "@/lib/services/quote-part-files";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

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

/**
 * Yetim dizin süpürmesi bir dizine dokunmadan önce ne kadar beklemek zorunda.
 *
 * Ölçü tek bir pencereye dayanıyor: `addPart`/`copyPartInto` dosyayı AÇIK bir
 * işlemin içinde taşır, yani "dizin var ama satırı henüz görünmüyor" hâli
 * meşru olarak saniyeler sürer. Altı saat, o pencerenin dört büyüklük
 * mertebesi üstünde; buna karşılık sızıntı en kötü hâlde yarım iş günü diskte
 * kalır (tur saatte bir koşuyor). Kısaltmanın kazancı yok, uzatmanın bedeli
 * yok — güvenli tarafta duruyor.
 */
export const ORPHAN_DIR_GRACE_HOURS = 6;

/**
 * Bir turda en çok kaç yetim dizin SİLİNİR.
 *
 * Tavan silmeye konur, İNCELEMEYE değil: tur her seferinde beklemesi dolmuş
 * BÜTÜN dizinlere bakar ve yalnız sildiklerini sayar. Ters kurgu (en eski 200
 * dizini incele) bir süre sonra hiçbir yetimi bulamaz hâle gelirdi — en eski
 * 200 dizin neredeyse her zaman CANLI parçaların dizinidir, yani süpürme her
 * turda aynı 200 satırı doğrular ve arkalarındaki yetim sonsuza dek beklerdi.
 */
export const ORPHAN_DIR_BATCH = 200;

/**
 * Satır kapısının tek sorgusunda en çok kaç dizin adı sorulur.
 *
 * `IN (…)` listesinin uzunluğuna bir tavan gerekiyor: yıllar içinde on binlerce
 * parça dizini birikir ve hepsini tek sorguya koymak hem planlayıcıyı hem de
 * protokol tamponunu zorlardı. Dizinler öbek öbek sorulur, öbek sayısı da
 * doğrudan dizin sayısıyla artar (saatte bir koşan bir iş için kabul edilebilir
 * bir bedel; alternatifi kalıcı bir tarama imleci, yani yeni bir tablo).
 */
const ORPHAN_DIR_QUERY_CHUNK = 200;

/** Kimlik biçimi: dizin adı bir parça kimliği (uuid) olmalı, yoksa dokunulmaz. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KAPANMAMIŞ anlaşma durumları: bundan daha fazla parti SERBEST BIRAKILABİLİR.
 *
 * Ölçü bilerek bu kadar DAR: `cancelled` / `expired` / `completed` bir anlaşmada
 * `releaseBatch` zaten reddediyor (`framework_not_active`), yani o anlaşmanın
 * kaynak teklifinden bir daha klon ÜRETİLMEZ ve dosyalarını tutmanın işletme
 * gerekçesi kalmaz. Kümeyi "her çerçeve" yapmak, iptal edilmiş bir anlaşmanın
 * dosyalarını sonsuza dek diskte tutmak olurdu.
 *
 * Anlaşmanın KENDİSİNİN ticari defter saklaması bu süpürmeden BAĞIMSIZDIR:
 * taahhüt, kilitli birim fiyatlar ve donmuş katalog `quote_frameworks` satırında
 * (`parts_snapshot` + `pricing_snapshot`) durur ve bu tur ona HİÇ dokunmaz —
 * yalnız parça DOSYALARINI siler.
 */
const LIVE_FRAMEWORK_STATUSES: FrameworkStatus[] = ["draft", "active"];

/**
 * R2'NİN KAPISI: bu teklif, kapanmamış bir çerçeve anlaşmanın KAYNAK teklifi mi?
 *
 * Neden kapı: `releaseBatch` → `cloneQuoteForFrameworkBatch` → `copyPartInto`
 * dosyaları kaynak parçadan hardlink'liyor. Kaynak teklifin dosyaları silinirse
 * (ya da teklif `expired`a çekilip süpürmenin adayı yapılırsa) klon
 * `files_purged` (409) ile patlar ve PLANLI PARTİLER BİR DAHA SERBEST
 * BIRAKILAMAZ. Yani bu kapı bir saklama tercihi değil, imzalanmış bir
 * anlaşmanın yerine getirilebilmesinin şartı.
 *
 * Kapı SORGUDA kurulur, sorgudan sonra JS'te süzülmez: iki sorgunun da
 * sayfalama tavanı var (`PURGE_BATCH`) ve sonradan süzmek, korunan satırların
 * tavanı doldurup arkalarındaki gerçek adayları sessizce kaydırması demekti.
 */
function noLiveFrameworkOnQuote(): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(quoteFrameworks)
      .where(
        and(
          eq(quoteFrameworks.quoteId, quotes.id),
          inArray(quoteFrameworks.status, LIVE_FRAMEWORK_STATUSES)
        )
      )
  );
}

/**
 * R6'NIN KAPISI: bu teklif bir çerçeve anlaşmanın KLON PARTİSİ mi?
 *
 * Klon parti teklifi sıradan bir `quotes` satırıdır, o yüzden iki hatırlatmanın
 * da adayı olur — ama ikisi de MÜŞTERİYE YANLIŞ HİKÂYEYİ anlatır: "teklifinin
 * süresi doluyor" dediği şey anlaşmada kilitli bir fiyattır ve müşterinin
 * yapacağı bir şey yoktur; "teklifini tamamla" dediği şey ise müşterinin hiç
 * kurmadığı bir teklif (partiyi admin serbest bıraktı). İkincisi üstelik ticari
 * ileti, yani gereksiz posta + İYS gürültüsü.
 *
 * Ölçü partinin DURUMUNA bakmaz: bir parti satırı varsa o teklif bir partidir.
 * İptal edilmiş bir partinin klonu da müşterinin kendi kurduğu bir teklif
 * değildir.
 */
function notFrameworkBatchQuote(): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(quoteFrameworkBatches)
      .where(eq(quoteFrameworkBatches.quoteId, quotes.id))
  );
}

/**
 * Süresi geçen teklifleri kapatır ve kaç tanesinin kapandığını döner.
 *
 * `order_id IS NULL` koşulu, durum süzgecinin üstüne konan İKİNCİ kapıdır:
 * ödenmiş bir teklifin satırı `ordered`dır, ama ödeme yolu ile bu tur
 * çakışırsa (webhook tam bu saniyede bağlıyorsa) teklif yine de
 * kapatılmamalı. Ters yön zararsızdır: `linkQuoteToOrderTx` yalnız
 * `order_id IS NULL` arar ve durumu `ordered` yazar, yani bu tur bir ödemeyi
 * kilitleyemez.
 *
 * ÜÇÜNCÜ KAPI (R2): kapanmamış bir çerçeve anlaşmanın KAYNAK teklifi `expired`a
 * ÇEKİLMEZ. İki sebep üst üste: (a) süresi dolmuş sayılan teklif saklama
 * süpürmesinin de adayı olur ve dosyaları silinince planlı partiler bir daha
 * serbest bırakılamaz; (b) anlaşmanın geçerliliğini `price_locked_until`
 * söyler, kaynak teklifin `expires_at`i değil — teklifi kapatmak müşterinin
 * imzalı anlaşmasını ekranda "süresi doldu" diye göstermekti.
 */
export async function expireQuotes(now: Date): Promise<number> {
  const expired = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(quotes.status, EXPIRABLE),
        isNull(quotes.orderId),
        lt(quotes.expiresAt, now),
        noLiveFrameworkOnQuote()
      )
    )
    .returning({ id: quotes.id });
  return expired.length;
}

/**
 * Adayları SATIR SATIR sahiplenip gönderir; kaç satırın sahiplenildiğini döner.
 *
 * Döngünün şekli sözleşmenin kendisi: her tur için tek bir koşullu
 * `UPDATE … RETURNING`, hemen ardından O SATIRIN mektubu. Aday listesi
 * (`due` + sıralama + `REMINDER_BATCH`) bir turun tavanını verir, ama hiçbir
 * satır kendi mektubundan önce damgalanmaz — dağıtımın ortasında gelen bir
 * SIGTERM en çok elde olan TEK mektubu kaybeder (bkz. dosya başı, kural 1).
 *
 * Koşul UPDATE'in kendi `WHERE`'inde İKİNCİ kez kurulur ve bu bilinçlidir:
 * postgres satırı kilitledikten sonra `WHERE`i satırın YENİ hâline karşı
 * yeniden değerlendirir. Böylece (a) aynı anda koşan ikinci bir tur aynı satırı
 * sahiplenemez (damga kolonu artık dolu), (b) aday seçildikten sonra uygunluğu
 * kaybeden satıra mektup yazılmaz (ödeme bağlandı, teklif kapandı).
 *
 * `updated_at`e DOKUNULMAZ. Dokunsaydı terk ölçüsü ("24 saattir dokunulmadı")
 * işin kendi yan etkisiyle sıfırlanır, terk hatırlatması hiçbir zaman gitmezdi.
 */
async function claimAndSendReminders(
  kind: "expiry" | "abandoned",
  due: SQL | undefined,
  order: SQL,
  now: Date
): Promise<number> {
  const stamp =
    kind === "expiry" ? { expiryReminderSentAt: now } : { abandonedReminderSentAt: now };
  const notify = kind === "expiry" ? notifyQuoteExpiring : notifyQuoteAbandoned;

  const candidates = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(due)
    .orderBy(order)
    .limit(REMINDER_BATCH);

  let sent = 0;
  for (const candidate of candidates) {
    const [claimed] = await db
      .update(quotes)
      .set(stamp)
      .where(and(eq(quotes.id, candidate.id), due))
      .returning({ id: quotes.id });
    if (!claimed) continue;
    // `notifyQuote*` kendi içinde try/catch'lidir ve FIRLATMAZ (quote-notify
    // kural 1): bir adresin düşmesi kalan hatırlatmaları düşürmez. Damga da
    // geri alınmaz — gerekçesi dosya başında.
    await notify(claimed.id);
    sent++;
  }
  return sent;
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
  const due = and(
    inArray(quotes.status, REMINDABLE),
    isNull(quotes.orderId),
    isNotNull(quotes.userId),
    isNotNull(quotes.totalKurus),
    isNull(quotes.expiryReminderSentAt),
    gt(quotes.expiresAt, now),
    lte(quotes.expiresAt, horizon),
    // R6: klon parti teklifine "teklifinizin süresi dolmak üzere" yazılmaz.
    notFrameworkBatchQuote()
  );
  // En yakın vade önce: sınıra takılan teklif, bir sonraki tura kalırken
  // süresini doldurmuş olmasın.
  return claimAndSendReminders("expiry", due, asc(quotes.expiresAt), now);
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
  // İzin kapısı `exists` ile kurulur, `innerJoin` ile değil: AYNI koşul hem aday
  // sorgusunda hem de satır başına `UPDATE`te geçmek zorunda ve bir UPDATE'e
  // join taşınamaz. Ölçü değişmiyor — `users.id` tekil, yani join'in seçtiği
  // satır kümesiyle birebir aynı (ve `user_id IS NULL` iki hâlde de eşleşmez).
  const due = and(
    inArray(quotes.status, REMINDABLE),
    isNull(quotes.orderId),
    isNotNull(quotes.totalKurus),
    isNull(quotes.abandonedReminderSentAt),
    gt(quotes.expiresAt, now),
    lt(quotes.updatedAt, idleBefore),
    exists(
      db
        .select({ one: sql`1` })
        .from(users)
        .where(and(eq(users.id, quotes.userId), eq(users.marketingConsent, true)))
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(quoteCheckouts)
        .where(eq(quoteCheckouts.quoteId, quotes.id))
    ),
    // R6: klon parti teklifine "yarım kalan teklifiniz duruyor" YAZILMAZ —
    // müşteri o teklifi hiç kurmadı (partiyi admin serbest bıraktı) ve bu bir
    // TİCARİ İLETİ, yani gereksiz posta + İYS gürültüsü.
    notFrameworkBatchQuote()
  );
  // En uzun süredir bekleyen önce.
  return claimAndSendReminders("abandoned", due, asc(quotes.updatedAt), now);
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
        lt(quotes.expiresAt, cutoff),
        // R2, EN SOMUT RİSK: kapanmamış bir çerçeve anlaşmanın kaynak teklifinin
        // dosyaları SİLİNMEZ. Silinirse `copyPartInto` `files_purged` (409) ile
        // patlar ve o anlaşmanın planlı partileri bir daha serbest
        // bırakılamaz — imzalanmış bir sözleşme yerine getirilemez hâle gelir.
        noLiveFrameworkOnQuote()
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
        shared = await quotePartKeyReferenced(key, { excludePartId: part.id });
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

/**
 * SATIRI OLMAYAN parça dizinlerini toplar; silinen dizin sayısını döner.
 *
 * Neden var: `addPart` sahnelenen dosyayı, parça satırını yazan İŞLEMİN İÇİNDE
 * `quote-parts/<yeni kimlik>/` altına taşır (ters sıra dosyasız bir parça
 * bırakırdı). İşlem geri alınırsa dosya orada kalır ve hiçbir satır onu
 * göstermez — yani `purgeExpiredQuoteFiles` onu ASLA bulamaz, çünkü o yalnız
 * satırlardan okuduğu anahtarları siler. `copyPartInto` da (kütüphane/yeniden
 * teklif) aynı deseni izler. Bu süpürme o sızıntının tek toplayıcısıdır.
 *
 * ÜÇ KAPI, hepsi "canlı bir dosyaya asla dokunma" için:
 *
 * 1. **Kimlik biçimi.** Dizin adı bir uuid değilse dokunulmaz: bizim
 *    yazmadığımız (operatörün elle bıraktığı, bir yedeğin açıldığı) bir klasörü
 *    silmek, bu işin işi değil.
 * 2. **Satır kapısı.** Adı bir parça kimliği OLAN dizin, o satır silinmiş
 *    (`deleted_at`) ya da dosyaları süpürülmüş (`files_purged_at`) olsa bile
 *    dokunulmaz. Satır duruyorsa dizin hâlâ o parçanın dizinidir.
 * 3. **Anahtar kapısı.** Satırı olmayan bir dizinin içindeki dosyayı BAŞKA bir
 *    satır gösteriyor olabilir (`duplicatePart` anahtarı paylaşır): o hâlde de
 *    dokunulmaz. Sorgu okunamazsa dizin korunur ve bir sonraki tur yeniden
 *    dener — silme geri alınamaz.
 *
 * Bekleme süresi (`ORPHAN_DIR_GRACE_HOURS`) dördüncü kapıdır: açık bir işlem
 * dosyayı tam şu an taşımış olabilir, satırı henüz kimse göremez.
 *
 * Siparişe kopyalanmış dosyalar bu süpürmenin DIŞINDADIR: onlar
 * `models/<orderId>/` altında İKİNCİ bir ada bağlıdır, bu süpürme ise yalnız
 * `quote-parts/` önekine bakar.
 */
export async function sweepOrphanQuotePartDirs(now: Date): Promise<number> {
  const cutoff = now.getTime() - ORPHAN_DIR_GRACE_HOURS * HOUR_MS;
  const candidates = (await listStoredDirs(QUOTE_PART_KEY_PREFIX))
    .filter((dir) => dir.modifiedMs < cutoff && UUID_RE.test(dir.name))
    // En eski önce: en uzun süredir yerde duran artık ilk sırada gider.
    .sort((a, b) => a.modifiedMs - b.modifiedMs)
    .map((dir) => dir.name);

  let swept = 0;
  for (let at = 0; at < candidates.length; at += ORPHAN_DIR_QUERY_CHUNK) {
    const chunk = candidates.slice(at, at + ORPHAN_DIR_QUERY_CHUNK);
    // 1. SATIR KAPISI: adı bir parça kimliği olan dizine dokunulmaz.
    const withRow = new Set(
      (
        await db
          .select({ id: quoteParts.id })
          .from(quoteParts)
          .where(inArray(quoteParts.id, chunk))
      ).map((row) => row.id)
    );

    for (const name of chunk) {
      if (swept >= ORPHAN_DIR_BATCH) return swept;
      if (withRow.has(name)) continue;
      // 2. ANAHTAR KAPISI: dizindeki bir dosyayı başka bir satır gösteriyor mu?
      let referenced: boolean;
      try {
        referenced = await quotePartKeysExistUnder(name);
      } catch (err) {
        console.error(`[quote-maintenance] ${name} anahtar sayımı okunamadı, dizin korundu`, err);
        continue;
      }
      if (referenced) continue;
      try {
        await deleteStoredDir(`${QUOTE_PART_KEY_PREFIX}/${name}`);
      } catch (err) {
        console.error(`[quote-maintenance] yetim dizin ${name} silinemedi`, err);
        continue;
      }
      swept++;
    }
  }
  return swept;
}

/**
 * Tamamı hediye kartıyla karşılanan taslağa, kendi isteği terfiyi denemesi için
 * bırakılan süre.
 *
 * Ödeme isteği rezervasyonu yazdıktan HEMEN sonra `promoteDraftToOrder`u çağırır
 * (tasarım §5.4, birinci koruma). Bu tur o denemenin rakibi değil, ağıdır: on
 * dakika, en yavaş terfinin (sipariş yazımı + e-posta + kuyruk) iki büyüklük
 * mertebesi üstünde, ama müşterinin bakiyesi harcanmışken siparişini beklediği
 * süre olarak da kısa. Kısaltmak iki tarafın aynı taslağı aynı anda terfi
 * ettirmeye çalışmasından başka bir şey kazandırmaz (`promoteDraftToOrder`
 * idempotent olduğu için zararsız ama faydasız); uzatmak müşteriyi bekletir.
 */
export const STUCK_GIFT_DRAFT_GRACE_MINUTES = 10;

/**
 * Bir turda en çok kaç sahipsiz rezervasyon terfi ettirilir.
 *
 * Tavan hatırlatmalardan düşük: her terfi bir sipariş yazımı, e-posta ve kuyruk
 * işidir (hatırlatma yalnız bir mektup). Bu aşamanın normal yükü SIFIRDIR —
 * sıraya girmiş elli taslak, ödeme yolunda sistemik bir arıza demektir ve o
 * hâlde de biriken iş turdan tura eritilir.
 */
export const STUCK_GIFT_DRAFT_BATCH = 50;

/**
 * SAHİPSİZ KALMIŞ hediye kartı rezervasyonlarını siparişe çevirir; kaç taslağın
 * siparişi doğduğunu döner.
 *
 * NEDEN VAR (tasarım §5.4, ÜÇÜNCÜ koruma): tutarın tamamı hediye kartından
 * karşılandığında bakiye ödeme İŞLEMİNDE düşer ve sipariş o işlemden SONRA
 * yazılır (`promoteDraftToOrder`). Arada süreç ölürse müşterinin kartı
 * harcanmıştır ama siparişi yoktur — parası tutulmuş demektir. Birinci koruma
 * isteğin kendi terfi denemesi, ikincisi `card-expire` işi (süre sonunda bakiyeyi
 * KARTA geri verir), bu da üçüncüsü: sipariş birkaç dakika içinde doğsun, müşteri
 * süre dolumunu beklemek zorunda kalmasın.
 *
 * KAPSAM teklif taslaklarıdır (`quote_checkouts` köprüsü): bu tur teklif
 * motorunun bakımı ve `/api/orders` yolunun kendi kuralları var (orası
 * `gift_card_full` taslağı için `card-expire` işini de kuyruğa almıyor). Oranın
 * sahipsiz taslağını buradan terfi ettirmek, sahibi bu iş olmayan bir davranış
 * değişikliği olurdu.
 *
 * KOŞULLU YAZIM `promoteDraftToOrder`ın KENDİSİDİR: taslağı satır kilidi altında
 * okur ve yalnız `pending`/`awaiting_review` iken `confirmed`a çevirir, yani iki
 * eşzamanlı tur (ya da tur + müşterinin isteği) ikinci bir sipariş yazamaz.
 * Hatırlatmaların "damgala-sonra-gönder" deseni buraya TAŞINAMAZ, çünkü
 * sahiplenilecek bir damga kolonu yok (bu iş migration açmıyor) ve terfinin
 * kendi atomik durum geçişi zaten o işi yapıyor.
 *
 * SESSİZ YUTMA YOK: her başarısız terfi toplanır ve aşama SONUNDA fırlatır, yani
 * tur kırmızıya döner ve hangi taslağın takıldığı günlüğe geçer. TEK istisna,
 * taslağın aday seçildikten sonra uygunluğunu KAYBETMESİ
 * (`DRAFT_NOT_PROMOTABLE`): süre dolumu işi, webhook ya da müşterinin iptali
 * araya girmiştir — ağın işi kalmamıştır, arıza yoktur.
 */
export async function promoteStuckGiftCoveredDrafts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_GIFT_DRAFT_GRACE_MINUTES * MINUTE_MS);
  const candidates = await db
    .select({ id: orderDrafts.id, reference: orderDrafts.reference })
    .from(orderDrafts)
    .where(
      and(
        eq(orderDrafts.paymentMethod, "gift_card_full"),
        eq(orderDrafts.status, "pending"),
        isNull(orderDrafts.promotedOrderId),
        lt(orderDrafts.createdAt, cutoff),
        // Köprü `exists` ile sorulur (join ile değil): tur yalnız KİMLİKLERİ
        // okuyor ve köprü satırı teklif başına tekil değil de olsa aynı taslak
        // iki kez listelenmemeli.
        exists(
          db
            .select({ one: sql`1` })
            .from(quoteCheckouts)
            .where(eq(quoteCheckouts.draftId, orderDrafts.id))
        )
      )
    )
    // En uzun süredir bekleyen önce: parası en uzun süre tutulmuş müşteri.
    .orderBy(asc(orderDrafts.createdAt))
    .limit(STUCK_GIFT_DRAFT_BATCH);

  let promoted = 0;
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      await promoteDraftToOrder(candidate.id);
      promoted++;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      if (message.startsWith("DRAFT_NOT_PROMOTABLE")) {
        // Aday seçildikten sonra taslak uygunluğunu kaybetti (süre dolumu,
        // webhook, müşteri iptali). `api/webhooks/paytr/route.ts` de bu hâli
        // aynı şekilde ayırt ediyor.
        console.warn(
          `[quote-maintenance] ${candidate.reference} artık terfi edilebilir değil: ${message}`
        );
        continue;
      }
      console.error(`[quote-maintenance] ${candidate.reference} terfi edemedi`, err);
      failures.push(`${candidate.reference}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `sahipsiz hediye kartı rezervasyonu siparişe çevrilemedi — ${failures.join(" | ")}`
    );
  }
  return promoted;
}

/**
 * Bir turda en çok kaç sahipsiz taslak kapatılır.
 *
 * Tavan terfi aşamasıyla aynı: her kapanış bir iade işlemi, bir mektup ve bir
 * kuyruk temizliğidir. Bu aşamanın normal yükü de SIFIRDIR — sıraya girmiş elli
 * taslak, son tarih işlerinin sistemik olarak kuyruğa girmediği anlamına gelir
 * ve o hâlde biriken iş turdan tura eritilir.
 */
export const STRANDED_DRAFT_BATCH = 50;

/**
 * SON TARİH İŞİ KAYBOLMUŞ teklif taslaklarını süresi geçtiğinde kapatır; kaç
 * taslak için süre dolumunun çağrıldığını döner.
 *
 * NEDEN VAR: ödeme başlatmanın kuyruk eklemeleri taslak işlemi COMMIT olduktan
 * sonra koşar ve EN İYİ ÇABADIR (`quote-checkout.ts` → `enqueueAfterCommit`) —
 * bakiye o commit'te çoktan düşmüşken Redis erişilemez diye isteği patlatmak,
 * müşteriye hem hata hem gitmiş bakiye göstermek olurdu. Bedeli şu: iş hiç
 * kuyruğa girmemiş olabilir (ya da Redis temizlenmiş, işçi hiç koşmamış).
 * O hâlde taslak sonsuza dek `pending` kalır, teklif canlı taslağı yüzünden
 * SALT OKUNUR durur (müşteri havaleye de geçemez) ve hediye kartı bakiyesi
 * rezervasyonda kilitli kalır. Bu aşama, eksik işin yapacağı şeyi yapar.
 *
 * KAPSAM YALNIZ TEKLİF TASLAKLARIDIR (`quote_checkouts` köprüsü). Atölye
 * tutmalarının (`workshop-close` işçisi) ve `/api/orders` taslaklarının kendi
 * süpürmeleri, kendi pencereleri ve kendi iptal metinleri var; onları buradan
 * kapatmak kapsam dışı bir davranış değişikliği olurdu.
 *
 * SON TARİH ÖLÇÜSÜ ödeme yolunu izler: havalede kapı `bank_transfer_deadline`
 * KOLONUDUR (admin uzatmış olabilir ve dekontu yolda olan bir ödemeyi kapatmak
 * müşterinin parasını yolda yakalamak olurdu), kartta ve tam karşılamada
 * `created_at + CARD_DEADLINE_HOURS` — `card-expire` işinin gecikmesiyle birebir
 * aynı ölçü.
 *
 * KOŞULLU YAZIM `expireDraft`ın KENDİSİDİR: taslağı satır kilidi altında okur,
 * yalnız `pending`/`awaiting_review` iken kapatır ve iadeyi aynı işlemde yapar
 * (`refundGiftCardForDraft`), yani iki eşzamanlı tur bakiyeyi iki kez geri
 * veremez ve tam o an gelen bir ödemeyi kilitleyemez.
 *
 * SESSİZ YUTMA YOK: her başarısız kapanış toplanır ve aşama SONUNDA fırlatır.
 * Kapanamayan bir taslak, bakiyesi kilitli kalmış bir müşteri demektir; bunu
 * bir gösterge söylemek zorunda.
 */
export async function expireStrandedQuoteDrafts(now: Date): Promise<number> {
  const cardCutoff = new Date(now.getTime() - CARD_DEADLINE_HOURS * HOUR_MS);
  const candidates = await db
    .select({ id: orderDrafts.id, reference: orderDrafts.reference })
    .from(orderDrafts)
    .where(
      and(
        // `awaiting_review` DIŞARIDA (oysa `expireDraft` onu da kapatabilir):
        // dekontu yüklenmiş bir taslak admin incelemesini bekliyor, yani
        // müşteri ödemesini YAPMIŞ olabilir. Onu süresi geçmiş saymak, gelmiş
        // bir havaleyi kapıda çevirmek olurdu.
        eq(orderDrafts.status, "pending"),
        // Köprü `exists` ile sorulur (join ile değil): tur yalnız KİMLİKLERİ
        // okuyor ve köprü satırı taslak başına tekil değil de olsa aynı taslak
        // iki kez listelenmemeli.
        exists(
          db
            .select({ one: sql`1` })
            .from(quoteCheckouts)
            .where(eq(quoteCheckouts.draftId, orderDrafts.id))
        ),
        or(
          and(
            eq(orderDrafts.paymentMethod, "bank_transfer"),
            // NULL kolon eşleşmez: son tarihi olmayan bir havale taslağı
            // kapatılmaz (yazılmamış bir vadeyi geçmiş saymak olurdu).
            lt(orderDrafts.bankTransferDeadline, now)
          ),
          and(
            ne(orderDrafts.paymentMethod, "bank_transfer"),
            lt(orderDrafts.createdAt, cardCutoff)
          )
        )
      )
    )
    // En uzun süredir bekleyen önce: bakiyesi en uzun süre kilitli kalmış
    // müşteri.
    .orderBy(asc(orderDrafts.createdAt))
    .limit(STRANDED_DRAFT_BATCH);

  let expired = 0;
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      await expireDraft(candidate.id);
      // Sayı, süre dolumunun ÇAĞRILDIĞI taslak sayısıdır: `expireDraft` void
      // döner ve idempotent olduğu için "zaten kapanmıştı" hâli buradan
      // ayırt edilemez. Aday süzgeci `pending` aradığı için sapmanın tek
      // kaynağı bu turla yarışan bir ödeme/iptaldir.
      expired++;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      console.error(`[quote-maintenance] ${candidate.reference} sonlandırılamadı`, err);
      failures.push(`${candidate.reference}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`sahipsiz teklif taslağı sonlandırılamadı — ${failures.join(" | ")}`);
  }
  return expired;
}

/**
 * Bir turda en çok kaç ANLAŞMAYA serbest bırakma hatırlatması gider.
 *
 * Tavan hatırlatmalardan düşük (`REMINDER_BATCH` 200): bir anlaşma mektubu İKİ
 * mektuptur (müşteri + admin) ve bu aşamanın normal yükü SIFIRA yakındır — tur
 * saatte bir koşuyor, kuyruğa girmiş yüz anlaşma iki yıllık bir plan defterinin
 * aynı güne yığılması demektir. Artanı bir sonraki tur alır (damga kolonu
 * sayesinde kaldığı yerden).
 */
export const FRAMEWORK_REMINDER_BATCH = 100;

/**
 * SERBEST BIRAKMA PENCERESİ açılmış planlı partisi olan anlaşmalara hatırlatma;
 * kaç anlaşmanın sahiplenildiğini döner.
 *
 * ─── DAMGA SATIR SATIR, GÖNDERİM DAMGADAN HEMEN SONRA ───────────────────────
 *
 * Damganın satırı ANLAŞMADIR (`quote_frameworks.release_reminder_sent_at`):
 * parti tablosunda damga kolonu yok ve bu tur migration AÇMIYOR. Damga, kendi
 * kolonunun boş olmasını arayan koşullu bir `UPDATE … RETURNING`tır ve O
 * SATIRIN mektubundan hemen önce yazılır; iki eşzamanlı tur aynı anlaşmayı
 * sahiplenemez.
 *
 * BUNUN BİLİNEN SINIRI: mektup anlaşma başına BİR KEZ gider — ilk penceresi
 * açılan parti için. İkinci ve sonraki partilerin penceresi açıldığında
 * müşteriye yeni bir mektup YAZILMAZ, çünkü damgalanacak ikinci bir kolon
 * yok. Yanlış olan davranış bu değil, ALTERNATİFİ: damgayı her turda
 * temizlemek ya da hiç damgalamamak, aynı adrese tur tur (saatte bir) mektup
 * yağdırırdı. ADMİN tarafında eksik yok — kenar çubuğu rozeti
 * (`releasableBatchCount`) penceresi açık PARTİLERİ sürekli sayıyor ve bu
 * aşamanın mektubu admin'e de gidiyor; kaybolan şey yalnız müşteriye giden
 * TEKRAR bildirimidir. Parti başına bildirim isteniyorsa bir kolon (ve bir
 * migration) gerekir; o ayrı bir turun işi.
 *
 * PARTİ HÂLİNDE ÖNDEN DAMGALAMAK BUNUN YERİNE GEÇMEZ: turun ortasına düşen bir
 * SIGTERM, damgalanmış ama mektubu yazılmamış anlaşmalar bırakırdı ve damga
 * dolduğu için bir daha da yazılmazdı (dosyanın 1. kuralı).
 *
 * GÖNDERİM BAŞARISIZ OLURSA DAMGA GERİ ALINMAZ: `quote-notify` sözleşme gereği
 * fırlatmaz (kendi `safe` kabuğu var), yani "başarısız" bilgisi buraya normalde
 * hiç ulaşmaz; ulaştığı gün de geri alınan bir damga SMTP arızasında aynı
 * adrese tur tur mektup yağdırırdı. Hata YUTULMAZ ama: toplanır ve aşama
 * SONUNDA fırlatır, `phase(...)` onu tura taşır ve kuyruk işi kırmızıya döner.
 *
 * ─── İŞLEMSEL, TİCARİ İLETİ DEĞİL ──────────────────────────────────────────
 *
 * `users.marketing_consent` ARANMAZ (`sendExpiryReminders` sınıfı): imzalanmış
 * bir anlaşmanın parti planında zamanın geldiğini bildirmek bir satış iletisi
 * değildir. Terk hatırlatması aranır; ikisini karıştırmak ya İYS ihlali ya
 * gereksiz bir kapı olurdu.
 *
 * ─── ÜÇ SORGU VE SIRANIN GEREKÇESİ ─────────────────────────────────────────
 *
 * Pencere ölçüsü İŞ GÜNÜ aritmetiğidir ve tatil listesi anlaşmanın DONMUŞ
 * `pricing_snapshot`ında duruyor, yani SQL'de ölçülemez. Bu yüzden sorgu
 * ANLAŞMAYI daraltır (aktif + kilidi dolmamış + damgası boş + planlı partisi
 * var), pencereyi `frameworkReleaseWindowOpen` ölçer. Adaylar EN YAKIN planlı
 * sevk tarihine göre sıralanır: tavana takılan anlaşma, penceresi açık olma
 * olasılığı EN DÜŞÜK olandır (penceresi açık bir parti tanımı gereği en yakın
 * tarihlilerdendir), yani tavan gerçek adayları kaydırmaz.
 *
 * Pencere her partinin KENDİ parçalarıyla ölçülür (`frameworkBatchLeadDays`),
 * anlaşma geneli maksimumla DEĞİL: plan kapısı da öyle ölçüyor ve ikisini
 * birbirinin yerine yazmak hızlı parçalı bir partinin penceresini günler önce
 * açardı.
 */
export async function sendFrameworkReleaseReminders(
  now: Date,
  /**
   * Mektubu atan işlev. ÜRETİMDE DAİMA varsayılanıdır; parametre yalnız
   * "gönderim fırlatırsa tur KIRMIZI olur" değişmezinin sınanabilmesi için var
   * — `quote-notify` sözleşme gereği fırlatmadığı için bu yolu başka hiçbir
   * şey tetikleyemez ve yutma sessizce geri gelirdi.
   */
  notify: (frameworkId: string) => Promise<void> = notifyFrameworkReleaseWindow
): Promise<number> {
  const earliestPlanned = sql<string | null>`(
    SELECT min(${quoteFrameworkBatches.plannedShipDate})
    FROM ${quoteFrameworkBatches}
    WHERE ${quoteFrameworkBatches.frameworkId} = ${quoteFrameworks.id}
      AND ${quoteFrameworkBatches.status} = 'planned'
  )`;
  const candidates = await db
    .select({
      id: quoteFrameworks.id,
      number: quoteFrameworks.number,
      leadTier: quoteFrameworks.leadTier,
      addonKeys: quoteFrameworks.addonKeys,
      partsSnapshot: quoteFrameworks.partsSnapshot,
      pricingSnapshot: quoteFrameworks.pricingSnapshot,
    })
    .from(quoteFrameworks)
    .where(
      and(
        eq(quoteFrameworks.status, "active"),
        // Kilidin süresi TARİHE bakılarak ölçülür, bu turun ne zaman koştuğuna
        // bakılarak değil: `releaseBatch` de öyle ölçüyor, yani kilidi dolmuş
        // bir anlaşmanın partisi için "bugün bırak" demek 409 veren bir işe
        // çağırmak olurdu.
        gte(quoteFrameworks.priceLockedUntil, now),
        isNull(quoteFrameworks.releaseReminderSentAt),
        exists(
          db
            .select({ one: sql`1` })
            .from(quoteFrameworkBatches)
            .where(
              and(
                eq(quoteFrameworkBatches.frameworkId, quoteFrameworks.id),
                eq(quoteFrameworkBatches.status, "planned")
              )
            )
        )
      )
    )
    .orderBy(asc(earliestPlanned))
    .limit(FRAMEWORK_REMINDER_BATCH);
  if (candidates.length === 0) return 0;

  const ids = candidates.map((c) => c.id);
  const plannedBatches = await db
    .select({
      id: quoteFrameworkBatches.id,
      frameworkId: quoteFrameworkBatches.frameworkId,
      plannedShipDate: quoteFrameworkBatches.plannedShipDate,
    })
    .from(quoteFrameworkBatches)
    .where(
      and(
        inArray(quoteFrameworkBatches.frameworkId, ids),
        eq(quoteFrameworkBatches.status, "planned")
      )
    )
    .orderBy(asc(quoteFrameworkBatches.plannedShipDate));
  const lineRows =
    plannedBatches.length === 0
      ? []
      : await db
          .select({
            batchId: quoteFrameworkBatchLines.batchId,
            partId: quoteFrameworkBatchLines.partId,
          })
          .from(quoteFrameworkBatchLines)
          .where(
            inArray(
              quoteFrameworkBatchLines.batchId,
              plannedBatches.map((b) => b.id)
            )
          );
  const partsByBatch = new Map<string, string[]>();
  for (const line of lineRows) {
    const list = partsByBatch.get(line.batchId) ?? [];
    list.push(line.partId);
    partsByBatch.set(line.batchId, list);
  }
  const batchesByFramework = new Map<string, typeof plannedBatches>();
  for (const batch of plannedBatches) {
    const list = batchesByFramework.get(batch.frameworkId) ?? [];
    list.push(batch);
    batchesByFramework.set(batch.frameworkId, list);
  }

  let sent = 0;
  const failures: string[] = [];
  for (const framework of candidates) {
    const open = (batchesByFramework.get(framework.id) ?? []).some((batch) =>
      frameworkReleaseWindowOpen({
        snapshot: framework.pricingSnapshot,
        leadDays: frameworkBatchLeadDays({
          snapshot: framework.pricingSnapshot,
          leadTier: framework.leadTier,
          parts: framework.partsSnapshot,
          addonKeys: framework.addonKeys,
          linePartIds: partsByBatch.get(batch.id) ?? [],
        }),
        plannedShipDate: batch.plannedShipDate,
        now,
      })
    );
    if (!open) continue;
    // `updated_at`e DOKUNULMAZ: o kolon anlaşmanın son GERÇEK değişikliğini
    // söylüyor ve bir hatırlatma anlaşmayı değiştirmez.
    const [claimed] = await db
      .update(quoteFrameworks)
      .set({ releaseReminderSentAt: now })
      .where(
        and(
          eq(quoteFrameworks.id, framework.id),
          isNull(quoteFrameworks.releaseReminderSentAt)
        )
      )
      .returning({ id: quoteFrameworks.id });
    if (!claimed) continue;
    try {
      await notify(claimed.id);
      sent++;
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      console.error(
        `[quote-maintenance] ${framework.number} serbest bırakma hatırlatması gönderilemedi`,
        err
      );
      failures.push(`${framework.number}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `çerçeve serbest bırakma hatırlatması gönderilemedi — ${failures.join(" | ")}`
    );
  }
  return sent;
}

/**
 * Fiyat kilidinin süresi geçen AKTİF anlaşmaları `expired`a çeker; kaç
 * anlaşmanın kapandığını döner.
 *
 * NEDEN AYRI BİR AŞAMA (9.) ve hatırlatmanın yanında değil: bu aşama tek bir
 * UPDATE'tir, mektup yazmaz ve `phase(...)` hataları TOPLADIĞI için bir SMTP
 * arızası bu süpürmeyi durdurmamalı. İkisini tek aşamaya koymak, biri
 * patladığında ötekini de sessizce atlamak demekti.
 *
 * SIRA ÖNEMSİZ (ve bu bilinçli): hatırlatma aşamasının kilit kapısı
 * `price_locked_until >= now` TARİHİNE bakar, anlaşmanın `status`una değil —
 * yani kilidi dolmuş bir anlaşma, bu aşama henüz koşmamışken de hatırlatma
 * ALMAZ. `releaseBatch` de aynı tarihi ölçüyor, yani bu tur gecikse bile
 * kimse kilitli olmayan bir fiyatla parti bırakamaz. Aşamanın işi ekranın ve
 * listelerin DOĞRU durumu göstermesidir.
 *
 * YALNIZ `active` → `expired`: `draft` bir anlaşma hiç yürürlüğe girmedi
 * (`releaseBatch` onu zaten reddediyor) ve admin ona `extendFrameworkLock` ile
 * yeni bir tarih verip aktifleştirebilir; onu `expired` yazmak, hiç başlamamış
 * bir anlaşmayı bitmiş göstermekti. `extendFrameworkLock` süresi dolmuş bir
 * anlaşmayı uzatmayla yeniden `active` yapar.
 *
 * YAYIN YAPILMAZ: ekranlar `lockExpired`ı `price_locked_until`dan OKUMA ANINDA
 * türetiyor (`loadFrameworkDetail`), yani açık bir sayfa bu turu beklemeden
 * doğru cümleyi gösterir.
 */
export async function expireFrameworkLocks(now: Date): Promise<number> {
  const expired = await db
    .update(quoteFrameworks)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(eq(quoteFrameworks.status, "active"), lt(quoteFrameworks.priceLockedUntil, now))
    )
    .returning({ id: quoteFrameworks.id });
  return expired.length;
}

export interface QuoteMaintenanceOutcome {
  expired: number;
  expiryReminders: number;
  abandonedReminders: number;
  purgedParts: number;
  orphanDirs: number;
  /** Sahipsiz kalmış hediye kartı rezervasyonundan doğan sipariş sayısı. */
  promotedGiftDrafts: number;
  /** Son tarih işi kaybolmuş olduğu için bu turda kapatılan taslak sayısı. */
  expiredStrandedDrafts: number;
  /** Serbest bırakma penceresi açıldığı için hatırlatılan ANLAŞMA sayısı. */
  frameworkReleaseReminders: number;
  /** Fiyat kilidi dolduğu için bu turda `expired`a çekilen anlaşma sayısı. */
  expiredFrameworks: number;
}

/**
 * Saatlik turun kendisi.
 *
 * SIRA ÖNEMLİ: sahipsiz rezervasyon aşaması ilk (tahsilatı alınmış teklif aynı
 * turda "süresi doldu" sayılmasın), sahipsiz taslak aşaması hemen ardından
 * (aynı taslak ikisinin de adayı olabilir; terfi kazanmalı), teklif süre dolumu
 * onların ardından koşar — böylece bu saat içinde kapanan bir teklife "birkaç
 * gün içinde bitiyor" yazılmaz.
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
    orphanDirs: 0,
    promotedGiftDrafts: 0,
    expiredStrandedDrafts: 0,
    frameworkReleaseReminders: 0,
    expiredFrameworks: 0,
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

  // SIRA: sahipsiz rezervasyon EN BAŞTA. Tahsilatı çoktan alınmış bir teklifin
  // aynı turda "süresi doldu" sayılması, müşteriye bir saat boyunca yanlış
  // hikâyeyi anlatmak olurdu; terfi önce koşunca teklif `ordered` olur ve süre
  // dolumunun `order_id IS NULL` kapısı onu zaten dışarıda bırakır.
  await phase("promoteStuckGiftCoveredDrafts", async () => {
    outcome.promotedGiftDrafts = await promoteStuckGiftCoveredDrafts(now);
  });
  // SIRA: terfiden HEMEN SONRA, çünkü aynı `gift_card_full` taslağı iki
  // aşamanın da adayı olabilir (bakiye düşmüş, sipariş doğmamış ve son tarih de
  // geçmiş). Terfi önce koşarsa taslak `confirmed` olur ve bu aşamanın `pending`
  // süzgecine düşmez — müşteri bedelini ödediği işi alır. Ters sırada bakiyesi
  // karta geri döner, siparişi hiç doğmaz ve teklif yeniden ödenmeyi bekler.
  await phase("expireStrandedQuoteDrafts", async () => {
    outcome.expiredStrandedDrafts = await expireStrandedQuoteDrafts(now);
  });
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
  // SIRA: saklama süpürmesinden SONRA. O tur bir dizini boşaltabilir ama satırı
  // bırakır, yani yetim süpürmesi ona dokunmaz; ters sırada da sonuç aynı olurdu
  // — bu sıra yalnız okurken hikâyeyi düzgün anlatıyor (satırlar önce, artık
  // dizinler sonra).
  await phase("sweepOrphanQuotePartDirs", async () => {
    outcome.orphanDirs = await sweepOrphanQuotePartDirs(now);
  });
  // SIRA: çerçeve aşamaları EN SONDA, çünkü hiçbir önceki aşamaya girdi
  // vermiyorlar ve ikisi de teklif tarafındaki süzgeçlerden BAĞIMSIZ ölçüyor
  // (hatırlatmanın kilit kapısı `price_locked_until` TARİHİNE bakar, anlaşmanın
  // `status`una değil — bkz. `expireFrameworkLocks` başlığı). Bu sıra yalnız
  // hikâyeyi düzgün anlatıyor: teklif motorunun bakımı önce, anlaşmaların
  // bakımı sonra.
  await phase("sendFrameworkReleaseReminders", async () => {
    outcome.frameworkReleaseReminders = await sendFrameworkReleaseReminders(now);
  });
  await phase("expireFrameworkLocks", async () => {
    outcome.expiredFrameworks = await expireFrameworkLocks(now);
  });

  if (failures.length > 0) throw new Error(`bakım turu eksik kaldı — ${failures.join(" | ")}`);
  return outcome;
}
