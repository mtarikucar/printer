import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterQcReviews, painterQcPhotos } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";

// Admin approves a painter's QC round: qc_pending → qc_approved (shipping unlocked).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true, orderNumber: true, userId: true, manufacturerId: true,
      painterId: true, painterStatus: true, painterQcRound: true, paymentStatus: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  // Approving painter QC unlocks the painter's ship, which accrues their
  // earning. A refunded order that still has its painter attached stops here.
  if (isRefunded(order)) {
    return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
  }

  const next = painterQcNextStatus((order.painterStatus ?? "") as PainterOrderStatus, "approve");
  if (!next) return NextResponse.json({ error: "Sipariş QC onayına uygun değil" }, { status: 400 });

  const [updated] = await db
    .update(orders)
    .set({ painterStatus: next, updatedAt: new Date() })
    // The guard again in the write, so a refund landing after the read wins.
    .where(and(eq(orders.id, id), eq(orders.painterStatus, "qc_pending"), notRefundedGuard()))
    .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
  if (!updated) {
    if (await isOrderRefunded(id)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    return NextResponse.json({ error: "Zaten işlenmiş" }, { status: 400 });
  }

  await db.insert(painterQcReviews).values({
    orderId: id, round: order.painterQcRound, decision: "approved", adminEmail: a.session.user.email,
  });
  await db
    .update(painterQcPhotos)
    .set({ reviewStatus: "approved" })
    .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));

  if (order.painterId) {
    await notifyPainter({
      painterId: order.painterId,
      type: "qc_result",
      subject: "QC onaylandı",
      body: `${order.orderNumber} numaralı işin kalite kontrolü onaylandı. Artık kargolayabilirsiniz.`,
      orderId: id,
    }).catch((e) => console.error("notifyPainter (qc approve) failed", e));
  }
  await emitOrderChanged({
    orderId: updated.id, orderNumber: updated.orderNumber, userId: updated.userId,
    manufacturerId: updated.manufacturerId, status: updated.status,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
