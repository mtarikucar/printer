import { NextRequest, NextResponse } from "next/server";
import { and, eq, desc, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { previews, orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

const PAGE_SIZE = 12;

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const cursor = request.nextUrl.searchParams.get("cursor");

  const conditions = [
    eq(previews.userId, session.userId),
    ne(previews.status, "expired"),
  ];

  if (cursor) {
    const cursorDate = new Date(cursor);
    if (isNaN(cursorDate.getTime())) {
      return NextResponse.json({ previews: [], nextCursor: null });
    }
    conditions.push(lt(previews.createdAt, cursorDate));
  }

  const userPreviews = await db.query.previews.findMany({
    where: and(...conditions),
    orderBy: [desc(previews.createdAt)],
    limit: PAGE_SIZE + 1,
    columns: {
      id: true,
      status: true,
      photoUrl: true,
      glbUrl: true,
      figurineSize: true,
      createdAt: true,
    },
  });

  const hasMore = userPreviews.length > PAGE_SIZE;
  const page = userPreviews.slice(0, PAGE_SIZE);

  // Find which previews already have orders
  const previewIds = page.map((p) => p.id);
  const linkedOrders =
    previewIds.length > 0
      ? await db.query.orders.findMany({
          columns: {
            id: true,
            previewId: true,
            orderNumber: true,
            status: true,
            amountKurus: true,
            isPublic: true,
            publicDisplayName: true,
          },
          where: (o, { inArray }) =>
            inArray(o.previewId, previewIds),
        })
      : [];

  const orderByPreviewId = new Map(
    linkedOrders.map((o) => [o.previewId, o])
  );

  const result = page.map((p) => {
    const order = orderByPreviewId.get(p.id);
    return {
      id: p.id,
      status: p.status,
      photoUrl: p.photoUrl,
      glbUrl: p.glbUrl,
      figurineSize: p.figurineSize,
      createdAt: p.createdAt,
      order: order
        ? {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            amountKurus: order.amountKurus,
            isPublic: order.isPublic,
            publicDisplayName: order.publicDisplayName,
          }
        : null,
    };
  });

  const nextCursor = hasMore
    ? page[page.length - 1]?.createdAt?.toISOString() ?? null
    : null;

  return NextResponse.json({ previews: result, nextCursor });
}
