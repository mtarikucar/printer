import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { applyStrike } from "@/lib/services/strikes";

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
    columns: { status: true },
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
    columns: { declinedManufacturerIds: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

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
      // Fresh QC round for the next manufacturer; prior photos stay as audit.
      qcRound: sql`${orders.qcRound} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        inArray(orders.manufacturerStatus, [...CANCELLABLE])
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

  return NextResponse.json({ success: true });
}
