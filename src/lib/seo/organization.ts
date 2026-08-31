/**
 * Site geneli Organization + WebSite JSON-LD (`@graph`).
 *
 * Yalnızca root layout'ta, TAM BİR KEZ yayınlanır. Sayfa bazlı entity'ler
 * (Product, BreadcrumbList) buraya girmez.
 *
 * Bağlayıcı kararlar:
 *  - Tip `OnlineStore` (Organization → OnlineBusiness → OnlineStore).
 *    `LocalBusiness` DEĞİL: o fiziksel bir şube gerektirir ve Google'ın
 *    self-serving review politikası nedeniyle yıldız özelliğine uygun değildir.
 *  - `aggregateRating` YOK. Google: "If the entity that's being reviewed
 *    controls the reviews about itself, their pages that use LocalBusiness or
 *    any other type of Organization structured data are ineligible for the star
 *    review feature."
 *  - `WebSite` altında `potentialAction`/`SearchAction` YOK: Google sitelinks
 *    searchbox'ı 2024-11-21'de global olarak kapattı.
 *  - `logo`/`image` YOK: elimizde gerçek bir logo dosyası yok. Uydurma bir yol
 *    yazmak yerine alan tamamen atlanıyor (`public/` altında yalnızca maskot
 *    görselleri ve `favicon.ico` var). Gerçek logo eklendiğinde buraya `logo`
 *    alanı gelmeli.
 *  - Kuruluş yılı, çalışan sayısı, ticaret sicil/MERSİS/ETBİS numarası gibi
 *    doğrulanamayan hiçbir alan doldurulmaz.
 */
import {
  BUSINESS_ADDRESS,
  BUSINESS_AREA_SERVED,
  BUSINESS_LEGAL_NAME,
  BUSINESS_TAX_ID,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  SOCIAL_PROFILES,
} from "@/lib/config/business-identity";

/**
 * Yalnızca doğrulanabilir gerçekler: fotoğraftan kişiye özel 3D figür, SLA
 * reçine baskı, profesyonel el boyaması, Türkiye geneline kargo.
 */
export const BUSINESS_DESCRIPTION =
  "Figurunica, müşterinin yüklediği fotoğraftan kişiye özel 3D figür üretir: " +
  "SLA reçine baskı, profesyonel el boyaması ve Türkiye geneline kargo.";

export interface PostalAddressNode {
  "@type": "PostalAddress";
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
}

export interface OnlineStoreNode {
  "@type": "OnlineStore";
  "@id": string;
  name: string;
  legalName: string;
  url: string;
  description: string;
  email: string;
  telephone: string;
  /** VKN. schema.org'un Türkiye vergi kimliği için önerdiği alan. */
  vatID: string;
  address: PostalAddressNode;
  contactPoint: {
    "@type": "ContactPoint";
    telephone: string;
    email: string;
    contactType: string;
    availableLanguage: string;
    areaServed: string;
  };
  sameAs: string[];
}

export interface WebSiteNode {
  "@type": "WebSite";
  "@id": string;
  url: string;
  name: string;
  publisher: { "@id": string };
  inLanguage: string;
}

export interface SiteJsonLdGraph {
  "@context": "https://schema.org";
  "@graph": [OnlineStoreNode, WebSiteNode];
}

/** Repo geneli desen: env yoksa apex alan adına düş. */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
}

/**
 * Root layout'ın gömdüğü `@graph`. Node'lar `@id` ile birbirini referanslar, bu
 * sayede ileride eklenecek Product/Breadcrumb node'ları aynı kuruluşa
 * bağlanabilir.
 */
export function buildOrganizationJsonLd(
  appUrl: string = getAppUrl()
): SiteJsonLdGraph {
  const organizationId = `${appUrl}/#organization`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OnlineStore",
        "@id": organizationId,
        name: BUSINESS_LEGAL_NAME,
        legalName: BUSINESS_LEGAL_NAME,
        url: appUrl,
        description: BUSINESS_DESCRIPTION,
        email: CONTACT_EMAIL,
        telephone: CONTACT_PHONE_DISPLAY,
        vatID: BUSINESS_TAX_ID,
        address: { "@type": "PostalAddress", ...BUSINESS_ADDRESS },
        contactPoint: {
          "@type": "ContactPoint",
          telephone: CONTACT_PHONE_DISPLAY,
          email: CONTACT_EMAIL,
          contactType: "customer service",
          availableLanguage: "Turkish",
          areaServed: BUSINESS_AREA_SERVED,
        },
        sameAs: [...SOCIAL_PROFILES],
      },
      {
        "@type": "WebSite",
        "@id": `${appUrl}/#website`,
        url: appUrl,
        name: BUSINESS_LEGAL_NAME,
        publisher: { "@id": organizationId },
        inLanguage: "tr-TR",
      },
    ],
  };
}
