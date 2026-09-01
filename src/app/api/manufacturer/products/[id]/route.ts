import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";
import { createProductSchema } from "@/lib/validators/product";
import {
  validateCostLines,
  replaceCostLines,
  getCostLines,
} from "@/lib/services/product-cost-lines";
import { resolveProductCategoryId } from "@/lib/services/categories";
import { hardDeleteOwnedProduct } from "@/lib/services/product-delete";
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

    // Kalem kırılımı fiyatı OLUŞTURUR. İstek kırılım göndermediyse (kısmi
    // düzenleme) mevcut kırılım YENİ fiyata karşı doğrulanır — aksi hâlde tek
    // başına bir fiyat düzenlemesi kırılımı sessizce tutarsız bırakır ve iki
    // hakediş tabanının toplamı sipariş tutarını tutmaz.
    const nextCostLines = input.costLines ?? (await getCostLines(id));
    const costLineError = validateCostLines(nextCostLines, input.priceKurus);
    if (costLineError) {
      return NextResponse.json({ error: costLineError }, { status: 400 });
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
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
      if (row && input.costLines) {
        await replaceCostLines(id, input.costLines, tx);
      }
      return row;
    });

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

// DELETE archives by default (hides the listing). With ?hard=1 it PERMANENTLY
// deletes the seller's own product — only when it has no order/draft/review
// history; otherwise refuses (the seller must archive it).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireActiveSeller();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;

  if (request.nextUrl.searchParams.get("hard") === "1") {
    const res = await hardDeleteOwnedProduct(id, guard.manufacturerId);
    if (!res.ok) {
      const status = res.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: res.reason }, { status });
    }
    return NextResponse.json({ success: true, deleted: true });
  }

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
