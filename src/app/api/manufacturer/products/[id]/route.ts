import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { createProductSchema } from "@/lib/validators/product";
import { resolveProductCategoryId } from "@/lib/services/categories";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

async function loadOwnedProduct(productId: string, manufacturerId: string) {
  return db.query.products.findFirst({
    where: and(
      eq(products.id, productId),
      eq(products.manufacturerId, manufacturerId)
    ),
    with: { images: true },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;
  const product = await loadOwnedProduct(id, guard.manufacturerId);
  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ product });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;
  const locale = getRequestLocale(request);

  const existing = await loadOwnedProduct(id, guard.manufacturerId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status === "archived") {
    return NextResponse.json(
      { error: "Archived products cannot be edited" },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const input = createProductSchema(locale).parse(body);

    let categoryId: string | null;
    try {
      categoryId = await resolveProductCategoryId(input.categoryId);
    } catch {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }

    // Editing an already-published (active) product sends it back to review so
    // an admin re-checks the change before it goes live again. Draft/rejected
    // products stay in their current state.
    const nextStatus =
      existing.status === "active" ? ("pending_review" as const) : existing.status;
    const reEnteredReview = nextStatus !== existing.status;

    const [updated] = await db
      .update(products)
      .set({
        title: input.title,
        description: input.description,
        priceKurus: input.priceKurus,
        material: input.material ?? null,
        categoryId,
        leadTimeDays: input.leadTimeDays,
        status: nextStatus,
        submittedAt: reEnteredReview ? new Date() : existing.submittedAt,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    if (reEnteredReview) {
      await publishRealtime([topics.admin()], { kind: "badge" }).catch(() => {});
    }

    return NextResponse.json({ product: updated });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      const errors = (error as Error & { errors?: unknown }).errors;
      return NextResponse.json({ error: errors }, { status: 400 });
    }
    console.error("Product update failed:", error);
    return NextResponse.json({ error: "Product update failed" }, { status: 500 });
  }
}

// Archive (soft delete) — hides the listing from the storefront.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;

  const [archived] = await db
    .update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(
      and(eq(products.id, id), eq(products.manufacturerId, guard.manufacturerId))
    )
    .returning();

  if (!archived) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
