import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews, generationAttempts, users } from "@/lib/db/schema";
import { getAiGenerationQueue, getMeshProcessingQueue, getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";
import { issueGuestClaimToken } from "@/lib/services/password-reset";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

/**
 * Kick off post-payment processing for an order that is already in `status='paid'`.
 *
 * Decides between three paths:
 *  - reuse approved preview → enqueue mesh processing
 *  - no preview → enqueue AI generation
 *  - no usable input → mark failed_generation
 *
 * Idempotent: only the first caller transitioning from `paid` succeeds; the rest are no-ops.
 *
 * Crash safety: if the queue `add` after commit throws (Redis hiccup), we
 * revert the order status back to `paid` so a subsequent caller (admin
 * retry, sweeper) can re-drive without manual surgery. Without this revert
 * the order would be stuck in `generating`/`processing_mesh` with no
 * worker job and no recovery path.
 */
export async function kickOffOrderProcessing(orderId: string, locale: Locale) {
  const result = await db.transaction(async (tx) => {
    // Row-lock to serialize concurrent kickoff calls (admin replay + webhook
    // race). Without the lock two callers might both observe status='paid'
    // and both attempt to enqueue.
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) {
      throw new Error("Order not found");
    }

    // Idempotency: only kick off from the freshly-paid state.
    if (order.status !== "paid") {
      return { order, action: "noop" as const };
    }

    // Upload orders: the model is already a print-ready mesh — skip AI/mesh and
    // go straight to review for manufacturer assignment.
    if (order.uploadedModelId) {
      await tx
        .update(orders)
        .set({ status: "review", updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return { order, action: "upload" as const };
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

  // Revert the in-flight status back to `paid` if queue enqueue fails so a
  // subsequent caller can retry. Without this the order would be stuck
  // mid-flight with no worker job to advance it.
  async function revertToPaid() {
    try {
      // Scoped revert: only flip back to `paid` if we still own the in-flight
      // states this function set. If an admin / another worker moved the row
      // to a terminal state in the meantime (rejected, failed_generation,
      // review, etc.) we must NOT clobber that.
      await db
        .update(orders)
        .set({ status: "paid", updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, result.order.id),
            inArray(orders.status, ["generating", "processing_mesh"])
          )
        );
    } catch (e) {
      console.error(
        `kickOff: failed to revert order ${result.order.id} to paid after queue error`,
        e
      );
    }
  }

  if (result.action === "mesh") {
    try {
      await getMeshProcessingQueue().add("process-mesh", {
        orderId: result.order.id,
        generationId: result.meshData!.generationId,
        glbUrl: result.meshData!.glbUrl,
        glbKey: result.meshData!.glbKey,
      });
    } catch (err) {
      console.error(
        `kickOff: mesh queue add failed for ${result.order.id}`,
        err
      );
      await revertToPaid();
      throw err;
    }
    // paid -> processing_mesh confirmed (queue job enqueued, no revert).
    await emitOrderChanged({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      userId: result.order.userId,
      manufacturerId: result.order.manufacturerId,
      status: "processing_mesh",
    });
  } else if (result.action === "generate") {
    try {
      await getAiGenerationQueue().add("generate", {
        orderId: result.order.id,
        imageUrl: result.generateData!.imageUrl,
        style: result.order.style,
        modifiers: result.order.modifiers ?? [],
      });
    } catch (err) {
      console.error(
        `kickOff: generate queue add failed for ${result.order.id}`,
        err
      );
      await revertToPaid();
      throw err;
    }
    // paid -> generating confirmed (queue job enqueued, no revert).
    await emitOrderChanged({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      userId: result.order.userId,
      manufacturerId: result.order.manufacturerId,
      status: "generating",
    });
  } else if (result.action === "failed") {
    // paid -> failed_generation committed in the transaction above.
    await emitOrderChanged({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      userId: result.order.userId,
      manufacturerId: result.order.manufacturerId,
      status: "failed_generation",
    });
  } else if (result.action === "upload") {
    // Upload orders skip AI/mesh — the model is already print-ready. Emit the
    // review transition; confirmation emails are sent below.
    await emitOrderChanged({
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      userId: result.order.userId,
      manufacturerId: result.order.manufacturerId,
      status: "review",
    });
  }

  if (result.action !== "failed") {
    await sendOrderConfirmationEmails(result.order, locale);
  }
}

/**
 * Best-effort customer emails after an order is confirmed: the order
 * confirmation, plus a guest "claim your account" link if the buyer checked out
 * without a password. Shared by the custom kickoff and the marketplace kickoff.
 * Never throws — email failures must not roll back order processing.
 */
export async function sendOrderConfirmationEmails(
  order: {
    id: string;
    email: string;
    orderNumber: string;
    customerName: string;
    userId: string;
  },
  locale: Locale
) {
  try {
    await getEmailQueue().add("confirmation", {
      type: "order_confirmation",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });
  } catch (err) {
    console.error(
      `sendOrderConfirmationEmails: confirmation enqueue failed for ${order.id}`,
      err
    );
  }

  // Q6: if the buyer placed this order as a guest (no password set), send
  // them a separate "claim your account" email with a 30-day token that
  // lets them set a password and access /account.
  try {
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, order.userId),
      columns: { id: true, isGuest: true, email: true, fullName: true },
    });
    if (buyer?.isGuest) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
      const { claimUrl } = await issueGuestClaimToken(buyer.id, appUrl);
      await getEmailQueue().add("guest-claim", {
        type: "guest_account_claim",
        to: buyer.email,
        orderNumber: order.orderNumber,
        customerName: buyer.fullName,
        claimUrl,
        locale,
      });
    }
  } catch (err) {
    console.error(
      `sendOrderConfirmationEmails: guest claim enqueue failed for ${order.id}`,
      err
    );
  }
}

/**
 * Marketplace counterpart to kickOffOrderProcessing. A marketplace order skips
 * AI generation / mesh entirely — the owning seller already has the physical
 * product to print. The seller was auto-assigned at promotion time
 * (manufacturerStatus='assigned'); here we just notify them and email the
 * customer. Idempotent at the notification layer (best-effort).
 */
export async function kickOffMarketplaceOrder(
  order: {
    id: string;
    email: string;
    orderNumber: string;
    customerName: string;
    userId: string;
    sellerManufacturerId: string | null;
    productTitleSnapshot: string | null;
  },
  locale: Locale
) {
  // Notify the owning seller so the order shows up in their queue. Admin
  // (platform) products have no seller yet — they surface in the admin order
  // queue for manual assignment instead.
  if (order.sellerManufacturerId) {
    try {
      const productLine = order.productTitleSnapshot
        ? `\nÜrün: ${order.productTitleSnapshot}`
        : "";
      await notifyManufacturer({
        manufacturerId: order.sellerManufacturerId,
        type: "order_assigned",
        subject: `Yeni pazaryeri siparişi: ${order.orderNumber}`,
        body: `${order.orderNumber} numaralı pazaryeri siparişiniz var.${productLine}\n\nMüşteri: ${order.customerName}\n\nLütfen ürünü hazırlayıp kargolayın.`,
        orderId: order.id,
      });
    } catch (err) {
      console.error(
        `kickOffMarketplaceOrder: seller notify failed for ${order.id}`,
        err
      );
    }
  }

  await sendOrderConfirmationEmails(order, locale);
}

