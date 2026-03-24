import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, desc, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";

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

  const conditions = [
    eq(orders.isPublic, true),
    inArray(orders.status, [...GALLERY_STATUSES]),
  ];

  if (cursor) {
    conditions.push(lt(orders.publishedAt, new Date(cursor)));
  }

  if (styleFilter && ["realistic", "disney", "anime", "chibi"].includes(styleFilter)) {
    conditions.push(eq(orders.style, styleFilter as any));
  }

  if (categoryFilter && ["character", "couple", "family", "pet", "fantasy", "funny", "custom"].includes(categoryFilter)) {
    conditions.push(eq(orders.galleryCategory, categoryFilter));
  }

  if (tagFilter) {
    conditions.push(sql`${orders.galleryTags} @> ${JSON.stringify([tagFilter])}::jsonb`);
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
    publishedAt: order.publishedAt,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
    thumbnailUrl: order.photos[0]?.originalUrl ?? null,
  }));

  const lastOrder = publicOrders[PAGE_SIZE - 1];
  const nextCursor = hasMore && lastOrder
    ? (lastOrder.publishedAt?.toISOString() ?? lastOrder.createdAt.toISOString())
    : null;

  return NextResponse.json({ items, nextCursor });
}
