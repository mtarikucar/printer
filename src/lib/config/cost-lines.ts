/**
 * Kalem bazlı hakediş — tek kaynak.
 *
 * Bir ürünün (ya da manuel siparişin) fiyatı TAM OLARAK iki tür kalemden oluşur:
 *
 *   production → üreticinin hakediş tabanı
 *   painting   → boyacının hakediş tabanı
 *
 *   fiyat        = Σ(production) + Σ(painting)
 *   üretici net  = (1 − komisyon) × Σ(production)
 *   boyacı net   = (1 − komisyon) × Σ(painting)
 *   platform     = komisyon × fiyat
 *
 * Böylece toplam partner ödemesi fiyatın sabit bir yüzdesidir ve fiyatı
 * geçmesi matematiksel olarak imkânsızdır. Önceki modelde iki taban örtük
 * kurallardan türetiliyordu ve aynı boyama payı hem üreticiye hem boyacıya
 * vaat edilebiliyordu (bkz. docs/superpowers/specs/2026-09-01-kalem-bazli-hakedis-design.md).
 *
 * Saf modül: DB yok, `server-only` yok. Client bileşenleri de import eder
 * (config/bulk.ts ile aynı konvansiyon) ve BullMQ worker'ları da — bir
 * `server-only` importu standalone Node worker'ını crash-loop'a sokar.
 */

export const COST_LINE_KINDS = ["production", "painting"] as const;
export type CostLineKind = (typeof COST_LINE_KINDS)[number];

export interface CostLine {
  kind: CostLineKind;
  amountKurus: number;
}

/** Panelde gösterilen Türkçe etiketler (select box'ların tek kaynağı). */
export const COST_LINE_LABELS_TR: Record<CostLineKind, string> = {
  production: "Üretim / baskı",
  painting: "Boyama",
};

/** Etiketin kime ödendiğini söyleyen kısa açıklama — form yardımcı metni. */
export const COST_LINE_PAYEE_TR: Record<CostLineKind, string> = {
  production: "Üreticinin hakediş tabanı",
  painting: "Boyacının hakediş tabanı",
};

/** Select box'ların doğrudan map'leyebileceği hazır seçenek listesi. */
export const COST_LINE_OPTIONS: ReadonlyArray<{
  value: CostLineKind;
  label: string;
  payee: string;
}> = COST_LINE_KINDS.map((kind) => ({
  value: kind,
  label: COST_LINE_LABELS_TR[kind],
  payee: COST_LINE_PAYEE_TR[kind],
}));

/** Bilinmeyen bir değeri güvenle kalem türüne daraltır. */
export function isCostLineKind(value: unknown): value is CostLineKind {
  return (
    typeof value === "string" && (COST_LINE_KINDS as readonly string[]).includes(value)
  );
}

/** Kalem listesini iki hakediş tabanına indirger. */
export function splitCostLines(lines: readonly CostLine[]): {
  productionKurus: number;
  paintingKurus: number;
} {
  let productionKurus = 0;
  let paintingKurus = 0;
  for (const line of lines) {
    const amount = Math.max(0, Math.trunc(line.amountKurus) || 0);
    if (line.kind === "painting") paintingKurus += amount;
    else productionKurus += amount;
  }
  return { productionKurus, paintingKurus };
}

/** Kalemlerin toplamı — ürünün fiyatı bununla doğrulanır. */
export function costLinesTotalKurus(lines: readonly CostLine[]): number {
  const s = splitCostLines(lines);
  return s.productionKurus + s.paintingKurus;
}

/**
 * Ürün tanımındaki kırılımın ORANLARINI, siparişte gerçekleşen satır tutarına
 * ölçekler.
 *
 * Gerekli çünkü satır tutarı ürünün liste fiyatına eşit olmak zorunda değil:
 * adet, opsiyon farkları, add-on'lar ve toplu sipariş kademeleri onu değiştirir.
 * Kırılımı sabit tutup tutarı ayrı ölçeklersek iki taban toplamı satır
 * tutarından sapar ve "hakediş toplamı fiyatı geçiyor" hatası geri gelir.
 *
 * En büyük kalan (largest-remainder) yöntemi: üretim payı aşağı yuvarlanır,
 * artan kuruş boyamaya verilir. İki taban HER ZAMAN tam olarak `totalKurus`
 * eder — yuvarlama kaybı ya da fazlası olmaz.
 *
 * Uç durumlar:
 *   - kırılım tamamen boş (0/0) → tutarın tamamı üretim sayılır. Kırılımı
 *     olmayan bir ürünün boyacı payı üretilemez; bugünkü davranış budur.
 *   - tek taraflı kırılım → tutarın tamamı o tarafa gider.
 */
export function allocateBases(args: {
  productionKurus: number;
  paintingKurus: number;
  totalKurus: number;
}): { productionKurus: number; paintingKurus: number } {
  const total = Math.max(0, Math.trunc(args.totalKurus) || 0);
  if (total === 0) return { productionKurus: 0, paintingKurus: 0 };

  const production = Math.max(0, Math.trunc(args.productionKurus) || 0);
  const painting = Math.max(0, Math.trunc(args.paintingKurus) || 0);
  const base = production + painting;

  // Kırılımsız ürün: boyacı payı yok, tamamı üretim.
  if (base === 0) return { productionKurus: total, paintingKurus: 0 };
  if (painting === 0) return { productionKurus: total, paintingKurus: 0 };
  if (production === 0) return { productionKurus: 0, paintingKurus: total };

  // Aşağı yuvarla, kalanı diğer tarafa bırak → toplam tam korunur.
  const productionShare = Math.floor((total * production) / base);
  return {
    productionKurus: productionShare,
    paintingKurus: total - productionShare,
  };
}
