/**
 * Mesafeli sözleşme ön bilgilendirme onayı — sürüm damgaları ve kapsam kuralı.
 *
 * MSY m.6/2-a, tüketicinin ödeme yükümlülüğüne girmeden HEMEN ÖNCE şunların bir
 * bütün olarak gösterilmesini şart koşar: ürünün temel nitelikleri, vergiler
 * dâhil toplam fiyat, cayma şartları ve —varsa— cayma hakkının bulunmadığı
 * bilgisi. m.7'ye göre bu yapılmazsa "sözleşme kurulmamış sayılır"; yani eksik
 * ön bilgilendirme, kişiye özel ürünlerdeki cayma istisnasını da düşürür.
 *
 * İspat yükü satıcıdadır (MSY m.5/6, m.10/1, TKHK m.48/2). Yargıtay 13. HD'nin
 * yerleşik hattı, satıcının "ön bilgilendirme yaptığına ilişkin BELGE
 * sunmaması"nı tek başına bozma sebebi sayar (E.2016/29554, E.2016/28878,
 * E.2017/3711). Bu yüzden onay yalnızca UI'da gösterilmez; damgası siparişe
 * yazılır ve hangi metin sürümünün kabul edildiği saklanır.
 *
 * Bu dosya bir BullMQ worker'ın (order-draft.ts üzerinden) ulaştığı yoldadır —
 * `import "server-only"` EKLEMEYİN, standalone Node worker'ı çökertir.
 */

/**
 * Ön Bilgilendirme Formu (`/on-bilgilendirme`) metin sürümü.
 *
 * Sürüm etiketi tek başına belge değildir: MSY m.20/1 "her bir işleme ilişkin
 * bilgi ve belgeyi üç yıl saklama" yükümlülüğü getirir. Bu yüzden sürüm
 * yükseltilirken ESKİ metin git geçmişinde kalır — sipariş, kabul edildiği
 * andaki sürüme bağlı kalır ve o sürümün tam metni repodan çıkarılabilir.
 */
export const PRELIMINARY_INFO_VERSION = "2026-08-31";

/** Mesafeli Satış Sözleşmesi (`/mesafeli-satis`) metin sürümü. Formdan AYRI
 *  sürümlenir: ikisi bağımsız değişebilir ve hangisinin kabul edildiği ayrı
 *  ayrı ispatlanmalıdır. */
export const DISTANCE_CONTRACT_VERSION = "2026-08-31";

/**
 * Onay metninin hangi varyantının gösterileceği.
 *
 * `personalized` — müşterinin kendi fotoğrafından/modelinden üretilen ürün.
 * MSY m.15/1-(b) istisnası uygulanır, cayma hakkı YOKTUR.
 * `readymade` — mağazadaki hazır/stok ürün. Cayma hakkı TAM OLARAK VARDIR;
 * burada istisna cümlesini göstermek yanıltıcı beyandır.
 */
export type ConsentVariant = "personalized" | "readymade";

/** Sipariş tipinden onay varyantı. `custom` (foto→figürin, Creative Lab) ve
 *  `upload` (müşterinin kendi STL/OBJ'si) kişiye özeldir; `marketplace` ve
 *  sepet hazır üründür. Tek kaynak: API gate'i ile UI aynı fonksiyonu çağırır. */
export function consentVariantForOrderType(orderType: string): ConsentVariant {
  return orderType === "custom" || orderType === "upload"
    ? "personalized"
    : "readymade";
}

/** Onay kaydının saklama süresi (MSY m.20/1: üç yıl). KVKK açısından
 *  `consent_ip`/`consent_user_agent` kişisel veridir; bu süreyi aşan kayıtlar
 *  temizlenmelidir. */
export const CONSENT_RETENTION_DAYS = 3 * 365;
