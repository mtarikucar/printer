import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { assignManufacturerToOrder } from "@/lib/services/manufacturer-assign";

// Hand a batch of orders for ONE product to a single manufacturer.
//
// This is the deterministic half of production batching: the ranker's
// batchAffinity signal nudges repeat orders toward the same workshop, but an
// admin looking at "340 units of this keychain across 9 orders" needs to be
// able to just place them all at once. Bounded to keep one request from turning
// into an unbounded fan-out of notifications.
const MAX_BULK_ASSIGN = 50;

const schema = z.object({
  manufacturerId: z.string().uuid(),
  orderIds: z.array(z.string().uuid()).min(1).max(MAX_BULK_ASSIGN),
});

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz veri" },
      { status: 400 }
    );
  }
  const { manufacturerId, orderIds } = parsed.data;

  // Sequential on purpose: each assignment writes an audit row and fires a
  // partner notification, and the shared service already guards each update on
  // the order still being unassigned. Racing 50 of these at one manufacturer
  // buys nothing and makes the failure report harder to read.
  const assigned: string[] = [];
  const skipped: Array<{ orderId: string; reason: string }> = [];
  for (const orderId of orderIds) {
    const result = await assignManufacturerToOrder({
      orderId,
      manufacturerId,
      adminEmail: a.session.user.email,
    });
    if (result.ok) assigned.push(orderId);
    else skipped.push({ orderId, reason: result.reason });
  }

  // A partially-applied batch is the normal outcome when someone else grabbed
  // an order in the meantime — report it rather than failing the whole call.
  return NextResponse.json({
    success: true,
    assignedCount: assigned.length,
    skipped,
  });
}
