/**
 * ÖZEL GÜN SAYFALARININ KAYIT DEFTERİ — `/hediye/<slug>`.
 *
 * Neden altı ayrı URL: insanlar bir asistana "figürün üreticisi kim" diye
 * sormuyor; "sevgiliye ne hediye alabilirim", "doğum gününe özel hediye" diye
 * soruyor. Ölçümün kuralı (2026-10-02) açık — her niyet için AYRI URL. Tek bir
 * sayfanın içindeki altı paragraf altı ayrı giriş kapısı etmez: asistan hangi
 * niyete hangi belgeyi döndüreceğini URL düzeyinde ayırıyor.
 *
 * ALTI DOSYA KOPYALANMADI. Burada yalnız veri var; sayfanın kendisi tek bir
 * dinamik rota (`src/app/hediye/[occasion]/page.tsx`) ve tek bir bileşen
 * (`occasion-page.tsx`). Yeni bir özel gün eklemek = buraya BİR satır + iki
 * sözlük anahtarı + `page-updated.ts`e bir tarih. `sitemap.ts` ve anasayfa /
 * `/figur` iç bağlantıları bu listeden TÜRÜYOR, yani bir slug eklendiğinde
 * hiçbir yer elle güncellenmez.
 *
 * METİN BURADA YAZILMADI. `landing.useCases.*` anahtarları (altı başlık + altı
 * açıklama, iki dilde) sözlükte zaten yazılıydı ve
 * `components/figurunica/dict.ts`in izin listesinde olmadıkları için HİÇBİR
 * YER onları render etmiyordu (denetim 2026-10-02: depo genelinde sıfır çağrı
 * yeri). Bu dosya o ölü metni bir URL'e bağlar; yeni pazarlama cümlesi yazmaz.
 *
 * Anahtar adları "useCases" (eski landing bölümünün adı) — BİLEREK
 * DEĞİŞTİRİLMEDİ: anahtarı yeniden adlandırmak iki dilde on iki satırı
 * dokunulmuş gösterir ve bu sevkiyatın işi metni taşımak değil YAYINLAMAK.
 *
 * SAF MODÜL: hiçbir import'u yok, `import "server-only"` de yok — BullMQ
 * worker'ı order-draft.ts üzerinden `src/lib/config/**`e ulaşıyor ve
 * `server-only` standalone-Node worker'ını crash-loop'a sokar
 * ([[worker-server-only-trap]]). Sözlük tipi (`Dictionary`) de İTHAL EDİLMEZ:
 * `product-facts.ts` ve `seo/figurine.ts` ile aynı gerekçe — bu dizin sözlük
 * modülüne bağlı olmamalı, bu yüzden okuyucu taraf YAPISAL bir tip alır
 * (`OccasionDict`). Tip kapısı yine kurulu: çağıran gerçek bir `Dictionary`
 * geçiyor ve anahtar sözlükte yoksa atama derlenmez.
 */

/**
 * Kaydın ŞEKLİ — yalnız denetim için.
 *
 * Okuyucu taraf bunu değil `Occasion`ı kullanır: anahtar adları LİTERAL
 * tipte kalmak zorunda, yoksa `d[occasion.titleKey]` sözlüğü indeksleyemez
 * (TS7053) ve tip kapısı — "anahtar sözlükte var mı" sorusu — tamamen
 * kaybolurdu.
 */
interface OccasionShape {
  /** URL segmenti. Türkçe ve okunabilir, ama ASCII — yüzde-kaçışa düşmesin. */
  slug: string;
  /** Özel günün GÖRÜNEN adı ("Doğum Günü Hediyesi"). */
  titleKey: string;
  /** Özel günün kendi tek cümlelik açıklaması. */
  descKey: string;
}

/**
 * Altı özel gün. Sıra sayfalarda ve sitemap'te GÖRÜNEN sıradır.
 *
 * `as const satisfies`: `satisfies` şekli denetler, `as const` slug ve anahtar
 * adlarını LİTERAL tipte tutar — `OccasionDict` tam o anahtarlardan türüyor,
 * yani kayda yeni bir anahtar girdiği anda derleyici sözlükte karşılığını arar.
 */
export const OCCASIONS = [
  {
    slug: "dogum-gunu",
    titleKey: "landing.useCases.birthday",
    descKey: "landing.useCases.birthday.desc",
  },
  {
    slug: "sevgiliye",
    titleKey: "landing.useCases.love",
    descKey: "landing.useCases.love.desc",
  },
  {
    slug: "evcil-hayvan",
    titleKey: "landing.useCases.pet",
    descKey: "landing.useCases.pet.desc",
  },
  {
    // Sözlük anahtarı "gaming", slug "oyun-karakteri": anahtar adı eski
    // bölümden geliyor, URL ise Türkçe arama niyetinin yazıldığı hâli.
    slug: "oyun-karakteri",
    titleKey: "landing.useCases.gaming",
    descKey: "landing.useCases.gaming.desc",
  },
  {
    slug: "aile-hatirasi",
    titleKey: "landing.useCases.family",
    descKey: "landing.useCases.family.desc",
  },
  {
    slug: "mezuniyet",
    titleKey: "landing.useCases.graduation",
    descKey: "landing.useCases.graduation.desc",
  },
] as const satisfies readonly OccasionShape[];

/** Bir kayıt satırı — anahtar adları literal, bkz. `OccasionShape`. */
export type Occasion = (typeof OCCASIONS)[number];

/**
 * Bağlantı bloğunun bölüm başlığı ve alt başlığı.
 *
 * Bu iki anahtar da sözlükte yazılı ve ölüydü ("Her An İçin Mükemmel Hediye" /
 * "Asla unutamayacakları, gerçekten kişisel bir hediye"). Anasayfa ve `/figur`
 * altı sayfaya bağlanırken aynı bloğu çiziyor.
 */
export const OCCASION_SECTION_KEYS = [
  "landing.useCases.title",
  "landing.useCases.subtitle",
] as const;

/** Okuyucu tarafın sözlükten istediği alanlar — YAPISAL tip (bkz. başlık). */
export type OccasionDictKey =
  | (typeof OCCASIONS)[number]["titleKey"]
  | (typeof OCCASIONS)[number]["descKey"]
  | (typeof OCCASION_SECTION_KEYS)[number];

export type OccasionDict = Record<OccasionDictKey, string>;

/** `/hediye/dogum-gunu`. Sitemap, `PAGE_UPDATED_AT` ve bağlantılar aynı yazımı kullanır. */
export function occasionPath(slug: string): string {
  return `/hediye/${slug}`;
}

/**
 * Slug → kayıt, yoksa `null`.
 *
 * Eşleşme TAM ve büyük/küçük harfe DUYARLI: `/hediye/Dogum-Gunu` ayrı bir URL
 * olurdu ve aynı içeriği iki adreste yayınlamak kanonikleştirmeyi bölerdi.
 * Yanlış yazımı sessizce düzeltmek yerine çağıran taraf 404 veriyor (bkz.
 * `occasionOrNotFound`).
 */
export function findOccasion(slug: string): Occasion | null {
  return OCCASIONS.find((o) => o.slug === slug) ?? null;
}
