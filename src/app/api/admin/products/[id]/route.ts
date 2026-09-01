import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { createProductSchema } from "@/lib/validators/product";
import {
  validateCostLines,
  replaceCostLines,
  getCostLines,
} from "@/lib/services/product-cost-lines";
import { resolveProductCategoryId } from "@/lib/services/categories";
import { hardDeleteProduct } from "@/lib/services/product-delete";
import { basePriceConflictsWithTiers } from "@/lib/services/product-tiers";
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
    let categoryId: string | null;
    try {
      categoryId = await resolveProductCategoryId(input.categoryId);
    } catch {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }
    // Volume tiers are validated as strictly below the base price when they are
    // saved — but nothing stops a later price edit from sinking underneath them,
    // at which point buying more would cost more. Refuse the edit instead.
    if (await basePriceConflictsWithTiers(id, input.priceKurus)) {
      return NextResponse.json(
        {
          error:
            "Liste fiyatı, tanımlı toplu fiyat kademelerinin altına indirilemez. Önce kademeleri güncelleyin.",
        },
        { status: 400 }
      );
    }
    // Kalem kırılımı fiyatı OLUŞTURUR. İstek kırılım göndermediyse (kısmi
    // düzenleme) mevcut kırılım YENİ fiyata karşı doğrulanır — aksi hâlde tek
    // başına bir fiyat düzenlemesi kırılımı sessizce tutarsız bırakır ve iki
    // hakediş tabanının toplamı sipariş tutarını tutmaz.
    const nextCostLines = input.costLines ?? (await getCostLines(id));
    const costLineError = validateCostLines(nextCostLines, input.priceKurus);
    if (costLineError) {
      return NextResponse.json({ error: costLineError }, { status: 400 });
    }

    // Fiyat ve kırılım TEK transaction'da değişir; arada fiyatla kırılımın
    // uyuşmadığı bir pencere kalmamalı (o pencerede verilen bir sipariş yanlış
    // taban yazardı).
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
          updatedAt: new Date(),
        })
        .where(eq(products.id, id))
        .returning();
      if (row && input.costLines) {
        await replaceCostLines(id, input.costLines, tx);
      }
      return row;
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ product: updated });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      // zod v4 sorunları `.issues`'ta tutar; `.errors` undefined'dır — bu yüzden
      // doğrulama hatası istemciye boş dönüyor ve kullanıcı neyin yanlış
      // olduğunu asla göremiyordu (yalnızca genel "kaydedilemedi").
      const issues = (error as Error & {
        issues?: Array<{ path?: (string | number)[]; message?: string }>;
      }).issues;
      const message =
        issues?.map((i) => i.message).filter(Boolean).join(" · ") ||
        "Gönderilen bilgiler geçersiz.";
      return NextResponse.json({ error: message, issues }, { status: 400 });
    }
    console.error("Admin product update failed:", error);
    return NextResponse.json({ error: "Product update failed" }, { status: 500 });
  }
}

// DELETE archives by default (force unlist). With ?hard=1 it PERMANENTLY
// deletes — only allowed when the product has no order/draft/review history.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  if (request.nextUrl.searchParams.get("hard") === "1") {
    const res = await hardDeleteProduct(id);
    if (!res.ok) {
      const status = res.reason === "not_found" ? 404 : 409;
      return NextResponse.json({ error: res.reason }, { status });
    }
    return NextResponse.json({ success: true, deleted: true });
  }

  const [archived] = await db
    .update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  if (!archived) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
