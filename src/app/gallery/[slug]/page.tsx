import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, generationAttempts, orderPhotos } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";
import { SiteHeader } from "@/components/site-header";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { GalleryDetailViewer } from "@/components/gallery-detail-viewer";

const GALLERY_STATUSES = ["approved", "printing", "shipped", "delivered"] as const;

async function loadGalleryOrder(slug: string) {
  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.gallerySlug, slug),
      eq(orders.isPublic, true),
      inArray(orders.status, [...GALLERY_STATUSES])
    ),
    columns: {
      id: true,
      orderNumber: true,
      publicDisplayName: true,
      figurineSize: true,
      style: true,
      galleryCategory: true,
      galleryTags: true,
      publishedAt: true,
    },
    with: {
      photos: { columns: { originalUrl: true }, limit: 1 },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });
  return order;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const order = await loadGalleryOrder(slug);
  if (!order) return {};
  const locale = await getLocale();
  const d = getDictionary(locale);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  const url = `${baseUrl}/gallery/${slug}`;
  const name = order.publicDisplayName || d["gallery.anonymous"];
  const styleLabel = d[`create.style.${order.style}` as keyof typeof d] || order.style;
  const title =
    locale === "tr"
      ? `${name} — ${styleLabel} 3D Figürin | Figurine Studio Galeri`
      : `${name} — ${styleLabel} 3D Figurine | Figurine Studio Gallery`;
  const description =
    locale === "tr"
      ? `Müşterimizin fotoğrafından ${styleLabel.toLowerCase()} stilinde ürettiğimiz 3D figürin. Galeriye göz atın, kendi figürinizi yaratın.`
      : `A ${styleLabel.toLowerCase()}-style 3D figurine we made from a customer's photo. Browse the gallery or create your own.`;
  const ogImage = normalizeFileUrl(order.photos[0]?.originalUrl ?? null);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      images: ogImage ? [{ url: ogImage, alt: name }] : undefined,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function GalleryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const order = await loadGalleryOrder(slug);
  if (!order) notFound();

  const locale = await getLocale();
  const d = getDictionary(locale);
  const name = order.publicDisplayName || d["gallery.anonymous"];
  const styleLabel = d[`create.style.${order.style}` as keyof typeof d] || order.style;
  const sizeLabel = d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize;
  const thumbnailUrl = normalizeFileUrl(order.photos[0]?.originalUrl ?? null);
  const glbUrl = normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null);

  // JSON-LD: search engines render this as a richer card. We tag as
  // CreativeWork because it's the most generic schema that fits "a 3D
  // model published in a gallery".
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name,
    description:
      locale === "tr"
        ? `${styleLabel} stilinde 3D figürin`
        : `${styleLabel}-style 3D figurine`,
    image: thumbnailUrl ?? undefined,
    datePublished: order.publishedAt?.toISOString(),
    keywords: order.galleryTags?.join(", "),
  };

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-text-muted mb-6">
          <Link href="/" className="hover:text-green-500">
            {d["nav.home"]}
          </Link>
          <span>/</span>
          <Link href="/gallery" className="hover:text-green-500">
            {d["nav.gallery"]}
          </Link>
          <span>/</span>
          <span className="text-text-primary font-medium truncate max-w-[200px]">
            {name}
          </span>
        </nav>

        <GalleryDetailViewer
          thumbnailUrl={thumbnailUrl}
          glbUrl={glbUrl}
          name={name}
        />

        <div className="mt-6 card p-6">
          <h1 className="text-2xl md:text-3xl font-serif text-text-primary">
            {name}
          </h1>
          <div className="flex items-center flex-wrap gap-2 mt-3">
            <span className="bg-bg-elevated text-green-500 text-xs font-medium px-2 py-1 rounded-full border border-bg-subtle">
              {sizeLabel}
            </span>
            <Link
              href={`/styles/${order.style}`}
              className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-1 rounded-full border border-purple-200 hover:bg-purple-200 transition-colors"
            >
              {styleLabel}
            </Link>
            {order.galleryCategory && (
              <span className="bg-bg-elevated text-text-secondary text-xs px-2 py-1 rounded-full border border-bg-subtle">
                {d[`gallery.category.${order.galleryCategory}` as keyof typeof d] ??
                  order.galleryCategory}
              </span>
            )}
          </div>
          {order.galleryTags && order.galleryTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {order.galleryTags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs text-text-muted bg-bg-elevated px-2 py-1 rounded-full border border-bg-subtle"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={`/create?style=${order.style}`}
              className="btn-primary text-sm"
            >
              {d["gallery.createYourOwn"]}
            </Link>
            <Link href="/gallery" className="btn-secondary text-sm">
              {d["gallery.backToGallery"] ?? d["nav.gallery"]}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
