import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, sql, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { applyStrike } from "@/lib/services/strikes";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";

// Manufacturer cancels an order they already accepted (printer broke, out of
// material, etc.). Unlike "decline" (only allowed while `assigned`), this is
// post-acceptance: the order returns to the admin queue (unassigned), the
// manufacturer is skipped on reassignment, a strike is recorded, and qcRound is
// bumped so any QC photos they uploaded don't leak to the next manufacturer.
const CANCELLABLE = [
  "accepted",
  "printing",
  "printed",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
] as const;

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { status: true, companyName: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  const reason = parsed.success ? parsed.data.reason : undefined;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: { declinedManufacturerIds: true, painterStatus: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Once the order has been handed off to a painter, the manufacturer's print +
  // QC work is already done and their print-portion earning has accrued. Letting
  // them "cancel" now would fork the order (the painter still holds it while it
  // re-enters the admin queue) AND strand a payable earning on the abandoning
  // manufacturer while the UNIQUE(orderId) constraint zeroes out the replacement
  // manufacturer's accrual. So cancel is only valid before hand-off — a bounced
  // painting job comes back through the painter's own decline flow instead.
  const handedToPainter =
    order.painterStatus != null && order.painterStatus !== "unassigned";
  if (handedToPainter) {
    return NextResponse.json(
      { error: "Bu sipariş boyacıya devredildi; artık iptal edilemez." },
      { status: 400 }
    );
  }

  const declined = Array.isArray(order.declinedManufacturerIds)
    ? (order.declinedManufacturerIds as string[])
    : [];

  const [updated] = await db
    .update(orders)
    .set({
      manufacturerId: null,
      manufacturerStatus: "unassigned",
      status: "approved",
      declinedManufacturerIds: Array.from(new Set([...declined, session.manufacturerId])),
      assignedToManufacturerAt: null,
      manufacturerAcceptedAt: null,
      // Durable admin flag so the order is visibly back in the manual queue even
      // if ADMIN_EMAIL is unset / the alert email fails (mirrors decline's N12
      // adminNotes). Append, don't overwrite a concurrent note.
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${"[İPTAL] Üretici kabul sonrası iptal etti — manuel atama gerekli."} ELSE ${orders.adminNotes} || E'\n' || ${"[İPTAL] Üretici kabul sonrası iptal etti — manuel atama gerekli."} END`,
      // Fresh QC round for the next manufacturer; prior photos stay as audit.
      qcRound: sql`${orders.qcRound} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        inArray(orders.manufacturerStatus, [...CANCELLABLE]),
        // Race-safe mirror of the hand-off guard above: never cancel an order a
        // painter is (or was) actively holding.
        or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
      )
    )
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Order is not in a cancellable status" },
      { status: 400 }
    );
  }

  await db.insert(manufacturerActions).values({
    orderId: id,
    manufacturerId: session.manufacturerId,
    action: "cancel_after_accept",
    notes: reason ?? null,
  });

  // Reliability strike — auto-suspends past the threshold (Faz 3).
  await applyStrike(session.manufacturerId);

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
    manufacturerStatus: updated.manufacturerStatus,
  });

  // Alert admin by email — admin has no inbox; the realtime emit above already
  // returns the order to the admin queue live, this adds the offline reach.
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    await getEmailQueue()
      .add("manufacturer-cancelled", {
        type: "manufacturer_cancelled",
        to: adminEmail,
        adminEmail,
        orderNumber: updated.orderNumber,
        customerName: manufacturer.companyName,
        companyName: manufacturer.companyName,
        cancelReason: reason,
        locale: "tr",
      })
      .catch((e) => console.error("manufacturer-cancelled email enqueue failed", e));
  }

  return NextResponse.json({ success: true });
}
