import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderDrafts, generationAttempts } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";
import { getBankDetails } from "@/lib/config/payment";

/**
 * Track endpoint resolves either a confirmed order or a pending draft (same reference string).
 * Pre-payment drafts return synthetic status `pending_payment` so the UI can render the
 * payment-pending experience without leaking that drafts/orders are different tables.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const { orderNumber } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  if (order) {
    // Look up the (now historical) draft to surface dekont receipt and havale total.
    const draft = order.draftId
      ? await db.query.orderDrafts.findFirst({
          where: eq(orderDrafts.id, order.draftId),
          columns: {
            bankTransferReceiptKey: true,
            havaleDiscountKurus: true,
            paymentMethod: true,
          },
        })
      : null;

    const finalAmountKurus =
      order.amountKurus - order.giftCardAmountKurus - order.havaleDiscountKurus;
    const receiptUrl = draft?.bankTransferReceiptKey
      ? `/api/customer/orders/${order.orderNumber}/receipt/view`
      : null;

    return NextResponse.json({
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      paidAt: order.paidAt,
      shippedAt: order.shippedAt,
      createdAt: order.createdAt,
      isPublic: order.isPublic,
      publicDisplayName: order.publicDisplayName,
      galleryReviewStatus: order.galleryReviewStatus,
      galleryReviewReason: order.galleryReviewReason,
      glbUrl: normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      amountKurus: order.amountKurus,
      giftCardAmountKurus: order.giftCardAmountKurus,
      havaleDiscountKurus: order.havaleDiscountKurus,
      failureReason: order.failureReason,
      bankTransfer: null,
      bankTransferHistory:
        order.paymentMethod === "bank_transfer"
          ? {
              finalAmountKurus,
              paidAt: order.paidAt?.toISOString() ?? null,
              receiptUrl,
            }
          : null,
    });
  }

  // Pre-payment: try the draft.
  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.reference, orderNumber),
  });
  if (!draft) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const isAwaitingTransfer =
    draft.paymentMethod === "bank_transfer" &&
    (draft.status === "pending" || draft.status === "awaiting_review");
  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;
  const receiptUrl = draft.bankTransferReceiptKey
    ? `/api/customer/orders/${draft.reference}/receipt/view`
    : null;

  // Map draft status to a synthetic order status the client already understands.
  let syntheticStatus: string;
  if (draft.status === "expired") syntheticStatus = "rejected";
  else if (draft.status === "failed") syntheticStatus = "rejected";
  else if (draft.status === "cancelled") syntheticStatus = "rejected";
  else syntheticStatus = "pending_payment";

  return NextResponse.json({
    orderNumber: draft.reference,
    status: syntheticStatus,
    customerName: draft.customerName,
    trackingNumber: null,
    carrier: null,
    paidAt: null,
    shippedAt: null,
    createdAt: draft.createdAt,
    isPublic: false,
    publicDisplayName: null,
    glbUrl: null,
    paymentMethod: draft.paymentMethod,
    // Map draft status → legacy paymentStatus values the UI uses to switch banners.
    paymentStatus:
      draft.status === "pending" && draft.paymentMethod === "bank_transfer"
        ? "awaiting_transfer"
        : draft.status === "expired"
        ? "expired"
        : draft.paytrFailureReason
        ? "failed"
        : "pending",
    amountKurus: draft.amountKurus,
    giftCardAmountKurus: draft.giftCardAmountKurus,
    havaleDiscountKurus: draft.havaleDiscountKurus,
    failureReason: draft.paytrFailureReason,
    bankTransfer: isAwaitingTransfer
      ? {
          bank: getBankDetails(),
          finalAmountKurus,
          deadline: draft.bankTransferDeadline?.toISOString() ?? null,
          receiptUploadedAt:
            draft.bankTransferReceiptUploadedAt?.toISOString() ?? null,
          receiptUrl,
          ocrConfidence: draft.receiptOcrConfidence ?? null,
          ocrStatus: draft.bankTransferReceiptKey
            ? draft.receiptOcrConfidence
              ? "scanned"
              : "scanning"
            : null,
        }
      : null,
    bankTransferHistory: null,
  });
}
