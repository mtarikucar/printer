import { getAppUrl } from "./organization";
import { BUSINESS_LEGAL_NAME } from "@/lib/config/business-identity";

/**
 * Product / Offer / BreadcrumbList JSON-LD for a marketplace product page.
 *
 * Decisions that are NOT free choices — each one is a Google requirement or a
 * documented limitation:
 *
 *  - `availability: InStock`. These are made-to-order prints, so
 *    `MadeToOrder` would be the honest schema.org term, but Google's merchant
 *    documentation does not support it and an unsupported value makes the whole
 *    offer ineligible. `InStock` plus a truthful `deliveryTime` (the product's
 *    own lead time) says the same thing in terms Google reads.
 *  - `priceValidUntil` is ROLLING, computed at render time. A fixed date in the
 *    past silently drops the offer from rich results, and that is the single
 *    most common way this markup rots.
 *  - `aggregateRating` is emitted ONLY when there are approved reviews AND the
 *    page renders them. Google requires the rating to be visible in the page
 *    content; the product page renders reviews server-side for exactly this
 *    reason. Note this is a PRODUCT rating from verified buyers — distinct from
 *    a self-serving rating of the business itself, which is why the
 *    Organization node deliberately carries no rating.
 *  - `hasMerchantReturnPolicy` is 14 days: these are ready-made catalogue goods
 *    under the ordinary distance-selling withdrawal right. The personalised
 *    figurine is NOT sold through this page and is governed separately.
 */

export interface ProductJsonLdInput {
  slug: string;
  title: string;
  description: string;
  priceKurus: number;
  images: string[];
  sellerName: string | null;
  material: string | null;
  leadTimeDays: number | null;
  ratingAvg: number;
  ratingCount: number;
  categoryName: string | null;
  categoryPath: string | null;
}

const CURRENCY = "TRY";
const RETURN_WINDOW_DAYS = 14;
/** How long a listed price is asserted to hold. Rolling, never a literal date. */
const PRICE_VALID_DAYS = 90;

function isoDateInDays(days: number, now: number): string {
  return new Date(now + days * 86_400_000).toISOString().slice(0, 10);
}

export function buildProductJsonLd(
  p: ProductJsonLdInput,
  nowMs: number = Date.now()
): Record<string, unknown> {
  const appUrl = getAppUrl();
  const url = `${appUrl}/shop/${p.slug}`;
  const leadTime = p.leadTimeDays ?? 7;

  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    description: p.description,
    url,
    ...(p.images.length > 0 ? { image: p.images } : {}),
    ...(p.material ? { material: p.material } : {}),
    ...(p.categoryName ? { category: p.categoryName } : {}),
    brand: { "@type": "Brand", name: p.sellerName || BUSINESS_LEGAL_NAME },
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: CURRENCY,
      // schema.org wants a decimal string, and kuruş are integers.
      price: (p.priceKurus / 100).toFixed(2),
      priceValidUntil: isoDateInDays(PRICE_VALID_DAYS, nowMs),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: BUSINESS_LEGAL_NAME },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "TR",
        returnPolicyCategory:
          "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: RETURN_WINDOW_DAYS,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: {
          "@type": "MonetaryAmount",
          value: "0",
          currency: CURRENCY,
        },
        shippingDestination: {
          "@type": "DefinedRegion",
          addressCountry: "TR",
        },
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: {
            "@type": "QuantitativeValue",
            minValue: 1,
            maxValue: leadTime,
            unitCode: "DAY",
          },
          transitTime: {
            "@type": "QuantitativeValue",
            minValue: 1,
            maxValue: 3,
            unitCode: "DAY",
          },
        },
      },
    },
  };

  // Only when the page actually shows them.
  if (p.ratingCount > 0 && p.ratingAvg > 0) {
    node.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: p.ratingAvg.toFixed(1),
      reviewCount: p.ratingCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return node;
}

/**
 * Breadcrumb for the product page. Mirrors the visible "back to shop" path, so
 * the markup describes navigation the reader can actually see.
 */
export function buildProductBreadcrumbJsonLd(p: {
  slug: string;
  title: string;
  categoryName: string | null;
  categoryPath: string | null;
}): Record<string, unknown> {
  const appUrl = getAppUrl();
  const items: Array<Record<string, unknown>> = [
    { "@type": "ListItem", position: 1, name: "Mağaza", item: `${appUrl}/shop` },
  ];
  if (p.categoryName && p.categoryPath) {
    items.push({
      "@type": "ListItem",
      position: items.length + 1,
      name: p.categoryName,
      item: `${appUrl}/shop?category=${encodeURIComponent(p.categoryPath)}`,
    });
  }
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: p.title,
    item: `${appUrl}/shop/${p.slug}`,
  });
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}
