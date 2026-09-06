/**
 * Uygulamanın tek saat dilimi.
 *
 * Sunucu ve worker konteynerleri UTC'de koşuyor ve hiçbir yerde `TZ`
 * ayarlanmıyor. Saat dilimi belirtilmeyen her sunucu-taraflı biçimlendirici bu
 * yüzden değeri 3 saat GERİDE yazıyordu: ödeme son tarihi, teslim tarihi,
 * atölye seans saati. Müşteriye gönderilen bir saat, İstanbul saatidir.
 *
 * Neden konteynerin `TZ`'sini değiştirmek yerine burası: `TZ` değişimi yalnızca
 * biçimlendirmeyi değil, `setDate(getDate() - N)` gibi yerel-saat aritmetiğini
 * de etkiler (retention cutoff'ları, hediye kartı sona erme). Biçimlendiricide
 * açıkça belirtmek, konteyner ortamı ne olursa olsun aynı sonucu verir.
 *
 * SAF MODÜL — hiçbir import'u yok. Client bileşenleri, BullMQ worker'ları ve
 * birbirini import edemeyen bildirim modülleri (import döngüsü) güvenle alır.
 */
export const APP_TIME_ZONE = "Europe/Istanbul";
