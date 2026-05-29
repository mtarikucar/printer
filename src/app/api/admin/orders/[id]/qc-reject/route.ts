import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, qcPhotos, qcReviews } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

// Admin rejects the submitted QC photos → qc_rejected; bumps qcRound so the
// manufacturer uploads a fresh round. Shipping stays blocked.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
  }
  const { reason } = parsed.data;

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
    "reject"
  );
  if (!next) {
    return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
  }

  const [updated] = await db
    .update(orders)
    .set({
      manufacturerStatus: next,
      qcRound: sql`${orders.qcRound} + 1`,
      qcRejectionCount: sql`${orders.qcRejectionCount} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), eq(orders.manufacturerStatus, "qc_pending")))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
  }

  // Mark the just-reviewed (old) round's photos rejected; new uploads land on
  // the bumped round.
  await db
    .update(qcPhotos)
    .set({ reviewStatus: "rejected" })
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
    decision: "rejected",
    reason,
    adminEmail,
  });
  await db.insert(adminActions).values({
    orderId: id,
    action: "qc_reject",
    adminEmail,
    notes: reason,
  });

  if (order.manufacturerId) {
    await notifyManufacturer({
      manufacturerId: order.manufacturerId,
      type: "qc_result",
      subject: `QC reddedildi — ${order.orderNumber}`,
      body: `Kalite kontrol reddedildi. Gerekçe: ${reason}. Lütfen düzeltip yeni fotoğraf yükleyerek tekrar gönderin.`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer qc_reject failed", e));
  }

  return NextResponse.json({ success: true });
}
