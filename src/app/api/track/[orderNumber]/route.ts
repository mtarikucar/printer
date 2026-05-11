import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";
import { getBankDetails } from "@/lib/config/payment";

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

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const isAwaitingTransfer =
    order.paymentMethod === "bank_transfer" &&
    order.paymentStatus === "awaiting_transfer";

  // Once paid we keep a stripped-down history block so the customer can still
  // see what they paid and how — but without bank details, deadline or upload.
  const isBankTransferHistory =
    order.paymentMethod === "bank_transfer" &&
    !isAwaitingTransfer &&
    order.paymentStatus === "succeeded";

  const finalAmountKurus =
    order.amountKurus - order.giftCardAmountKurus - order.havaleDiscountKurus;

  // Auth'd customer-only path — only the owner's session will succeed.
  const receiptUrl = order.bankTransferReceiptKey
    ? `/api/customer/orders/${order.orderNumber}/receipt/view`
    : null;

  return NextResponse.json({
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    trackingNumber: order.trackingNumber,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    createdAt: order.createdAt,
    isPublic: order.isPublic,
    publicDisplayName: order.publicDisplayName,
    glbUrl: normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null),
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    amountKurus: order.amountKurus,
    giftCardAmountKurus: order.giftCardAmountKurus,
    havaleDiscountKurus: order.havaleDiscountKurus,
    failureReason: order.failureReason,
    bankTransfer: isAwaitingTransfer
      ? {
          bank: getBankDetails(),
          finalAmountKurus,
          deadline: order.bankTransferDeadline?.toISOString() ?? null,
          receiptUploadedAt:
            order.bankTransferReceiptUploadedAt?.toISOString() ?? null,
          receiptUrl,
        }
      : null,
    bankTransferHistory: isBankTransferHistory
      ? {
          finalAmountKurus,
          paidAt: order.paidAt?.toISOString() ?? null,
          receiptUrl,
        }
      : null,
  });
}
