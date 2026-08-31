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

export const BUSINESS_ADDRESS = {
  streetAddress: "Şehit Osman Avcı Mahallesi, Akın 688 Sitesi B32",
  addressLocality: "Etimesgut",
  addressRegion: "Ankara",
  postalCode: "06820",
  addressCountry: "TR",
} as const;

/**
 * Yasal sayfalarda gösterilen tek satırlık adres — posta kodu DAHİL.
 * `contact.ts`'teki `CONTACT_ADDRESS_FULL` posta kodu içermez ve footer/harita
 * bağlantısı için orada kalır; yasal kimlik blokları bunu kullanır.
 */
export const BUSINESS_ADDRESS_FULL = `${BUSINESS_ADDRESS.streetAddress}, ${BUSINESS_ADDRESS.postalCode} ${BUSINESS_ADDRESS.addressLocality} / ${BUSINESS_ADDRESS.addressRegion}`;

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
