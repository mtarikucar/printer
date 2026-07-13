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
import { getProductConfig } from "@/lib/services/product-options";
import { sellerNotSuspended } from "@/lib/services/shop-query";
import { ProductDetailClient } from "./detail-client";
import { ProductReviews } from "@/components/reviews/product-reviews";
import { ProductRow } from "@/components/marketplace/product-row";
import { type ProductListItem } from "@/components/product-card";

async function loadProduct(slug: string) {
  return db.query.products.findFirst({
    where: and(
      eq(products.slug, slug),
      eq(products.status, "active"),
      sellerNotSuspended()
    ),
    with: {
      images: true,
      manufacturer: { columns: { companyName: true } },
      categoryNode: { columns: { path: true, name: true } },
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

  // Default gallery = images with no option choice (the unpainted set). Images
  // tagged to a choice (e.g. "El boyaması" painted set) are grouped separately
  // so the buyer page can swap the gallery when that option is selected.
  const sortedImages = [...product.images].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const images = sortedImages
    .filter((img) => !img.optionChoiceId)
    .map((img) => getPublicUrl(img.storageKey));
  const choiceImages: Record<string, string[]> = {};
  for (const img of sortedImages) {
    if (!img.optionChoiceId) continue;
    (choiceImages[img.optionChoiceId] ??= []).push(getPublicUrl(img.storageKey));
  }
  // Fallback: if every image was tagged to a choice (no default), still show
  // something rather than an empty gallery.
  const defaultImages =
    images.length > 0
      ? images
      : sortedImages.map((img) => getPublicUrl(img.storageKey));

  const optionConfig = await getProductConfig(product.id);

  // Cross-sell: a few more active products from the same category node.
  const relatedRows = product.categoryId
    ? await db.query.products.findMany({
        where: and(
          eq(products.status, "active"),
          eq(products.categoryId, product.categoryId),
          ne(products.id, product.id),
          sellerNotSuspended()
        ),
        orderBy: [desc(products.createdAt)],
        limit: 6,
        with: {
          manufacturer: { columns: { companyName: true } },
          categoryNode: { columns: { path: true, name: true } },
        },
      })
    : [];
  const related: ProductListItem[] = relatedRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    priceKurus: p.priceKurus,
    material: p.material,
    categoryPath: p.categoryNode?.path ?? null,
    categoryName: p.categoryNode?.name ?? null,
    leadTimeDays: p.leadTimeDays,
    imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    sellerName: p.manufacturer?.companyName ?? null,
    ratingAvgX100: p.ratingAvgX100,
    ratingCount: p.ratingCount,
  }));

  // Buyer-safe spec: only "box contents" (no STL/3D mesh, notes, or recipe).
  // The 3D preview was removed, so we intentionally do NOT pass model3dUrl —
  // emitting the seller-derived GLB would leak printable geometry to buyers.
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
            images: defaultImages,
            boxContents: publicSpec.boxContents,
            optionGroups: optionConfig.optionGroups,
            addons: optionConfig.addons,
            choiceImages,
          }}
        />
        <ProductReviews productId={product.id} />
        <ProductRow
          title={d["related.title" as keyof typeof d] || "Benzer ürünler"}
          products={related}
          viewAllHref={
            product.categoryNode
              ? `/shop?category=${encodeURIComponent(product.categoryNode.path)}`
              : "/shop"
          }
        />
      </div>
    </main>
  );
}
