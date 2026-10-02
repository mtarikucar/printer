import type { FigurunicaDict } from "./dict";

/**
 * `/figur` SSS bölümünün sekiz soru-cevabı — TEK kaynak.
 *
 * Neden ayrı bir modül: bu liste iki yerde okunuyor ve İKİSİNDE AYNI olmak
 * zorunda —
 *   1. ekrandaki akordeon (`faq.tsx`, `"use client"`),
 *   2. sayfanın yayınladığı `FAQPage` JSON-LD'si (`figur/page.tsx`, sunucu).
 * Sunucu bileşeni `"use client"` taşıyan bir modülden saf veri ithal edemez
 * (ithal ettiği her şey istemci referansı olur), bu yüzden liste tarafsız bir
 * dosyada duruyor. Şemaya sayfada OLMAYAN bir cevap yazmak Google'ın "yapısal
 * veri uyuşmazlığı" cezası; iki ayrı dizi tutmak ise o ayrışmayı bir gün
 * kendiliğinden üretirdi.
 *
 * Soru/cevapların METNİ değişmedi: yalnız tek bir yerden okunuyor.
 */
export function figurineFaqItems(
  d: FigurunicaDict
): Array<{ q: string; a: string }> {
  return [
    { q: d["landing.faq.q1"], a: d["landing.faq.a1"] },
    { q: d["landing.faq.q2"], a: d["landing.faq.a2"] },
    { q: d["landing.faq.q3"], a: d["landing.faq.a3"] },
    { q: d["landing.faq.q4"], a: d["landing.faq.a4"] },
    { q: d["landing.faq.q5"], a: d["landing.faq.a5"] },
    { q: d["landing.faq.q6"], a: d["landing.faq.a6"] },
    { q: d["landing.faq.q7"], a: d["landing.faq.a7"] },
    { q: d["landing.faq.q8"], a: d["landing.faq.a8"] },
  ];
}
