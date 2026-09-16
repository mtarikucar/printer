import { NextRequest, NextResponse } from "next/server";
import { and, eq, count, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { productReviews, orders, orderItems, products } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { loadProductReviews } from "@/lib/services/product-reviews";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR, CUSTOMER_READ_FAILED_ERROR } from "@/lib/api/route-error";

export const runtime = "nodejs";

// GET — approved reviews + average for a product.
async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Shared with the product page, which renders the same data server-side.
  const data = await loadProductReviews(id);
  return NextResponse.json(data);
}

// POST — leave a review. Gated: the user must have a DELIVERED order containing
// the product (single-item order.productId OR a cart sub-order's orderItems).
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rating = Math.round(Number(body.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  }

  const single = await db.query.orders.findFirst({
    where: and(
      eq(orders.userId, session.userId),
      eq(orders.productId, id),
      eq(orders.status, "delivered")
    ),
    columns: { id: true },
  });
  let eligibleOrderId = single?.id ?? null;
  if (!eligibleOrderId) {
    const line = await db
      .select({ orderId: orderItems.orderId })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(
        and(
          eq(orderItems.productId, id),
          eq(orders.userId, session.userId),
          eq(orders.status, "delivered")
        )
      )
      .limit(1);
    eligibleOrderId = line[0]?.orderId ?? null;
  }
  if (!eligibleOrderId) {
    return NextResponse.json({ error: "not_eligible" }, { status: 403 });
  }

  // One review per (product, user). The DB unique index is (product,user,order),
  // so a buyer with multiple delivered orders for the same product could
  // otherwise post one review per order and inflate the rating. Dedupe before
  // insert; onConflictDoNothing stays as a same-order backstop.
  const existing = await db
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(
      and(
        eq(productReviews.productId, id),
        eq(productReviews.userId, session.userId)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ ok: true, alreadyReviewed: true });
  }

  await db
    .insert(productReviews)
    .values({
      productId: id,
      userId: session.userId,
      orderId: eligibleOrderId,
      rating,
      title: typeof body.title === "string" ? body.title.slice(0, 120) : null,
      body: typeof body.body === "string" ? body.body.slice(0, 2000) : null,
      status: "approved",
    })
    .onConflictDoNothing();

  // Refresh the denormalised rating shown on product cards.
  const [agg] = await db
    .select({ avg: sql<string>`avg(${productReviews.rating})`, cnt: count() })
    .from(productReviews)
    .where(and(eq(productReviews.productId, id), eq(productReviews.status, "approved")));
  await db
    .update(products)
    .set({
      ratingAvgX100: agg?.avg ? Math.round(Number(agg.avg) * 100) : 0,
      ratingCount: Number(agg?.cnt ?? 0),
    })
    .where(eq(products.id, id));

  return NextResponse.json({ ok: true });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handleGET` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handleGET(_req, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /api/products/[id]/reviews", CUSTOMER_READ_FAILED_ERROR);
  }
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePOST` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    return await handlePOST(req, ctx);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/products/[id]/reviews", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
