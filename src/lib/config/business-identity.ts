/**
 * Yasal + makine tarafından okunabilir işletme kimliği. TEK KAYNAK.
 *
 * `contact.ts` iletişim kanallarını (telefon, e-posta, WhatsApp, harita) tutar;
 * bu modül onu SİLMEZ/yeniden yazmaz, tamamlar. Burada yalnızca kimlik ve yasal
 * alanlar var; ortak alanlar (e-posta, telefon) tekrar edilmez, `contact.ts`'ten
 * alınıp buradan yeniden dışa aktarılır ki tüketiciler tek modülden okusun.
 *
 * Tüketicileri: yasal sayfalar (mesafeli satış, ön bilgilendirme, ticari ileti),
 * footer sosyal bağlantıları ve `@/lib/seo/organization` JSON-LD üreticisi.
 *
 * `src/lib/config/*` altında `import "server-only"` YASAK: BullMQ worker'ları bu
 * dizine ulaşıyor ve standalone Node worker crash-loop'a giriyor.
 */
import { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY } from "./contact";

/** Ticari unvan (sözleşme/faturada görünen ad). */
export const BUSINESS_LEGAL_NAME = "Figurunica";

/** Vergi kimlik numarası (VKN). 6563 sayılı kanun sitede bulunmasını gerektirir. */
export const BUSINESS_TAX_ID = "8841014310";

/**
 * Bilerek YOK: MERSİS ve ETBİS kayıt numaraları. Sahibi 2026-08-31'de ikisinin
 * de henüz bulunmadığını bildirdi. Bunları UYDURMA ve gerçek bir numara
 * verilene kadar yasal sayfalara ETBİS kaydı iddiasını GERİ EKLEME — bkz.
 * `src/app/mesafeli-satis/page.tsx` içindeki kaldırma notu.
 */

/**
 * Sokak adresinin iki satırı. ADRESİN ELLE YAZILI TEK YERİ burasıdır; aşağıdaki
 * her biçim (yapısal adres, tek satır, satır listesi, harita sorgusu) bundan
 * TÜRÜR. `scripts/test-business-identity.ts` "adres metni depoda TEK yerde
 * yazılı" iddiasıyla bunu çiviliyor.
 */
const ADDRESS_STREET_LINES = [
  "Şehit Osman Avcı Mahallesi",
  "Akın 688 Sitesi B32",
] as const;

export const BUSINESS_ADDRESS = {
  streetAddress: ADDRESS_STREET_LINES.join(", "),
  addressLocality: "Etimesgut",
  addressRegion: "Ankara",
  postalCode: "06820",
  addressCountry: "TR",
} as const;

/** Posta kodu + ilçe / il — adresin son satırı. */
const ADDRESS_LOCALITY_LINE = `${BUSINESS_ADDRESS.postalCode} ${BUSINESS_ADDRESS.addressLocality} / ${BUSINESS_ADDRESS.addressRegion}`;

/**
 * Adresin satır satır hâli (`/contact` sayfasındaki `<address>` bloğu).
 *
 * 2026-10-02'ye kadar bunun `contact.ts`'te posta kodu TAŞIMAYAN bir ikizi
 * vardı: yasal sayfalar `06820`li adresi, her sayfanın footer'ı ve `/contact`
 * ise posta kodsuz olanı gösteriyordu. Bir harita/işletme eşleştiricisinin
 * okuduğu NAP bloğu (isim-adres-telefon) tam olarak footer'daki o eksik hâldi,
 * yani site ile işletme kaydının aynı varlık sayılması zorlaşıyordu. İkiz
 * KALDIRILDI; her yüzey artık aynı dizgiyi basıyor.
 */
export const BUSINESS_ADDRESS_LINES = [
  ...ADDRESS_STREET_LINES,
  ADDRESS_LOCALITY_LINE,
] as const;

/** Tek satırlık adres — yasal sayfalar, belgeler ve footer aynısını basar. */
export const BUSINESS_ADDRESS_FULL = BUSINESS_ADDRESS_LINES.join(", ");

/**
 * Haritada "burayı ara" bağlantısı. Sorgu adresin KENDİSİNDEN türüyor (posta
 * kodu dâhil): elle yazılmış bir sorgu, adres değiştiği gün haritada başka bir
 * yeri gösterirdi — eski `CONTACT_MAPS_URL` tam olarak böyle posta kodsuz
 * kalmıştı.
 *
 * Sorguda `/` YOK: ilçe ile il virgülle ayrılıyor (`… 06820 Etimesgut, Ankara`),
 * çünkü bu alan bir coğrafi kodlayıcıya gidiyor ve virgül onun beklediği posta
 * biçimi. Görüntülenen adres (`BUSINESS_ADDRESS_FULL`) "Etimesgut / Ankara"
 * yazımını KORUYOR — o yazım sayfalarda bugüne kadar görünen hâl.
 *
 * Bu bir ARAMA bağlantısıdır, bir işletme kaydı değil — karşılığında bir Google
 * Business Profile kaydı YOK (bkz. `BUSINESS_MAPS_PROFILE_URL`).
 */
export const BUSINESS_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent(
    `${BUSINESS_ADDRESS.streetAddress}, ${BUSINESS_ADDRESS.postalCode} ` +
      `${BUSINESS_ADDRESS.addressLocality}, ${BUSINESS_ADDRESS.addressRegion}`
  );

/** Herkese açık sosyal profiller — schema.org `sameAs` bunlardan türetilir. */
export const SOCIAL_PROFILES = [
  "https://www.instagram.com/figurunica",
  "https://www.tiktok.com/@figurunica",
] as const;

/**
 * Footer'da gösterilecek sosyal bağlantılar. `sameAs` sinyalinin karşılığı
 * olması için bağlantıların sitede gerçekten görünür olması gerekiyor, bu yüzden
 * etiketler de URL'lerle aynı yerden türetiliyor.
 */
export const SOCIAL_LINKS = [
  { label: "Instagram", href: SOCIAL_PROFILES[0] },
  { label: "TikTok", href: SOCIAL_PROFILES[1] },
] as const;

/** Hizmet verilen ülke, ISO 3166-1 alpha-2. */
export const BUSINESS_AREA_SERVED = "TR";

export { CONTACT_EMAIL, CONTACT_PHONE_DISPLAY };
