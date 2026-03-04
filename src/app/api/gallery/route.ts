import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, desc, lt } from "drizzle-orm";
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

  const conditions = [
    eq(orders.isPublic, true),
    inArray(orders.status, [...GALLERY_STATUSES]),
  ];

  if (cursor) {
    conditions.push(lt(orders.publishedAt, new Date(cursor)));
  }

  const publicOrders = await db.query.orders.findMany({
    where: and(...conditions),
    orderBy: [desc(orders.publishedAt)],
    limit: PAGE_SIZE + 1,
    columns: {
      id: true,
      publicDisplayName: true,
      figurineSize: true,
      publishedAt: true,
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
    publishedAt: order.publishedAt,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
    thumbnailUrl: order.photos[0]?.originalUrl ?? null,
  }));

  const nextCursor = hasMore
    ? items[items.length - 1]?.publishedAt?.toISOString() ?? null
    : null;

  return NextResponse.json({ items, nextCursor });
}
