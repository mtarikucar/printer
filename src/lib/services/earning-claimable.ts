/**
 * ÖDENEBİLİR HAKEDİŞ KURALI — ekranların ve partileme sorgularının TEK tanımı.
 *
 * NEDEN AYRI MODÜL: kural iki yerde ayrı ayrı yazılmıştı ve ayrıştılar. Partner
 * ekranı "ödeme bekleyen" tutarını iade edilen siparişleri ÇIKARARAK
 * hesaplıyordu; ekranın hemen yanındaki "Ödeme talep et" düğmesinin arkasındaki
 * partileme sorgusu ise siparişe hiç bakmadan her `pending` + partilenmemiş
 * satırı süpürüyordu. Sonuç: ekranda ₺838,20 yazarken ödeme partisine ₺1.676,40
 * giriyordu ve aradaki fark, parası müşteriye İADE EDİLMİŞ bir siparişin
 * hakedişiydi. Ekranın "ödenemez" dediği parayı, ekranın kendi düğmesi ödeme
 * kuyruğuna sokuyordu.
 *
 * Kural artık burada durur ve ÖDENEBİLİRLİĞE KARAR VEREN HER YER buradan okur:
 *   - partner ekranları: manufacturer/earnings, painter/earnings ve
 *     painter/dashboard ("Bekleyen kazanç"),
 *   - partileme sorguları: createPayoutForManufacturer (payouts.ts),
 *     createPayoutForPainter (painter-payouts.ts) ve /api/painter/payout-request,
 *   - admin ödeme kuyruğu: /admin/payouts (her iki sekme).
 * Ayrışmayı scripts/test-cost-lines.ts pinler: hem derlenmiş SQL'i
 * karşılaştırarak, hem de src/ ağacını tarayıp hakediş tablolarına ödenebilirlik
 * yüklemini ELLE kuran her dosyayı düşürerek. Bir listeye dosya eklemek yetmez;
 * tarama listeyi aşar, yeni bir ekran da kuralı okumak zorundadır.
 *
 * NEDEN İADE EDİLMİŞ SİPARİŞTE HÂLÂ BEKLEYEN HAKEDİŞ KALIR: iade
 * (order-refund.ts) reverseEarning / reversePainterEarning'i işlemin DIŞINDA,
 * en iyi çaba ile çağırır (`.catch` + log). Çevirme başarısız olursa sipariş
 * iade edilmiş kalır ama hakediş satırı `pending` kalır — satırın kendisi
 * sıradan, ödenmeyi bekleyen paraya benzer. Bu modül o satırın ödemeye
 * girmesini engelleyen settir.
 *
 * SAF MODÜL: `@/lib/db` İMPORT ETMEZ. db/index.ts import anında bir pg havuzu
 * kurar; kuralı oraya bağlamak DB'siz birim testinin kuralı import etmesini
 * imkânsız kılardı. `server-only` de EKLEMEYİN (worker zinciri).
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { orders } from "@/lib/db/schema";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";

/** Henüz bir ödeme partisine girmemiş hakediş satırının statüsü. */
export const OPEN_EARNING_STATUS = "pending";

/**
 * İade terimi, siparişle BİRLEŞTİRİLMİŞ sorgu üzerinde.
 *
 * `is distinct from` bilerek: sol birleşim sipariş satırını bulamazsa hem
 * `= 'refunded'` hem `<> 'refunded'` NULL döner ve tutar İKİ toplamdan BİRDEN
 * düşerdi — para ekrandan sessizce kaybolurdu. Değer tek kaynaktan
 * (REFUNDED_PAYMENT_STATUS); kuralın kendisi order-status-policy'nin
 * isRefunded'ı ile aynı soruyu sorar.
 */
export const orderNotRefundedSql: SQL = sql`${orders.paymentStatus} is distinct from ${REFUNDED_PAYMENT_STATUS}`;
export const orderRefundedSql: SQL = sql`${orders.paymentStatus} is not distinct from ${REFUNDED_PAYMENT_STATUS}`;

/**
 * Kuralın ihtiyaç duyduğu iki sütun. `SQLWrapper` yeterli ve bilerek geniş: her
 * drizzle sütunu SQLWrapper'dır, kural iki tabloda (manufacturer_earnings,
 * painter_earnings) birebir AYNI kurulur ve tablo nesnesi olduğu gibi geçilir.
 */
export interface EarningRuleColumns {
  status: SQLWrapper;
  payoutId: SQLWrapper;
}

/**
 * AÇIK SATIR: tahakkuk etmiş, henüz bir ödeme partisine girmemiş.
 *
 * Dışa açık, çünkü admin ödeme kuyruğu açık satırların TAMAMINI listeler —
 * ödenebilir olanı da, iadesi yüzünden ödenmeyeni de — ve ikisini satır satır
 * ayırır. O ekran bu ifadeyi elle kursaydı kural yine çatallanırdı; tek fark,
 * çatalın ekranla parti arasında değil ekranın kendi içinde olması olurdu.
 */
export function openEarningWhere(t: EarningRuleColumns): SQL {
  return sql`(${t.status} = ${OPEN_EARNING_STATUS} and ${t.payoutId} is null)`;
}

/**
 * PARTİYE GİRMİŞ ama henüz ödenmemiş satır: partner ekranlarının "Ödeme
 * sürecinde" rakamı. Açık satırın öbür yarısı; ödenebilirin değil.
 */
export function inPayoutEarningWhere(t: EarningRuleColumns): SQL {
  return sql`(${t.status} = ${OPEN_EARNING_STATUS} and ${t.payoutId} is not null)`;
}

/**
 * TALEP EDİLEBİLİR (ödenebilir) hakediş — kuralın kendisi.
 *
 * Ekranların "ödeme bekleyen / talep edilebilir" toplamı ile partileme
 * sorgularının WHERE'i AYNI bu ifadedir: ekranın ödenebilir dediği para ile
 * partiye giren para tanım gereği aynı satır kümesidir. Sorgu `orders` ile
 * birleştirilmiş olmalıdır (leftJoin) — kural siparişin ödeme durumunu okur.
 *
 * Dış parantez bilerek: ifade bir gün `or()` ile birleştirilirse öncelik
 * kaymasın.
 */
export function claimableEarningWhere(t: EarningRuleColumns): SQL {
  return sql`(${openEarningWhere(t)} and ${orderNotRefundedSql})`;
}

/**
 * Açık ama siparişi İADE EDİLMİŞ hakediş: ödenmez. Satır ekranda gizlenmez
 * (ekran veriyi olduğu gibi gösterir) ama talep edilebilir paradan ayrılır ve
 * tutarı sebebiyle birlikte yazılır — partner ödeneceğini sanmasın.
 */
export function refundedOpenEarningWhere(t: EarningRuleColumns): SQL {
  return sql`(${openEarningWhere(t)} and ${orderRefundedSql})`;
}

/**
 * Bu düzeltmeden ÖNCE partiye girmiş iade hakedişi: satır `pending` ama
 * `payout_id` dolu. Yeni kural bunu bir daha ÜRETMEZ; eski kayıtlar için ekran
 * tutarı ayrıca söyler, çünkü partileme filtresi `payout_id is null` olduğundan
 * satır partiye girer girmez "iade" uyarısından da düşüyordu — uyarı tam da
 * risk gerçekleştiği anda kayboluyordu.
 */
export function refundedInPayoutEarningWhere(t: EarningRuleColumns): SQL {
  return sql`(${inPayoutEarningWhere(t)} and ${orderRefundedSql})`;
}
