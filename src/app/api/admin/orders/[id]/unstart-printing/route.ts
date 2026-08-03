import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Undo an admin self-fulfilled "start printing".
 *
 * The gap this closes: `start-printing` moves an admin-fulfilled order
 * (no manufacturer) `approved → printing`, and the only forward action from
 * there is `ship`. If the admin hit it by mistake — or decides to hand the job
 * to a manufacturer after all — there was no way back to the assignment stage.
 *
 * This is the mirror of `start-printing`: same `isNull(manufacturerId)` guard so
 * it can NEVER touch a manufacturer-driven order (those use revoke-manufacturer).
 * No money is involved on the admin self-fulfillment track, so nothing to
 * reconcile — it is a pure `printing → approved` status reset.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email ?? "admin";

  const { id } = await params;

  // Atomic + concurrency-safe: only a printing, manufacturer-less order matches.
  const [order] = await db
    .update(orders)
    .set({ status: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.status, "printing"),
        isNull(orders.manufacturerId)
      )
    )
    .returning();

  if (!order) {
    return NextResponse.json(
      {
        error:
          "Sipariş baskı aşamasında değil ya da bir üreticiye ait (üretici siparişleri için 'Atamayı geri al' kullanın).",
      },
      { status: 400 }
    );
  }

  await db
    .insert(adminActions)
    .values({
      orderId: id,
      // No dedicated enum value — reuse "edit" (a neutral admin state change) so
      // this ships without an `admin_action_type` migration. The note carries
      // the real meaning for the history log.
      action: "edit",
      adminEmail,
      notes: "Baskı geri alındı → onaya (atama aşamasına) döndürüldü.",
    })
    .catch((e) => console.error("unstart-printing: adminActions insert failed", e));

  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
  }).catch((e) => console.error("unstart-printing: emit failed", e));

  return NextResponse.json({ success: true });
}
