"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import { pickFigurunicaDict } from "@/components/figurunica/dict";
import { TrustSignals, FigFooter } from "@/components/figurunica/sections";
import type { ProductListItem } from "@/components/product-card";
import { DualPathHero } from "./dual-path-hero";
import { FeaturedStrip } from "./featured-strip";
import { CategoryShowcase } from "./category-showcase";
import { ProductionPathsBand } from "./production-paths-band";
import { MarketCta } from "./market-cta";

// Marketplace-first homepage: two equal entry points (browse the shop / create
// custom), then featured products, categories, the production capabilities, and
// reused honest trust + footer from the figurine landing.
export function MarketplaceLanding({ featured }: { featured: ProductListItem[] }) {
  const d = useDictionary();
  const fig = pickFigurunicaDict(d);

  return (
    <>
      <DualPathHero />
      <FeaturedStrip products={featured} />
      <CategoryShowcase />
      <ProductionPathsBand />
      <TrustSignals d={fig} />
      <MarketCta />
      <FigFooter d={fig} />
    </>
  );
}
