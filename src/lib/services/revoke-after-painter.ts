import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  manufacturerActions,
  painterActions,
  manufacturerEarnings,
} from "@/lib/db/schema";
import { isRefunded } from "@/lib/config/order-status-policy";
// Koli ölçüsü: üç yazma ucunun ve otomatik yolların kullandığı saf fonksiyon.
import { painterParcelOnTheWay } from "@/lib/config/flags";
import {
  isOrderRefunded,
  notRefundedGuard,
} from "@/lib/services/manufacturer-assign";
import { reverseEarning, accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";

/**
 * Admin pulls a painting order all the way back from the painter to the
 * manufacturer-assignment queue.
 *
 * The gap this closes: once an order is handed to a painter, `revoke-manufacturer`
 * refuses it (`handed_to_painter`) because the manufacturer's print-portion
 * earning has already accrued at send-to-painter. There was no admin path to
 * unwind a bad hand-off short of a full refund.
 *
 * What it does, in one shot: detaches the painter AND the manufacturer and
 * resets the order to the assignment stage (`approved`, or `paid` for a
 * marketplace/seller order).
 *
 * MONEY SAFETY — why this is NOT just painter-decline with a bigger blast
 * radius. painter-decline keeps the SAME manufacturer, so leaving its earning
 * row in place is not just harmless but REQUIRED (sahibin kararı: baskı
 * hakedişi retten etkilenmez). Here we DETACH the manufacturer and re-queue for
 * a DIFFERENT one, and `manufacturer_earnings.order_id` is UNIQUE — so ANY
 * surviving earning row would stand between the next manufacturer and their
 * money. `accrueEarning` no longer swallows that conflict: a row belonging to
 * someone else is REFUSED loudly ("mismatch_refused" + admin note) instead of
 * silently paying ₺0. Loud is better than silent, but it is still unpaid work —
 * so the invariant stands unchanged: we reverse the earning FIRST and only
 * detach once we have PROVEN zero earning rows remain for the order:
 *  - a 'pending'/batched row reverses + deletes cleanly -> proceed;
 *  - a 'paid' (settled) row cannot be clawed back -> we refuse (`earning_settled`)
 *    and leave the order untouched so the admin uses the refund/dispute flow;
 *  - a reversal failure aborts before any detach (`reverse_failed`), order intact.
 * If the atomic detach then loses a race (painter shipped meanwhile) after we
 * already reversed, we re-accrue so the manufacturer is not underpaid — unless
 * the race was lost to a REFUND, in which case re-accruing would write a
 * payable earning onto an order whose money went back to the customer.
 *
 * İADE: bu servis iade edilmiş siparişi HİÇ işlemez (`refunded`), çünkü yaptığı
 * her şey — geri sarma, iki kara liste, iki QC turu, otomatik atama — orada
 * yasaktır. Koparmayı çağıranın iade yolu yapar.
 */
/**
 * KOPARMA, KOLİNİN KAYDINI DA SİLMESİN.
 *
 * İki koparma yolu da (bu servis + rotanın iade dalı) devir izlerini temizler:
 * `receivedByPainterAt`, `paintedAt`, `painterHandoffCarrier`,
 * `painterHandoffTrackingNumber`. Bu DOĞRUDUR — sipariş sıradaki partnere
 * sıfırdan gider ve eski damgalar yeni partnerin satırında yalan söylerdi.
 * Ama fiziksel kutu hâlâ boyacıda ya da ona giden yolda olabilir ve silinen o
 * dört alan, kutunun nerede olduğunu söyleyen TEK kayıttı: silindikten sonra
 * kimse aramaya nereden başlayacağını bilemiyordu.
 *
 * Çare koparmayı ENGELLEMEK değil (tam koparma meşru bir işlem): gerçekleri
 * kalıcı admin notuna taşımak ve admin'e kutunun hâlâ dışarıda olduğunu
 * SÖYLEMEK. Ölçü üç yazma ucuyla ve otomatik yollarla aynıdır (flags.ts ·
 * painterParcelOnTheWay); iki ölçü ayrışsaydı aynı sipariş bir yolda korunur,
 * diğerinde sessizce silinirdi.
 */
export function painterParcelRevokeTrace(o: {
  painterHandoffCarrier: string | null;
  painterHandoffTrackingNumber: string | null;
  receivedByPainterAt: Date | null;
}): { noteClause: string; warningTr: string | null } {
  if (!painterParcelOnTheWay(o)) return { noteClause: "", warningTr: null };
  const carrier = o.painterHandoffCarrier ?? "-";
  const tracking = o.painterHandoffTrackingNumber ?? "-";
  const received = o.receivedByPainterAt ? " (boyacı teslim almıştı)" : "";
  return {
    noteClause:
      ` KOLİ KAYDI (sipariş alanları temizlendi, kayıt bu notta durur): ` +
      `${carrier} / ${tracking}${received}.`,
    warningTr:
      `Koparma yapıldı, ama BASKI HÂLÂ DIŞARIDA: kargo kaydı ${carrier} / ${tracking}${received}. ` +
      `Siparişteki devir/kargo alanları temizlendi; kaydın kendisi sipariş notlarına yazıldı. ` +
      `Kutunun geri gelmesini ya da yeni partnere ulaşmasını elle takip edin.`,
  };
}

export const PAINTER_REVOCABLE_STATUSES = [
  "assigned",
  "accepted",
  "painting",
  "painted",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
] as const;

export type RevokeAfterPainterResult =
  | {
      code: "ok";
      prevManufacturerId: string | null;
      prevPainterId: string;
      prevManufacturerStatus: string | null;
      prevPainterStatus: string;
      orderNumber: string;
      userId: string;
      orderStatus: string;
      /** Geri alınan sipariş otomatik olarak yeni bir üreticiye yerleşti mi. */
      autoAssigned: boolean;
      /**
       * Koparma sırasında fiziksel koli hâlâ dışarıdaysa admin'e söylenecek
       * Türkçe cümle (yoksa null). İşlem BAŞARILIDIR; bu bir ret değil, eksik
       * kalan gerçeğin duyurusudur.
       */
      parcelWarningTr: string | null;
    }
  | { code: "not_found" }
  | { code: "not_handed_to_painter" }
  | { code: "already_shipped" }
  | { code: "wrong_status"; status: string }
  | { code: "earning_settled" }
  | { code: "reverse_failed" }
  | { code: "lost_race" }
  /**
   * Sipariş iade edilmiş: bu servis HİÇBİR ŞEY yazmadan (ve paraya dokunmadan)
   * çekilir. Koparmayı çağıranın iade yolu yapar (rotadaki
   * `detachRefundedFromPainter`).
   */
  | { code: "refunded" }
  /**
   * Koparma yarışı kaybedildi VE siparişin ödeme durumu okunamadı: baskı
   * hakedişi geri alınmıştı, yeniden tahakkuk KAPALI TARAFA düşülerek
   * yapılmadı. Çağıran bunu admin'e olduğu gibi söylemek zorundadır.
   */
  | { code: "state_unreadable" };

export async function revokeAfterPainterHandoff(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
  /** Keep the ranker from handing the order back to the same manufacturer. */
  blocklistManufacturer?: boolean;
  /** Add the painter to the order's painter blocklist. Default off. */
  blocklistPainter?: boolean;
  /**
   * "Kuyruğumda kalsın": sipariş geri alındıktan sonra otomatik olarak yeni bir
   * üreticiye YERLEŞTİRİLMESİN. Admin bazen bunu ister (müşteriyle
   * konuşulacak, iade düşünülüyor, üretici elle seçilecek). Varsayılan false.
   */
  keepInQueue?: boolean;
}): Promise<RevokeAfterPainterResult> {
  const { orderId, adminEmail, reason } = args;
  const blocklistManufacturer = args.blocklistManufacturer !== false;
  const blocklistPainter = args.blocklistPainter === true;
  const keepInQueue = args.keepInQueue === true;

  // Read + validate first (the atomic UPDATE below carries the concurrency
  // guard, mirroring painter-decline; we deliberately avoid an outer
  // transaction so reverseEarning's own transaction does not nest).
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });
  if (!order) return { code: "not_found" as const };
  // İADE TERMİNAL, VE BURADAN AŞAĞISI SİPARİŞİ KIMILDATIR: hakedişi çevirir,
  // durumu atama aşamasına geri sarar, İKİ kara listeyi birden işler, İKİ QC
  // turunu birden artırır ve sonunda otomatik atamayı tetikler. İade edilmiş
  // siparişte hepsi yasaktır (order-status-policy.ts). Kontrol en başta, ilk
  // yan etkiden (reverseEarning) ÖNCE durur: buradan `refunded` dönüldüğünde
  // sipariş de para da el değmemiş olur. Koparmayı rotanın iade yolu yapar;
  // parayı da orada çevirmeyiz, hakediş geri alma iadenin kendi işidir
  // (order-refund.ts).
  if (isRefunded(order)) return { code: "refunded" as const };
  if (order.shippedAt != null) return { code: "already_shipped" as const };
  if (
    !order.painterId ||
    !order.painterStatus ||
    order.painterStatus === "unassigned"
  ) {
    return { code: "not_handed_to_painter" as const };
  }
  if (order.painterStatus === "shipped") {
    // Belt-and-suspenders: painter-ship sets shippedAt too, so the guard above
    // already caught this — but never revoke a shipped-by-painter order.
    return { code: "already_shipped" as const };
  }
  if (
    !(PAINTER_REVOCABLE_STATUSES as readonly string[]).includes(
      order.painterStatus
    )
  ) {
    return { code: "wrong_status" as const, status: order.painterStatus };
  }

  const prevManufacturerId = order.manufacturerId;
  const prevPainterId = order.painterId;
  const prevManufacturerStatus = order.manufacturerStatus;
  const prevPainterStatus = order.painterStatus;
  // The print portion the previous manufacturer earned at hand-off. `painterId`
  // is still set at this point (we have not detached yet), so this resolves to
  // the production kalem total — the painting share stays the painter's.
  const printBaseKurus = manufacturerBaseKurus({
    amountKurus: order.amountKurus,
    productionBaseKurus: order.productionBaseKurus,
    paintingPriceKurus: order.paintingPriceKurus,
    painterId: prevPainterId,
    paintsInHouse: false,
  });

  // ── Money reconciliation BEFORE the detach ──────────────────────────────
  // Reverse the manufacturer's print-portion earning (accrued at send-to-painter)
  // and delete the reversed row so a future manufacturer can re-accrue. Do this
  // first so a failure aborts with the order UNTOUCHED (never a detached order
  // sitting over a stranded earning that would zero-pay the next manufacturer).
  try {
    await reverseEarning(orderId);
    await db
      .delete(manufacturerEarnings)
      .where(
        and(
          eq(manufacturerEarnings.orderId, orderId),
          eq(manufacturerEarnings.status, "reversed")
        )
      );
  } catch (e) {
    console.error("revoke-after-painter: earning reversal failed", e);
    return { code: "reverse_failed" as const };
  }

  // INVARIANT: after the reversal, NO manufacturer_earnings row may remain for
  // this order — the UNIQUE(order_id) constraint + onConflictDoNothing means any
  // survivor (a settled 'paid' row reverseEarning can't claw back) would block
  // the next manufacturer's accrual. If one survives, refuse and leave the order
  // intact; nothing was mutated (reverse/delete are no-ops on a 'paid' row).
  const surviving = await db
    .select({ id: manufacturerEarnings.id })
    .from(manufacturerEarnings)
    .where(eq(manufacturerEarnings.orderId, orderId))
    .limit(1);
  if (surviving.length > 0) {
    return { code: "earning_settled" as const };
  }

  const restoredStatus =
    order.orderType === "marketplace" && order.sellerManufacturerId
      ? "paid"
      : "approved";

  const declinedMfg = Array.isArray(order.declinedManufacturerIds)
    ? (order.declinedManufacturerIds as string[])
    : [];
  const declinedPainter = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];

  // Kutu dışarıdaysa kaydı nota taşı: aşağıdaki UPDATE dört kargo alanını da
  // temizliyor ve bu cümle olmasa kutunun izi tamamen kaybolurdu.
  const parcel = painterParcelRevokeTrace(order);
  const note = `[BOYACIDAN GERİ ALMA] Admin ${adminEmail} siparişi boyacıdan geri aldı (üretici: ${prevManufacturerStatus ?? "-"}, boyacı: ${prevPainterStatus}).${parcel.noteClause} Sebep: ${reason}`;

  const [updated] = await db
    .update(orders)
    .set({
      // Detach the manufacturer.
      manufacturerId: null,
      manufacturerStatus: "unassigned",
      assignedToManufacturerAt: null,
      manufacturerAcceptedAt: null,
      manufacturerPrintedAt: null,
      // Detach the painter and wipe every hand-off breadcrumb so the next
      // hand-off starts clean.
      painterId: null,
      painterStatus: "unassigned",
      assignedToPainterAt: null,
      sentToPainterAt: null,
      receivedByPainterAt: null,
      paintedAt: null,
      painterHandoffCarrier: null,
      painterHandoffTrackingNumber: null,
      // Back to the assignment stage.
      status: restoredStatus as typeof order.status,
      // Bump both QC rounds so neither partner's photos leak to the next ones.
      qcRound: sql`${orders.qcRound} + 1`,
      painterQcRound: sql`${orders.painterQcRound} + 1`,
      ...(blocklistManufacturer && prevManufacturerId
        ? {
            declinedManufacturerIds: Array.from(
              new Set([...declinedMfg, prevManufacturerId])
            ),
          }
        : {}),
      ...(blocklistPainter
        ? {
            declinedPainterIds: Array.from(
              new Set([...declinedPainter, prevPainterId])
            ),
          }
        : {}),
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, orderId),
        // Concurrency lock: if the painter shipped / declined or another admin
        // acted between the read and here, this matches 0 rows.
        eq(orders.painterId, prevPainterId),
        inArray(orders.painterStatus, [...PAINTER_REVOCABLE_STATUSES]),
        isNull(orders.shippedAt),
        // Yukarıdaki iade kontrolünün SQL karşılığı: okuma ile bu yazma
        // arasına düşen bir iade geri sarmayı ve iki kara listeyi yine
        // işletirdi. Yarış burada kapanır.
        notRefundedGuard()
      )
    )
    .returning();

  if (!updated) {
    // Hakediş ÇEVRİLDİ ama koparma yarışı kaybedildi. Artık iki ayrı sebebi
    // var ve tedavileri ZIT:
    //  • sipariş ilerledi (boyacı kargoladı, başka bir admin araya girdi) →
    //    üretici baskısının parasını hak ediyor, yeniden tahakkuk edilir;
    //  • araya İADE düştü (yukarıdaki yeni WHERE koşulu) → para müşteriye geri
    //    gitti; yeniden tahakkuk, iade edilmiş siparişin üstüne ÖDENEBİLİR bir
    //    hakediş yazmak olurdu (ödeme talebi toplu batch'e alır) — yapılmaz.
    // Ödeme durumu okunamazsa KAPALI TARAFA düşülür: yeniden tahakkuk
    // yapılmaz ve bu, çağırana `state_unreadable` olarak AÇIKÇA söylenir —
    // eksik bir hakediş admin ekranından telafi edilebilir, iade edilmiş
    // siparişe yazılmış ödenebilir bir hakediş sessizce ödenir.
    const refundedNow = await isOrderRefunded(orderId).catch(() => null);
    if (refundedNow === null) {
      console.error(
        "revoke-after-painter: lost race and payment state unreadable; earning left reversed",
        orderId
      );
      return { code: "state_unreadable" as const };
    }
    if (!refundedNow && prevManufacturerId) {
      // Yeniden tahakkukun SONUCU yutulmaz. Yarışı kaybettiğimize göre siparişe
      // araya giren biri dokunmuştur ve satır artık başkasına ait olabilir;
      // accrueEarning bunu sessizce geçmez (`mismatch_refused`) ve siparişin
      // admin notuna iz düşer. Buradaki günlük o izin yanına "hangi üretici,
      // hangi tutar" bilgisini koyar — bu para geri sarılmış, yerine yenisi
      // yazılamamış olabilir.
      const re = await accrueEarning(
        orderId,
        prevManufacturerId,
        printBaseKurus
      ).catch((e) => {
        console.error(
          "revoke-after-painter: re-accrue after lost race failed",
          e
        );
        return null;
      });
      if (re !== null && re !== "accrued" && re !== "already_accrued" && re !== "corrected") {
        console.error(
          `revoke-after-painter: ${orderId} baskı payı (${printBaseKurus} kuruş) yeniden yazılamadı (${re}) — üretici ${prevManufacturerId} EKSİK kalmış olabilir`
        );
      }
    }
    return refundedNow
      ? { code: "refunded" as const }
      : { code: "lost_race" as const };
  }

  // Audit trail on both partner ledgers. Deliberately "admin_revoked" (not
  // "decline") so the ranker's reliability scoring is untouched.
  if (prevManufacturerId) {
    await db
      .insert(manufacturerActions)
      .values({
        orderId,
        manufacturerId: prevManufacturerId,
        action: "admin_revoked",
        notes: `[Admin boyacıdan geri aldı] ${reason}`.slice(0, 500),
      })
      .catch((e) =>
        console.error("revoke-after-painter: manufacturerActions insert failed", e)
      );
  }
  await db
    .insert(painterActions)
    .values({
      orderId,
      painterId: prevPainterId,
      action: "admin_revoked",
      notes: `[Admin boyacıdan geri aldı] ${reason}`.slice(0, 500),
    })
    .catch((e) =>
      console.error("revoke-after-painter: painterActions insert failed", e)
    );

  // Detach BİTTİ: sipariş yeniden "onaylı/paid + atanmamış", yani otomatik
  // atamanın tetiklendiği geçişlerden biri. Tetikleyici rotaya değil buraya
  // konuldu ki bu fonksiyonu çağıran her yol (bugün admin rotası) aynı davransın.
  // Para mutabakatından SONRA çağrılır: hakediş geri alınmadan yeni üretici
  // atanırsa UNIQUE(order_id) yüzünden ikinci tahakkuk sessizce ₺0 kalırdı.
  let autoAssigned = false;
  if (!keepInQueue) {
    const placement = await autoAssignIfEligible(orderId, {
      reason: "boyacıdan geri alındı",
      // `blocklistManufacturer` işaretlenmemiş olsa bile iş, az önce
      // koparıldığı atölyeye anında geri gitmemeli.
      excludeManufacturerIds: prevManufacturerId ? [prevManufacturerId] : [],
    });
    autoAssigned = placement.assigned;
  }

  return {
    code: "ok" as const,
    prevManufacturerId,
    prevPainterId,
    prevManufacturerStatus,
    prevPainterStatus,
    orderNumber: order.orderNumber,
    userId: order.userId,
    orderStatus: restoredStatus,
    autoAssigned,
    parcelWarningTr: parcel.warningTr,
  };
}
