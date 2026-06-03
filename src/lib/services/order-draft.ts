import { eq, and, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  orderDrafts,
  orders,
  orderPhotos,
  giftCards,
  giftCardRedemptions,
} from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import {
  kickOffOrderProcessing,
  kickOffMarketplaceOrder,
} from "@/lib/services/order-confirm";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import {
  getPaymentDeadlineQueue,
  havaleExpireJobId,
  havaleReminderJobId,
  getEmailQueue,
} from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";

async function cancelHavaleJobs(draftId: string): Promise<void> {
  const q = getPaymentDeadlineQueue();
  await q.remove(havaleReminderJobId(draftId)).catch(() => {});
  await q.remove(havaleExpireJobId(draftId)).catch(() => {});
}

/**
 * Build a customer-facing reference string. Used as the order number when promoted
 * and as PayTR merchant_oid input (digits + letters only — buildMerchantOid strips
 * the hyphen).
 */
export function buildDraftReference(): string {
  return `FIG-${nanoid(8).toUpperCase()}`;
}

/**
 * Promote a pending draft into an `orders` row and kick off generation.
 * Idempotent: only the first caller to flip the draft from "pending" → "confirmed"
 * inserts the order. Concurrent webhook/OCR/admin races are guarded by that atomic
 * status flip.
 *
 * Throws if the draft is missing or already confirmed.
 */
export async function promoteDraftToOrder(
  draftId: string
): Promise<{ orderId: string; orderNumber: string; locale: Locale }> {
  const result = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, draftId))
      .for("update");

    if (!draft) {
      throw new Error("DRAFT_NOT_FOUND");
    }

    // Allow promotion from either pending or awaiting_review (OCR low confidence + admin approve).
    if (draft.status !== "pending" && draft.status !== "awaiting_review") {
      // Already promoted — return the existing order so callers stay idempotent.
      if (draft.status === "confirmed" && draft.promotedOrderId) {
        const existing = await tx.query.orders.findFirst({
          where: eq(orders.id, draft.promotedOrderId),
          columns: { id: true, orderNumber: true, locale: true, orderType: true },
        });
        if (existing) {
          return {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            locale: (existing.locale === "en" ? "en" : "tr") as Locale,
            // Carry orderType so the post-tx kickoff branch doesn't mistakenly
            // run generation on a re-entered (already-promoted) marketplace order.
            orderType: existing.orderType,
            alreadyPromoted: true as const,
          };
        }
      }
      throw new Error(`DRAFT_NOT_PROMOTABLE:${draft.status}`);
    }

    const isMarketplace = draft.orderType === "marketplace";

    const [order] = await tx
      .insert(orders)
      .values({
        orderNumber: draft.reference,
        userId: draft.userId,
        previewId: draft.previewId,
        draftId: draft.id,
        email: draft.email,
        customerName: draft.customerName,
        phone: draft.phone,
        figurineSize: draft.figurineSize,
        style: draft.style,
        material: draft.material,
        modifiers: draft.modifiers,
        shippingAddress: draft.shippingAddress,
        status: "paid",
        locale: draft.locale,
        paymentMethod: draft.paymentMethod,
        paymentStatus: "succeeded",
        amountKurus: draft.amountKurus,
        havaleDiscountKurus: draft.havaleDiscountKurus,
        giftCardAmountKurus: draft.giftCardAmountKurus,
        upsells: draft.upsells,
        upsellAmountKurus: draft.upsellAmountKurus,
        paidAt: new Date(),
        // Marketplace fields copied from the draft.
        orderType: draft.orderType,
        productId: draft.productId,
        sellerManufacturerId: draft.sellerManufacturerId,
        productTitleSnapshot: draft.productTitleSnapshot,
        quantity: draft.quantity,
        // Marketplace: auto-assign the owning seller (no AI gen, no scoring).
        // A platform/admin product (no seller) stays unassigned for the admin
        // queue. Custom orders start unassigned and go through generation.
        manufacturerId:
          isMarketplace && draft.sellerManufacturerId
            ? draft.sellerManufacturerId
            : null,
        manufacturerStatus:
          isMarketplace && draft.sellerManufacturerId ? "assigned" : "unassigned",
        assignedToManufacturerAt:
          isMarketplace && draft.sellerManufacturerId ? new Date() : null,
      })
      .returning();

    // Custom orders carry the customer's input photo into order_photos so
    // generation can pick it up. Marketplace orders have no input photo.
    if (!isMarketplace && draft.photoKey) {
      await tx.insert(orderPhotos).values({
        orderId: order.id,
        originalUrl: getPublicUrl(draft.photoKey),
      });
    }

    // Reassign any draft-scoped gift-card redemption to the new order.
    await tx
      .update(giftCardRedemptions)
      .set({ orderId: order.id })
      .where(eq(giftCardRedemptions.draftId, draft.id));

    // Row lock above already serializes promotion; this is just the status flip.
    await tx
      .update(orderDrafts)
      .set({
        status: "confirmed",
        promotedOrderId: order.id,
        promotedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draftId));

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      locale: (draft.locale === "en" ? "en" : "tr") as Locale,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      orderType: order.orderType,
      manufacturerStatus: order.manufacturerStatus,
      email: order.email,
      customerName: order.customerName,
      sellerManufacturerId: order.sellerManufacturerId,
      productTitleSnapshot: order.productTitleSnapshot,
      newOrder: true,
    };
  });

  // New order row created at status=paid. Emit for the freshly-created order.
  // Skipped on the idempotent re-entry path where an existing order is returned.
  if ("newOrder" in result && result.newOrder) {
    await emitOrderChanged({
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      userId: result.userId,
      manufacturerId: result.manufacturerId,
      status: "paid",
      manufacturerStatus: result.manufacturerStatus ?? "unassigned",
    });
  }

  // Outside the transaction: cancel scheduled deadline jobs and kick off the
  // appropriate fulfillment path.
  await cancelHavaleJobs(draftId);

  if (result.orderType === "marketplace") {
    // Marketplace: skip AI generation/mesh entirely. On first promotion
    // ("newOrder") notify the seller + email the customer. On an idempotent
    // re-entry (webhook retry) do nothing — the seller was already notified and
    // re-emailing would spam the customer.
    if ("newOrder" in result && result.newOrder) {
      await kickOffMarketplaceOrder(
        {
          id: result.orderId,
          email: result.email,
          orderNumber: result.orderNumber,
          customerName: result.customerName,
          userId: result.userId,
          sellerManufacturerId: result.sellerManufacturerId ?? null,
          productTitleSnapshot: result.productTitleSnapshot ?? null,
        },
        result.locale
      );
    }
  } else {
    // Custom: kickOffOrderProcessing is idempotent (no-ops unless status='paid')
    // and doubles as a self-heal retry on the re-entry path.
    await kickOffOrderProcessing(result.orderId, result.locale);
  }

  return { orderId: result.orderId, orderNumber: result.orderNumber, locale: result.locale };
}

/**
 * Expire a pending bank-transfer draft after the deadline. Refunds any held gift-card
 * balance and emails the customer. Idempotent.
 */
export async function expireDraft(draftId: string): Promise<void> {
  const SYSTEM_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "system@figurunica.com";

  const result = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, draftId))
      .for("update");

    if (!draft) return null;
    if (draft.status !== "pending" && draft.status !== "awaiting_review") {
      return null;
    }

    // Atomic claim: refund only redemptions that haven't been refunded yet.
    // The `refundedAt IS NULL` guard makes this idempotent — a retried job
    // that finds rows already refunded just gets zero claimed rows back.
    await refundGiftCardForDraft(tx, draftId);

    await tx
      .update(orderDrafts)
      .set({
        status: "expired",
        paytrFailureReason:
          draft.paytrFailureReason ?? "Havale ödeme süresi doldu (72 saat)",
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draftId));

    return draft;
  });

  if (!result) return;
  void SYSTEM_ADMIN_EMAIL;

  // Draft moved to `expired` — refresh the admin drafts badge.
  await publishRealtime([topics.admin()], { kind: "badge" });

  // Cancel the sibling reminder job. When `expireDraft` runs from its own
  // bullmq job that's redundant, but it's also called from admin force-expire
  // and the reminder would otherwise still fire 24h later.
  await cancelHavaleJobs(draftId);

  const locale: Locale = result.locale === "en" ? "en" : "tr";
  await getEmailQueue().add("send-email", {
    type: "payment_expired",
    to: result.email,
    orderNumber: result.reference,
    customerName: result.customerName,
    locale,
  });
}

/**
 * Mark a draft as failed (e.g. PayTR rejected). Refunds any held gift card.
 * Idempotent.
 */
export async function failDraft(
  draftId: string,
  failureReason: string
): Promise<void> {
  const failed = await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, draftId))
      .for("update");

    if (!draft) return false;
    if (draft.status !== "pending" && draft.status !== "awaiting_review")
      return false;

    await refundGiftCardForDraft(tx, draftId);

    await tx
      .update(orderDrafts)
      .set({
        status: "failed",
        paytrFailureReason: failureReason,
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draftId));

    return true;
  });

  // Draft moved to `failed` — refresh the admin drafts badge.
  if (failed) {
    await publishRealtime([topics.admin()], { kind: "badge" });
  }

  // Cancel any scheduled bullmq jobs so they don't fire after the draft is
  // already in a terminal state. Best-effort; if Redis is down the worker's
  // own status guard catches the case.
  await cancelHavaleJobs(draftId);
}

/**
 * Refund any active (refundedAt IS NULL) gift-card redemption rows tied to
 * `draftId`. Implementation note: we do the credit-restore in a single UPDATE
 * against `giftCardRedemptions` keyed on `refundedAt IS NULL`. Any concurrent
 * worker retry that re-enters this code path finds zero rows in that state
 * and is a no-op — so even without the partial unique index (defense in
 * depth) we cannot double-refund.
 */
async function refundGiftCardForDraft(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  draftId: string
): Promise<void> {
  const claimed = await tx
    .update(giftCardRedemptions)
    .set({ refundedAt: new Date() })
    .where(
      and(
        eq(giftCardRedemptions.draftId, draftId),
        isNull(giftCardRedemptions.refundedAt)
      )
    )
    .returning({
      giftCardId: giftCardRedemptions.giftCardId,
      amountKurus: giftCardRedemptions.amountKurus,
    });

  // Restore the credit on each gift card we just claimed. Lock per row to
  // prevent a concurrent redemption attempt from stomping the balance.
  for (const r of claimed) {
    const [card] = await tx
      .select()
      .from(giftCards)
      .where(eq(giftCards.id, r.giftCardId))
      .for("update");
    if (!card) continue;

    const newBalance = card.balanceKurus + r.amountKurus;
    let newStatus: typeof card.status;
    if (card.status === "expired") {
      newStatus = "expired";
    } else if (newBalance === 0) {
      newStatus = "fully_used";
    } else if (newBalance >= card.amountKurus) {
      newStatus = "active";
    } else {
      newStatus = "partially_used";
    }
    await tx
      .update(giftCards)
      .set({
        balanceKurus: newBalance,
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(giftCards.id, card.id));
  }
}

export async function findDraftByReference(reference: string) {
  return db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.reference, reference),
  });
}

export async function findDraftByPaytrMerchantOid(merchantOid: string) {
  return db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.paytrMerchantOid, merchantOid),
  });
}
