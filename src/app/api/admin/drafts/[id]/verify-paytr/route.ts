import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { queryPaytrTransactionStatus } from "@/lib/services/paytr";
import { failDraft, promoteDraftToOrder } from "@/lib/services/order-draft";

/**
 * Admin-triggered PayTR status reconciliation. Used to recover card drafts whose
 * webhook was lost (localhost dev, transient outage, mis-configured notification
 * URL). Queries PayTR for the canonical state of merchant_oid and promotes /
 * fails the draft accordingly.
 *
 * Idempotent: calling on an already-promoted draft returns the existing order.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();

  if ("response" in a) return a.response;

  const { id } = await params;
  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, id),
  });
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.paymentMethod !== "card") {
    return NextResponse.json(
      { error: "Only card drafts support PayTR verification" },
      { status: 400 }
    );
  }

  if (!draft.paytrMerchantOid) {
    return NextResponse.json(
      { error: "Draft has no PayTR merchant_oid — payment was never started" },
      { status: 400 }
    );
  }

  if (draft.status === "confirmed" && draft.promotedOrderId) {
    return NextResponse.json({
      state: "confirmed",
      orderId: draft.promotedOrderId,
      orderNumber: draft.reference,
    });
  }

  const result = await queryPaytrTransactionStatus(draft.paytrMerchantOid);

  if (result.status === "success") {
    try {
      const promoted = await promoteDraftToOrder(draft.id);
      return NextResponse.json({
        state: "confirmed",
        orderId: promoted.orderId,
        orderNumber: promoted.orderNumber,
        paytr: {
          paymentAmount: result.paymentAmount,
          paymentType: result.paymentType,
          testMode: result.testMode,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "promotion_failed";
      console.error(
        `[admin.verify-paytr] promotion failed for ${draft.reference}`,
        err
      );
      return NextResponse.json(
        { state: "verify_error", error: msg },
        { status: 500 }
      );
    }
  }

  if (result.status === "failed") {
    const reason =
      [result.failedReasonCode, result.failedReasonMsg]
        .filter(Boolean)
        .join(" — ") || "PayTR rejected the payment";
    await failDraft(draft.id, reason);
    return NextResponse.json({ state: "failed", reason });
  }

  if (result.status === "waiting") {
    return NextResponse.json({ state: "waiting" });
  }

  return NextResponse.json(
    {
      state: "verify_error",
      error: result.failedReasonMsg || "PayTR status query failed",
    },
    { status: 502 }
  );
}
