import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions, qcPhotos } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { emitOrderChanged } from "@/lib/realtime/emit";

// Manufacturer submits the current round of QC photos for admin review:
// printed | qc_rejected → qc_pending (order.status → quality_check).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const { id } = await params;
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: {
      id: true,
      manufacturerStatus: true,
      qcRound: true,
      email: true,
      orderNumber: true,
      customerName: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const current = (order.manufacturerStatus ?? "") as ManufacturerOrderStatus;
  const next = qcNextStatus(current, "submit");
  if (!next) {
    return NextResponse.json(
      { error: "Order is not in a submittable status" },
      { status: 400 }
    );
  }

  const [photoRow] = await db
    .select({ value: count() })
    .from(qcPhotos)
    .where(and(eq(qcPhotos.orderId, id), eq(qcPhotos.round, order.qcRound)));
  if (Number(photoRow?.value ?? 0) < 1) {
    return NextResponse.json(
      { error: "Add at least one photo before submitting" },
      { status: 400 }
    );
  }

  // Atomic transition guarded on the exact status we read.
  const [updated] = await db
    .update(orders)
    .set({ manufacturerStatus: next, status: "quality_check", updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, current)
      )
    )
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Order is not in a submittable status" },
      { status: 400 }
    );
  }

  await db.insert(manufacturerActions).values({
    orderId: id,
    manufacturerId: session.manufacturerId,
    action: "submit_qc",
    notes: `round ${order.qcRound}`,
  });

  // Notify admin there's a QC review waiting (recipient overridden to adminEmail).
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    await getEmailQueue().add("qc-submitted", {
      type: "qc_submitted",
      to: order.email,
      adminEmail,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      companyName: manufacturer.companyName,
    });
  }

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
    manufacturerStatus: updated.manufacturerStatus,
  });

  return NextResponse.json({ success: true });
}
