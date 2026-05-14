export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";
import { DraftReviewClient } from "./client";

export default async function AdminDraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.id, id),
  });
  if (!draft) notFound();

  const finalAmountKurus =
    draft.amountKurus - draft.giftCardAmountKurus - draft.havaleDiscountKurus;

  return (
    <div className="p-8 max-w-4xl">
      <DraftReviewClient
        draft={{
          id: draft.id,
          reference: draft.reference,
          status: draft.status,
          paymentMethod: draft.paymentMethod,
          customerName: draft.customerName,
          email: draft.email,
          phone: draft.phone,
          amountKurus: draft.amountKurus,
          giftCardAmountKurus: draft.giftCardAmountKurus,
          havaleDiscountKurus: draft.havaleDiscountKurus,
          finalAmountKurus,
          bankTransferDeadline: draft.bankTransferDeadline?.toISOString() ?? null,
          bankTransferReceiptUploadedAt:
            draft.bankTransferReceiptUploadedAt?.toISOString() ?? null,
          hasReceipt: !!draft.bankTransferReceiptKey,
          receiptOcrConfidence: draft.receiptOcrConfidence,
          receiptOcrParsed: draft.receiptOcrParsed,
          receiptOcrText: draft.receiptOcrText,
          receiptOcrFailureReason: draft.receiptOcrFailureReason,
          paytrFailureReason: draft.paytrFailureReason,
          promotedOrderId: draft.promotedOrderId,
          createdAt: draft.createdAt.toISOString(),
        }}
      />
    </div>
  );
}
