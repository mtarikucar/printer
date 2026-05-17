import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orderDrafts, adminActions } from "@/lib/db/schema";
import { promoteDraftToOrder } from "@/lib/services/order-draft";

/**
 * `id` is the draft id. Admin manually promotes a havale draft when OCR confidence was
 * medium/low or admin reviewed the receipt out-of-band.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const session = { user: { email: a.session.user.email } };

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, id),
  });
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.paymentMethod !== "bank_transfer") {
    return NextResponse.json(
      { error: "Draft is not a bank transfer" },
      { status: 400 }
    );
  }

  if (draft.status === "confirmed" && draft.promotedOrderId) {
    return NextResponse.json({
      success: true,
      alreadyPaid: true,
      orderId: draft.promotedOrderId,
    });
  }

  if (draft.status !== "pending" && draft.status !== "awaiting_review") {
    return NextResponse.json(
      { error: `Draft is in '${draft.status}' state and cannot be marked paid` },
      { status: 400 }
    );
  }

  const promoted = await promoteDraftToOrder(draft.id);

  await db.insert(adminActions).values({
    orderId: promoted.orderId,
    action: "mark_havale_paid",
    adminEmail: session.user.email,
    notes: body.notes,
  });

  return NextResponse.json({
    success: true,
    orderId: promoted.orderId,
    orderNumber: promoted.orderNumber,
  });
}
