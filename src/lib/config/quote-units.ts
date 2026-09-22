/**
 * Dosya biriminden milimetreye geçiş — anlık teklif motorunun TEK çeviri yeri.
 *
 * `PartGeometry` her zaman DOSYA BİRİMİNDEDİR (STL/OBJ birimsizdir, 3MF kendi
 * birimini söyler). Müşteri birimi ya da ölçeği değiştirdiğinde analiz worker'ı
 * yeniden çalışmaz; yalnız burası yeniden hesaplanır. Bu yüzden fiyat, DfM ve
 * arayüz milimetreyi BAŞKA hiçbir yerde türetmez.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok — BullMQ worker'ı
 * ve istemci bileşenleri birlikte import eder.
 */
import type { PartGeometry, QuoteUnits, ScaledGeometry, Vec3 } from "@/lib/config/quote-types";

/** Bir dosya biriminin kaç milimetre ettiği. */
export function unitFactor(units: QuoteUnits): number {
  switch (units) {
    case "mm":
      return 1;
    case "cm":
      return 10;
    case "in":
      return 25.4;
  }
}

/** Kutu boyutlarını küçükten büyüğe sıralar — sığma kontrolü yönden bağımsızdır. */
export function sortedExtents(v: Vec3): [number, number, number] {
  const sorted = [v.x, v.y, v.z].sort((a, b) => a - b);
  return [sorted[0] as number, sorted[1] as number, sorted[2] as number];
}

/** `a` üçlüsü `b` üçlüsüne sığıyor mu (ikisi de sıralı olmalı). */
function fitsSorted(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => value <= (b[i] as number));
}

/**
 * Geometriyi milimetreye çevirir. `factor = unitFactor(units) × scale`; hacim
 * `factor³`, alan `factor²`, uzunluklar `factor` ile çarpılır.
 */
export function scaledGeometry(
  g: PartGeometry,
  units: QuoteUnits,
  scale: number
): ScaledGeometry {
  const factor = unitFactor(units) * scale;
  const volumeMm3 = g.volume === null ? null : g.volume * factor ** 3;
  const areaMm2 = g.area * factor ** 2;
  const extentsMm: Vec3 = {
    x: g.extents.x * factor,
    y: g.extents.y * factor,
    z: g.extents.z * factor,
  };
  return {
    factor,
    volumeMm3,
    volumeCm3: volumeMm3 === null ? null : volumeMm3 / 1000,
    areaMm2,
    areaCm2: areaMm2 / 100,
    extentsMm,
    sortedMm: sortedExtents(extentsMm),
    wallP1Mm: g.wallP1 === null ? null : g.wallP1 * factor,
  };
}

/**
 * Dosyanın hangi birimde yazılmış olabileceğine dair ÖNERİ (null = öneri yok).
 *
 * Sıra: 3MF kendi birimini bildiriyorsa tartışma yok. Aksi hâlde yalnız
 * "sayılar şüpheli derecede küçük" durumunda öneri verilir: en büyük boyut 10
 * birimden küçükse parça milimetre okunduğunda 1 cm'in altında kalır ki bu
 * neredeyse hiçbir zaman kastedilen şey değildir — dosya büyük olasılıkla inç
 * ya da santimetredir.
 *
 * SPEC'TEN SAPMA (bilinçli): tasarım metni "baskı hacmini aşıp /10 ile sığıyorsa
 * `cm` öner" diyor. `unitFactor(cm) = 10` olduğu için santimetre parçayı KÜÇÜLTMEZ,
 * BÜYÜTÜR; baskı hacmini aşan bir parçaya cm/inç önermek onu daha da büyütürdü.
 * Sığmayan parçanın çözümü birim değil ÖLÇEKTİR (bkz. DfM `too_large.fitScale`).
 * Bu yüzden `cm`, inç yorumunun baskı hacmine sığmadığı küçük parçalar için
 * kalan makul öneri olarak kullanılır.
 */
export function suggestUnits(g: PartGeometry, maxBuild: Vec3): QuoteUnits | null {
  if (g.sourceUnits) return g.sourceUnits;

  const raw = sortedExtents(g.extents);
  const largest = raw[2];
  if (!(largest > 0)) return null;
  if (largest >= 10) return null;

  const build = sortedExtents(maxBuild);
  if (fitsSorted(raw.map((v) => v * unitFactor("in")), build)) return "in";
  if (fitsSorted(raw.map((v) => v * unitFactor("cm")), build)) return "cm";
  return null;
}
