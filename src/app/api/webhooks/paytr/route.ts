import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, generationAttempts } from "@/lib/db/schema";
import { verifyCallbackHash } from "@/lib/services/paytr";
import { getAiGenerationQueue, getMeshProcessingQueue, getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);

  const formData = await request.formData();
  const merchantOid = formData.get("merchant_oid") as string;
  const status = formData.get("status") as string;
  const totalAmount = formData.get("total_amount") as string;
  const hash = formData.get("hash") as string;

  if (!merchantOid || !status || !totalAmount || !hash) {
    return new Response("OK", { status: 200 });
  }

  // Verify hash
  if (!verifyCallbackHash({ merchantOid, status, totalAmount, hash })) {
    console.error("PayTR callback hash verification failed");
    return new Response("OK", { status: 200 });
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.paytrMerchantOid, merchantOid),
  });

  if (!order || order.status !== "pending_payment") {
    return new Response("OK", { status: 200 });
  }

  if (status === "success") {
    // Update order to paid
    await db
      .update(orders)
      .set({
        status: "paid",
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Check if order has a preview (skip AI generation)
    if (order.previewId) {
      const preview = await db.query.previews.findFirst({
        where: eq(previews.id, order.previewId),
      });

      if (preview?.glbUrl && preview.glbKey) {
        // Create generation attempt record from preview data
        const [attempt] = await db
          .insert(generationAttempts)
          .values({
            orderId: order.id,
            provider: "meshy",
            providerTaskId: preview.meshyTaskId,
            status: "succeeded",
            inputImageUrl: preview.photoUrl,
            outputGlbUrl: preview.glbUrl,
            durationMs: preview.durationMs,
            costCents: 0, // Already paid during preview
          })
          .returning();

        // Skip AI generation, go directly to mesh processing
        await getMeshProcessingQueue().add("process-mesh", {
          orderId: order.id,
          generationId: attempt.id,
          glbUrl: preview.glbUrl,
          glbKey: preview.glbKey,
        });
      }
    } else {
      // No preview — use standard AI generation flow
      const photo = await db.query.orderPhotos.findFirst({
        where: eq(orderPhotos.orderId, order.id),
      });

      if (photo) {
        await getAiGenerationQueue().add("generate", {
          orderId: order.id,
          imageUrl: photo.originalUrl,
        });
      }
    }

    // Send confirmation email
    await getEmailQueue().add("confirmation", {
      type: "order_confirmation",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });
  }

  // PayTR expects plain "OK" text response
  return new Response("OK", { status: 200 });
}
