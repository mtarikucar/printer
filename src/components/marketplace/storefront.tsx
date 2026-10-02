"use client";

import dynamic from "next/dynamic";
import { useDictionary } from "@/lib/i18n/locale-context";
import { withProductFacts } from "@/lib/config/product-facts";
import type { NetworkMapData } from "@/lib/config/network-map";
import type { ProductListItem } from "@/components/product-card";
import { HeroCreate } from "./hero-create";
import { CategoryRibbon } from "./category-ribbon";
import { ProductRow } from "./product-row";
import { RecentlyViewed } from "./recently-viewed";
import { CustomStrip } from "./custom-strip";
import { OccasionLinks } from "@/components/occasion-links";

// 81 ilin geometrisi ~47 KB (~20 KB gz). Ayrı chunk'a alınır ki ağ verisi
// olmayan (bölümün hiç render edilmediği) ziyaretçi bunu indirmesin. SSR AÇIK
// kalır — bölüm LCP alanının altında ama içerik HTML'de bulunmalı.
const NetworkMapSection = dynamic(() =>
  import("./network-map/network-map-section").then((m) => m.NetworkMapSection)
);

export interface RootCategory {
  path: string;
  name: string;
}

// A product belongs to a root shelf via the first segment of its category path
// (e.g. "figurine/marvel" → root "figurine"), so deeply-nested products still
// surface on their top-level shelf.
function rootSegment(categoryPath: string | null): string | null {
  return categoryPath ? categoryPath.split("/")[0] : null;
}

/**
 * FİYAT ÇIPASI — anasayfanın tek alıntılanabilir rakamı.
 *
 * Ölçüm (2026-10-02): anasayfanın GÖRÜNÜR metni 1.359 karakterdi ve içinde tek
 * bir ₺ rakamı yoktu; oysa bu sayfa sitemap önceliği 1.0 olan sayfa, yani bir
 * asistanın ilk okuduğu yer. Aynı gün gerçek bir ChatGPT oturumunda "figür
 * nerede yaptırabilirim" sorusuna çıkan üç markanın üçünde de bir rakam vardı.
 *
 * Çıpa VİTRİNDEN GELMEZ: ürün listesi boş olsa da (yeni kurulum, veritabanı
 * okunamadı) yazılır — rakamın kaynağı `FIGURINE_PRICE_KURUS`, kataloğun
 * durumu değil. İki cümle de sözlükte ZATEN duruyordu ve hiçbir yerde render
 * edilmiyordu; yeni pazarlama metni yazılmadı.
 */
function FigurinePriceAnchor() {
  const d = useDictionary();
  return (
    <section className="border-b border-border-default bg-bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-center sm:flex-row sm:items-baseline sm:justify-center sm:gap-3 sm:text-left">
        <p className="text-sm font-semibold text-text-primary">
          {withProductFacts(d["landing.cta.subtitle"])}
        </p>
        <p className="text-sm text-text-secondary">
          {withProductFacts(d["landing.box.figurine.desc"])}
        </p>
      </div>
    </section>
  );
}

// The homepage IS the marketplace: category ribbon → price anchor → New
// Arrivals → one shelf per populated root category → a secondary custom strip →
// footer. The marketing story now lives on /figur + /nasil-calisir.
export function StorefrontHome({
  products,
  roots,
  networkMap,
}: {
  products: ProductListItem[];
  roots: RootCategory[];
  /** null → ağ verisi çekilemedi ya da hiç partner yok; bölüm çizilmez. */
  networkMap: NetworkMapData | null;
}) {
  const d = useDictionary();

  const newest = products.slice(0, 10);
  const populatedRoots = roots.filter((r) =>
    products.some((p) => rootSegment(p.categoryPath) === r.path)
  );

  return (
    <>
      {/* Category ribbon sits up top (right under the nav), then the
          photo→figurine hero, then the marketplace shelves. */}
      <CategoryRibbon categories={roots} />
      <HeroCreate />
      <FigurinePriceAnchor />
      <ProductRow
        title={d["store.row.new"]}
        products={newest}
        viewAllHref="/shop?sort=newest"
      />
      <RecentlyViewed />
      {populatedRoots.map((r) => (
        <ProductRow
          key={r.path}
          title={r.name}
          products={products
            .filter((p) => rootSegment(p.categoryPath) === r.path)
            .slice(0, 5)}
          viewAllHref={`/shop?category=${encodeURIComponent(r.path)}`}
        />
      ))}
      {networkMap && networkMap.partners.length > 0 && (
        <NetworkMapSection data={networkMap} />
      )}
      {/* ALTI ÖZEL GÜN SAYFASINA İÇ BAĞLANTI. Yalnız sitemap'ten erişilen
          sayfa zayıftır: keşfedilse de sitenin kendi ağırlığından pay almaz.
          Bağlantı sitemap önceliği 1.0 olan sayfadan veriliyor. Blok vitrinden
          BAĞIMSIZ — ürün listesi boş olsa da çizilir, çünkü metni sözlükten
          geliyor (`landing.useCases.*`, V3'e kadar hiçbir yerde render
          edilmiyordu). */}
      <OccasionLinks d={d} />
      <CustomStrip />
    </>
  );
}
