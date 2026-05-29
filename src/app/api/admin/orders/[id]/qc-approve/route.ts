import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, qcPhotos, qcReviews } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";

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
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "qc_result",
      subject: `QC onaylandı — ${order.orderNumber}`,
      body: `${order.orderNumber} numaralı sipariş kalite kontrolden geçti. Artık kargolayabilirsiniz.`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer qc_approve failed", e));
  }

  return NextResponse.json({ success: true });
}
