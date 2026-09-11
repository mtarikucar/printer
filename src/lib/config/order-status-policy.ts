/**
 * Sipariş durumu politikası: birden çok yerin AYNI cevabı vermesi gereken
 * sorular için tek kaynak.
 *
 * Neden ayrı modül: "Reddet" butonu (admin client) ile reject API'si kendi
 * listelerini ayrı tutuyordu ve ayrıştılar. Buton `awaiting_model`'da "Reddet"
 * gösteriyor, API aynı isteği 400 ile geri çeviriyordu. İade kontrolü ve admin
 * notu ekleme de her rotada elle yazılıyordu; kopyalar zamanla birbirinden
 * ayrışır.
 *
 * SAF MODÜL: `@/lib/db` import etmez. Admin client bileşenleri, API rotaları
 * ve BullMQ worker'ları güvenle alır. "server-only" EKLEMEYİN: worker'ın import
 * zincirine girerse worker crash-loop'a girer (2026-06-13'te yaşandı).
 */
import { APP_TIME_ZONE } from "@/lib/config/timezone";

/**
 * Admin'in "Reddet" ile kapatabileceği sipariş durumları. Hem reject API'si hem
 * admin sipariş sayfasındaki buton bu listeyi okur.
 *
 * Ödenmiş bir siparişi reddetmek iadedir (reject rotası parayı geri alır). Bu
 * yüzden liste yalnız henüz üretime GİRMEMİŞ durumları kapsar. `printing` ve
 * sonrası bilinçli olarak dışarıda: orada fiziksel iş ve partner hakedişi var,
 * çıkış yolu "İade et".
 *
 * `awaiting_model` ve `awaiting_customer_approval` eklendi. İkisinde de henüz
 * üreticiye giden bir şey yok (üretici kuyruğunu yalnız gerçek onay açar).
 * Müşterinin onay ekranı ve onay SLA worker'ı `awaiting_customer_approval`
 * korumalı güncelleme yaptığından reddedilmiş bir siparişi geri canlandıramaz.
 *
 * Tip bilerek `readonly string[]`: çağıranlar `order.status` (string) ile
 * `.includes` yapar. Drizzle `inArray` için enum tipine daraltmak çağıranın işi.
 */
export const REJECTABLE_STATUSES: readonly string[] = [
  "paid",
  "awaiting_model",
  "awaiting_customer_approval",
  "generating",
  "processing_mesh",
  "review",
  "approved",
  "failed_generation",
  "failed_mesh",
];

/**
 * İade edilmiş siparişin `payment_status` değeri. İade kuralı YALNIZ bu değeri
 * engeller (bkz. isRefunded). SQL karşılığı `notRefundedGuard()`
 * (services/manufacturer-assign.ts) da bu sabiti okur; kural tek yerde durur.
 */
export const REFUNDED_PAYMENT_STATUS = "refunded";

/**
 * İade edilmiş sipariş mi?
 *
 * İade kararı (refund-end-state): iade edilen sipariş durumunu KORUR ama her
 * ileri işlem (onay, toplu onay, admin model yükleme, üretici atama, baskı
 * başlatma, kargo, Yurtiçi kargo, boyacı atama, boyama ekleme) sunucuda
 * reddedilir. Sebep: iade partnerleri koparır ve siparişi `approved` +
 * `unassigned` bırakır. Bu, atanabilir bir siparişin tam olarak görünüşüdür;
 * engellenmezse sipariş yeniden atanır ya da kargolanır ve yeni bir hakediş
 * doğar. Teslim ve ret serbesttir: teslim zaten yola çıkmış paketin kaydıdır,
 * ret siparişi kapatır; ikisi de işi ileri taşımaz.
 *
 * Kural "ödeme başarılı mı" DEĞİL, "iade edilmiş mi"dir. Bugün enum yalnız
 * succeeded|refunded olsa da elle açılan, havale, sıfır tutarlı ve atölye
 * siparişleri başka bir ödeme durumunda durabilir; 'succeeded' şartı onları
 * sessizce dondururdu. Rotalar bu yüzden 'succeeded' aramaz.
 */
export function isRefunded(o: {
  paymentStatus: string | null | undefined;
}): boolean {
  return o.paymentStatus === REFUNDED_PAYMENT_STATUS;
}

/**
 * İade edilmiş siparişte ileri işlem denendiğinde her rotanın döndürdüğü tek
 * Türkçe mesaj (HTTP 409).
 */
export const REFUNDED_ORDER_ERROR =
  "Bu sipariş iade edildi. Onay, model yükleme, atama, baskı, kargo ve boyama gibi ileri işlemler yapılamaz.";

// Konteynerler UTC'de koşuyor; saat dilimi verilmezse damga 3 saat geride
// yazılır. `hourCycle: "h23"` gece yarısını "24:00" değil "00:00" yazar.
const NOTE_STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Tek bir not satırı: "[YYYY-MM-DD HH:mm] not" (İstanbul saati).
 *
 * Ayrı export, çünkü atomik UPDATE yazanlar birleştirmeyi SQL'de yapar (araya
 * giren bir [SLA] bayrağı kaybolmasın diye) ama satırın biçimi tek yerden
 * gelmeli.
 */
export function formatAdminNoteLine(note: string, at: Date = new Date()): string {
  const p: Record<string, string> = {};
  for (const part of NOTE_STAMP.formatToParts(at)) p[part.type] = part.value;
  return `[${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}] ${note.trim()}`;
}

/**
 * Siparişin admin notuna yeni bir satır EKLER; mevcut metni asla değiştirmez.
 *
 * Eskiden onay, ret, teslim, baskı başlatma ve iade notu `adminNotes`'un
 * ÜZERİNE yazıyordu. Böylece SLA worker'larının ve üretici red akışının
 * bıraktığı [SLA] bayrakları siliniyordu. Birleştirme kuralı SQL karşılığıyla
 * birebir aynı:
 *   CASE WHEN x IS NULL OR x = '' THEN satır ELSE x || E'\n' || satır END
 * Boş (ya da yalnız boşluk) bir not hiçbir şey eklemez.
 */
export function appendAdminNote(
  existing: string | null | undefined,
  note: string,
  at?: Date
): string {
  if (!note.trim()) return existing ?? "";
  const line = formatAdminNoteLine(note, at);
  return existing ? `${existing}\n${line}` : line;
}
