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

  let processingStarted = false;

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

      // Update status before enqueueing to avoid race condition
      await db
        .update(orders)
        .set({ status: "processing_mesh", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      // Skip AI generation, go directly to mesh processing
      await getMeshProcessingQueue().add("process-mesh", {
        orderId: order.id,
        generationId: attempt.id,
        glbUrl: preview.glbUrl,
        glbKey: preview.glbKey,
      });

      processingStarted = true;
    }
    // Preview exists but glbUrl/glbKey missing — fall through to photo path
  }

  if (!processingStarted) {
    // No usable preview — use standard AI generation flow
    const photo = await db.query.orderPhotos.findFirst({
      where: eq(orderPhotos.orderId, order.id),
    });

    if (photo) {
      // Update status before enqueueing to avoid race condition
      await db
        .update(orders)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      await getAiGenerationQueue().add("generate", {
        orderId: order.id,
        imageUrl: photo.originalUrl,
        style: order.style,
        modifiers: order.modifiers ?? [],
      });
    } else {
      // No photo and no usable preview — mark as failed
      await db
        .update(orders)
        .set({
          status: "failed_generation",
          failureReason: "No photo or preview available for processing",
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
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
