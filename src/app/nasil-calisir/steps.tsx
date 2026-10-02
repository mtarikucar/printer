import type { JSX } from "react";
import { FIGURINE_LEAD_DAYS } from "@/lib/config/product-facts";

/**
 * `/nasil-calisir`ın "Sipariş adım adım" listesi — VERİ olarak.
 *
 * Neden sayfadan çıkarıldı: aynı altı adım artık iki yerde okunuyor ve
 * İKİSİNDE AYNI olmak zorunda —
 *   1. sayfadaki numaralı `<ol>` (müşterinin okuduğu),
 *   2. sayfanın yayınladığı `HowTo` JSON-LD'si (makinenin okuduğu).
 * Şemaya sayfada OLMAYAN bir adım metni yazmak Google'ın "yapısal veri
 * uyuşmazlığı" cezasıdır; adımları bir de şemaya kopyalamak ise o ayrışmayı
 * bir gün kendiliğinden üretirdi. Metinler DEĞİŞMEDİ, yalnız tek kaynağa
 * taşındı.
 *
 * Gövde neden düz dize DEĞİL: ekrandaki cümlelerin içinde kalın yazılmış
 * rakamlar var ("5-7 iş günü"). Gövde bu yüzden parçalı: düz metin ve
 * `{ b: … }` (kalın) parçaları. Ekran `<strong>` basar, şema aynı parçaları
 * birleştirip düz metne çevirir (`stepBodyText`) — yani iki çıktı tek
 * kaynaktan türer ve kalın yazılan rakam şemadan DÜŞMEZ.
 *
 * Rakamlar elle yazılmaz: üretim/kargo süresi `FIGURINE_LEAD_DAYS`ten,
 * kapıdan kapıya toplam ikisinin TOPLAMINDAN gelir. Teslim süresi değişince
 * bu üç cümle ve `Offer.shippingDetails` birlikte değişir.
 */

/** Gövdenin bir parçası: düz metin ya da kalın (`<strong>`) metin. */
export type StepSegment = string | { b: string };

export interface HowItWorksStep {
  /** Adımın kalın başlangıcı — ekranda `<strong>`, şemada `HowToStep.name`. */
  name: string;
  body: readonly StepSegment[];
}

export interface HowItWorksSection {
  /** Bölümün GÖRÜNEN başlığı; `HowTo.name` aynı dizeyi taşır. */
  title: string;
  steps: readonly HowItWorksStep[];
}

const { productionMin, productionMax, transitMin, transitMax } = FIGURINE_LEAD_DAYS;
/** Kapıdan kapıya: üretim + kargo. İki ucu da ayrı ayrı toplanır. */
const doorMin = productionMin + transitMin;
const doorMax = productionMax + transitMax;

const TR: HowItWorksSection = {
  title: "Sipariş adım adım",
  steps: [
    {
      name: "Fotoğrafı yükle.",
      body: [
        "Yüzün net göründüğü tek bir fotoğraf yeterlidir. Gerçekçi desende birden fazla fotoğraf (farklı açılar ya da bir çift) yükleyebilirsin.",
      ],
    },
    {
      name: "Tasarım desenini seç.",
      body: ["Gerçekçi, Masalsı Animasyon, Anime, Chibi, Vinil Figür ya da Kil Animasyon."],
    },
    {
      name: "Önizlemeyi onayla.",
      body: [
        "Yapay zekâ destekli hattımız fotoğraftan iki stilize görsel üretir; hangisinin basılacağına sen karar verirsin. Beğenmezsen düzeltiriz — sen onaylamadan üretim başlamaz.",
      ],
    },
    {
      name: "Ödemeni yap.",
      body: [
        "Kredi/banka kartı (PayTR altyapısı, 3D Secure) ya da havale/EFT. Havalede üretim, ödemenin hesaba geçtiği teyit edildikten sonra başlar.",
      ],
    },
    {
      name: "3D model + baskı.",
      body: [
        "Ekibimiz onayladığın görselden baskıya hazır 3D modeli hazırlar; üretici partnerimiz SLA reçineyle basar, destekleri temizler ve kalite kontrolünden geçirir. Bu aşama önizleme onayından sonra ",
        { b: `${productionMin}-${productionMax} iş günü` },
        " sürer.",
      ],
    },
    {
      name: "El boyama ve kargo.",
      body: [
        "Figür boyacı partnerimize geçer, elde boyanır ve Yurtiçi Kargo'ya verilir; teslimat ",
        { b: `${transitMin}-${transitMax} iş günü` },
        " sürer. Kapıdan kapıya toplam süre ",
        { b: `${doorMin}-${doorMax} iş günü` },
        "dür.",
      ],
    },
  ],
};

const EN: HowItWorksSection = {
  title: "An order, step by step",
  steps: [
    {
      name: "Upload the photo.",
      body: [
        "One photo with a clearly visible face is enough. The Realistic template also accepts several photos (different angles, or a couple).",
      ],
    },
    {
      name: "Pick a design template.",
      body: ["Realistic, Storybook, Anime, Chibi, Vinyl, or Claymation."],
    },
    {
      name: "Approve the preview.",
      body: [
        "Our AI-assisted pipeline turns the photo into two stylized images; you choose which one gets printed. Not happy? We revise it — nothing is produced until you approve.",
      ],
    },
    {
      name: "Pay.",
      body: [
        "Card (via PayTR, 3D Secure) or bank transfer. With a bank transfer, production starts once we confirm the money has landed.",
      ],
    },
    {
      name: "3D model + printing.",
      body: [
        "Our team builds the print-ready 3D model from the image you approved; our manufacturing partner prints it in SLA resin, removes the supports, and quality-checks it. This takes ",
        { b: `${productionMin}-${productionMax} business days` },
        " after preview approval.",
      ],
    },
    {
      name: "Hand painting and shipping.",
      body: [
        "The figurine goes to our painter partner, is painted by hand, and is handed to Yurtiçi Kargo; delivery takes ",
        { b: `${transitMin}-${transitMax} business days` },
        ". Door to door that is ",
        { b: `${doorMin}-${doorMax} business days` },
        ".",
      ],
    },
  ],
};

export const HOW_IT_WORKS_STEPS: Record<"tr" | "en", HowItWorksSection> = {
  tr: TR,
  en: EN,
};

/**
 * Adımın gövdesinin DÜZ METNİ — `HowTo.step[].text`in tam karşılığı.
 *
 * Kalın parçalar metne DAHİL edilir (çıkarılsa şema "Bu aşama önizleme
 * onayından sonra sürer" gibi yarım bir cümle yayınlardı) ve kenar boşlukları
 * kırpılır: ekranda `<strong>` ile düz metin arasındaki boşluk işaretlemenin
 * parçasıdır, şemada cümlenin parçası değildir.
 */
export function stepBodyText(step: HowItWorksStep): string {
  return step.body
    .map((segment) => (typeof segment === "string" ? segment : segment.b))
    .join("")
    .trim();
}

/**
 * Numaralı adım listesi.
 *
 * Sarmalayıcı `<ol>` BİLEREK sınıfsız: `/nasil-calisir`ın `prose` kapsayıcısı
 * `[&_ol]:…` seçicileriyle biçimlendiriyor, yani görünüm sayfadan geliyor ve
 * bu taşıma piksel düzeyinde nötr.
 */
export function HowItWorksSteps({
  steps,
}: {
  steps: readonly HowItWorksStep[];
}): JSX.Element {
  return (
    <ol>
      {steps.map((step) => (
        <li key={step.name}>
          <strong>{step.name}</strong>{" "}
          {step.body.map((segment, i) =>
            typeof segment === "string" ? (
              segment
            ) : (
              <strong key={i}>{segment.b}</strong>
            )
          )}
        </li>
      ))}
    </ol>
  );
}
