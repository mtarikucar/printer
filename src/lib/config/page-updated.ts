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
 * KAPSAM, V2'de sitemap'in TAMAMINA genişledi: `sitemap.ts` her statik rotanın
 * `lastModified`ını buradan okuyor (eskiden `new Date()`, yani her render'da
 * "şimdi" diyen bir gürültü kaynağıydı). Bu yüzden `STATIC_ROUTES`un her yolu
 * burada BULUNMAK ZORUNDA — `scripts/test-sitemap.ts` eksik yolu kırmızıya
 * çevirir. Satırın varlığı görünür bir "Son güncelleme" satırı DOĞURMAZ: o
 * satırı yalnız `<LastUpdated/>` çizdiği sayfalar gösterir.
 *
 * Tarihlerin kaynağı:
 *  - Ticari sayfalar: içeriği son değiştiren sevkiyatın günü.
 *  - Hukuki sayfalar: sayfanın KENDİ ÜSTÜNDE yazılı "Son güncelleme" tarihi
 *    (`kargo/page.tsx` "24 Ağustos 2026" gibi). İki yazımın ayrışması
 *    sitemap'in okuyucuya göründüğünden farklı bir tarih söylemesi demek
 *    olurdu; `test-sitemap.ts` o ayrışmayı da pinliyor.
 *  - Hiç dokunulmamış sayfalar: dosyanın son içerik commit'inin günü.
 *
 * SAF MODÜL: hiçbir import'u yok; `import "server-only"` de yok (bkz.
 * [[worker-server-only-trap]]).
 */

/** ISO (YYYY-MM-DD) — sayfanın içeriğinin son anlamlı değişikliği. */
export const PAGE_UPDATED_AT: Readonly<Record<string, string>> = {
  // V1 altı sayfanın gövdesine dokundu: fiyat/boyut çıpası, 25 µm katman
  // yüksekliği ve bu satırın kendisi.
  "": "2026-10-02",
  "/figur": "2026-10-02",
  "/nasil-calisir": "2026-10-02",
  "/3d-baski": "2026-10-02",
  "/urunler": "2026-10-02",
  "/shop": "2026-10-02",
  // Görünür "Son güncelleme" satırı OLMAYAN, ama sitemap'te duran rotalar.
  // `/create`in gövdesi de V1'de değişti (gerçekler bandı).
  "/create": "2026-10-02",
  "/3d-baski/malzemeler": "2026-09-23",
  "/toplu-siparis": "2026-08-11",
  "/anahtarlik-kutusu": "2026-09-16",
  "/atolye": "2026-07-07",
  "/contact": "2026-07-07",
  // Hukuki sayfalar: tarih sayfanın ÜSTÜNDE de yazılı, ikisi aynı olmalı.
  "/kargo": "2026-08-24",
  "/iade": "2026-08-24",
  "/on-bilgilendirme": "2026-08-24",
  "/mesafeli-satis": "2026-08-28",
  "/privacy": "2026-08-28",
  "/cerez": "2026-06-09",
  "/ticari-ileti": "2026-06-09",
  "/terms": "2026-03-31",
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
