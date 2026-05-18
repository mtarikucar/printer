import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { createGiftCard } from "@/lib/services/gift-card";
import { getEmailQueue } from "@/lib/queue/queues";
import { generateGallerySlug } from "@/lib/services/slug";

/**
 * Gallery moderation service (Q4 in roadmap).
 *
 * Customer hits the PublishToggle → POST /api/customer/orders/[ref]/publish
 *   → galleryReviewStatus="pending" (admin queue surfaces it)
 * Admin at /admin/gallery-queue/[id] then triggers one of:
 *   - approve  → isPublic=true, publishedAt=now, status="approved"
 *   - reject   → status="rejected", reason recorded
 *   - reward   → mint gift card + isPublic=true (approve+reward in one shot)
 *
 * Each action is logged in admin_actions and emits a customer email
 * (best-effort via the existing email queue — failure here doesn't break
 * the moderation).
 */

interface ApproveParams {
  orderId: string;
  adminEmail: string;
  category?: string | null;
  tags?: string[] | null;
  displayName?: string | null;
}

interface RejectParams {
  orderId: string;
  adminEmail: string;
  reason: string;
}

interface RewardParams {
  orderId: string;
  adminEmail: string;
  giftCardAmountKurus: number;
  expirationDays?: number;
  note?: string;
  category?: string | null;
  tags?: string[] | null;
  displayName?: string | null;
}

const VALID_CATEGORIES = [
  "character",
  "couple",
  "family",
  "pet",
  "fantasy",
  "funny",
  "custom",
];

function sanitizeCategory(c: string | null | undefined): string | null {
  if (!c) return null;
  return VALID_CATEGORIES.includes(c) ? c : null;
}

function sanitizeTags(t: string[] | null | undefined): string[] | null {
  if (!Array.isArray(t)) return null;
  const cleaned = t
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase().slice(0, 20))
    .filter((s) => s.length > 0)
    .slice(0, 5);
  return cleaned.length > 0 ? cleaned : null;
}

export async function approveGalleryItem(
  params: ApproveParams
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, params.orderId),
    columns: {
      id: true,
      orderNumber: true,
      email: true,
      customerName: true,
      locale: true,
      galleryReviewStatus: true,
    },
  });
  if (!order) return { ok: false, reason: "not_found" };
  if (order.galleryReviewStatus !== "pending") {
    return { ok: false, reason: `cannot approve from ${order.galleryReviewStatus}` };
  }

  // Slug is computed outside the transaction so the uniqueness check can
  // see committed rows. The collision window is harmless: even if two
  // approvals race and both generate the same slug, the unique index
  // rejects the second; admin retries get a "-2" suffix on the next try.
  const slug = await generateGallerySlug(
    order.orderNumber,
    params.displayName ?? null
  );

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        isPublic: true,
        publishedAt: new Date(),
        galleryReviewStatus: "approved",
        galleryReviewReason: null,
        galleryCategory: sanitizeCategory(params.category),
        galleryTags: sanitizeTags(params.tags),
        publicDisplayName: params.displayName ?? null,
        gallerySlug: slug,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, params.orderId));

    await tx.insert(adminActions).values({
      orderId: params.orderId,
      action: "gallery_approve",
      adminEmail: params.adminEmail,
    });
  });

  // Customer notification — best-effort.
  try {
    await getEmailQueue().add("gallery-approved", {
      type: "admin_custom",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customSubject: "Figüriniz galeride yayında 🎉",
      customBody:
        `Merhaba ${order.customerName},\n\n` +
        `Figüriniz ${order.orderNumber} galerimizde yayınlandı! ` +
        `Aşağıdaki bağlantıdan görebilir ve sosyal medyada paylaşabilirsiniz.\n\n` +
        `Teşekkürler — Figurine Studio`,
      locale: (order.locale === "en" ? "en" : "tr") as "en" | "tr",
    });
  } catch (err) {
    console.error("[gallery-review] approve email enqueue failed", err);
  }

  return { ok: true };
}

export async function rejectGalleryItem(
  params: RejectParams
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, params.orderId),
    columns: {
      id: true,
      orderNumber: true,
      email: true,
      customerName: true,
      locale: true,
      galleryReviewStatus: true,
    },
  });
  if (!order) return { ok: false, reason: "not_found" };
  if (order.galleryReviewStatus !== "pending") {
    return { ok: false, reason: `cannot reject from ${order.galleryReviewStatus}` };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        isPublic: false,
        galleryReviewStatus: "rejected",
        galleryReviewReason: params.reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, params.orderId));

    await tx.insert(adminActions).values({
      orderId: params.orderId,
      action: "gallery_reject",
      adminEmail: params.adminEmail,
      notes: params.reason.slice(0, 500),
    });
  });

  try {
    await getEmailQueue().add("gallery-rejected", {
      type: "admin_custom",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customSubject: "Galeri başvurunuz hakkında",
      customBody:
        `Merhaba ${order.customerName},\n\n` +
        `${order.orderNumber} figüriniz için galeri başvurunuzu inceledik. ` +
        `Şu an galeride yayınlayamıyoruz — sebep: ${params.reason}\n\n` +
        `Sipariş ve figürinizle ilgili tüm haklarınız korunmaktadır.\n\n` +
        `— Figurine Studio`,
      locale: (order.locale === "en" ? "en" : "tr") as "en" | "tr",
    });
  } catch (err) {
    console.error("[gallery-review] reject email enqueue failed", err);
  }

  return { ok: true };
}

/**
 * Combined approve + gift-card reward. Used when admin wants to thank the
 * customer for an exceptional figurine. The gift card is created via the
 * regular gift-card service and linked back via `galleryRewardGiftCardId`.
 */
export async function rewardAndApproveGalleryItem(
  params: RewardParams
): Promise<
  | { ok: true; giftCardCode: string }
  | { ok: false; reason: string }
> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, params.orderId),
    columns: {
      id: true,
      orderNumber: true,
      email: true,
      customerName: true,
      locale: true,
      galleryReviewStatus: true,
    },
  });
  if (!order) return { ok: false, reason: "not_found" };
  if (
    order.galleryReviewStatus !== "pending" &&
    order.galleryReviewStatus !== "approved"
  ) {
    return {
      ok: false,
      reason: `cannot reward from ${order.galleryReviewStatus}`,
    };
  }

  // Create the gift card first (outside transaction since it has its own
  // atomic insert + uses createGiftCard's logic).
  const { card } = await createGiftCard({
    amountKurus: params.giftCardAmountKurus,
    expirationDays: params.expirationDays ?? 365,
    note: params.note ?? `Galeri ödülü — ${order.orderNumber}`,
    recipientEmail: order.email,
    recipientName: order.customerName,
  });

  // Slug — same rationale as approveGalleryItem. Idempotent: if a slug
  // already exists on the row (e.g. from a prior approve-without-reward),
  // we keep it to preserve any externally-shared links.
  const existingSlug = await db.query.orders.findFirst({
    where: eq(orders.id, params.orderId),
    columns: { gallerySlug: true },
  });
  const slug =
    existingSlug?.gallerySlug ??
    (await generateGallerySlug(order.orderNumber, params.displayName ?? null));

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        isPublic: true,
        publishedAt: new Date(),
        galleryReviewStatus: "approved",
        galleryReviewReason: null,
        galleryCategory: sanitizeCategory(params.category),
        galleryTags: sanitizeTags(params.tags),
        publicDisplayName: params.displayName ?? null,
        galleryRewardGiftCardId: card.id,
        gallerySlug: slug,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, params.orderId));

    await tx.insert(adminActions).values({
      orderId: params.orderId,
      action: "gallery_reward",
      adminEmail: params.adminEmail,
      notes: `Gift card ${card.code} · ${params.giftCardAmountKurus / 100} TL`,
    });
  });

  // Customer notification with the gift card code.
  try {
    await getEmailQueue().add("gallery-rewarded", {
      type: "admin_custom",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customSubject: `Figüriniz galeride + hediye çeki hediyemiz 🎁`,
      customBody:
        `Merhaba ${order.customerName},\n\n` +
        `${order.orderNumber} figürinizi galerimize aldık ve özel bulduğumuz için ` +
        `size ${params.giftCardAmountKurus / 100} TL değerinde bir hediye çeki gönderiyoruz.\n\n` +
        `Hediye çeki kodu: ${card.code}\n` +
        `Bir sonraki siparişinizde uygulayabilirsiniz.\n\n` +
        `Teşekkürler — Figurine Studio`,
      locale: (order.locale === "en" ? "en" : "tr") as "en" | "tr",
    });
  } catch (err) {
    console.error("[gallery-review] reward email enqueue failed", err);
  }

  return { ok: true, giftCardCode: card.code };
}

/**
 * Fetch the pending-review queue for the admin UI.
 */
export async function listPendingGalleryReviews(limit = 100) {
  return db.query.orders.findMany({
    where: and(eq(orders.galleryReviewStatus, "pending")),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      figurineSize: true,
      style: true,
      publicDisplayName: true,
      galleryCategory: true,
      galleryTags: true,
      createdAt: true,
    },
    orderBy: (o, { asc }) => [asc(o.createdAt)],
    limit,
  });
}
