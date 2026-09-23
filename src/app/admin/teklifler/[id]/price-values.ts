/**
 * Karar ekranının PARA KATMANI: ekrandaki metin ↔ telden giden kuruş.
 *
 * Neden ekranın içinde değil ayrı bir saf modülde: burası admin'in girdiği
 * tutarın ilk durağı ve buradaki bir hata sunucuda YAKALANAMAZ — "12,5o" gibi
 * bir yazım hatası `NaN`a, `NaN` da `JSON.stringify` içinde `null`a düşerdi ve
 * `null` bu uçta "bu parçanın manuel fiyatını SİL" demektir. Yani bir harf
 * hatası, girilmiş bir fiyatı sessizce silerdi. Kural burada duruyor ki bir
 * düğüm testi onu koşabilsin (`"use client"` bir bileşen import edilemez).
 *
 * SAF MODÜL: React yok, DB yok, `node:` import'u yok.
 */

/** `null` = fiyatı KALDIR (alan boş), `"invalid"` = okunamadı. */
export type PriceDraftValue = number | null | "invalid";

/**
 * "7,50" → 750 kuruş.
 *
 * Kabul edilen biçim bilerek dar: rakamlar, tek bir ayraç ve en fazla iki
 * ondalık. `Number()`in gevşekliği (`"0x10"`, `"1e3"`, `" 12 "`) bir para
 * alanında yardım değil sürprizdir.
 */
export function toKurus(text: string): PriceDraftValue {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return "invalid";
  return Math.round(Number(clean) * 100);
}

/** Kuruş → ekrandaki metin ("7,5"); `null` boş alan. */
export function fromKurus(value: number | null): string {
  return value === null ? "" : String(value / 100).replace(".", ",");
}

export interface PriceDraftPart {
  id: string;
  position: number;
  name: string;
}

export interface PriceRow {
  partId: string;
  unitKurus: number | null;
}

/**
 * Taslaktaki tutarları satırlara çevirir.
 *
 * Okunamayan BİR alan bile varsa hiçbir satır dönmez, hangi parçanın yanlış
 * olduğunu söyleyen TÜRKÇE bir cümle döner: yarım bir istek göndermek, doğru
 * yazılmış satırları kaydedip yanlış olanı sessizce silmek olurdu.
 *
 * `only = "filled"` boş alanları ATLAR (karşı teklif: yalnız yazdığın parça),
 * `"all"` hepsini gönderir (manuel fiyat: boş alan "fiyatı kaldır" demektir).
 */
export function rowsOf(
  parts: PriceDraftPart[],
  draft: Record<string, string>,
  only: "all" | "filled"
): PriceRow[] | string {
  const rows: PriceRow[] = [];
  for (const part of parts) {
    const text = draft[part.id] ?? "";
    if (only === "filled" && text.trim() === "") continue;
    const value = toKurus(text);
    if (value === "invalid") {
      return `P${String(part.position).padStart(2, "0")} ${part.name}: tutarı okuyamadım. Örnek: 74,50`;
    }
    rows.push({ partId: part.id, unitKurus: value });
  }
  return rows;
}

/** Boş/hatalı gün alanı `NaN` gitsin: sunucu Türkçe cümlesiyle reddetsin. */
export function daysOrNaN(text: string): number {
  const clean = text.trim();
  return /^\d+$/.test(clean) ? Number(clean) : Number.NaN;
}
