import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { getPublicUrl } from "@/lib/services/storage";
import { ProductDetailClient } from "./detail-client";

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
  if (!product) return { title: "Figurine Studio" };
  return {
    title: `${product.title} — Figurine Studio`,
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
          }}
        />
      </div>
    </main>
  );
}
