/**
 * Parça kimlik anahtarları: "bu manuel fiyat hâlâ geçerli mi", "müşteri TAM OLARAK
 * bu uyarıları onayladı mı".
 *
 * Kriptografik özet DEĞİL, okunur ve KARARLI bir dize üretilir. Sebep: anahtar
 * DB'de saklanır ve admin panelinde/destek yazışmasında gözle karşılaştırılır;
 * ayrıca `node:crypto` bu saf modüle giremez (istemci bileşenleri de import eder).
 * Çarpışma riski yok — anahtar gizli değil, yalnız eşitlik karşılaştırması için.
 *
 * KURAL: alan eklerken SONA ekleyin. Sıra değişirse sahadaki tüm manuel fiyatlar
 * ve uyarı onayları sessizce düşer.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */
import type { DfmCode, LeadTierKey, PartConfig } from "@/lib/config/quote-types";

/** Anahtarın hangi kurallarla üretildiği — kural değişirse artır. */
const KEY_VERSION = "v1";

/**
 * Ölçek `double precision` olarak saklanır; `String(0.70)` ile `String(0.7)`
 * aynı olsun diye sabit basamakla yazılır. Ölçek aralığı 0,01–100.
 */
function scaleToken(scale: number): string {
  return scale.toFixed(4);
}

function optionalNumber(value: number | null): string {
  return value === null ? "-" : String(value);
}

/** Fiyatı belirleyen HER konfig alanı — biri değişirse fiyat yeniden hesaplanır. */
function configTokens(config: PartConfig): string[] {
  return [
    config.technologyKey,
    config.materialKey,
    config.colorKey,
    config.finishKey,
    optionalNumber(config.layerUm),
    optionalNumber(config.infillPct),
    String(config.quantity),
    config.units,
    scaleToken(config.scale),
    config.criticalTolerance ? "kt1" : "kt0",
  ];
}

/**
 * Manuel fiyatın bağlı olduğu anahtar. Admin bir parçaya elle fiyat girdiğinde
 * bu anahtar da yazılır; müşteri malzemeyi, adedi, ölçeği ya da teslim kademesini
 * değiştirirse anahtar tutmaz ve manuel fiyat otomatik olarak düşer.
 *
 * Teslim kademesi anahtarın PARÇASIDIR: manuel fiyat KDV dahil nihai birim
 * fiyattır, kademe çarpanı ona sonradan uygulanamaz.
 */
export function partPricingKey(
  p: { sourceSha256: string | null; config: PartConfig },
  leadTier: LeadTierKey
): string {
  return [KEY_VERSION, "price", p.sourceSha256 ?? "-", ...configTokens(p.config), leadTier].join(
    "|"
  );
}

/**
 * Müşterinin onayladığı uyarı kümesinin anahtarı. Kodlar sıralanır ki uyarıların
 * üretim sırası onayı bozmasın; yeni bir uyarı çıkarsa anahtar değişir ve onay
 * yeniden istenir.
 */
export function dfmWarningKey(
  codes: DfmCode[],
  p: { sourceSha256: string | null; config: PartConfig }
): string {
  const unique = [...new Set(codes)].sort();
  return [KEY_VERSION, "dfm", p.sourceSha256 ?? "-", ...configTokens(p.config), unique.join(",")].join(
    "|"
  );
}
