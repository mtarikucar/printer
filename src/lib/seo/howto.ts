/**
 * `HowTo` JSON-LD yayıcısı.
 *
 * Denetim (2026-10-02): sitede iki NUMARALI adım listesi işaretsiz duruyordu —
 * `/3d-baski`nin dört adımı ve `/nasil-calisir`ın altı adımlık `<ol>`si.
 * Numaralandırma bilgi taşıyor (adımlar gerçekten sıralı), ama makine için
 * sırasız bir metin yığınıydı.
 *
 * TEK KURAL — `faq.ts` ile aynı: şemadaki metin, sayfada GÖRÜNEN metnin
 * birebir aynısıdır. Builder metin ÜRETMEZ; çağıran, `<ol>`ün çizildiği AYNI
 * diziyi verir. Bu yüzden `/nasil-calisir`ın altı adımı bu sevkiyatta sayfadan
 * çıkarılıp bir veri modülüne (`app/nasil-calisir/steps.tsx`) taşındı: liste
 * ile şema aynı kaynaktan okumadıkça "birebir" bir temenniden ibaret kalır.
 *
 * Boş listede `null` döner (çağıran hiç `<script>` basmaz): adımsız bir `HowTo`
 * geçersiz markup'tır.
 *
 * Not: Google 2023'te HowTo zengin sonucunu kaldırdı, yani bu işaretlemenin
 * bugünkü faydası AI retrieval tarafındadır — asistan "nasıl sipariş
 * veriyorum" sorusuna sıralı adımlarla cevap verebilsin diye.
 */

export interface HowToStepInput {
  /** Adımın GÖRÜNEN kısa başlığı ("Fotoğrafı yükle."). */
  name: string;
  /** Adımın GÖRÜNEN gövdesi; kalın yazılmış rakamlar dâhil, düz metin olarak. */
  text: string;
}

export function buildHowToJsonLd({
  url,
  name,
  steps,
}: {
  /** Adımların GÖRÜNDÜĞÜ sayfanın tam adresi. */
  url: string;
  /** Sayfadaki bölüm başlığı ("Sipariş adım adım" / "Dosyadan üretime dört adım"). */
  name: string;
  steps: readonly HowToStepInput[];
}): Record<string, unknown> | null {
  if (steps.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    "@id": `${url}#howto`,
    url,
    name,
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      // `position` 1'den başlar: ekrandaki numaralandırmanın aynısı.
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };
}
