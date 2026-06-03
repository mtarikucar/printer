import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { createProductSchema } from "@/lib/validators/product";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { images: true, manufacturer: { columns: { companyName: true } } },
  });
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ product });
}

// Admin edit any product's fields (does not change moderation status).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  const locale = getRequestLocale(request);

  try {
    const body = await request.json();
    const input = createProductSchema(locale).parse(body);
    const [updated] = await db
      .update(products)
      .set({
        title: input.title,
        description: input.description,
        priceKurus: input.priceKurus,
        material: input.material ?? null,
        category: input.category ?? null,
        leadTimeDays: input.leadTimeDays,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ product: updated });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      return NextResponse.json({ error: errors }, { status: 400 });
    }
    console.error("Admin product update failed:", error);
    return NextResponse.json({ error: "Product update failed" }, { status: 500 });
  }
}

// Admin archive (force unlist).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;
  const [archived] = await db
    .update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  if (!archived) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
