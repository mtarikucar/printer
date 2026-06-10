import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and, ne, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { getPublicUrl } from "@/lib/services/storage";
import { getProductPublicSpec } from "@/lib/services/product-spec";
import { ProductDetailClient } from "./detail-client";
import { ProductReviews } from "@/components/reviews/product-reviews";
import { ProductRow } from "@/components/marketplace/product-row";
import { type ProductListItem } from "@/components/product-card";

async function loadProduct(slug: string) {
  return db.query.products.findFirst({
    where: and(eq(products.slug, slug), eq(products.status, "active")),
    with: {
      images: true,
      manufacturer: { columns: { companyName: true } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return { title: "Figurunica" };
  return {
    title: `${product.title} — Figurunica`,
    description: product.description.slice(0, 160),
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const { slug } = await params;

  const product = await loadProduct(slug);
  if (!product) notFound();

  const images = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((img) => getPublicUrl(img.storageKey));

  // Cross-sell: a few more active products from the same category.
  const relatedRows = product.category
    ? await db.query.products.findMany({
        where: and(
          eq(products.status, "active"),
          eq(products.category, product.category),
          ne(products.id, product.id)
        ),
        orderBy: [desc(products.createdAt)],
        limit: 6,
        with: { manufacturer: { columns: { companyName: true } } },
      })
    : [];
  const related: ProductListItem[] = relatedRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    category: p.category,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
    ratingAvgX100: p.ratingAvgX100,
    ratingCount: p.ratingCount,
  }));

  // Buyer-safe spec: a 3D preview + "box contents" (no STL, notes, or recipe).
  const publicSpec = await getProductPublicSpec(product.id);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link
          href="/shop"
          className="text-sm text-text-muted hover:text-text-primary"
        >
          ← {d["shop.backToShop" as keyof typeof d] || "Mağazaya dön"}
        </Link>
        <ProductDetailClient
          product={{
            id: product.id,
            title: product.title,
            description: product.description,
            priceKurus: product.priceKurus,
            material: product.material,
            leadTimeDays: product.leadTimeDays,
            sellerName: product.manufacturer?.companyName ?? null,
            images,
            model3dUrl: publicSpec.model3dUrl,
            boxContents: publicSpec.boxContents,
          }}
        />
        <ProductReviews productId={product.id} />
        <ProductRow
          title={d["related.title" as keyof typeof d] || "Benzer ürünler"}
          products={related}
          viewAllHref={`/shop?category=${product.category}`}
        />
      </div>
    </main>
  );
}
