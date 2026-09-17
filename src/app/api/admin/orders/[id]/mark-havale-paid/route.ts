import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orderDrafts, adminActions } from "@/lib/db/schema";
import { DraftConsentRequiredError, DraftPaymentEvidenceChangedError } from "@/lib/services/draft-commercial-consent";
import { z } from "zod";
import { promoteDraftToOrder } from "@/lib/services/order-draft";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * `id` is the draft id. Admin manually promotes a havale draft when OCR confidence was
 * medium/low or admin reviewed the receipt out-of-band.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const session = { user: { email: a.session.user.email } };

    const { id } = await params;
    const parsed = z.object({
      notes: z.string().optional(),
      commercialFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    }).safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Ödeme onay bilgileri geçersiz. Sayfayı yenileyip tekrar deneyin." }, { status: 400 });
    const body = parsed.data;

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

    let promoted: Awaited<ReturnType<typeof promoteDraftToOrder>>;
    try {
      promoted = await promoteDraftToOrder(draft.id, { manualPaymentEvidence: { fingerprint: body.commercialFingerprint } });
    } catch (error) {
      if (error instanceof DraftPaymentEvidenceChangedError) return NextResponse.json({ error: error.message, code: "payment_evidence_changed" }, { status: 409 });
      if (error instanceof DraftConsentRequiredError) return NextResponse.json({ error: error.message, code: "commercial_consent_required" }, { status: 409 });
      throw error;
    }

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
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/mark-havale-paid", ADMIN_ACTION_FAILED_ERROR);
  }
}
