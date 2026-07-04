import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, users } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";
import { issueGuestClaimToken } from "@/lib/services/password-reset";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

/**
 * Kick off post-payment processing for an order that is already in `status='paid'`.
 *
 * Image-first flow: there is NO automatic 3D generation anymore. The customer
 * already approved a fal.ai image before paying, so a paid custom order simply
 * moves to `awaiting_model`, where the admin manually produces + uploads the
 * 3D model. Upload orders (customer supplied their own mesh) go straight to
 * `review` for manufacturer assignment, as before.
 *
 * Idempotent: only the first caller transitioning from `paid` succeeds; the
 * rest are no-ops. No queue work, so no crash-revert dance is needed.
 */
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

    // Custom orders (image-first): wait for the admin to sculpt + upload the 3D.
    await tx
      .update(orders)
      .set({ status: "awaiting_model", updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    return { order, action: "awaiting_model" as const };
  });

  if (result.action === "noop") return;

  await emitOrderChanged({
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
    userId: result.order.userId,
    manufacturerId: result.order.manufacturerId,
    status: result.action === "upload" ? "review" : "awaiting_model",
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

