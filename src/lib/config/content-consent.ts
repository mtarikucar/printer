/**
 * Görsel/kişilik hakları + KVKK onayı sürüm damgası.
 *
 * Müşteri, foto/model içeren siparişlerde (custom / upload / WhatsApp pay)
 * sipariş anında iki ayrı onay verir: (1) Kullanım Koşulları + fotoğraf
 * taahhütleri, (2) KVKK Aydınlatma + yurt dışı AI aktarımına açık rıza.
 * Onay verildiğinde bu sürüm siparişe yazılır (`orders.content_consent_version`)
 * — hangi sözleşme metninin kabul edildiğinin denetim izi. Metin esaslı olarak
 * değişince bu sürümü yükseltin.
 */
export const CONTENT_CONSENT_VERSION = "2026-08-28";

/**
 * Sürüm damgası, otomatik 3D boru hattının kapısıdır.
 *
 * 2026-08-28'de rıza metni genişletildi: fotoğraf artık yalnız "stilize görsel
 * üretimi" için değil, 3D MODEL üretimi için de yurt dışına aktarılıyor ve
 * aktarımcı listesine Meshy ekleniyor. KVKK m.3 açık rızanın "belirli bir
 * konuya ilişkin" olmasını şart koşuyor: 2D stilizasyon için verilmiş bir rıza
 * 3D mesh üretimini KAPSAMAZ.
 *
 * `kickOffOrderProcessing` bu sürümü karşılaştırır; eski sürümlü siparişler
 * otomatik yola girmez, bugünkü elle yoldan devam eder.
 */
export const CONTENT_CONSENT_VERSION_MESHY = "2026-08-28";
