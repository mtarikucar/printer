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
import { kickOffOrderProcessing } from "@/lib/services/order-confirm";
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
          columns: { id: true, orderNumber: true, locale: true },
        });
        if (existing) {
          return {
            orderId: existing.id,
            orderNumber: existing.orderNumber,
            locale: (existing.locale === "en" ? "en" : "tr") as Locale,
          };
        }
      }
      throw new Error(`DRAFT_NOT_PROMOTABLE:${draft.status}`);
    }

    const photoUrl = getPublicUrl(draft.photoKey);

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
        manufacturerStatus: "unassigned",
      })
      .returning();

    await tx.insert(orderPhotos).values({
      orderId: order.id,
      originalUrl: photoUrl,
    });

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
    };
  });

  // Outside the transaction: cancel scheduled deadline jobs and kick generation.
  await cancelHavaleJobs(draftId);

  await kickOffOrderProcessing(result.orderId, result.locale);

  return result;
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
  await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(orderDrafts)
      .where(eq(orderDrafts.id, draftId))
      .for("update");

    if (!draft) return;
    if (draft.status !== "pending" && draft.status !== "awaiting_review") return;

    await refundGiftCardForDraft(tx, draftId);

    await tx
      .update(orderDrafts)
      .set({
        status: "failed",
        paytrFailureReason: failureReason,
        updatedAt: new Date(),
      })
      .where(eq(orderDrafts.id, draftId));
  });

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
