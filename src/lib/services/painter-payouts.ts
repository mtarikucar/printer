import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterEarnings, painterPayouts } from "@/lib/db/schema";
import { painterBaseKurus } from "@/lib/services/earning-base";
import { computeEarning } from "@/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
// KARAR kuralı üretici tarafıyla ORTAKTIR ve burada ikinci kez yazılmaz: aynı
// soruyu (duran satır korunur mu, düzeltilir mi, reddedilir mi) iki ayrı yerde
// cevaplamak, iki tarafın bir gün ayrışması demekti. Türkçe METİN ise ortak
// DEĞİL: üretici metni "Üreticinin ..." diye başlar ve boyacı satırında admin'i
// yanlış partnere ve yanlış ekrana yollardı (aşağıdaki twin'e bakın).
import {
  reconcileAccrual,
  type AccrualMismatchReason,
  type AccrualOutcome,
} from "@/lib/services/payouts";
import { claimableEarningWhere, openEarningWhere } from "@/lib/services/earning-claimable";
import {
  claimEarningsIntoPayout,
  isPayoutLockBusy,
  payoutHoldsWhatItClaims,
  PayoutClaimRaceError,
} from "@/lib/services/payout-claim";
import type { PayoutCreateResult } from "@/lib/services/payouts";

// Painter earnings + payouts — mirrors src/lib/services/payouts.ts (manufacturer
// side) against the painter_earnings / painter_payouts tables. The painter's
// gross is the professional-painting add-on price (orders.paintingPriceKurus);
// the platform keeps the same commission %, the painter is paid the remainder.

/** accruePainterEarning'in işlem tutamacı: notu da AYNI işlem yazsın diye. */
type PainterAccrualTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Reddin Türkçe anlatımı — BOYACI tarafı.
 *
 * Üretici ikizinin metni (accrualMismatchNote, payouts.ts) "Üreticinin ..."
 * diye başlar ve /admin/payouts'un üretici sekmesine yollar. Aynı cümleyi
 * boyacı satırında kullanmak, notu okuyan admin'i YANLIŞ partnere ve yanlış
 * ekrana göndermek olurdu — oysa bu notun tek işi, parayı elden düzeltebilecek
 * kişiyi doğru yere göndermek.
 *
 * `foundGrossKurus === null` YALNIZ "vanished" içindir: satır okunamadı, ona
 * uydurma bir tutar yazılmaz.
 */
export function painterAccrualMismatchNote(args: {
  painterId: string;
  wantedGrossKurus: number;
  foundGrossKurus: number | null;
  reason: AccrualMismatchReason;
}): string {
  const bas = `[HAKEDİŞ] Boyacının (${args.painterId}) hakedişi ${args.wantedGrossKurus} kuruş olmalıydı`;
  const bulunan = `${args.foundGrossKurus} kuruşluk satır`;
  switch (args.reason) {
    case "other_manufacturer":
      return (
        `${bas} ama siparişteki ${bulunan} BAŞKA bir boyacıya ait; tutar düzeltilmedi. ` +
        `Ortada tutar değil devir/koparma sorunu var — siparişin boyacı atamasını kontrol edin.`
      );
    case "reversed":
      return (
        `${bas} ama siparişteki ${bulunan} "geri çevrildi" durumunda ve tahakkuk onu diriltmez. ` +
        `Bu boyacı bu siparişten HİÇ ödenmez (geri çevrilmiş satır ödeme partisine giremez) — ` +
        `hakedişi elden yeniden açın.`
      );
    case "settled":
      return (
        `${bas} ama ${bulunan} ödeme partisine girmiş ya da ödenmiş; düzeltilemedi. ` +
        `Boyacı EKSİK ödenmiş olabilir — /admin/payouts üzerinden kontrol edin.`
      );
    case "vanished":
      return (
        `${bas} ama satır ne yazılabildi ne okunabildi (eşzamanlı silme); siparişte hakediş satırı YOK. ` +
        `Boyacı bu siparişten hiç ödenmez — hakedişi elden açın.`
      );
  }
}

/**
 * Reddi SİPARİŞİN admin notuna, KARARI VEREN İŞLEMİN İÇİNDE yazar.
 *
 * `tx` ile, `db` ile değil: not işlemin dışında ve hatası yutularak yazılsaydı
 * bir red hiçbir kalıcı iz bırakmadan bitebilirdi — tam da bu kuralın
 * reddettiği hâl. Aynı işlemde yazılınca not kararın commit'ini miras alır:
 * ya ikisi birden olur, ya hiçbiri. (Üretici ikizi: writeMismatchNote.)
 */
async function writePainterMismatchNote(args: {
  tx: PainterAccrualTx;
  orderId: string;
  painterId: string;
  wantedGrossKurus: number;
  foundGrossKurus: number | null;
  reason: AccrualMismatchReason;
}): Promise<void> {
  const note = formatAdminNoteLine(painterAccrualMismatchNote(args));
  await args.tx
    .update(orders)
    .set({
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, args.orderId));
}

/** accruePainterEarning'in işleminden çıkan sonuç + izin gerektirdiği rakamlar. */
type PainterAccrualTxResult =
  | { outcome: "accrued" | "already_accrued" | "skipped_refunded" | "order_not_found" }
  | { outcome: "corrected"; fromGrossKurus: number; toGrossKurus: number }
  | {
      outcome: "mismatch_refused";
      reason: AccrualMismatchReason;
      /** `null` yalnız "vanished" dalında: satır okunamadı, tutarı da yok. */
      foundGrossKurus: number | null;
      wantedGrossKurus: number;
    };

/**
 * Accrue the painter's earning for a completed (shipped) painting job.
 * The single choke point for painter money: no other module inserts
 * painter_earnings.
 *
 * TUTAR HER ZAMAN DOĞRU SATIRA OTURUR, YA DA GÜRÜLTÜYLE REDDEDİLİR — üretici
 * tarafında kapatılan para deliğinin BOYACI İKİZİ. Satır `order_id` üzerinde
 * TEKİLDİR ve çakışma burada da sessizce yutuluyordu
 * (`onConflictDoNothing` → "already_accrued"): satırın STATÜSÜ hiç okunmadığı
 * için GERİ ÇEVRİLMİŞ bir boyacı satırı da "para yerinde" cevabını alıyordu.
 * Oysa `reversed` satır hiçbir ödeme partisine giremez (claimableEarningWhere):
 * boyacı o siparişten HİÇ ödenmeyecekken çağıran "tahakkuk tamam" diye
 * dönüyordu. Farklı bir tutar da aynı sessizlikle düşüyordu — boyama kalemi
 * sonradan değiştiğinde (çok parçalı siparişte admin boyama kalemi ekler) ikinci
 * çağrı no-op oluyor, boyacı aradaki farktan mahrum kalıyordu.
 *
 * Kural DÖRT dala ayrılır ve dördü de İZ BIRAKIR (üretici tarafıyla birebir
 * aynı; gerekçelerin uzun hâli accrueEarning'de):
 *   • satır yok                 → yazılır ("accrued");
 *   • satır GERİ ÇEVRİLMİŞ      → tutarı ne olursa olsun reddedilir
 *     ("mismatch_refused" · "reversed"). Diriltmek bu çağrının işi DEĞİLDİR;
 *   • satır var, tutar aynı     → dokunulmaz ("already_accrued") — çift kargo
 *     hâlâ no-op'tur;
 *   • satır var, tutar farklı   → AYNI boyacının AÇIK satırıysa düzeltilir
 *     ("corrected"); değilse hiçbir şey yazılmaz, red günlüğe VE siparişin
 *     admin notuna — kararı veren işlemin içinde — düşer.
 *
 * Oran `orders.commissionRateBps`ten, yani işin kabul edildiği anda
 * DONDURULMUŞ orandan gelir (canlı sabitten değil): boyacı sözleşmesinin
 * "komisyon oranı, işi kabul ettiğiniz anda sabitlenir" sözü ancak böyle doğru
 * olur. Kolon her boyama siparişinde doludur; sabit yalnız dondurma öncesi
 * satırlar için yedektir.
 *
 * A refunded order never accrues: the refund check and the insert share one
 * transaction with the order row read FOR SHARE. Why the lock, and why here as
 * well as in the ship route, is explained on accrueEarning (payouts.ts).
 */
export async function accruePainterEarning(
  orderId: string,
  painterId: string,
  grossKurus: number
): Promise<AccrualOutcome> {
  const result = await db.transaction(async (tx): Promise<PainterAccrualTxResult> => {
    // Bounded lock wait, for the reason given on accrueEarning.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    const [row] = await tx
      .select({
        rate: orders.commissionRateBps,
        amountKurus: orders.amountKurus,
        productionBaseKurus: orders.productionBaseKurus,
        paintingPriceKurus: orders.paintingPriceKurus,
      })
      .from(orders)
      .where(and(eq(orders.id, orderId), notRefundedGuard()))
      .for("share");
    if (!row) {
      const [exists] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, orderId));
      return { outcome: exists ? "skipped_refunded" : "order_not_found" };
    }
    const rateBps = row.rate ?? PLATFORM_COMMISSION_RATE_BPS;

    // Mirror of the manufacturer-side tripwire: the painter's base can never
    // exceed the order, and must be the painting kalem total. Log, never throw —
    // a shipped-but-unpaid painting job is worse than a visible mis-amount.
    if (grossKurus > row.amountKurus) {
      console.error(
        `[kalem] order ${orderId}: painter gross ${grossKurus} exceeds order amount ${row.amountKurus}`
      );
    }

    // Read the current split under the same order lock as the accrual.
    const currentGrossKurus = painterBaseKurus(row);
    if (grossKurus !== currentGrossKurus) {
      console.info(`[painter-earning] ${orderId}: stale caller base ${grossKurus}; using locked base ${currentGrossKurus}`);
    }
    const e = computeEarning(currentGrossKurus, rateBps);

    // Reddin izini TEK yerden bırakır: karar hangi dalda alınırsa alınsın iz
    // aynı işlemde ve aynı biçimde yazılır. Not yazılamazsa işlem geri alınır —
    // red, kaydı olmadan commit edemez (red dalında geri alınacak bir para
    // yazması zaten yoktur).
    const refuse = async (
      reason: AccrualMismatchReason,
      foundGrossKurus: number | null
    ): Promise<PainterAccrualTxResult> => {
      await writePainterMismatchNote({
        tx,
        orderId,
        painterId,
        reason,
        foundGrossKurus,
        wantedGrossKurus: e.grossKurus,
      });
      return {
        outcome: "mismatch_refused",
        reason,
        foundGrossKurus,
        wantedGrossKurus: e.grossKurus,
      };
    };

    // İKİ DENEME — üretici ikizinin aynısı: çakışan satır araya giren bir
    // silmeyle yok olmuş olabilir, o zaman ikinci deneme temiz yazar. Sonsuz
    // döngü yok.
    for (let attempt = 0; attempt < 2; attempt++) {
      const inserted = await tx
        .insert(painterEarnings)
        .values({
          orderId,
          painterId,
          grossKurus: e.grossKurus,
          commissionKurus: e.commissionKurus,
          netKurus: e.netKurus,
          commissionRateBps: e.commissionRateBps,
        })
        .onConflictDoNothing({ target: painterEarnings.orderId })
        .returning({ id: painterEarnings.id });
      if (inserted.length > 0) return { outcome: "accrued" };

      // Çakıştık: duran satırı KİLİTLEYEREK oku. Karar bu satırın tutarına,
      // SAHİBİNE ve STATÜSÜNE dayanıyor; kilitsiz okumada araya giren bir
      // partileme, çevirme ya da silme kararı bayatlatırdı.
      const [existing] = await tx
        .select({
          painterId: painterEarnings.painterId,
          grossKurus: painterEarnings.grossKurus,
          status: painterEarnings.status,
        })
        .from(painterEarnings)
        .where(eq(painterEarnings.orderId, orderId))
        .for("update");
      if (!existing) continue;

      // ORTAK KARAR, ADAPTE EDİLEN TARAF BURASI: saf kural partnerin id'sini
      // `manufacturerId` adıyla soruyor (payouts.ts'te doğdu). Ölçü aynı —
      // "satırın sahibi bu çağrının partneri mi" — o yüzden kuralı
      // çatallamak yerine alan adını burada eşliyoruz.
      const decision = reconcileAccrual({
        existing: {
          manufacturerId: existing.painterId,
          grossKurus: existing.grossKurus,
          status: existing.status,
        },
        incoming: { manufacturerId: painterId, grossKurus: e.grossKurus },
      });
      if (decision.action === "keep") return { outcome: "already_accrued" };
      if (decision.action === "refuse") {
        return refuse(
          // "other_manufacturer" makine kodu ortak kuraldan gelir; boyacı
          // tarafının Türkçesi onu "başka bir boyacıya ait" diye anlatır.
          decision.reason,
          existing.grossKurus
        );
      }

      const fixed = await tx
        .update(painterEarnings)
        .set({
          grossKurus: e.grossKurus,
          commissionKurus: e.commissionKurus,
          netKurus: e.netKurus,
          commissionRateBps: e.commissionRateBps,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(painterEarnings.orderId, orderId),
            // Satırın SAHİBİ değişmez: tutarı düzeltmek, parayı başka bir
            // boyacıya yazmak DEĞİLDİR.
            eq(painterEarnings.painterId, painterId),
            // Yalnız AÇIK satır düzeltilebilir (partiye girmiş satırın tutarını
            // değiştirmek partiyi ödenemez yapardı). Kural elle kurulmaz, tek
            // kaynaktan okunur.
            openEarningWhere(painterEarnings)
          )
        )
        .returning({ id: painterEarnings.id });
      if (fixed.length > 0) {
        return {
          outcome: "corrected",
          fromGrossKurus: existing.grossKurus,
          toGrossKurus: e.grossKurus,
        };
      }
      // Yüklem tutmadı: satır partiye girmiş ya da ödenmiş.
      return refuse("settled", existing.grossKurus);
    }

    // Bulunan tutar YOK: satır okunamadı.
    return refuse("vanished", null);
  });

  if (result.outcome === "skipped_refunded") {
    console.warn(
      `[accrual] order ${orderId}: skipped: refunded — no painter earning for ${painterId}`
    );
  } else if (result.outcome === "order_not_found") {
    console.error(`[accrual] order ${orderId}: not found — no painter earning accrued`);
  } else if (result.outcome === "corrected") {
    console.warn(
      `[accrual] order ${orderId}: boyacı ${painterId} hakedişi ${result.fromGrossKurus} → ${result.toGrossKurus} kuruş olarak düzeltildi`
    );
  } else if (result.outcome === "mismatch_refused") {
    // Kalıcı iz (siparişin admin notu) İŞLEMİN İÇİNDE yazıldı; buradaki günlük
    // onun ikizi, yerine geçeni değil.
    const bulunan =
      result.foundGrossKurus === null
        ? "satır okunamadı"
        : `satır ${result.foundGrossKurus} kuruş`;
    console.error(
      `[accrual] order ${orderId}: boyacı hakedişi ${result.wantedGrossKurus} kuruş olmalıydı, ${bulunan} ve düzeltilemedi (${result.reason}) — boyacı ${painterId}`
    );
  }
  return result.outcome;
}

/** Reverse a painter's (still-pending/unpaid) earning on refund/clawback. */
export async function reversePainterEarning(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Sınırlı bekleme + KİLİTLİ okuma: üretici tarafının aynası. NEDEN'i
    // reverseEarning'de (payouts.ts) uzun uzun yazılı. Özet: kilitsiz okunan
    // `payout_id`, araya giren partilemeden sonra ESKİ sürümdür; düşüm yanlış
    // partiye (ya da hiçbirine) gider ve parti, artık tutmadığı parayı iddia
    // eder — ödenemez ve silinemez bir parti.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const toReverse = await tx
      .select({ id: painterEarnings.id, payoutId: painterEarnings.payoutId, netKurus: painterEarnings.netKurus })
      .from(painterEarnings)
      .where(
        and(
          eq(painterEarnings.orderId, orderId),
          ne(painterEarnings.status, "reversed"),
          ne(painterEarnings.status, "paid")
        )
      )
      .for("update");
    if (toReverse.length === 0) return;
    // Düşüm TEK ifadede, göreli: üretici tarafının aynası (bkz. reverseEarning,
    // payouts.ts). Oku-değiştir-yaz, aynı partideki iki eşzamanlı geri almada
    // bir düşümü kaybediyor ve partiyi arkasındaki paradan farklı bir tutar
    // iddia eder hâlde bırakıyordu.
    for (const e of toReverse) {
      if (!e.payoutId) continue;
      await tx
        .update(painterPayouts)
        .set({
          totalKurus: sql`greatest(0, ${painterPayouts.totalKurus} - ${e.netKurus})`,
          earningCount: sql`greatest(0, ${painterPayouts.earningCount} - 1)`,
        })
        .where(
          and(eq(painterPayouts.id, e.payoutId), eq(painterPayouts.status, "pending"))
        );
    }

    // ÇEVİRME YÜKLEMİ ÜRETİCİ İKİZİYLE AYNIDIR — ve öyle olmak zorundadır.
    // Eskiden bu UPDATE YALNIZCA satır id'sine bakıyordu
    // (`.where(eq(painterEarnings.id, e.id))`), ikizi ise statüyü yeniden
    // denetliyordu. Ölçülen sonuç: markPainterPayoutPaid parti satırının
    // kilidini tutarken hakedişleri `paid` yapar; burada bekleyen UPDATE
    // uyandığında id hâlâ eşittir ve ÖDENMİŞ bir hakedişi `reversed` +
    // `payout_id = null` yapardı. Ödenmiş parti artık ödediğini tutmaz ve
    // boyacı, BANKADAN ÇIKMIŞ parayla geri alınmış görünürdü. Statü yeniden
    // ileri sürülünce satır iki kez çevrilemez, ödenmişe de dokunulamaz.
    await tx
      .update(painterEarnings)
      .set({ status: "reversed", payoutId: null, updatedAt: new Date() })
      .where(
        and(
          eq(painterEarnings.orderId, orderId),
          ne(painterEarnings.status, "reversed"),
          ne(painterEarnings.status, "paid")
        )
      );
  });
}

/**
 * Boyacının TALEP EDİLEBİLİR hakedişlerini tek bir ödemede toplar.
 *
 * İADE FİLTRESİ BURADA ZORUNLUDUR. Bu sorgu siparişe hiç bakmadan her `pending`
 * + partilenmemiş satırı süpürüyordu; boyacının kendi ekranı (/painter/earnings)
 * ise iade edilen siparişin hakedişini "talep edilebilir" tutarından çıkarıp
 * satırı "İade edildi" diye işaretliyor ve "ödeme talebi oluşturduğunuzda
 * partiye de girmez" diye yazıyordu. Admin'in /admin/payouts → Boyacılar
 * sekmesindeki "Ödeme oluştur" düğmesi tam da o satırı partiye sokuyor, sonra
 * "Ödendi işaretle" onu `paid` yapıyordu: ekranın ödenemez dediği para, ekranın
 * yanındaki düğmeyle müşteriye iade edilmiş bir siparişten ÖDENİYORDU. Kural
 * artık üretici tarafıyla tek ve aynı yerden gelir (earning-claimable.ts).
 *
 * PARTİLEME ATOMİKTİR ve üretici tarafıyla AYNI algoritmadır (payout-claim.ts):
 * sayım `for update of` ile kilitli okunur, partinin toplamı damganın
 * `returning`inden yazılır. Boyacı tarafında ölçülen hâl de aynıydı: boyacının
 * kendi talebi ile admin'in "Ödeme oluştur"u aynı anda çalıştığında iki parti
 * kuruluyor, 4 hakedişin tamamı birine kaçıyor, öteki "₺3.000,00 · 4 iş" diyen
 * ama arkasında tek satır olmayan bir hayalet parti olarak ödenebiliyordu.
 *
 * TEK PARTİLEME YOLU: /api/painter/payout-request bu fonksiyonu çağırır, kendi
 * kopyasını KURMAZ. İki ayrı kopya, kuralın (ve şimdi kilidin) ancak birinde
 * düzeltilmesi demekti.
 */
export async function createPayoutForPainter(
  painterId: string,
  adminEmail: string
): Promise<PayoutCreateResult> {
  try {
    const batch = await db.transaction(async (tx) => {
      // Sınırlı bekleme: eşzamanlı partileme kilidi bırakmazsa uç askıda
      // kalmasın, Türkçe "birazdan tekrar deneyin" cevabına düşsün.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return claimEarningsIntoPayout({
        lockClaimable: async () =>
          await tx
            .select({ id: painterEarnings.id, netKurus: painterEarnings.netKurus })
            .from(painterEarnings)
            // Kural siparişin ödeme durumunu okur; birleşim olmadan kurulamaz.
            .leftJoin(orders, eq(orders.id, painterEarnings.orderId))
            .where(
              and(
                eq(painterEarnings.painterId, painterId),
                claimableEarningWhere(painterEarnings)
              )
            )
            .for("update", { of: painterEarnings }),
        openBatch: async () => {
          const [payout] = await tx
            .insert(painterPayouts)
            .values({
              painterId,
              totalKurus: 0,
              earningCount: 0,
              adminEmail,
              status: "pending",
            })
            .returning({ id: painterPayouts.id });
          return payout.id;
        },
        // Damga id listesine EK OLARAK yüklemi de taşır: liste sayım anının
        // fotoğrafıdır, `openEarningWhere` satırın hâlâ açık (partisiz)
        // olduğunu damga anında yeniden ileri sürer. Gerekçesi üretici
        // tarafında ayrıntılı yazılı (payouts.ts): yüklem olmadan "bir hakediş,
        // tam olarak bir parti" yalnız kilide yaslanır ve kilit delinirse başka
        // partinin satırı sessizce çalınır.
        stamp: async (payoutId, ids) =>
          await tx
            .update(painterEarnings)
            .set({ payoutId, updatedAt: new Date() })
            .where(
              and(inArray(painterEarnings.id, ids), openEarningWhere(painterEarnings))
            )
            .returning({ id: painterEarnings.id, netKurus: painterEarnings.netKurus }),
        writeBatchTotals: async (payoutId, totalKurus, earningCount) => {
          await tx
            .update(painterPayouts)
            .set({ totalKurus, earningCount })
            .where(eq(painterPayouts.id, payoutId));
        },
      });
    });
    return batch ? { ok: true, ...batch } : { ok: false, reason: "nothing_owed" };
  } catch (e) {
    if (isPayoutLockBusy(e) || e instanceof PayoutClaimRaceError) {
      console.warn(
        `[payout] painter ${painterId}: parti kurulamadı (eşzamanlı ödeme işlemi)`,
        e
      );
      return { ok: false, reason: "busy" };
    }
    throw e;
  }
}

/**
 * Bekleyen boyacı ödemesini ödendi işaretler → hakedişleri `paid` olur.
 *
 * Üretici tarafının aynası: parti satırı kilitlenir ve partinin İDDİA ettiği
 * tutar ile ARKASINDA duran hakedişler uyuşmuyorsa HİÇBİR ŞEY yazılmaz
 * (hayalet parti ödenemez).
 */
export type PainterPayoutPaidResult =
  | { ok: true; painterId: string; totalKurus: number }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "mismatch";
      statedKurus: number;
      statedCount: number;
      heldKurus: number;
      heldCount: number;
    };

export async function markPainterPayoutPaid(
  payoutId: string,
  reference: string | null
): Promise<PainterPayoutPaidResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [payout] = await tx
      .select({
        id: painterPayouts.id,
        painterId: painterPayouts.painterId,
        totalKurus: painterPayouts.totalKurus,
        earningCount: painterPayouts.earningCount,
      })
      .from(painterPayouts)
      .where(and(eq(painterPayouts.id, payoutId), eq(painterPayouts.status, "pending")))
      .for("update");
    if (!payout) return { ok: false, reason: "not_found" };

    const [held] = await tx
      .select({
        heldCount: sql<number>`count(*)::int`,
        heldKurus: sql<number>`coalesce(sum(${painterEarnings.netKurus}), 0)::int`,
      })
      .from(painterEarnings)
      .where(
        and(eq(painterEarnings.payoutId, payoutId), ne(painterEarnings.status, "reversed"))
      );
    const heldCount = Number(held?.heldCount ?? 0);
    const heldKurus = Number(held?.heldKurus ?? 0);
    if (
      !payoutHoldsWhatItClaims({
        statedKurus: payout.totalKurus,
        statedCount: payout.earningCount,
        heldKurus,
        heldCount,
      })
    ) {
      console.error(
        `[payout] painter ${payoutId}: parti ${payout.totalKurus} kuruş / ${payout.earningCount} iş diyor ama ${heldKurus} kuruş / ${heldCount} iş tutuyor — ödendi işaretlenmedi`
      );
      return {
        ok: false,
        reason: "mismatch",
        statedKurus: payout.totalKurus,
        statedCount: payout.earningCount,
        heldKurus,
        heldCount,
      };
    }

    await tx
      .update(painterPayouts)
      .set({ status: "paid", paidAt: new Date(), reference })
      .where(eq(painterPayouts.id, payoutId));
    await tx
      .update(painterEarnings)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        and(eq(painterEarnings.payoutId, payoutId), ne(painterEarnings.status, "reversed"))
      );
    return { ok: true, painterId: payout.painterId, totalKurus: payout.totalKurus };
  });
}

/**
 * Hiçbir hakediş tutmayan bekleyen boyacı partisini siler — üretici tarafının
 * aynası (bkz. deleteEmptyPayout, payouts.ts): reddedilen hayalet parti
 * kuyrukta çıkışsız kalmasın.
 */
export type PainterPayoutDeleteResult =
  | { ok: true; painterId: string }
  | { ok: false; reason: "not_found" | "already_paid" }
  | { ok: false; reason: "has_earnings"; heldCount: number };

export async function deleteEmptyPainterPayout(
  payoutId: string
): Promise<PainterPayoutDeleteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [payout] = await tx
      .select({
        id: painterPayouts.id,
        painterId: painterPayouts.painterId,
        status: painterPayouts.status,
      })
      .from(painterPayouts)
      .where(eq(painterPayouts.id, payoutId))
      .for("update");
    if (!payout) return { ok: false, reason: "not_found" };
    if (payout.status !== "pending") return { ok: false, reason: "already_paid" };
    const [held] = await tx
      .select({ heldCount: sql<number>`count(*)::int` })
      .from(painterEarnings)
      .where(eq(painterEarnings.payoutId, payoutId));
    const heldCount = Number(held?.heldCount ?? 0);
    if (heldCount > 0) return { ok: false, reason: "has_earnings", heldCount };
    await tx.delete(painterPayouts).where(eq(painterPayouts.id, payoutId));
    return { ok: true, painterId: payout.painterId };
  });
}
