import { eq, isNull, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { orders, orderPhotos, previews } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";

/**
 * The customer's "journey" page: the photo they uploaded, the design they
 * approved, and the figure that came out — reachable by the QR on the card in
 * the box.
 *
 * Access is possession of an unguessable token, the same capability model as
 * /pay/<reference> and /quote/<id>. It is NOT derived from orderNumber, which
 * travels on shipping labels and invoices; the journey shows a photo of
 * someone's face, so reading a parcel label must not be enough to open it.
 */

// 12 chars of nanoid's 64-symbol alphabet ≈ 72 bits. Guessing one is not a
// realistic attack, and a leaked link can be rotated without touching the order.
const TOKEN_LENGTH = 12;

/**
 * Only bespoke orders have a journey. A customer who bought a keychain from the
 * shop uploaded no photo and approved no design — there is nothing to tell, and
 * a QR promising a story would lead to an empty page.
 */
export function orderHasJourney(order: {
  orderType: string;
  modelGlbKey: string | null;
  modelGlbUrl: string | null;
}): boolean {
  return order.orderType === "custom" && !!(order.modelGlbKey || order.modelGlbUrl);
}

/**
 * Return this order's journey token, minting one if it is eligible and does not
 * have one yet. Idempotent, and safe to call from anywhere that needs the link
 * (model upload, shipping email, the admin card page).
 *
 * Minting lazily rather than only at model-upload time means orders that
 * shipped before this feature existed still get a working card when someone
 * asks for one — no backfill migration needed.
 */
export async function ensureJourneyToken(orderId: string): Promise<string | null> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      orderType: true,
      modelGlbKey: true,
      modelGlbUrl: true,
      journeyToken: true,
    },
  });
  if (!order || !orderHasJourney(order)) return null;
  if (order.journeyToken) return order.journeyToken;

  // Guard on journeyToken still being NULL so two concurrent callers (the
  // shipping email worker and an admin opening the card) can't overwrite each
  // other's token and invalidate a card that was already printed.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = nanoid(TOKEN_LENGTH);
    const [updated] = await db
      .update(orders)
      .set({ journeyToken: candidate })
      .where(and(eq(orders.id, orderId), isNull(orders.journeyToken)))
      .returning({ journeyToken: orders.journeyToken });
    if (updated?.journeyToken) return updated.journeyToken;

    // Either someone else won the race (re-read and use theirs) or the unique
    // index rejected a collision (retry with a fresh token).
    const [current] = await db
      .select({ journeyToken: orders.journeyToken })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (current?.journeyToken) return current.journeyToken;
  }
  return null;
}

export function journeyUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  return `${base.replace(/\/$/, "")}/yolculuk/${token}`;
}

export interface JourneyData {
  orderNumber: string;
  /** First name only — the page greets, it does not address an invoice. */
  firstName: string;
  photoUrl: string | null;
  designUrl: string | null;
  glbUrl: string | null;
  figurineSize: string | null;
  material: string;
  orderedAt: string;
  /** Calendar days from payment to shipping; null while still in production. */
  productionDays: number | null;
}

/**
 * Everything the journey page renders, or null when the token does not resolve.
 * A missing stage yields a null URL rather than an error — an order whose photo
 * was purged still has a design and a figure worth showing.
 */
export async function loadJourney(token: string): Promise<JourneyData | null> {
  if (!token || token.length > 64) return null;

  const order = await db.query.orders.findFirst({
    where: eq(orders.journeyToken, token),
    columns: {
      id: true,
      orderNumber: true,
      orderType: true,
      customerName: true,
      previewId: true,
      modelGlbKey: true,
      modelGlbUrl: true,
      figurineSize: true,
      material: true,
      paidAt: true,
      createdAt: true,
      shippedAt: true,
    },
  });
  if (!order || !orderHasJourney(order)) return null;

  // The uploaded photo lives on order_photos (orders itself carries no photo
  // key — the draft's photoKey is copied into a row there at promotion).
  const [photo] = await db
    .select({ originalUrl: orderPhotos.originalUrl })
    .from(orderPhotos)
    .where(eq(orderPhotos.orderId, order.id))
    .limit(1);
  let photoUrl = normalizeFileUrl(photo?.originalUrl ?? null);

  // The design the customer picked out of the fal.ai variations.
  let designUrl: string | null = null;
  if (order.previewId) {
    const preview = await db.query.previews.findFirst({
      where: eq(previews.id, order.previewId),
      columns: { selectedStyledImageUrl: true, photoUrl: true },
    });
    designUrl = normalizeFileUrl(preview?.selectedStyledImageUrl ?? null);
    if (!photoUrl) photoUrl = normalizeFileUrl(preview?.photoUrl ?? null);
  }

  const start = order.paidAt ?? order.createdAt;
  const productionDays =
    order.shippedAt && start
      ? Math.max(
          1,
          Math.round(
            (order.shippedAt.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
          )
        )
      : null;

  return {
    orderNumber: order.orderNumber,
    firstName: (order.customerName ?? "").trim().split(/\s+/)[0] || "Merhaba",
    photoUrl,
    designUrl,
    glbUrl: normalizeFileUrl(order.modelGlbUrl ?? order.modelGlbKey ?? null),
    figurineSize: order.figurineSize,
    material: order.material,
    orderedAt: (start ?? order.createdAt).toISOString(),
    productionDays,
  };
}
