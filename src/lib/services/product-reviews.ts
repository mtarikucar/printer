import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { productReviews, products, users } from "@/lib/db/schema";

/**
 * Approved reviews plus the denormalised aggregate for a product.
 *
 * Extracted out of the reviews API route so the PRODUCT PAGE can render the
 * same data server-side. It used to be fetched only from a `useEffect` in a
 * client component, which meant the HTML a crawler (or an AI retrieval bot)
 * receives said "Henüz yorum yok." while the listing card next to it showed
 * "4.7 (12)" — contradictory information, and structured-data markup for a
 * rating that is not visible in the page is unsupported.
 *
 * avg/count come from the denormalised aggregate on `products` (maintained over
 * ALL approved reviews on write), so they match the cards rather than being
 * computed from only the newest page of reviews.
 */
export interface PublicReview {
  rating: number;
  title: string | null;
  body: string | null;
  createdAt: Date;
  customerName: string;
}

export interface ProductReviewData {
  reviews: PublicReview[];
  avg: number;
  count: number;
}

export const REVIEW_PAGE_SIZE = 50;

export async function loadProductReviews(
  productId: string,
  limit = REVIEW_PAGE_SIZE
): Promise<ProductReviewData> {
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
    .where(
      and(eq(productReviews.productId, productId), eq(productReviews.status, "approved"))
    )
    .orderBy(desc(productReviews.createdAt))
    .limit(limit);

  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: { ratingAvgX100: true, ratingCount: true },
  });

  return {
    // Only the first name is published — a full name next to a purchase is more
    // personal data than a review needs.
    reviews: rows.map((r) => ({
      rating: r.rating,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      customerName: (r.customerName ?? "").split(" ")[0] || "Müşteri",
    })),
    avg: (product?.ratingAvgX100 ?? 0) / 100,
    count: product?.ratingCount ?? 0,
  };
}
