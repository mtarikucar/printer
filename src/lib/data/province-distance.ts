import { TURKEY_MAP_PROVINCES } from "@/lib/data/turkey-map";

/**
 * İl–il mesafe çekirdeği — SAF modül (DB yok, `server-only` yok).
 *
 * NEDEN AYRI DOSYA: `turkey-map.ts` ÜRETİLMİŞ bir dosyadır ve
 * `npx tsx scripts/build-turkey-map.ts` onu header+body+footer olarak BAŞTAN
 * yazar. Oraya eklenen her satır ilk yeniden üretimde sessizce kaybolur.
 * Çapa koordinatları (cx/cy) oradan okunur, mantık burada durur.
 *
 * NEDEN ÇAPA KOORDİNATI (distance-source kararı): yeni bir enlem/boylam
 * tablosu eklemiyoruz — 81 ilin çapası zaten repoda. Yönlendirme için mesafenin
 * mutlak doğruluğu değil SIRASI gerekir ve sıra doğru: İstanbul–Ankara 230.4
 * birim ≈ 346 km (gerçek karayolu ~350 km), Kocaeli–Düzce 68.9 birim ≈ 103 km,
 * Edirne–Hakkari 948.5 birim ≈ 1423 km (yurt içi en uzak çift).
 *
 * Kargo bölge/desi tablosu geldiğinde (Phase 10) gerçek maliyet bu modülün
 * yerine geçer; çağıranlar aynı kalır.
 */

/**
 * Bir harita biriminin yaklaşık kilometre karşılığı.
 *
 * viewBox eni 1013.7 birim ve Türkiye'nin doğu–batı açıklığı ~1520 km olduğu
 * için 1 birim ≈ 1.5 km. Kuş uçuşu ölçüdür: karayolu mesafesi tipik olarak
 * %10–25 daha uzundur, o yüzden bu değeri fiyata DEĞİL yalnızca sıralamaya
 * ve insan okuyacağı "~X km" etiketine koyun.
 */
export const MAP_UNIT_KM = 1.5;

/**
 * Türkçe harf katlaması. `toLocaleLowerCase("tr")` "İ"yi "i", "I"yı "ı" yapar;
 * kalan aksanları ASCII'ye indiriyoruz ki "İSTANBUL", "Istanbul", "istanbul"
 * ve "Hakkâri" gibi elle yazılmış varyantlar aynı ile düşsün. Partner profili
 * il'i SERBEST METİN olarak saklıyor (validators/network-map.ts:15), yani bu
 * hoşgörü olmadan tek harf farkı mesafeyi "bilinmiyor"a düşürürdü.
 */
const FOLD_MAP: Record<string, string> = {
  "ı": "i",
  "ş": "s",
  "ğ": "g",
  "ü": "u",
  "ö": "o",
  "ç": "c",
  "â": "a",
  "î": "i",
  "û": "u",
  "ê": "e",
};

/** İl adının karşılaştırma anahtarı; boş/anlamsız girdide null. */
export function foldProvinceName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const folded = raw
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/[ışğüöçâîûê]/g, (c) => FOLD_MAP[c] ?? c)
    // Boşluk ve noktalama at: "Afyon Karahisar" → "afyonkarahisar".
    .replace(/[\s.'’-]+/g, "");
  return folded.length > 0 ? folded : null;
}

interface ProvinceAnchor {
  /** Kanonik il adı (PROVINCES ile birebir). */
  il: string;
  cx: number;
  cy: number;
}

const ANCHORS = new Map<string, ProvinceAnchor>();
for (const p of TURKEY_MAP_PROVINCES) {
  const key = foldProvinceName(p.il);
  // 81 ilin katlanmış adı tekrarsızdır (scripts/test-province-distance.ts bunu
  // her koşuda doğrular) — yani burada sessiz bir üzerine yazma olamaz.
  if (key) ANCHORS.set(key, { il: p.il, cx: p.cx, cy: p.cy });
}

/** Serbest metin il adını kanonik yazıma çevirir; tanınmıyorsa null. */
export function canonicalProvince(name: string | null | undefined): string | null {
  const key = foldProvinceName(name);
  if (!key) return null;
  return ANCHORS.get(key)?.il ?? null;
}

/**
 * İki ad AYNI ili mi gösteriyor? Haritada olmayan (ama birebir aynı yazılmış)
 * adlar da aynı sayılır: "aynı yer" olduğu kesindir, çapası olmasa bile.
 */
export function sameProvinceName(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const fa = foldProvinceName(a);
  const fb = foldProvinceName(b);
  return fa !== null && fa === fb;
}

/** İl çapası (harita koordinatı); tanınmayan ad için null. */
export function provinceAnchor(
  name: string | null | undefined
): ProvinceAnchor | null {
  const key = foldProvinceName(name);
  if (!key) return null;
  return ANCHORS.get(key) ?? null;
}

/**
 * İki il çapası arası kuş uçuşu mesafe, HARİTA BİRİMİ cinsinden (1 birim ≈
 * 1.5 km). Taraflardan biri tanınmıyorsa null — "0" DÖNMEZ: bilinmeyen bir il
 * sıfır mesafeli sayılsaydı adresi bozuk her sipariş en yakın atölyeymiş gibi
 * puanlanırdı.
 *
 * Saf ve simetrik; sonuç tek ondalığa yuvarlanır ki log ve testler kararlı
 * kalsın.
 */
export function provinceDistanceUnits(
  a: string | null | undefined,
  b: string | null | undefined
): number | null {
  const pa = provinceAnchor(a);
  const pb = provinceAnchor(b);
  if (!pa || !pb) return null;
  const d = Math.hypot(pa.cx - pb.cx, pa.cy - pb.cy);
  return Math.round(d * 10) / 10;
}

/** Aynı mesafenin insan okuyacağı hâli (tam km); tanınmayan ilde null. */
export function provinceDistanceKm(
  a: string | null | undefined,
  b: string | null | undefined
): number | null {
  const units = provinceDistanceUnits(a, b);
  return units === null ? null : Math.round(units * MAP_UNIT_KM);
}
