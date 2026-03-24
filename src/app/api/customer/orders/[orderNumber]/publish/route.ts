import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
    with: {
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        limit: 1,
      },
    },
  });

  if (!order) {
    return NextResponse.json(
      { error: d["api.order.notFound"] },
      { status: 404 }
    );
  }

  if (order.generationAttempts.length === 0) {
    return NextResponse.json(
      { error: "No completed generation available" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.isPublic !== "boolean") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { isPublic, displayName, category, tags } = body as {
    isPublic: boolean;
    displayName?: string;
    category?: string;
    tags?: string[];
  };

  // Validate category
  const VALID_CATEGORIES = ["character", "couple", "family", "pet", "fantasy", "funny", "custom"];
  const validCategory = category && VALID_CATEGORIES.includes(category) ? category : null;

  // Validate tags (max 5, each max 20 chars, lowercase trimmed)
  const validTags = Array.isArray(tags)
    ? tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase().slice(0, 20))
        .filter((t) => t.length > 0)
        .slice(0, 5)
    : null;

  await db
    .update(orders)
    .set({
      isPublic,
      publicDisplayName: isPublic ? (displayName || null) : order.publicDisplayName,
      // Always set publishedAt when publishing (prevents null cursor breaking pagination)
      publishedAt: isPublic ? new Date() : order.publishedAt,
      galleryCategory: isPublic ? (validCategory || null) : order.galleryCategory,
      galleryTags: isPublic ? (validTags && validTags.length > 0 ? validTags : null) : order.galleryTags,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  return NextResponse.json({ success: true, isPublic });
}
