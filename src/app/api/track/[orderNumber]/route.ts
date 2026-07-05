import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderDrafts, generationAttempts } from "@/lib/db/schema";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { getSessionUser } from "@/lib/services/customer-auth";
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
  // The track page is reachable by order number alone (guest-friendly), so a
  // few sensitive links are emitted only to the authenticated owner.
  const session = await getSessionUser();

  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true, outputStlUrl: true, outputObjUrl: true },
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

    const isOwner = !!session?.userId && session.userId === order.userId;
    const finalAmountKurus =
      order.amountKurus - order.giftCardAmountKurus - order.havaleDiscountKurus;
    // The dekont (bank receipt) link is a session-gated route; only emit it to
    // the owner so its existence/path isn't disclosed to a guest who merely
    // knows the order number (the link 401s for them anyway).
    const receiptUrl =
      draft?.bankTransferReceiptKey && isOwner
        ? `/api/customer/orders/${order.orderNumber}/receipt/view`
        : null;

    return NextResponse.json({
      orderNumber: order.orderNumber,
      status: order.status,
      customerName: order.customerName,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      isPublic: order.isPublic,
      publicDisplayName: order.publicDisplayName,
      galleryReviewStatus: order.galleryReviewStatus,
      galleryReviewReason: order.galleryReviewReason,
      // Prefer the admin-uploaded model (image-first fal.ai flow), falling back
      // to a legacy succeeded generation attempt for historical Meshy orders.
      glbUrl: normalizeFileUrl(
        order.modelGlbUrl ?? order.generationAttempts[0]?.outputGlbUrl ?? null
      ),
      // Digital-files add-on: whether the customer bought it and whether the
      // print-ready files are downloadable yet. The bytes are served only via
      // the entitlement-gated /api/customer/orders/.../download endpoint.
      digitalFiles: {
        entitled:
          order.paymentStatus === "succeeded" &&
          (order.upsells ?? []).includes("digital_files"),
        // STL comes from the admin upload (orders.model_stl_url) or a legacy
        // attempt; OBJ is legacy-attempt-only (image-first flow produces no OBJ).
        stlReady: !!(order.modelStlUrl || order.generationAttempts[0]?.outputStlUrl),
        objReady: !!order.generationAttempts[0]?.outputObjUrl,
      },
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      // Marketplace option/add-on selection + the resolved painted/unpainted
      // image, so the confirmation reflects exactly what was ordered.
      selectedOptions: order.selectedOptions ?? [],
      selectedAddons: order.selectedAddons ?? [],
      itemImageUrl: order.itemImageKey ? getPublicUrl(order.itemImageKey) : null,
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
  const draftIsOwner = !!session?.userId && session.userId === draft.userId;
  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;
  const receiptUrl =
    draft.bankTransferReceiptKey && draftIsOwner
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
