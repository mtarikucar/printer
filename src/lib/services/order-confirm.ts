import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, generationAttempts } from "@/lib/db/schema";
import { getAiGenerationQueue, getMeshProcessingQueue, getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";

export async function confirmOrder(orderId: string, locale: Locale) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order || order.status !== "pending_payment") {
    throw new Error("Order not found or not in pending_payment status");
  }

  // Update order to paid
  await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

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
