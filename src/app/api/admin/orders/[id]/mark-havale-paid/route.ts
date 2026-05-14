import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orderDrafts, adminActions } from "@/lib/db/schema";
import { promoteDraftToOrder } from "@/lib/services/order-draft";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * `id` is the draft id. Admin manually promotes a havale draft when OCR confidence was
 * medium/low or admin reviewed the receipt out-of-band.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: d["api.auth.unauthorized"] }, { status: 401 });
  }

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
