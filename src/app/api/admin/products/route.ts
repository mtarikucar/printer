import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createProductSchema } from "@/lib/validators/product";
import { resolveProductCategoryId } from "@/lib/services/categories";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { generateProductSlug } from "@/lib/services/slug";
import {
  validateCostLines,
  replaceCostLines,
} from "@/lib/services/product-cost-lines";

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

    // Kalem kırılımı fiyatı OLUŞTURUR: toplamı fiyata eşit olmak zorunda.
    // Eşit değilse iki hakediş tabanı tutarı tutmaz ve partner payları
    // fiyattan sapar — bu yüzden ürün hiç yazılmadan reddediliyor.
    const costLineError = validateCostLines(input.costLines ?? [], input.priceKurus);
    if (costLineError) {
      return NextResponse.json({ error: costLineError }, { status: 400 });
    }

    const slug = await generateProductSlug(input.title);

    let categoryId: string | null;
    try {
      categoryId = await resolveProductCategoryId(input.categoryId);
    } catch {
      return NextResponse.json({ error: "invalid category" }, { status: 400 });
    }

    // Ürün ve kırılımı TEK transaction'da yazılır — düzenleme yolunda olduğu
    // gibi. İkisi ayrı yazıldığında araya giren bir hata (constraint, havuz
    // zaman aşımı, iptal edilen istek) fiyatı olan ama HİÇ kalemi olmayan bir
    // ürün bırakıyordu. O satır "kırılımsız eski ürün"den ayırt edilemez:
    // boyacı payı sessizce sıfırlanır ve tutarın tamamı üretim sayılır.
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({
          ownerType: "admin",
          manufacturerId: null,
          title: input.title,
          description: input.description,
          priceKurus: input.priceKurus,
          material: input.material ?? null,
          categoryId,
          leadTimeDays: input.leadTimeDays,
          status: "active",
          slug,
          createdByAdminEmail: a.session.user.email,
          reviewedByEmail: a.session.user.email,
          reviewedAt: new Date(),
        })
        .returning();
      if (input.costLines?.length) {
        await replaceCostLines(row.id, input.costLines, tx);
      }
      return row;
    });

    return NextResponse.json({ product: created });
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
    console.error("Admin product create failed:", error);
    return NextResponse.json({ error: "Product create failed" }, { status: 500 });
  }
}
