/**
 * `FAQPage` JSON-LD yayıcısı.
 *
 * Denetim (2026-10-02): sitede on altı soru-cevap çifti düz HTML olarak
 * duruyordu (`/3d-baski` dokuz `<details>`, `/figur` sekiz `<button>`) ve
 * hiçbiri işaretlenmemişti — yani bir asistan "fiyatı görmek için hesap
 * gerekiyor mu" sorusunun cevabını sayfada bulsa bile hangi metnin hangi
 * sorunun cevabı olduğunu BİLMİYORDU.
 *
 * TEK KURAL: şemadaki metin, sayfada GÖRÜNEN metnin birebir aynısıdır.
 * Bu yüzden builder metin ÜRETMEZ, yalnız sarar: çağıran, sayfanın kendi
 * çizdiği listeyi (sözlükten ya da katalogdan türeyen aynı diziyi) verir.
 * Şemaya sayfada olmayan bir cevap yazmak Google'ın "yapısal veri uyuşmazlığı"
 * cezasıdır; iki kopya metin ise bir gün ayrışır.
 *
 * Boş listede `null` döner (çağıran hiç `<script>` basmaz): `mainEntity: []`
 * taşıyan bir `FAQPage` geçersiz markup'tır.
 *
 * Not: Google 2023'te FAQ zengin sonucunu devlet/sağlık sitelerine daralttı,
 * yani bu işaretlemenin bugünkü faydası AI retrieval ve entity anlama
 * tarafındadır — sayfa görünümünde bir değişiklik beklenmiyor.
 */

/** Sayfanın çizdiği soru-cevap çifti. `3d-baski/sections.tsx`in `FaqEntry`si bu şekli karşılar. */
export interface FaqPair {
  q: string;
  a: string;
}

export function buildFaqPageJsonLd({
  url,
  name,
  items,
}: {
  /** Soruların GÖRÜNDÜĞÜ sayfanın tam adresi. */
  url: string;
  /** Sayfadaki bölüm başlığı ("Sıkça Sorulan Sorular" / "Teklif almadan önce"). */
  name: string;
  items: readonly FaqPair[];
}): Record<string, unknown> | null {
  if (items.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    // Sayfa başına tek SSS bloğu var; `#faq` çıpası `/figur`de gerçek bir
    // çıpa (`<section id="faq">`).
    "@id": `${url}#faq`,
    url,
    name,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}
