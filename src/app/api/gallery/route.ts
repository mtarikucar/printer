import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, desc, lt, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";

const GALLERY_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
] as const;

const PAGE_SIZE = 12;

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("cursor");
  const styleFilter = request.nextUrl.searchParams.get("style");
  const categoryFilter = request.nextUrl.searchParams.get("category");
  const tagFilter = request.nextUrl.searchParams.get("tag");
  // Q9: keyword search across publicDisplayName + galleryTags. Trimmed +
  // lowercased server-side; capped so a 10KB query string can't blow up the
  // ILIKE pattern.
  const rawQ = request.nextUrl.searchParams.get("q") ?? "";
  const q = rawQ.trim().slice(0, 60).toLowerCase();

  const conditions = [
    eq(orders.isPublic, true),
    inArray(orders.status, [...GALLERY_STATUSES]),
  ];

  if (cursor) {
    // Compound cursor: "timestamp|id" for deterministic pagination
    const [cursorTs, cursorId] = cursor.split("|");
    if (cursorTs && cursorId) {
      const cursorDate = new Date(cursorTs);
      if (isNaN(cursorDate.getTime())) {
        return NextResponse.json({ items: [], nextCursor: null });
      }
      conditions.push(
        sql`(${orders.publishedAt}, ${orders.id}) < (${cursorDate}, ${cursorId})`
      );
    } else {
      // Fallback for legacy single-value cursors
      const cursorDate = new Date(cursor);
      if (isNaN(cursorDate.getTime())) {
        return NextResponse.json({ items: [], nextCursor: null });
      }
      conditions.push(lt(orders.publishedAt, cursorDate));
    }
  }

  if (styleFilter && ["realistic", "disney", "anime", "chibi", "object"].includes(styleFilter)) {
    conditions.push(eq(orders.style, styleFilter as any));
  }

  if (categoryFilter && ["character", "couple", "family", "pet", "fantasy", "funny", "custom"].includes(categoryFilter)) {
    conditions.push(eq(orders.galleryCategory, categoryFilter));
  }

  if (tagFilter) {
    conditions.push(sql`${orders.galleryTags} @> ${JSON.stringify([tagFilter])}::jsonb`);
  }

  if (q.length > 0) {
    // Match against publicDisplayName OR any tag (substring, case-insensitive).
    // Tags are stored lower-cased at write time (publish route already does
    // `.toLowerCase()`), so a single ILIKE on the jsonb::text catches them.
    const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      sql`(lower(${orders.publicDisplayName}) LIKE ${pattern} OR lower(${orders.galleryTags}::text) LIKE ${pattern})`
    );
  }

  const publicOrders = await db.query.orders.findMany({
    where: and(...conditions),
    orderBy: [desc(orders.publishedAt)],
    limit: PAGE_SIZE + 1,
    columns: {
      id: true,
      publicDisplayName: true,
      figurineSize: true,
      style: true,
      galleryCategory: true,
      galleryTags: true,
      gallerySlug: true,
      publishedAt: true,
      createdAt: true,
    },
    with: {
      photos: {
        columns: { originalUrl: true },
        limit: 1,
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  const hasMore = publicOrders.length > PAGE_SIZE;
  const items = publicOrders.slice(0, PAGE_SIZE).map((order) => ({
    id: order.id,
    publicDisplayName: order.publicDisplayName,
    figurineSize: order.figurineSize,
    style: order.style,
    category: order.galleryCategory,
    tags: order.galleryTags ?? [],
    slug: order.gallerySlug ?? null,
    publishedAt: order.publishedAt,
    glbUrl: normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null),
    thumbnailUrl: normalizeFileUrl(order.photos[0]?.originalUrl ?? null),
  }));

  const lastOrder = publicOrders[PAGE_SIZE - 1];
  const nextCursor = hasMore && lastOrder
    ? `${(lastOrder.publishedAt ?? lastOrder.createdAt).toISOString()}|${lastOrder.id}`
    : null;

  return NextResponse.json(
    { items, nextCursor },
    {
      headers: {
        // Public, immutable-ish listing — let the CDN/browser serve it for a
        // minute and revalidate in the background for the next 5.
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
