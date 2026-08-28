import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, users } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";
import { issueGuestClaimToken } from "@/lib/services/password-reset";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import {
  assignManufacturerToOrder,
  orderHasPrintableContent,
} from "@/lib/services/manufacturer-assign";
import { rankForOrderWithShadow } from "@/lib/services/manufacturer-assignment-shadow";
import { getModelGenerationQueue } from "@/lib/queue/queues";
import { isFlagEnabled } from "@/lib/services/flags";
import { reserveSpend, releaseSpend } from "@/lib/services/spend-guard";
import { resolveTargetHeightMm } from "@/lib/config/sizes";
import { CONTENT_CONSENT_VERSION_MESHY } from "@/lib/config/content-consent";
import { getCreditBalance, MESHY_CREDITS_PER_ORDER } from "@/lib/services/meshy";

/**
 * Kick off post-payment processing for an order that is already in `status='paid'`.
 *
 * A paid custom order takes one of two roads:
 *
 *  - `generating` when the auto-3D pipeline is eligible (see
 *    `autoModelEligibility`), which hands it to the Meshy worker chain.
 *  - `awaiting_model` otherwise. That is TODAY's behaviour, byte for byte, and
 *    it is also the kill switch: flipping `auto_model_enabled` off puts every
 *    new order back on the manual road with no code path removed.
 *
 * Upload orders (customer supplied their own mesh) go straight to `review` for
 * manufacturer assignment, as before.
 *
 * Idempotent: only the first caller transitioning from `paid` succeeds; the
 * rest are no-ops. No queue work, so no crash-revert dance is needed.
 */
/**
 * Why an order may or may not take the automatic road.
 *
 * Returned as a reason rather than a boolean so the fallback is explainable in
 * the admin panel: "this one went manual because the size is bespoke" is a
 * different operational fact from "we were out of Meshy credit".
 */
export async function autoModelEligibility(order: {
  orderType: string | null;
  previewId: string | null;
  uploadedModelId: string | null;
  figurineSize: string | null;
  contentConsentVersion: string | null;
}): Promise<{ eligible: true } | { eligible: false; reason: string }> {
  if (!(await isFlagEnabled("auto_model_enabled"))) {
    return { eligible: false, reason: "auto_model_disabled" };
  }
  if (order.orderType !== "custom") return { eligible: false, reason: "not_custom" };
  if (!order.previewId) return { eligible: false, reason: "no_preview" };
  if (order.uploadedModelId) return { eligible: false, reason: "customer_supplied_model" };

  if (!resolveTargetHeightMm(order.figurineSize).ok) {
    return { eligible: false, reason: "bespoke_size" };
  }

  // Consent given for the OLD processor list does not cover Meshy. KVKK art. 3
  // requires açık rıza to be specific; an order whose consent predates the
  // Meshy disclosure goes down the manual road rather than being sent abroad
  // under a permission its buyer never gave.
  if (
    !order.contentConsentVersion ||
    order.contentConsentVersion < CONTENT_CONSENT_VERSION_MESHY
  ) {
    return { eligible: false, reason: "consent_predates_meshy" };
  }

  const minBalance = Number(process.env.MESHY_MIN_CREDIT_BALANCE ?? 60);
  const balance = await getCreditBalance().catch(() => -1);
  if (balance >= 0 && balance < Math.max(minBalance, MESHY_CREDITS_PER_ORDER)) {
    return { eligible: false, reason: "low_meshy_balance" };
  }

  return { eligible: true };
}

export async function kickOffOrderProcessing(orderId: string, locale: Locale) {
  const result = await db.transaction(async (tx) => {
    // Row-lock to serialize concurrent kickoff calls (admin replay + webhook race).
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

    // Upload orders: the model is already a print-ready mesh — skip straight to
    // review for manufacturer assignment.
    if (order.uploadedModelId) {
      await tx
        .update(orders)
        .set({ status: "review", updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return { order, action: "upload" as const };
    }

    // Custom orders: either the automatic pipeline or today's manual road.
    // The eligibility check runs OUTSIDE this transaction (it makes a network
    // call), so it is decided before the lock is taken — see below.
    await tx
      .update(orders)
      .set({ status: "awaiting_model", updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    return { order, action: "awaiting_model" as const };
  });

  if (result.action === "noop") return;

  // Promote awaiting_model -> generating when the auto-3D road is open. Done
  // after the transaction so a slow provider call never holds a row lock, and
  // guarded on the status we just wrote so a concurrent admin action wins.
  let finalStatus: string = result.action === "upload" ? "review" : "awaiting_model";
  if (result.action === "awaiting_model") {
    const eligibility = await autoModelEligibility(result.order);
    if (eligibility.eligible) {
      const round = (result.order.modelGenerationRound ?? 0) + 1;
      // Reserve before enqueueing: a job that cannot afford its provider call
      // should never be created.
      const reservation = await reserveSpend("meshy", 0, {
        kind: "order",
        id: result.order.id,
      });
      const promoted = await db
        .update(orders)
        .set({ status: "generating", modelGenerationRound: round, updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, "awaiting_model")))
        .returning({ id: orders.id });

      if (promoted.length > 0) {
        try {
          await getModelGenerationQueue().add(
            "step",
            { orderId, round, stage: "create" as const },
            { jobId: `model-gen:${orderId}:${round}` }
          );
          finalStatus = "generating";
        } catch (err) {
          // Enqueue failed after the status write: put it back on the manual
          // road rather than leaving a paid order stuck in `generating` with
          // no job behind it.
          console.error(`[order-confirm] enqueue failed for ${orderId}; reverting`, err);
          await db
            .update(orders)
            .set({ status: "awaiting_model", updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.status, "generating")));
        }
      }
      if (reservation.ok) await releaseSpend(reservation.reservationId);
    } else {
      console.info(
        `[order-confirm] order=${orderId} stays manual: ${eligibility.reason}`
      );
    }
  }

  await emitOrderChanged({
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
    userId: result.order.userId,
    manufacturerId: result.order.manufacturerId,
    status: finalStatus,
  });

  await sendOrderConfirmationEmails(result.order, locale);
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
 * AI generation / mesh entirely — the product to print already exists. Three
 * shapes land here:
 *
 *  1. Seller-owned product — the seller was auto-assigned at promotion
 *     (manufacturerStatus='assigned'); we just notify them.
 *  2. Platform (admin-owned) catalogue product — nobody is assigned yet, but
 *     the product HAS print files (enforced at product approval). It stays at
 *     `paid`, which is an assignable status, and we try to auto-assign the
 *     best-scoring manufacturer right away.
 *  3. Admin-typed WhatsApp order — no productId, no order_items, so there is
 *     genuinely nothing to print yet. It goes to `awaiting_model` so the admin
 *     can upload a model, exactly as before.
 *
 * Shapes 2 and 3 used to be conflated: every seller-less marketplace order was
 * pushed to `awaiting_model`, which is NOT an assignable status — so a paid
 * platform-product order could never reach a manufacturer at all, and the
 * customer's tracker claimed "Modeliniz Hazırlanıyor" for a stock item.
 *
 * Idempotent at the notification layer (best-effort).
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
  } else if (await orderHasPrintableContent(order.id)) {
    // Shape 2. Leave the status at `paid` — it is already assignable — and try
    // to place it. A failure here is never fatal: the order simply stays
    // unassigned and shows up in the admin's "atanmamış" bucket.
    try {
      await autoAssignMarketplaceOrder(order.id, order.orderNumber);
    } catch (err) {
      console.error(
        `kickOffMarketplaceOrder: auto-assign failed for ${order.id}`,
        err
      );
    }
  } else {
    // Shape 3.
    await db
      .update(orders)
      .set({ status: "awaiting_model", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: "awaiting_model",
    });
  }

  await sendOrderConfirmationEmails(order, locale);
}

/**
 * Place a platform-product order with the best-scoring eligible manufacturer.
 *
 * Ranking goes through the Q7 shadow wrapper (not the raw ranker) so automatic
 * assignments show up in the same canary/evaluation telemetry as the admin UI
 * and the decline-retry path. The ranker's batch-affinity signal is what makes
 * repeat orders of the same product cluster in one workshop.
 *
 * No eligible candidate is a normal outcome, not an error: the order keeps its
 * `paid` + unassigned state and waits for an admin in /admin/bulk-orders.
 */
async function autoAssignMarketplaceOrder(orderId: string, orderNumber: string) {
  const candidates = await rankForOrderWithShadow(orderId);
  const best = candidates.find((c) => c.eligible);
  if (!best) {
    console.warn(
      `autoAssignMarketplaceOrder: no eligible manufacturer for ${orderNumber}`
    );
    return;
  }
  const result = await assignManufacturerToOrder({
    orderId,
    manufacturerId: best.manufacturerId,
    // Already proved above, and the ranker just read the same order.
    skipPrintableCheck: true,
    notification: {
      subject: `Yeni sipariş atandı: ${orderNumber}`,
      body: `${orderNumber} numaralı sipariş otomatik olarak size atandı.\n\nÜretici panelinizden 24 saat içinde kabul veya reddedin.`,
    },
  });
  if (!result.ok) {
    console.warn(
      `autoAssignMarketplaceOrder: ${orderNumber} not assigned (${result.reason})`
    );
  }
}

