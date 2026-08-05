import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, manufacturers, qcPhotos, qcReviews } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { emitOrderChanged } from "@/lib/realtime/emit";

// Admin approves the submitted QC photos → qc_approved (unlocks shipping).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email;
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      manufacturerStatus: true,
      qcRound: true,
      manufacturerId: true,
      orderNumber: true,
      userId: true,
      needsPainting: true,
      painterStatus: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const next = qcNextStatus(
    (order.manufacturerStatus ?? "") as ManufacturerOrderStatus,
    "approve"
  );
  if (!next) {
    return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
  }

  const [updated] = await db
    .update(orders)
    .set({ manufacturerStatus: next, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.manufacturerStatus, "qc_pending")))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
  }

  await db
    .update(qcPhotos)
    .set({ reviewStatus: "approved" })
    .where(
      and(
        eq(qcPhotos.orderId, id),
        eq(qcPhotos.round, order.qcRound),
        eq(qcPhotos.reviewStatus, "pending")
      )
    );
  await db.insert(qcReviews).values({
    orderId: id,
    round: order.qcRound,
    decision: "approved",
    adminEmail,
  });
  await db.insert(adminActions).values({
    orderId: id,
    action: "qc_approve",
    adminEmail,
  });

  if (order.manufacturerId) {
    // The next step after QC differs per order, and telling every manufacturer
    // "artık kargolayabilirsiniz" left painting orders stuck: the ship panel is
    // hidden for them (only a painter may ship a painting order), so the
    // instruction pointed at a button that isn't there. Spell out the real next
    // action instead.
    const mfr = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, order.manufacturerId),
      columns: { paintsInHouse: true },
    });
    const handsOffToPainter = order.needsPainting && !mfr?.paintsInHouse;
    const nextStep = handsOffToPainter
      ? "Sipariş profesyonel boyama içeriyor: kargolamak yerine sipariş sayfasındaki “Boyacıya gönder” bölümünden bir boyacı seçip figürü ona gönderin. Boyacı boyayıp müşteriye kargolayacak."
      : order.needsPainting
        ? "Sipariş profesyonel boyama içeriyor: kendiniz boyayıp kargolayabilir ya da sipariş sayfasından bir boyacıya gönderebilirsiniz."
        : "Artık sipariş sayfasından kargo takip numarasını girip müşteriye gönderebilirsiniz.";
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "qc_result",
      subject: `QC onaylandı — ${order.orderNumber}`,
      body: `${order.orderNumber} numaralı sipariş kalite kontrolden geçti. ${nextStep}`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer qc_approve failed", e));
  }

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    manufacturerStatus: next,
  });

  return NextResponse.json({ success: true });
}
