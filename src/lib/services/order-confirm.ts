import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, generationAttempts } from "@/lib/db/schema";
import { getAiGenerationQueue, getMeshProcessingQueue, getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";

/**
 * Kick off post-payment processing for an order that is already in `status='paid'`.
 *
 * Decides between three paths:
 *  - reuse approved preview → enqueue mesh processing
 *  - no preview → enqueue AI generation
 *  - no usable input → mark failed_generation
 *
 * Idempotent: only the first caller transitioning from `paid` succeeds; the rest are no-ops.
 */
export async function kickOffOrderProcessing(orderId: string, locale: Locale) {
  const result = await db.transaction(async (tx) => {
    const order = await tx.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });
    if (!order) {
      throw new Error("Order not found");
    }

    // Idempotency: only kick off from the freshly-paid state.
    if (order.status !== "paid") {
      return { order, action: "noop" as const };
    }

    if (order.previewId) {
      const preview = await tx.query.previews.findFirst({
        where: eq(previews.id, order.previewId),
      });

      if (preview?.glbUrl && preview.glbKey) {
        const [attempt] = await tx
          .insert(generationAttempts)
          .values({
            orderId: order.id,
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
          order,
          action: "mesh" as const,
          meshData: {
            generationId: attempt.id,
            glbUrl: preview.glbUrl,
            glbKey: preview.glbKey,
          },
        };
      }
    }

    const photo = await tx.query.orderPhotos.findFirst({
      where: eq(orderPhotos.orderId, order.id),
    });

    if (photo) {
      await tx
        .update(orders)
        .set({ status: "generating", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      return {
        order,
        action: "generate" as const,
        generateData: { imageUrl: photo.originalUrl },
      };
    }

    await tx
      .update(orders)
      .set({
        status: "failed_generation",
        failureReason: "No photo or preview available for processing",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    return { order, action: "failed" as const };
  });

  if (result.action === "noop") return;

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

