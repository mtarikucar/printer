/**
 * TİCARİ SAYFALARIN "SON GÜNCELLEME" TARİHİ — tek kaynak.
 *
 * Ölçüm (2026-10-02): yazar ve son güncelleme alanı olmayan sayfaların bir AI
 * asistanının kaynak kartına çıkma oranı 2,4 kat düşük. Hukuki sayfalarımızda
 * tarih vardı ama her birinde ELLE yazılı (`kargo/page.tsx` "24 Ağustos
 * 2026"); niyetin karşısındaki ticari sayfalarda ise hiç yoktu.
 *
 * TARİH `new Date()` İLE ÇÖZÜLMEZ. Her render'da bugünü yazan bir sayfa
 * "bugün güncellendi" diye YANLIŞ bir tazelik sinyali yayınlar: içerik altı ay
 * önce yazılmış olsa bile taze görünür, ve bir kez yakalandığında sinyalin
 * tamamı değersizleşir. `sitemap.ts`in bugünkü `lastModified: new Date()`
 * hatası tam olarak budur ve bu modül onun da gelecekteki kaynağıdır —
 * anahtarlar bilerek `STATIC_ROUTES[].path` ile AYNI yazımda (anasayfa ""),
 * böylece sitemap buradan okumaya geçtiğinde ikinci bir tarih listesi doğmaz.
 *
 * SÖZLEŞME: bu sayfalardan birinin GÖRÜNEN içeriğini değiştiren commit, o
 * satırın tarihini de günceller. Tarih elle yazılır çünkü "içerik anlamlı
 * biçimde değişti mi" sorusunu ne derleyici ne git mtime yanıtlayabilir —
 * biçimsel bir refactor tazelik sinyali DEĞİLDİR.
 *
 * SAF MODÜL: hiçbir import'u yok; `import "server-only"` de yok (bkz.
 * [[worker-server-only-trap]]).
 */

/** ISO (YYYY-MM-DD) — sayfanın içeriğinin son anlamlı değişikliği. */
export const PAGE_UPDATED_AT: Readonly<Record<string, string>> = {
  // Bu sevkiyat (V1) altı sayfanın da gövdesine dokundu: fiyat/boyut çıpası,
  // 25 µm katman yüksekliği ve bu satırın kendisi.
  "": "2026-10-02",
  "/figur": "2026-10-02",
  "/nasil-calisir": "2026-10-02",
  "/3d-baski": "2026-10-02",
  "/urunler": "2026-10-02",
  "/shop": "2026-10-02",
};

/**
 * Bir yolun tarihi; listede yoksa `null` (çağıran satırı hiç çizmez).
 *
 * "/" ve "" aynı sayfadır: sitemap anasayfayı "" ile yazar, bir React prop'u
 * ise doğal olarak "/" taşır. Normalizasyon burada yapılır ki çağıran yerin
 * hangi yazımı kullandığı önemsiz olsun.
 */
export function pageUpdatedAt(path: string): string | null {
  const key = path === "/" ? "" : path.replace(/\/+$/, "");
  return PAGE_UPDATED_AT[key] ?? null;
}
