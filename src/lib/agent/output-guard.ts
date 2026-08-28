/**
 * Last line of defence on what the agent is allowed to say.
 *
 * The tool schemas already make it impossible for the model to *invent an
 * argument*. This guards the other direction: the free text it writes. Under
 * Turkish consumer law (TKHK m.4) a price stated to a buyer is binding
 * pre-contractual information even when we cannot bill it, so a hallucinated
 * "₺1.999" is a liability the moment it is sent — not when it is charged.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */

/** Any number that reads as money in Turkish: ₺1.399, 1399 TL, "1.399 lira". */
const MONEY_PATTERN = /(?:₺\s*([\d.,]+))|(?:([\d.,]+)\s*(?:tl|try|lira)\b)/giu;

const IBAN_PATTERN = /\bTR\s*\d{2}(?:\s*\d{4}){5}\s*\d{2}\b/i;

/** Words that promise a concession the agent has no authority to grant. */
const DISCOUNT_WORDS = [
  "indirim",
  "kupon",
  "promosyon kodu",
  "kampanya kodu",
  "iskonto",
  "bedava",
  "ücretsiz gönderiyorum",
  "size özel fiyat",
];

export type GuardFailure =
  | "unquoted_price"
  | "iban"
  | "discount_language"
  | "foreign_link"
  | "too_long";

export interface GuardResult {
  ok: boolean;
  failures: GuardFailure[];
  detail?: string;
}

/** Normalise "1.399,00" / "1399" / "1.399" to a comparable digit string. */
function normaliseAmount(raw: string): string {
  return raw.replace(/[^\d]/g, "").replace(/0+$/, "") || raw.replace(/[^\d]/g, "");
}

function allowedOrigins(): string[] {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
  return [app, "https://wa.me", "https://figurunica.com"];
}

/**
 * Check an outbound message against what actually happened this turn.
 *
 * `quotedFormatted` is every price string `quote_item` returned during this
 * turn. A price in the text that is not in that set means the model produced a
 * number instead of looking one up.
 */
export function guardOutboundText(
  text: string,
  quotedFormatted: string[]
): GuardResult {
  const failures: GuardFailure[] = [];
  const details: string[] = [];

  if (text.length > 700) failures.push("too_long");

  const allowed = new Set(quotedFormatted.map(normaliseAmount).filter(Boolean));
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const raw = match[1] ?? match[2] ?? "";
    const normalised = normaliseAmount(raw);
    if (!normalised) continue;
    if (!allowed.has(normalised)) {
      failures.push("unquoted_price");
      details.push(`"${match[0].trim()}" bu turda quote_item'dan gelmedi`);
      break;
    }
  }

  if (IBAN_PATTERN.test(text)) {
    failures.push("iban");
    details.push("mesajda IBAN var — banka bilgisi yalnız /pay sayfasından verilir");
  }

  const lower = text.toLocaleLowerCase("tr");
  for (const word of DISCOUNT_WORDS) {
    if (lower.includes(word)) {
      failures.push("discount_language");
      details.push(`indirim dili: "${word}"`);
      break;
    }
  }

  for (const match of text.matchAll(/https?:\/\/[^\s)]+/gi)) {
    const url = match[0];
    if (!allowedOrigins().some((origin) => url.startsWith(origin))) {
      failures.push("foreign_link");
      details.push(`yabancı bağlantı: ${url.slice(0, 60)}`);
      break;
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    detail: details.length > 0 ? details.join(" · ") : undefined,
  };
}

/**
 * What to send when the model's text cannot be trusted twice in a row.
 *
 * Deliberately NOT silence: the customer asked something and deserves an
 * answer, and a correct price plus a human is strictly better than nothing.
 */
export function deterministicFallback(quotedFormatted: string[]): string {
  const price = quotedFormatted[0];
  return price
    ? `Figürünüzün fiyatı ${price}. Detaylar için sizi bir temsilcimize aktarıyorum.`
    : "Bir saniye — sizi bir temsilcimize aktarıyorum, hemen yardımcı olacaklar.";
}
