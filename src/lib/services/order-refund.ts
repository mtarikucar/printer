import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { reverseEarning } from "@/lib/services/payouts";
import { reversePainterEarning } from "@/lib/services/painter-payouts";
import { refundGiftCardForOrder } from "@/lib/services/order-draft";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";
import { recordRefund } from "@/lib/analytics/server";
import { formatAdminNoteLine, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";

export type RefundOrderResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_refunded" };

/**
 * Bir siparişi iade eder. TEK para yolu — admin rotası da atölye iptalleri de
 * buradan geçer. Rotadan çıkarıldı (saf taşıma), çünkü ikinci bir kopya
 * zamanla ilkinden ayrışır.
 *
 * Yan etkiler sırayla: sipariş iade işaretlenir + partnerler koparılır,
 * hakediş/boyacı hakedişi/hediye kartı geri alınır, admin aksiyonu yazılır,
 * müşteriye bildirim + e-posta gider, SSE yayılır, GA4 refund kaydedilir.
 * Para dışı adımların hatası loglanır ama iadeyi geri almaz (mevcut davranış).
 *
 * `already_refunded`: sipariş zaten iade edilmiş; hiçbir yan etki çalışmaz.
 * Karar ön okumada DEĞİL, korumalı UPDATE'te verilir: okuma ile yazma arasına
 * bir ret (reject rotası kendi korumalı çevirmesiyle `refunded` yazar) ya da
 * ikinci bir iade girerse UPDATE hiçbir satırı eşleştirmez. Eskiden koşulsuz
 * yazıyordu; iki yol da hakedişleri geri alıyor, müşteriye ikinci "iade edildi"
 * e-postası gidiyor ve recordRefund geliri İKİ kez düşüyordu.
 */
export async function refundOrder(input: {
  orderId: string;
  reason: string | null;
  adminEmail: string;
}): Promise<RefundOrderResult> {
  const { orderId: id, reason, adminEmail } = input;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      userId: true,
      orderNumber: true,
      email: true,
      customerName: true,
      paymentStatus: true,
      status: true,
      manufacturerId: true,
      locale: true,
      amountKurus: true,
      giftCardAmountKurus: true,
      havaleDiscountKurus: true,
      productId: true,
      attribution: true,
    },
  });
  if (!order) return { ok: false, reason: "not_found" };
  // Hızlı yol; asıl koruma aşağıdaki UPDATE'in WHERE'inde.
  if (isRefunded(order)) {
    return { ok: false, reason: "already_refunded" };
  }

  // İade gerekçesi admin notuna EKLENİR, üzerine yazılmaz: eskiden gerekçe
  // (varsayılanı "Admin iadesi") notun tamamını siliyor, SLA worker'larının ve
  // üretici red akışının bıraktığı [SLA] bayraklarını da götürüyordu.
  const trimmedReason = reason?.trim() ?? "";
  const reasonLine = trimmedReason ? formatAdminNoteLine(`İade: ${trimmedReason}`) : null;

  // Korumalı çevirme: yalnız hâlâ iade edilmemiş sipariş `refunded` olur
  // (notRefundedGuard, iade kuralının tek SQL karşılığı). RETURNING boş dönerse
  // araya başka bir iade/ret girmiştir: o yol yan etkileri zaten çalıştırdı.
  const [flipped] = await db
    .update(orders)
    .set({
      paymentStatus: "refunded",
      ...(reasonLine
        ? {
            adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${reasonLine} ELSE ${orders.adminNotes} || E'\n' || ${reasonLine} END`,
          }
        : {}),
      // Halt fulfillment: detach the partners so a refunded order can no longer
      // be shipped for a fresh earning. The manufacturer/painter ship routes gate
      // on manufacturerId/painterId matching the session, so clearing them (and
      // resetting the sub-statuses) removes the order from every partner queue and
      // makes any further ship attempt a no-op. reverseEarning below backs out
      // anything already accrued; detaching stops it re-accruing.
      manufacturerId: null,
      manufacturerStatus: "unassigned",
      painterId: null,
      painterStatus: "unassigned",
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), notRefundedGuard()))
    .returning({ id: orders.id });
  if (!flipped) return { ok: false, reason: "already_refunded" };

  await reverseEarning(id).catch((e) => console.error("reverseEarning failed", e));
  // Also claw back the painter's earning for a refunded painting order.
  await reversePainterEarning(id).catch((e) =>
    console.error("reversePainterEarning failed", e)
  );
  // Restore any gift-card credit the order consumed — the spent balance must go
  // back on the card when the order is refunded (idempotent; no-op if none).
  await refundGiftCardForOrder(id).catch((e) =>
    console.error("refundGiftCardForOrder failed", e)
  );

  await db.insert(adminActions).values({
    orderId: id,
    action: "refund",
    adminEmail,
    notes: reason,
  });

  if (order.userId) {
    await notifyCustomer({
      userId: order.userId,
      orderId: id,
      type: "order_refunded",
      title: "Siparişin iade edildi",
      body: `${order.orderNumber} numaralı siparişin için iade işlendi.`,
    });
  }
  await getEmailQueue()
    .add("send-email", {
      type: "order_refunded",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale: order.locale === "en" ? "en" : "tr",
    })
    .catch((e) => console.error("refund email enqueue failed", e));

  // `order.manufacturerId` UPDATE'ten ÖNCE okunan değerdir (UPDATE onu null
  // yapar) — üreticinin SSE odası bu yüzden hâlâ haberdar olur. Sıra bozulursa
  // siparişi kuyruğundan düşen üretici hiçbir bildirim almaz.
  await emitOrderChanged({
    orderId: id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  });

  // Server-side refund conversion (keeps GA4 revenue/ROAS honest). Fire-and-forget.
  // Value MUST match the purchase event's basis (gross order.amountKurus, recorded
  // in promoteDraftToOrder) so a full refund nets the reported revenue to exactly
  // zero — recording the net cash here would leave the gift-card/havale portion as
  // phantom residual revenue in GA4/Meta.
  void recordRefund({
    orderNumber: order.orderNumber,
    valueKurus: order.amountKurus,
    userId: order.userId,
    productId: order.productId,
    attribution: order.attribution,
  }).catch(() => {});

  return { ok: true };
}
