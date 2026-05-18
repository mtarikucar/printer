import sharp from "sharp";
import { extname } from "path";

const TURKISH_BANKING_KEYWORDS = [
  "havale",
  "eft",
  "fast",
  "transfer",
  "gönderildi",
  "gonderildi",
  "gönderim",
  "açıklama",
  "aciklama",
  "tutar",
  "miktar",
  "alıcı",
  "alici",
  "gönderen",
  "gonderen",
  "iban",
  "para transferi",
];

export const RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS = 100; // ±1 TL
export const RECEIPT_OCR_MIN_KEYWORD_MATCHES = 1;

export interface OcrResult {
  rawText: string;
  amountKurus?: number;
  iban?: string;
  sender?: string;
  date?: string;
  referenceFound: boolean;
  /** True only when an `expectedReference` substring or fuzzy match was found
   *  AND the fuzzy distance ratio is ≥ FUZZY_REFERENCE_THRESHOLD. */
  referenceFuzzyMatched: boolean;
  keywordMatches: number;
  /** Set when `ocrDekont` is called with `expectedIban`. `true` means the
   *  extracted IBAN matched the expected merchant IBAN exactly; `false` means
   *  a different IBAN was detected (potential fraud signal); `null` means
   *  either no IBAN was extracted OR no expected was supplied. */
  ibanMatchesExpected: boolean | null;
  failureReason?: string;
}

export type OcrConfidence = "high" | "medium" | "low";

/** Minimum Levenshtein-based similarity to count a reference as fuzzy-matched.
 *  0.85 catches single-character OCR mistakes (e.g. O↔0, I↔l) without letting
 *  random alphanumeric noise look like a reference. */
const FUZZY_REFERENCE_THRESHOLD = 0.85;

/**
 * Pre-process the receipt image for OCR: grayscale + normalize + cap width.
 *
 * PDF receipts are NOT auto-processed: rasterising a PDF requires poppler-utils
 * (or a JS alternative like pdf2pic) which isn't in the stock Docker image. PDF
 * uploads therefore fail OCR with `PDF_NOT_SUPPORTED`, land in the `awaiting_review`
 * draft state, and surface to admin for manual confirmation via the drafts panel.
 * If PDF dekonts become common, install poppler-utils and switch this branch to
 * rasterise page 1.
 */
async function preprocessImage(buffer: Buffer, mime: string): Promise<Buffer> {
  if (mime === "application/pdf") {
    throw new Error("PDF_NOT_SUPPORTED");
  }
  return sharp(buffer)
    .rotate() // honor EXIF
    .grayscale()
    .resize({ width: 1500, withoutEnlargement: true })
    .normalize()
    .toBuffer();
}

function parseAmountToKurus(text: string): number | undefined {
  // Match Turkish-formatted amounts: "1.299,50" or "1299,50" or "1299.50".
  // Prefer numbers near "TL" / "₺" / amount keywords.
  const lines = text.split(/\r?\n/);

  const amountRegex = /(\d{1,3}(?:[.\s]\d{3})*[,.](\d{2}))(?:\s*(?:TL|TRY|₺))?/gi;
  const candidates: { value: number; nearKeyword: boolean }[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const nearKeyword =
      lower.includes("tutar") ||
      lower.includes("miktar") ||
      lower.includes("amount") ||
      lower.includes(" tl") ||
      lower.includes("tl ") ||
      lower.endsWith("tl") ||
      lower.includes("₺");

    let match: RegExpExecArray | null;
    while ((match = amountRegex.exec(line)) !== null) {
      const raw = match[1];
      const normalized = raw.replace(/[\s.]/g, "").replace(",", ".");
      const v = Number(normalized);
      if (Number.isFinite(v) && v >= 1) {
        candidates.push({ value: v, nearKeyword });
      }
    }
  }

  if (candidates.length === 0) return undefined;
  // Prefer the largest candidate near a keyword; otherwise the largest overall
  // (figurine payments are the prominent number on the slip).
  const keyworded = candidates.filter((c) => c.nearKeyword);
  const pool = keyworded.length > 0 ? keyworded : candidates;
  const max = pool.reduce((a, b) => (a.value >= b.value ? a : b));
  return Math.round(max.value * 100);
}

function parseIban(text: string): string | undefined {
  const m = text.match(/TR\s*\d[\d\s]{20,30}/i);
  if (!m) return undefined;
  return m[0].replace(/\s+/g, "").toUpperCase().slice(0, 26);
}

function parseDate(text: string): string | undefined {
  const m = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (!m) return undefined;
  const [, d, mo, y] = m;
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseSender(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    if (lower.includes("gönderen") || lower.includes("gonderen") || lower.includes("from")) {
      const cleaned = line.replace(/.*?[:：]\s*/, "").trim();
      if (cleaned && cleaned.length < 80) return cleaned;
    }
  }
  return undefined;
}

function countKeywords(text: string): number {
  const lower = text.toLowerCase();
  return TURKISH_BANKING_KEYWORDS.reduce(
    (n, kw) => (lower.includes(kw) ? n + 1 : n),
    0
  );
}

/**
 * Iterative Levenshtein distance. Standard DP; runs over short strings
 * (reference is ~12 chars). Returns edit distance.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Sliding-window fuzzy match: scan every length-N substring of `haystack`
 * (where N = needle.length) and return true if any has Levenshtein similarity
 * ≥ threshold. `needle` should already be normalised (alphanumeric uppercase).
 */
function fuzzyContains(haystack: string, needle: string, threshold: number): boolean {
  if (needle.length === 0) return false;
  if (haystack.length < needle.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    const window = haystack.slice(i, i + needle.length);
    const distance = levenshtein(window, needle);
    const similarity = 1 - distance / needle.length;
    if (similarity >= threshold) return true;
  }
  return false;
}

function normaliseIban(iban: string): string {
  return iban.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export interface OcrDekontOptions {
  /** Merchant's expected receiving IBAN. When supplied, the result's
   *  `ibanMatchesExpected` is filled in; otherwise it's `null`. */
  expectedIban?: string;
}

export async function ocrDekont(
  buffer: Buffer,
  storageKey: string,
  expectedReference: string,
  options: OcrDekontOptions = {}
): Promise<OcrResult> {
  const ext = extname(storageKey).toLowerCase();
  const mime =
    ext === ".pdf"
      ? "application/pdf"
      : ext === ".png"
      ? "image/png"
      : ext === ".webp"
      ? "image/webp"
      : "image/jpeg";

  let processed: Buffer;
  try {
    processed = await preprocessImage(buffer, mime);
  } catch (err) {
    return {
      rawText: "",
      referenceFound: false,
      referenceFuzzyMatched: false,
      keywordMatches: 0,
      ibanMatchesExpected: null,
      failureReason:
        err instanceof Error ? err.message : "Image preprocessing failed",
    };
  }

  let text = "";
  try {
    // Dynamic import — tesseract.js pulls in wasm which is heavy at module load.
    const { recognize } = await import("tesseract.js");
    const result = await recognize(processed, "tur+eng");
    text = result.data.text ?? "";
  } catch (err) {
    return {
      rawText: "",
      referenceFound: false,
      referenceFuzzyMatched: false,
      keywordMatches: 0,
      ibanMatchesExpected: null,
      failureReason: err instanceof Error ? err.message : "OCR failed",
    };
  }

  // Exact-substring lookup (current behaviour) + fuzzy fallback on the
  // alphanumeric-stripped form. Fuzzy match catches typical single-character
  // OCR errors (O↔0, I↔1↔l, S↔5) without false-positives on random noise.
  const upperText = text.toUpperCase();
  const stripped = upperText.replace(/[^A-Z0-9]/g, "");
  const refUpper = expectedReference.toUpperCase();
  const refStripped = refUpper.replace(/[^A-Z0-9]/g, "");

  const exactFound =
    upperText.includes(refUpper) || stripped.includes(refStripped);
  const fuzzyFound =
    !exactFound &&
    refStripped.length >= 6 &&
    fuzzyContains(stripped, refStripped, FUZZY_REFERENCE_THRESHOLD);

  const referenceFound = exactFound || fuzzyFound;
  const referenceFuzzyMatched = fuzzyFound;

  const iban = parseIban(text);
  const ibanMatchesExpected = options.expectedIban
    ? iban
      ? normaliseIban(iban) === normaliseIban(options.expectedIban)
      : false
    : null;

  return {
    rawText: text,
    amountKurus: parseAmountToKurus(text),
    iban,
    sender: parseSender(text),
    date: parseDate(text),
    referenceFound,
    referenceFuzzyMatched,
    keywordMatches: countKeywords(text),
    ibanMatchesExpected,
  };
}

export function scoreOcr(
  result: OcrResult,
  expectedAmountKurus: number
): OcrConfidence {
  if (result.failureReason) return "low";

  // Hard floor: an extracted IBAN that does NOT match the expected merchant
  // IBAN is a strong fraud signal — never auto-promote, even if amount and
  // reference look right. Force admin review.
  if (result.ibanMatchesExpected === false) return "low";

  const amountOk =
    result.amountKurus !== undefined &&
    Math.abs(result.amountKurus - expectedAmountKurus) <=
      RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS;
  const refOk = result.referenceFound;
  const keywordsOk = result.keywordMatches >= RECEIPT_OCR_MIN_KEYWORD_MATCHES;
  // Boost: matching IBAN substantively strengthens "this is the right payment"
  // signal even when amount or reference parsing has minor errors.
  const ibanOk = result.ibanMatchesExpected === true;

  if (amountOk && refOk && keywordsOk) return "high";
  // Treat an IBAN-confirmed transfer with EITHER amount OR reference as high
  // confidence: the IBAN match is itself a very strong signal that we have
  // the right receipt.
  if (ibanOk && (amountOk || refOk)) return "high";
  if (amountOk || refOk) return "medium";
  return "low";
}
