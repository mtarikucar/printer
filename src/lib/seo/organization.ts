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
 *    Ayrı bir `LocalBusiness` düğümü ÜRETİLEBİLİR ama bir KAPININ ARKASINDA
 *    duruyor (`buildLocalBusinessNode`): Maps kaydı gelmeden emitlenmez.
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
  BUSINESS_MAPS_PROFILE_URL,
  BUSINESS_TAX_ID,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  businessSameAs,
} from "@/lib/config/business-identity";
import { FIGURINE_PRICE_KURUS } from "@/lib/config/prices";
import { formatCurrency } from "@/lib/i18n/format";

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

/**
 * Fiziksel işletme düğümü — Maps kaydı GELMEDEN emitlenmez.
 *
 * Alan seçimi dar ve bilerek: `openingHours`, `geo`, `logo` ve kuruluş yılı
 * YOK çünkü hiçbirinin doğrulanmış karşılığı yok. `priceRange` istisnadır —
 * figürin TEK fiyatlı ve rakam `FIGURINE_PRICE_KURUS`tan geliyor.
 */
export interface LocalBusinessNode {
  "@type": "LocalBusiness";
  "@id": string;
  name: string;
  url: string;
  description: string;
  email: string;
  telephone: string;
  address: PostalAddressNode;
  areaServed: string;
  priceRange: string;
  /** Maps kaydı dâhil — eşleşmenin site tarafı. */
  sameAs: string[];
  /** Aynı ada ve adrese sahip iki düğüm BAĞLANMAZSA iki işletme gibi görünür. */
  parentOrganization: { "@id": string };
}

export interface SiteJsonLdGraph {
  "@context": "https://schema.org";
  /**
   * Üçüncü düğüm (`LocalBusiness`) KOŞULLU: Maps kaydı yoksa graf iki
   * düğümlüdür. Tip bunu tuple + yayılım ile söylüyor, yani `[0]`/`[1]`
   * okumaları hâlâ daralmış tipte kalıyor.
   */
  "@graph": [OnlineStoreNode, WebSiteNode, ...LocalBusinessNode[]];
}

/**
 * Repo geneli desen: env yoksa apex alan adına düş.
 *
 * `||` (`??` DEĞİL) kasıtlı: `NEXT_PUBLIC_APP_URL=""` boş dizgi de env
 * "ayarlanmış" sayılır ve `??` bunu geçerli kabul eder — sonuç `url: ""` ve
 * bozuk bir `@id: "/#organization"` olurdu. Sondaki `/`'ler de kırpılır:
 * aksi halde `@id: "…com//#organization"` gibi çift eğik çizgili bir kimlik
 * üretilir. Bu alanlar yayınlanan entity kimliği — bozuk olması arama
 * motorlarının entity çözümlemesini kırar.
 */
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://figurunica.com").replace(
    /\/+$/,
    ""
  );
}

/**
 * `LocalBusiness` düğümü — Maps kaydı YOKSA `null`.
 *
 * NEDEN BİR KAPI ARKASINDA. Adresi ve hizmet alanını iddia eden bir
 * `LocalBusiness`, karşılığında bir işletme kaydı yokken güvenilirlik
 * kazandırmaz: eşleşecek bir kayıt olmadan "burada bir dükkân var" demek boş
 * bir iddiadır ve yıldızlı işletme bloğuna da sokmaz (o blok kayıttan gelir,
 * site metninden değil — `docs/google-business-profile.md`). Kayıt açıldığı gün
 * `BUSINESS_MAPS_PROFILE_URL` dolar ve düğüm kendiliğinden yayına girer.
 *
 * `@id` AYRI (`#localbusiness`): `#organization` ile çakışsaydı iki farklı
 * tipte tek bir kimlik yayınlanmış olurdu. `parentOrganization` ikisini
 * bağlıyor, yoksa aynı ada ve adrese sahip iki düğüm iki ayrı işletme gibi
 * görünür.
 *
 * BEKLEYEN ALANLAR (sahipten): kuruluş yılı → `foundingDate`, tam yasal unvan
 * (`Ltd. Şti.` / `A.Ş.` / şahıs şirketi) → `legalName`. İkisi de
 * `docs/google-business-profile.md` §1'de "SENDEN" diye işaretli; gelmeden
 * yazılmaz. Aynı şekilde `openingHours` (atölyenin ziyarete açık saati yok),
 * `geo` (ölçülmüş koordinat yok) ve `logo` (gerçek dosya yok) de uydurulmaz.
 */
export function buildLocalBusinessNode(
  appUrl: string = getAppUrl(),
  mapsProfileUrl: string | null = BUSINESS_MAPS_PROFILE_URL
): LocalBusinessNode | null {
  if (!mapsProfileUrl) return null;

  return {
    "@type": "LocalBusiness",
    "@id": `${appUrl}/#localbusiness`,
    name: BUSINESS_LEGAL_NAME,
    url: appUrl,
    description: BUSINESS_DESCRIPTION,
    email: CONTACT_EMAIL,
    telephone: CONTACT_PHONE_DISPLAY,
    address: { "@type": "PostalAddress", ...BUSINESS_ADDRESS },
    // Hizmet alanı ÜLKE, şehir değil: kargo Türkiye genelinedir ve kayıt da
    // "hizmet bölgesi olan işletme" olarak açılıyor. "Ankara'da bir dükkân"
    // gibi görünmek, Ankara dışındaki sorularda hiç çıkmamak demek.
    areaServed: BUSINESS_AREA_SERVED,
    // Tek fiyatlı ürün: aralık değil, fiyatın kendisi. Rakam sabitten gelir ve
    // biçimlendirme depodaki tek para biçimlendiricisiyle yapılır.
    priceRange: formatCurrency(FIGURINE_PRICE_KURUS, "tr"),
    sameAs: businessSameAs(mapsProfileUrl),
    parentOrganization: { "@id": `${appUrl}/#organization` },
  };
}

/**
 * Root layout'ın gömdüğü `@graph`. Node'lar `@id` ile birbirini referanslar, bu
 * sayede ileride eklenecek Product/Breadcrumb node'ları aynı kuruluşa
 * bağlanabilir.
 *
 * `mapsProfileUrl` bir PARAMETRE: değer bugün `null` olan bir sabitten gelir ve
 * kapının açık hâli ancak böyle sınanabilir (bkz. `buildLocalBusinessNode`).
 */
export function buildOrganizationJsonLd(
  appUrl: string = getAppUrl(),
  mapsProfileUrl: string | null = BUSINESS_MAPS_PROFILE_URL
): SiteJsonLdGraph {
  const organizationId = `${appUrl}/#organization`;
  const localBusiness = buildLocalBusinessNode(appUrl, mapsProfileUrl);

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
        sameAs: businessSameAs(mapsProfileUrl),
      },
      {
        "@type": "WebSite",
        "@id": `${appUrl}/#website`,
        url: appUrl,
        name: BUSINESS_LEGAL_NAME,
        publisher: { "@id": organizationId },
        inLanguage: "tr-TR",
      },
      // Koşullu üçüncü düğüm: Maps kaydı yokken liste iki düğümde kalır.
      ...(localBusiness ? [localBusiness] : []),
    ],
  };
}
