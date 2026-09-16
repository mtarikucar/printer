import type { Metadata } from "next";
import { and, asc, eq, inArray } from "drizzle-orm";
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
        manufacturerId: products.manufacturerId,
      })
      .from(products)
      .where(and(eq(products.boxEligible, true), eq(products.status, "active")))
      .orderBy(asc(products.priceKurus), asc(products.title)),
    listBoxTiers(),
  ]);

  // `leftJoin(manufacturers)` KALDIRILDI: join TEK ifadedir, `manufacturers`
  // okunamadığında kutu sayfası tamamen 500 verirdi — oysa ürünler
  // okunabiliyordu. Satıcı durumu AYRI ve korumalı okunur.
  //
  // Bu okuma GÖSTERİM DEĞİL, bir KAPININ girdisi: askıya alınmış satıcının
  // ürünü satışa çıkamaz. Okunamadığında kapı AÇIK varsayılamaz, bu yüzden
  // yalnız platformun KENDİ (admin) tasarımları listelenir — kural zaten bu
  // sayfadaki ürünlerin admin'e ait olmasını söylüyor, yani kayıp beklenmez.
  const sellerIds = [
    ...new Set(rows.map((r) => r.manufacturerId).filter((x): x is string => !!x)),
  ];
  const sellerRead = sellerIds.length
    ? await db
        .select({ id: manufacturers.id, status: manufacturers.status })
        .from(manufacturers)
        .where(inArray(manufacturers.id, sellerIds))
        .catch((e) => {
          console.error("kutu: satıcı durumları okunamadı", e);
          return null;
        })
    : [];
  const sellerStatusById = new Map((sellerRead ?? []).map((m) => [m.id, m.status]));

  // Same suspended-seller gate the storefront applies. Box-eligible products
  // are admin-owned by policy, so this is belt-and-braces against a stray flag.
  const designs: BoxDesign[] = rows
    .filter(
      (p) =>
        p.ownerType === "admin" ||
        sellerStatusById.get(p.manufacturerId ?? "") === "active"
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
