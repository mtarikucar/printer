import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, products } from "@/lib/db/schema";
import { SiteHeader } from "@/components/site-header";
import { getPublicUrl } from "@/lib/services/storage";
import { listBoxTiers } from "@/lib/services/box-tiers";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { BoxBuilderClient, type BoxDesign } from "./box-builder-client";

export const metadata: Metadata = {
  title: "Anahtarlık Kutusu | Figurunica",
  description:
    "Beğendiğin anahtarlıklardan 10'ar 10'ar seç, kutunu kendin oluştur. Kutudaki toplam adet arttıkça birim fiyat düşer.",
};

// The box builder: one screen, assorted designs, priced on the box total.
//
// Deliberately NOT built on queryShopProducts: that helper answers "what is on
// sale in the shop" (category tree, sort, search, pagination). The box needs a
// flat, complete, unpaginated list of eligible designs — a different question,
// and threading box-ness through the storefront query would make both muddier.
export default async function AnahtarlikKutusuPage() {
  const dict = getDictionary(await getLocale());

  const [rows, tiers] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        title: products.title,
        priceKurus: products.priceKurus,
        primaryImageKey: products.primaryImageKey,
        ownerType: products.ownerType,
        manufacturerStatus: manufacturers.status,
      })
      .from(products)
      .leftJoin(manufacturers, eq(products.manufacturerId, manufacturers.id))
      .where(and(eq(products.boxEligible, true), eq(products.status, "active")))
      .orderBy(asc(products.priceKurus), asc(products.title)),
    listBoxTiers(),
  ]);

  // Same suspended-seller gate the storefront applies. Box-eligible products
  // are admin-owned by policy, so this is belt-and-braces against a stray flag.
  const designs: BoxDesign[] = rows
    .filter(
      (p) => p.ownerType === "admin" || p.manufacturerStatus === "active"
    )
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      priceKurus: p.priceKurus,
      imageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    }));

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-serif text-3xl text-text-primary">
          {dict["box.title"]}
        </h1>
        <p className="mt-2 max-w-2xl text-text-secondary">{dict["box.intro"]}</p>

        <BoxBuilderClient designs={designs} tiers={tiers} />
      </div>
    </main>
  );
}
