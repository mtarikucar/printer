/**
 * Quality-control constants shared by the manufacturer panel and the API.
 *
 * Kept in sync with the manufacturer partnership contract
 * (src/lib/content/manufacturer-onboarding.ts, §5): each QC round needs at
 * least four photos — overall front, back/side, a close-up of the finest
 * detail, and one with a ruler for scale.
 */
export const QC_MIN_PHOTOS = 4;
/**
 * Taban üst sınır: TEK figürlük bir işin turu (sözleşmenin dört fotoğrafı +
 * iki yedek). Parçası olmayan her sipariş bu sınırda kalır.
 */
export const QC_MAX_PHOTOS = 6;
/**
 * Parça sayısından BAĞIMSIZ mutlak tavan. Yirmi parçalık bir iş bile tek turda
 * bir albüm yüklemesin: depolama, moderasyon ve admin onay ekranı sonsuz bir
 * listeyi taşıyamaz.
 */
export const QC_MAX_PHOTOS_HARD = 24;

/**
 * Bir turda kaç QC fotoğrafı kabul edilir — işin PARÇA SAYISINA göre.
 *
 * Altı fotoğraf yirmi parçalık bir teklif siparişini anlatamaz: her parçanın
 * kendi kanıtı istendiğinde sabit sınır, üreticiyi eksik kanıt göndermeye
 * zorlar. Formül parça başına bir fotoğraf + iki genel kare (grup çekimi ve
 * cetvelli ölçü) varsayar, tabanın altına inmez ve tavanı aşmaz.
 *
 * Sayı OKUNAMADIYSA (NaN) taban döner: `existing + adding > NaN` her zaman
 * false'tur, yani NaN bir sınır SINIRSIZLIK demek olurdu — kapı bilinmezlikte
 * açılmaz.
 */
export function qcPhotoCap(partCount: number): number {
  if (Number.isNaN(partCount)) return QC_MAX_PHOTOS;
  return Math.min(QC_MAX_PHOTOS_HARD, Math.max(QC_MAX_PHOTOS, partCount + 2));
}
