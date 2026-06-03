import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createProductSchema } from "@/lib/validators/product";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { generateProductSlug } from "@/lib/services/slug";

// List products, optionally filtered by ?status=pending_review (moderation
// queue) or any product status.
export async function GET(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const status = request.nextUrl.searchParams.get("status");
  const rows = await db.query.products.findMany({
    where: status
      ? eq(products.status, status as typeof products.$inferSelect.status)
      : undefined,
    orderBy: [desc(products.createdAt)],
    with: { images: true, manufacturer: { columns: { companyName: true } } },
  });

  return NextResponse.json({ products: rows });
}

// Create a platform-owned (admin) product. No self-review — goes live as
// `active` immediately with a minted slug. manufacturerId stays null.
export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const locale = getRequestLocale(request);
  try {
    const body = await request.json();
    const input = createProductSchema(locale).parse(body);
    const slug = await generateProductSlug(input.title);

    const [created] = await db
      .insert(products)
      .values({
        ownerType: "admin",
        manufacturerId: null,
        title: input.title,
        description: input.description,
        priceKurus: input.priceKurus,
        material: input.material ?? null,
        category: input.category ?? null,
        leadTimeDays: input.leadTimeDays,
        status: "active",
        slug,
        createdByAdminEmail: a.session.user.email,
        reviewedByEmail: a.session.user.email,
        reviewedAt: new Date(),
      })
      .returning();

    return NextResponse.json({ product: created });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      return NextResponse.json({ error: errors }, { status: 400 });
    }
    console.error("Admin product create failed:", error);
    return NextResponse.json({ error: "Product create failed" }, { status: 500 });
  }
}
