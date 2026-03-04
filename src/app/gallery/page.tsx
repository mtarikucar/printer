import type { Metadata } from "next";
import { eq, and, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { SiteHeader } from "@/components/site-header";
import { GalleryGrid } from "@/components/gallery-grid";

const GALLERY_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = getDictionary(locale);
  return {
    title: `${d["gallery.title"]} — Figurine Studio`,
    description: d["gallery.subtitle"],
  };
}

export default async function GalleryPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const publicOrders = await db.query.orders.findMany({
    where: and(
      eq(orders.isPublic, true),
      inArray(orders.status, [...GALLERY_STATUSES])
    ),
    orderBy: [desc(orders.publishedAt)],
    limit: 13,
    columns: {
      id: true,
      publicDisplayName: true,
      figurineSize: true,
      publishedAt: true,
    },
    with: {
      photos: {
        columns: { originalUrl: true },
        limit: 1,
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
    },
  });

  const hasMore = publicOrders.length > 12;
  const items = publicOrders.slice(0, 12).map((order) => ({
    id: order.id,
    publicDisplayName: order.publicDisplayName,
    figurineSize: order.figurineSize,
    publishedAt: order.publishedAt?.toISOString() ?? null,
    glbUrl: order.generationAttempts[0]?.outputGlbUrl ?? null,
    thumbnailUrl: order.photos[0]?.originalUrl ?? null,
  }));

  const nextCursor = hasMore
    ? items[items.length - 1]?.publishedAt ?? null
    : null;

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <section className="relative overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl md:text-5xl font-serif text-text-primary">
            {d["gallery.title"]}
          </h1>
          <p className="mt-4 text-lg text-text-secondary max-w-xl mx-auto">
            {d["gallery.subtitle"]}
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-12 pb-20">
        <GalleryGrid initialItems={items} initialCursor={nextCursor} />
      </section>
    </main>
  );
}
