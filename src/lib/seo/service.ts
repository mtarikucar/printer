/**
 * `/3d-baski` sayfasının `Service` JSON-LD'si.
 *
 * Neden ayrı bir builder: `Organization` kök düzende bir kez yayınlanır,
 * `Product` pazaryeri ürününü anlatır; anlık teklif motoru ise bir HİZMETTİR
 * (sipariş üzerine üretim). Fiyatı `AggregateOffer` taşır çünkü tek bir fiyat
 * yoktur: teknoloji ve malzemeye göre değişen bir aralığın ALT UCU
 * yayımlanır — sayfada gösterilen "₺X'den başlayan" çapasının aynısı.
 *
 * Rakamlar katalogdan gelir (`pricing-anchors`), elle yazılmaz: yapısal veride
 * sayfada görünmeyen bir fiyat yayımlamak hem Google'ın "markup must match
 * visible content" kuralına aykırıdır hem de bayatlar.
 */
import { BUSINESS_AREA_SERVED, BUSINESS_LEGAL_NAME } from "@/lib/config/business-identity";
import type { PricingSnapshot } from "@/lib/config/quote-types";
import {
  ANCHOR_BASIS_TR,
  anchorJsonPrice,
  catalogAnchorKurus,
  technologyAnchorKurus,
} from "@/app/3d-baski/pricing-anchors";
import { getAppUrl } from "./organization";

const CURRENCY = "TRY";

export function buildPrintServiceJsonLd(
  snapshot: PricingSnapshot,
  appUrl: string = getAppUrl()
): Record<string, unknown> {
  const url = `${appUrl}/3d-baski`;
  const lowest = catalogAnchorKurus(snapshot);

  const offers = snapshot.technologies.flatMap((tech) => {
    const kurus = technologyAnchorKurus(snapshot, tech.key);
    if (kurus === null) return [];
    return [
      {
        "@type": "Offer",
        name: tech.name,
        url: `${url}#${tech.key}`,
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: anchorJsonPrice(kurus),
          priceCurrency: CURRENCY,
          valueAddedTaxIncluded: true,
          description: ANCHOR_BASIS_TR,
        },
        itemOffered: {
          "@type": "Service",
          name: tech.name,
          description: tech.description,
        },
      },
    ];
  });

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#service`,
    name: "Anlık 3D baskı teklifi",
    serviceType: "3D baskı hizmeti",
    url,
    description:
      "STL, OBJ, 3MF veya STEP dosyanızı yükleyin; ölçü, üretilebilirlik kontrolü ve " +
      "fiyat anında çıksın. FDM ve SLA baskı, Türkiye genelinde üretim ortağı ağıyla.",
    provider: { "@id": `${appUrl}/#organization` },
    brand: { "@type": "Brand", name: BUSINESS_LEGAL_NAME },
    areaServed: BUSINESS_AREA_SERVED,
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: url,
      availableLanguage: "tr-TR",
    },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: CURRENCY,
      ...(lowest === null ? {} : { lowPrice: anchorJsonPrice(lowest) }),
      offerCount: offers.length,
      offers,
    },
  };
}
