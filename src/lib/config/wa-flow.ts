import { APPROVAL_BUTTONS } from "@/lib/config/whatsapp";

/**
 * Fixed UI blocks and canonical FAQ answers.
 *
 * The agent picks a block by name; the wording and the button labels are ours.
 * That is what stops a model from writing its own refund policy, and it is why
 * `emit_reply` cannot produce a button label: Meta caps titles at 20 characters
 * and, more importantly, the version of a legal answer a customer screenshots
 * has to be the binding one.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */

export interface UiBlock {
  buttons?: Array<{ id: string; title: string }>;
  suffix?: string;
}

export function renderUiBlock(ui: string): UiBlock {
  switch (ui) {
    case "variation_choice":
      return {
        buttons: [
          { id: "var:0", title: "1. görsel" },
          { id: "var:1", title: "2. görsel" },
          { id: "var:retry", title: "Yeniden üret" },
        ],
      };
    case "address_confirm":
      return {
        buttons: [
          { id: "addr:ok", title: "Doğru" },
          { id: "addr:fix", title: "Düzeltmek istiyorum" },
        ],
      };
    case "pay_prompt":
      return { suffix: "\n\nÖdeme linkinden kartla veya havaleyle ödeyebilirsiniz." };
    case "model_approval":
      return { buttons: [...APPROVAL_BUTTONS] };
    case "photo_retry":
      return {
        suffix:
          "\n\nİpucu: yüzün net göründüğü, iyi ışıklı ve yakın çekilmiş bir kare en iyi sonucu veriyor.",
      };
    case "multi_subject":
      return { suffix: "\n\nFotoğraftaki kişilerden hangisinin figürünü istiyorsunuz?" };
    case "style_picker":
    case "none":
    default:
      return {};
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";

/**
 * Canonical answers. Each carries the page it was derived from so a CI check
 * can flag it when that page changes — a stale legal answer in a chat is worse
 * than no answer.
 */
export const FAQ_ANSWERS: Record<string, { text: string; sourcePage: string }> = {
  kargo: {
    text: `Kargo ücretsiz, Türkiye'nin her yerine gönderiyoruz. Detaylar: ${APP_URL}/kargo`,
    sourcePage: "/kargo",
  },
  sure: {
    text: `Fotoğrafı aldıktan sonra görselleri dakikalar içinde hazırlıyoruz. Ödeme ve onaydan sonra üretim + kargo tipik olarak 7-14 gün sürüyor. Detaylar: ${APP_URL}/kargo`,
    sourcePage: "/kargo",
  },
  iade: {
    text: `İade ve cayma hakkınızın nasıl işlediğini burada yazdık: ${APP_URL}/iade`,
    sourcePage: "/iade",
  },
  malzeme: {
    text: "Figürler SLA reçine ile basılıyor; ince detayları en iyi bu teknoloji çıkarıyor. Ardından profesyonel olarak elde boyanıyor.",
    sourcePage: "/nasil-calisir",
  },
  boyut: {
    text: "Standart figür 15 cm boyunda ve sergilemeye hazır bir kaidenin üzerinde geliyor.",
    sourcePage: "/figur",
  },
  fiyat_genel: {
    text: `Fiyatlar ürün sayfamızda: ${APP_URL}/figur`,
    sourcePage: "/figur",
  },
  hediye: {
    text: "Hediye paketi seçeneğimiz var; sipariş sırasında ekleyebilirsiniz. Hediye kartı da satıyoruz.",
    sourcePage: "/hediye-karti",
  },
  boyama: {
    text: "Figürünüz profesyonel olarak elde boyanmış hâlde, sergilemeye hazır geliyor.",
    sourcePage: "/figur",
  },
  kvkk: {
    text: `Fotoğrafınızın nasıl işlendiğini ve hangi hizmet sağlayıcılara aktarıldığını KVKK aydınlatma metnimizde yazdık: ${APP_URL}/privacy`,
    sourcePage: "/privacy",
  },
  toptan: {
    text: `Toplu sipariş için ayrı bir akışımız var: ${APP_URL}/toplu-siparis`,
    sourcePage: "/toplu-siparis",
  },
  atolye: {
    text: `Mekânınızda atölye düzenlememizi isterseniz buradan başvurabilirsiniz: ${APP_URL}/atolye`,
    sourcePage: "/atolye",
  },
  odeme: {
    text: "Kredi kartı ve havale/EFT kabul ediyoruz. Havale ile ödeyenlere %3 indirim uyguluyoruz.",
    sourcePage: "/on-bilgilendirme",
  },
};
