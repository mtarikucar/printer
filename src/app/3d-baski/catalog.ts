import { cache } from "react";
import { SEED_SNAPSHOT } from "@/lib/config/quote-seed";
import type { PricingSnapshot } from "@/lib/config/quote-types";
import { loadActiveSnapshot } from "@/lib/services/quote-catalog";

/**
 * Açılış ve malzeme sayfalarının katalog okuması.
 *
 * İki kural var ve ikisi de bu tek fonksiyonda duruyor:
 *
 *  1. **DB'siz derleme.** `next build` bu sayfaları önceden çizmeye çalışır ve
 *     CI'da veritabanı yoktur. Okuma patlarsa tohum katalog (`SEED_SNAPSHOT`)
 *     devreye girer: sayfa YAYINLANIR, rakamları SQL tohumuyla birebir aynıdır
 *     (parite `scripts/test-quote-service-db.ts`'te çivili). Bir vitrin sayfası
 *     veritabanı yok diye 500 vermemeli.
 *  2. **İstek başına tek okuma.** `generateMetadata` ve sayfanın kendisi aynı
 *     kataloğu ister; `cache` ikisini tek sorguya indirir.
 */
export const loadLandingSnapshot = cache(async (): Promise<PricingSnapshot> => {
  try {
    return await loadActiveSnapshot();
  } catch (err) {
    console.warn("[3d-baski] katalog okunamadı; tohum kataloğa düşüldü:", err);
    return SEED_SNAPSHOT;
  }
});
