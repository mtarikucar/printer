import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc, count, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { productReviews, orders, orderItems, users, products } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";

export const runtime = "nodejs";

// GET — approved reviews + average for a product.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rows = await db
    .select({
      rating: productReviews.rating,
      title: productReviews.title,
      body: productReviews.body,
      createdAt: productReviews.createdAt,
      customerName: users.fullName,
    })
    .from(productReviews)
    .innerJoin(users, eq(productReviews.userId, users.id))
    .where(and(eq(productReviews.productId, id), eq(productReviews.status, "approved")))
    .orderBy(desc(productReviews.createdAt))
    .limit(50);

  // avg/count come from the denormalized product aggregate (maintained over ALL
  // approved reviews on write), so they match the product cards instead of being
  // computed from only the 50 newest reviews in the list above.
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    columns: { ratingAvgX100: true, ratingCount: true },
  });
  const count = product?.ratingCount ?? 0;
  const avg = (product?.ratingAvgX100 ?? 0) / 100;
  return NextResponse.json({
    reviews: rows.map((r) => ({
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      customerName: (r.customerName ?? "").split(" ")[0] || "Müşteri",
    })),
    avg,
    count,
  });
}

// POST — leave a review. Gated: the user must have a DELIVERED order containing
// the product (single-item order.productId OR a cart sub-order's orderItems).
export async function POST(
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
