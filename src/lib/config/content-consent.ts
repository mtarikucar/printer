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
export const CONTENT_CONSENT_VERSION = "2026-07-20";
