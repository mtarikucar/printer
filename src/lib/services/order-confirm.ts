import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, generationAttempts } from "@/lib/db/schema";
import { getAiGenerationQueue, getMeshProcessingQueue, getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";

export async function confirmOrder(orderId: string, locale: Locale) {
  const result = await db.transaction(async (tx) => {
    // Atomically claim the order: only one caller can transition from pending_payment
    const [updated] = await tx
      .update(orders)
      .set({
        status: "paid",
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")))
      .returning();

    if (!updated) {
      throw new Error("Order not found or not in pending_payment status");
    }

    // Check if order has a preview (skip AI generation)
    if (updated.previewId) {
      const preview = await tx.query.previews.findFirst({
        where: eq(previews.id, updated.previewId),
      });

      if (preview?.glbUrl && preview.glbKey) {
        // Create generation attempt record from preview data
        const [attempt] = await tx
          .insert(generationAttempts)
          .values({
            orderId: updated.id,
            provider: "meshy",
            providerTaskId: preview.meshyTaskId,
            status: "succeeded",
            inputImageUrl: preview.photoUrl,
            outputGlbUrl: preview.glbUrl,
            durationMs: preview.durationMs,
            costCents: 0,
          })
          .returning();

        await tx
          .update(orders)
          .set({ status: "processing_mesh", updatedAt: new Date() })
          .where(eq(orders.id, orderId));

        return {
          order: updated,
          action: "mesh" as const,
          meshData: {
            generationId: attempt.id,
            glbUrl: preview.glbUrl,
            glbKey: preview.glbKey,
          },
        };
      }
    }

    // No usable preview — use standard AI generation flow
    const photo = await tx.query.orderPhotos.findFirst({
      where: eq(orderPhotos.orderId, updated.id),
    });

    if (photo) {
      await tx
        .update(orders)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      return {
        order: updated,
        action: "generate" as const,
        generateData: {
          imageUrl: photo.originalUrl,
        },
      };
    }

    // No photo and no usable preview
    await tx
      .update(orders)
      .set({
        status: "failed_generation",
        failureReason: "No photo or preview available for processing",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    return { order: updated, action: "failed" as const };
  });

  // Enqueue jobs outside the transaction (after commit)
  if (result.action === "mesh") {
    await getMeshProcessingQueue().add("process-mesh", {
      orderId: result.order.id,
      generationId: result.meshData!.generationId,
      glbUrl: result.meshData!.glbUrl,
      glbKey: result.meshData!.glbKey,
    });
  } else if (result.action === "generate") {
    await getAiGenerationQueue().add("generate", {
      orderId: result.order.id,
      imageUrl: result.generateData!.imageUrl,
      style: result.order.style,
      modifiers: result.order.modifiers ?? [],
    });
  }

  // Send confirmation email (only if order is actually being processed)
  if (result.action !== "failed") {
    await getEmailQueue().add("confirmation", {
      type: "order_confirmation",
      to: result.order.email,
      orderNumber: result.order.orderNumber,
      customerName: result.order.customerName,
      locale,
    });
  }
}
