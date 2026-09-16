import { eq, and, ne, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerEarnings, payouts, invoices, orders } from "@/lib/db/schema";
import { computeEarning, computeKdv } from "@/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS, KDV_RATE_BPS } from "@/lib/config/prices";
import { eInvoiceProvider } from "@/lib/services/e-invoice";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { claimableEarningWhere, openEarningWhere } from "@/lib/services/earning-claimable";
import {
  claimEarningsIntoPayout,
  isPayoutLockBusy,
  payoutHoldsWhatItClaims,
  PayoutClaimRaceError,
} from "@/lib/services/payout-claim";

/**
 * What an accrual call did. Callers fire and forget (`.catch` + log), but why
 * an earning did NOT land has to be visible: "skipped because refunded" must
 * never read like "already there".
 */
export type AccrualOutcome =
  | "accrued"
  | "already_accrued"
  | "skipped_refunded"
  | "order_not_found";

/**
 * Accrue a manufacturer's earning. The single choke point for manufacturer
 * money: every manufacturer_earnings row is written here (ship, send-to-painter,
 * the admin painter hand-off, the workshop batch ship, the revoke-after-painter
 * re-accrual). Idempotent on orderId: the unique constraint and
 * onConflictDoNothing make a double-ship a no-op.
 *
 * A refunded order never accrues. The routes refuse forward actions on one, but
 * this is the backstop for whatever reaches it anyway: a refunded row that kept
 * its partner, a caller that forgot the guard, a re-accrual after a lost race.
 * The check and the insert share one transaction, and the order row is read
 * FOR SHARE. A refund that commits first empties the guarded read. A refund
 * that comes later waits on the row lock until this commits, and its
 * reverseEarning() then reverses the new row. In neither order does a pending
 * earning survive on a refunded order.
 */
export async function accrueEarning(
  orderId: string,
  manufacturerId: string,
  grossKurus: number
): Promise<AccrualOutcome> {
  const outcome = await db.transaction(async (tx): Promise<AccrualOutcome> => {
    // Bounded wait for the row lock. A caller already holding this order row
    // in its own open transaction would otherwise hang here forever: the wait
    // is on another connection, so Postgres sees no deadlock. After 5s it fails
    // into the caller's `.catch` log instead.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    // Use the rate frozen when the manufacturer accepted the order; fall back
    // to the current rate for orders accepted before the column existed.
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
      return exists ? "skipped_refunded" : "order_not_found";
    }
    const rateBps = row.rate ?? PLATFORM_COMMISSION_RATE_BPS;

    // Money tripwire. The kalem model's whole guarantee is that the two earning
    // bases sum to the order total; if that ever stops holding, partner payouts
    // can drift past the price again — the exact failure this model replaced.
    // Loud log, never a throw: refusing to accrue would leave a shipped order
    // unpaid, which is worse than an over/under-payment we can see and correct.
    if (row.productionBaseKurus != null) {
      const split = row.productionBaseKurus + row.paintingPriceKurus;
      if (split !== row.amountKurus) {
        console.error(
          `[kalem] order ${orderId}: production(${row.productionBaseKurus}) + painting(${row.paintingPriceKurus}) = ${split} ≠ amount(${row.amountKurus})`
        );
      }
      if (grossKurus > row.amountKurus) {
        console.error(
          `[kalem] order ${orderId}: manufacturer gross ${grossKurus} exceeds order amount ${row.amountKurus}`
        );
      }
    }

    const e = computeEarning(grossKurus, rateBps);
    const inserted = await tx
      .insert(manufacturerEarnings)
      .values({
        orderId,
        manufacturerId,
        grossKurus: e.grossKurus,
        commissionKurus: e.commissionKurus,
        netKurus: e.netKurus,
        commissionRateBps: e.commissionRateBps,
      })
      .onConflictDoNothing({ target: manufacturerEarnings.orderId })
      .returning({ id: manufacturerEarnings.id });
    return inserted.length > 0 ? "accrued" : "already_accrued";
  });

  if (outcome === "skipped_refunded") {
    console.warn(
      `[accrual] order ${orderId}: skipped: refunded — no manufacturer earning for ${manufacturerId}`
    );
  } else if (outcome === "order_not_found") {
    console.error(`[accrual] order ${orderId}: not found — no manufacturer earning accrued`);
  }
  return outcome;
}

// Clawback — used when an order is refunded / a dispute is resolved against the
// manufacturer. Only un-reversed, not-yet-paid earnings are reversed. Crucially
// payout-aware: if a reversed earning was already BATCHED into a still-pending
// payout, we deduct its net from that payout's total/count and clear its
// payoutId, so the admin doesn't later transfer (and the earning isn't flipped
// back to "paid" for) money on a refunded order.
export async function reverseEarning(orderId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Sınırlı bekleme: aşağıdaki okuma artık SATIR KİLİDİ alıyor, yani
    // eşzamanlı bir partileme ya da "ödendi işaretle" varsa BEKLER. Sınırsız
    // beklemek ucu askıda bırakırdı; 5s sonra hata çağıranın `.catch` günlüğüne
    // düşer. Kilit sırası partilemeyle ters olduğu için 40P01 (deadlock) da
    // mümkündür ve aynı yere düşer — ikisi de "para YAZILMADI" demektir.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    // OKUMA KİLİTLİDİR — KARDEŞİYLE AYNI KİLİT. Partileme sorgusu
    // (createPayoutForManufacturer) aynı satırları `for update of` ile okur;
    // parti üyeliğini DEĞİŞTİREN bu yol da aynı kilidi almak zorundadır.
    //
    // ÖLÇÜLEN HÂL (kilitsizken): iade `payout_id`yi NULL okur; araya giren
    // partileme satırı P partisine damgalayıp commit eder; iadenin düşüm
    // döngüsü P'yi HİÇ görmediği için düşümü ATLAR, ama aşağıdaki UPDATE satırı
    // yine de `reversed` + `payout_id = null` yapar. P, artık TUTMADIĞI
    // hakedişin parasını toplamında taşır: "iddia ettiği ≠ tuttuğu".
    // markPayoutPaid bu partiyi (haklı olarak) kalıcı reddeder,
    // deleteEmptyPayout da temizleyemez çünkü parti başka satırlar tutuyordur —
    // GERÇEK bir parti çıkışsız kalırdı.
    //
    // Kilitle: partileme önce commit ederse Postgres yüklemi GÜNCEL satır
    // üzerinde yeniden değerlendirir (EvalPlanQual) ve `payoutId` P olarak
    // okunur; düşüm doğru partiye gider. Partileme sonra gelirse damgası bu
    // işlem bitene kadar bekler ve yeni satır sürümünde eleyip geri alır.
    const toReverse = await tx
      .select({
        id: manufacturerEarnings.id,
        netKurus: manufacturerEarnings.netKurus,
        payoutId: manufacturerEarnings.payoutId,
      })
      .from(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          ne(manufacturerEarnings.status, "reversed"),
          ne(manufacturerEarnings.status, "paid")
        )
      )
      .for("update");
    if (toReverse.length === 0) return;

    // Back out each earning from any still-pending payout it was batched into.
    //
    // DÜŞÜM TEK İFADEDE, GÖRELİ YAPILIR (oku-değiştir-yaz DEĞİL). Eskiden parti
    // toplamı önce okunup sonra yazılıyordu; aynı partideki iki hakediş aynı
    // anda geri alındığında ikisi de AYNI toplamı okuyup kendi düşümünü yazıyor
    // ve bir düşüm kayboluyordu. Sonuç tam da bu turun kapattığı hâldir: parti,
    // arkasındaki hakedişlerden FARKLI bir tutar iddia eder — ve "Ödendi
    // işaretle" artık böyle bir partiyi haklı olarak reddettiği için, kayıp
    // düşüm partiyi ödenemez hâlde bırakırdı. `greatest(0, …)` eski kodun
    // Math.max'ının aynısıdır: toplam negatife düşmesin.
    for (const e of toReverse) {
      if (!e.payoutId) continue;
      await tx
        .update(payouts)
        .set({
          totalKurus: sql`greatest(0, ${payouts.totalKurus} - ${e.netKurus})`,
          earningCount: sql`greatest(0, ${payouts.earningCount} - 1)`,
        })
        .where(and(eq(payouts.id, e.payoutId), eq(payouts.status, "pending")));
    }

    await tx
      .update(manufacturerEarnings)
      .set({ status: "reversed", payoutId: null, updatedAt: new Date() })
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          ne(manufacturerEarnings.status, "reversed"),
          ne(manufacturerEarnings.status, "paid")
        )
      );
  });
}

/**
 * Bir partileme denemesinin sonucu.
 *
 * `null` DEĞİL, AYRIŞTIRILMIŞ bir sonuç: "ödenecek bir şey yok" ile "başka bir
 * ödeme işlemiyle çakıştı" aynı cevap olamaz. İlki partnere/admin'e "kuyruk
 * boş" der; ikincisi "birazdan tekrar deneyin" der ve ekran ikisini ayırt
 * edemezse yarışın kaybeden tarafı sebepsiz bir hata görürdü.
 */
export type PayoutCreateResult =
  | { ok: true; payoutId: string; totalKurus: number; count: number }
  | { ok: false; reason: "nothing_owed" | "busy" };

// Batch a manufacturer's not-yet-batched pending earnings into one payout.
//
// İADE FİLTRESİ BURADA ZORUNLUDUR. Bu sorgu eskiden siparişe hiç bakmadan her
// `pending` + partilenmemiş satırı süpürüyordu; üreticinin kendi ekranı ise
// iade edilen siparişleri "ödeme bekleyen" tutarından çıkarıyordu. Üretici
// ekranda ₺838,20 görüp düğmeye bastığında partiye ₺1.676,40 giriyor, fark
// parası müşteriye iade edilmiş bir siparişin hakedişi oluyordu: ekranın
// ödenemez dediği para, ekranın kendi düğmesiyle ödeme kuyruğuna giriyordu.
// Kural artık tek yerden okunur (claimableEarningWhere) — ekranın ödenebilir
// dediği küme ile partiye giren küme tanım gereği aynıdır.
//
// PARTİLEME ATOMİKTİR. Algoritma ve NEDEN'i payout-claim.ts'de: sayım `for
// update of` ile KİLİTLİ okunur (eşzamanlı ikinci partileme aynı satırları bir
// daha alamaz) ve partinin toplamı damganın `returning`inden yazılır (parti,
// tanım gereği tuttuğu parayı söyler). Kilit `of` ile yalnız hakediş tablosuna
// verilir: kural siparişle sol birleşim ister, Postgres ise dış birleşimin
// NULL üretebilen tarafını kilitletmez.
export async function createPayoutForManufacturer(
  manufacturerId: string,
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
            .select({
              id: manufacturerEarnings.id,
              netKurus: manufacturerEarnings.netKurus,
            })
            .from(manufacturerEarnings)
            // Kural siparişin ödeme durumunu okur; birleşim olmadan kurulamaz.
            .leftJoin(orders, eq(orders.id, manufacturerEarnings.orderId))
            .where(
              and(
                eq(manufacturerEarnings.manufacturerId, manufacturerId),
                claimableEarningWhere(manufacturerEarnings)
              )
            )
            .for("update", { of: manufacturerEarnings }),
        // Parti 0/0 açılır: damga için id (FK) şart, toplam ise ancak damga
        // geri okunduktan sonra bilinir.
        openBatch: async () => {
          const [payout] = await tx
            .insert(payouts)
            .values({
              manufacturerId,
              totalKurus: 0,
              earningCount: 0,
              adminEmail,
              status: "pending",
            })
            .returning({ id: payouts.id });
          return payout.id;
        },
        // Damga TAM OLARAK sayılan satırlara vurulur (id listesi), aynı WHERE'i
        // ikinci kez çalıştırmaya değil; `returning` ile de gerçekten damgalanan
        // satırlar geri okunur.
        //
        // İD LİSTESİNİN YANINDA YÜKLEM DE DURUR. Liste, sayım anındaki bir
        // FOTOĞRAFTIR; `openEarningWhere` satırın damga anında HÂLÂ açık
        // (bekleyen + partisiz) olduğunu yeniden ileri sürer. Böylece "bir
        // hakediş, tam olarak bir parti" kuralı SQL'de kendini korur ve yalnız
        // kilide yaslanmaz: kilit bir gün delinirse yüklem satırı eler, damga
        // eksik döner ve claimEarningsIntoPayout partiyi kurmadan geri alır.
        // Yüklem olmasaydı başka bir partiye AİT satır sessizce ÇALINIRDI —
        // sayım ile damga eşit kalacağı için algoritmanın son denetimi de bunu
        // göremezdi (bkz. scripts/test-cost-lines.ts, "çalınan satır").
        stamp: async (payoutId, ids) =>
          await tx
            .update(manufacturerEarnings)
            .set({ payoutId, updatedAt: new Date() })
            .where(
              and(
                inArray(manufacturerEarnings.id, ids),
                openEarningWhere(manufacturerEarnings)
              )
            )
            .returning({
              id: manufacturerEarnings.id,
              netKurus: manufacturerEarnings.netKurus,
            }),
        writeBatchTotals: async (payoutId, totalKurus, earningCount) => {
          await tx
            .update(payouts)
            .set({ totalKurus, earningCount })
            .where(eq(payouts.id, payoutId));
        },
      });
    });
    return batch ? { ok: true, ...batch } : { ok: false, reason: "nothing_owed" };
  } catch (e) {
    // Kilit beklemesi ya da sayım/damga ayrışması: işlem geri alındı, hiçbir
    // parti kurulmadı. Ekranın gösterebileceği bir sebep dönmeli.
    if (isPayoutLockBusy(e) || e instanceof PayoutClaimRaceError) {
      console.warn(
        `[payout] manufacturer ${manufacturerId}: parti kurulamadı (eşzamanlı ödeme işlemi)`,
        e
      );
      return { ok: false, reason: "busy" };
    }
    throw e;
  }
}

/**
 * "Ödendi işaretle"nin sonucu.
 *
 * `mismatch`: partinin İDDİA ettiği tutar ile ARKASINDA duran hakedişler
 * uyuşmuyor. Ölçülen hâl, yarışın bıraktığı hayalet partiydi: 0 hakediş tutan
 * bir parti "6 sipariş · ₺12.600,00" diyordu ve işaretlenebiliyordu — ödeme
 * bildirimi gidiyor, tek bir hakediş kapanmıyordu. Okuma bir kapıyı besliyor,
 * o yüzden KAPALI tarafa düşer: uyuşmuyorsa hiçbir şey yazılmaz.
 */
export type PayoutPaidResult =
  | { ok: true; manufacturerId: string; totalKurus: number }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "mismatch";
      statedKurus: number;
      statedCount: number;
      heldKurus: number;
      heldCount: number;
    };

// Mark a pending payout paid → its earnings flip to "paid". Idempotent.
export async function markPayoutPaid(
  payoutId: string,
  reference: string | null
): Promise<PayoutPaidResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Parti satırı KİLİTLENEREK okunur: ödeme sırasında ne ikinci bir
    // işaretleme ne de partinin silinmesi araya girebilsin.
    const [payout] = await tx
      .select({
        id: payouts.id,
        manufacturerId: payouts.manufacturerId,
        totalKurus: payouts.totalKurus,
        earningCount: payouts.earningCount,
      })
      .from(payouts)
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, "pending")))
      .for("update");
    if (!payout) return { ok: false, reason: "not_found" };

    // Partinin GERÇEKTEN kapatacağı para: `paid` yapılacak satırların aynısı
    // (çevrilmiş satırlar dışarıda — onlar zaten `paid` olmayacak).
    const [held] = await tx
      .select({
        heldCount: sql<number>`count(*)::int`,
        heldKurus: sql<number>`coalesce(sum(${manufacturerEarnings.netKurus}), 0)::int`,
      })
      .from(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.payoutId, payoutId),
          ne(manufacturerEarnings.status, "reversed")
        )
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
        `[payout] ${payoutId}: parti ${payout.totalKurus} kuruş / ${payout.earningCount} sipariş diyor ama ${heldKurus} kuruş / ${heldCount} sipariş tutuyor — ödendi işaretlenmedi`
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
      .update(payouts)
      .set({ status: "paid", paidAt: new Date(), reference })
      .where(eq(payouts.id, payoutId));
    // Never resurrect an earning that was reversed (refund/clawback) after it
    // was batched — only flip the still-pending ones to paid.
    await tx
      .update(manufacturerEarnings)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        and(
          eq(manufacturerEarnings.payoutId, payoutId),
          ne(manufacturerEarnings.status, "reversed")
        )
      );
    return { ok: true, manufacturerId: payout.manufacturerId, totalKurus: payout.totalKurus };
  });
}

/**
 * HİÇBİR HAK EDİŞ TUTMAYAN bekleyen partiyi siler.
 *
 * Neden var: "Ödendi işaretle" artık uyuşmayan partiyi reddediyor; reddedilen
 * parti kuyrukta kalır ve admin'in elinde onu kapatacak hiçbir denetim
 * olmazdı — ekranın sunduğu her denetimin cevap veren bir ucu olmalı. Silme
 * bilerek DAR: yalnız `pending` ve arkasında TEK SATIR OLMAYAN parti. Para
 * tutan bir parti asla silinmez (hakedişler de partisiz kalmaz); onlar için
 * cevap yine rettir.
 *
 * İki kaynak üretir: (1) düzeltmeden önceki yarışın bıraktığı hayalet partiler,
 * (2) bütün hakedişleri iade yüzünden geri alınmış, içi boşalmış partiler.
 */
export type PayoutDeleteResult =
  | { ok: true; manufacturerId: string }
  | { ok: false; reason: "not_found" | "already_paid" }
  | { ok: false; reason: "has_earnings"; heldCount: number };

export async function deleteEmptyPayout(payoutId: string): Promise<PayoutDeleteResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [payout] = await tx
      .select({
        id: payouts.id,
        manufacturerId: payouts.manufacturerId,
        status: payouts.status,
      })
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .for("update");
    if (!payout) return { ok: false, reason: "not_found" };
    if (payout.status !== "pending") return { ok: false, reason: "already_paid" };
    // Çevrilmiş satır da sayılır: parti hâlâ ona referansla duruyor olabilir ve
    // silmek yabancı anahtarı düşürürdü.
    const [held] = await tx
      .select({ heldCount: sql<number>`count(*)::int` })
      .from(manufacturerEarnings)
      .where(eq(manufacturerEarnings.payoutId, payoutId));
    const heldCount = Number(held?.heldCount ?? 0);
    if (heldCount > 0) return { ok: false, reason: "has_earnings", heldCount };
    await tx.delete(payouts).where(eq(payouts.id, payoutId));
    return { ok: true, manufacturerId: payout.manufacturerId };
  });
}

/**
 * Get-or-create the customer invoice for a paid order (KDV-inclusive).
 *
 * The row is only marked `issued` when the provider hands back a REAL
 * reference. The provider is currently a stub that files nothing with GİB and
 * returns `STUB-<invoiceNumber>`; writing `issued` on the back of that made the
 * database assert an invoice exists — and let the customer download it — when
 * none had been filed. A `pending` row is the honest state until a real
 * integrator (Paraşüt/Foriba/Mikro) is wired in.
 */
export async function getOrCreateInvoice(order: {
  id: string;
  orderNumber: string;
  amountKurus: number;
  customerName: string;
  email: string;
}) {
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.orderId, order.id),
  });
  if (existing) return existing;

  const k = computeKdv(order.amountKurus, KDV_RATE_BPS);
  const invoiceNumber = `FAT-${order.orderNumber}`;
  let providerRef: string | null = null;
  try {
    const issued = await eInvoiceProvider.issue({
      invoiceNumber,
      totalKurus: k.totalKurus,
      subtotalKurus: k.subtotalKurus,
      kdvKurus: k.kdvKurus,
      customerName: order.customerName,
      customerEmail: order.email,
    });
    providerRef = issued.providerRef;
  } catch (err) {
    console.error("e-invoice issue failed (non-fatal)", err);
  }

  // A synthetic reference is not an invoice. Anything the stub produces (or a
  // provider failure that leaves providerRef null) stays `pending`.
  const reallyIssued = !!providerRef && !providerRef.startsWith("STUB-");
  if (!reallyIssued) {
    console.warn(
      `[invoice] ${invoiceNumber} recorded as pending — no real provider reference`
    );
  }

  const [row] = await db
    .insert(invoices)
    .values({
      orderId: order.id,
      invoiceNumber,
      subtotalKurus: k.subtotalKurus,
      kdvKurus: k.kdvKurus,
      totalKurus: k.totalKurus,
      kdvRateBps: k.kdvRateBps,
      status: reallyIssued ? "issued" : "pending",
      providerRef: reallyIssued ? providerRef : null,
    })
    .onConflictDoNothing({ target: invoices.orderId })
    .returning();

  return row ?? db.query.invoices.findFirst({ where: eq(invoices.orderId, order.id) });
}
