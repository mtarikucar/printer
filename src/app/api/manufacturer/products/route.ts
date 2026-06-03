import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { createProductSchema } from "@/lib/validators/product";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

/**
 * Seller product management. Only `active` (KYC-complete) manufacturers may
 * list products. Products are created as `draft`; the seller submits them for
 * admin review via the [id]/submit route.
 */
export async function GET() {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const rows = await db.query.products.findMany({
    where: eq(products.manufacturerId, guard.manufacturerId),
    orderBy: [desc(products.createdAt)],
    with: { images: true },
  });

  return NextResponse.json({ products: rows });
}

export async function POST(request: NextRequest) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const locale = getRequestLocale(request);
  try {
    const body = await request.json();
    const input = createProductSchema(locale).parse(body);

    const [created] = await db
      .insert(products)
      .values({
        ownerType: "seller",
        manufacturerId: guard.manufacturerId,
        title: input.title,
        description: input.description,
        priceKurus: input.priceKurus,
        material: input.material ?? null,
        category: input.category ?? null,
        leadTimeDays: input.leadTimeDays,
        status: "draft",
      })
      .returning();

    return NextResponse.json({ product: created });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      return NextResponse.json({ error: errors }, { status: 400 });
    }
    console.error("Product create failed:", error);
    return NextResponse.json({ error: "Product create failed" }, { status: 500 });
  }
}
