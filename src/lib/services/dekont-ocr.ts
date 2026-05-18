import sharp from "sharp";
import { extname } from "path";
import { execFile } from "node:child_process";

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

export type DetectedBank =
  | "garanti"
  | "ziraat"
  | "is_bankasi"
  | "yapi_kredi"
  | "akbank"
  | "generic";

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
  /** Issuer bank identified from header keywords. Defaults to "generic" if
   *  no bank-specific pattern matched; downstream logging uses this to track
   *  per-bank parser accuracy. */
  bank: DetectedBank;
  failureReason?: string;
}

export type OcrConfidence = "high" | "medium" | "low";

/** Minimum Levenshtein-based similarity to count a reference as fuzzy-matched.
 *  0.85 catches single-character OCR mistakes (e.g. O↔0, I↔l) without letting
 *  random alphanumeric noise look like a reference. */
const FUZZY_REFERENCE_THRESHOLD = 0.85;

/**
 * Rasterize a PDF buffer's first page to a PNG buffer using poppler-utils'
 * `pdftoppm` CLI. The Docker base stage installs `poppler-utils`. -r 200
 * gives us ~200 DPI which is enough for tesseract on typical dekonts
 * without ballooning RAM. -f 1 -l 1 limits to page 1 (most dekonts are
 * one page; multi-page ones still have summary info on page 1).
 *
 * `pdftoppm - -` reads PDF from stdin and writes PNG to stdout via the
 * `-png` flag, so we never touch the filesystem.
 */
function rasterizePdfToPng(pdfBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "pdftoppm",
      ["-r", "200", "-png", "-f", "1", "-l", "1", "-", "-"],
      {
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        // Defense against a maliciously-crafted PDF that hangs pdftoppm.
        // Normal single-page rasterization completes in <2s; 30s gives
        // plenty of headroom for unusually large/dense pages while
        // still bounding worst-case worker stall.
        timeout: 30_000,
      },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        if (!stdout || (stdout as Buffer).length === 0) {
          reject(new Error("pdftoppm produced no output"));
          return;
        }
        resolve(stdout as Buffer);
      }
    );
    child.stdin?.end(pdfBuffer);
  });
}

/**
 * Pre-process the receipt image for OCR: grayscale + normalize + cap width.
 *
 * PDF receipts are rasterised to a PNG via `pdftoppm` (poppler-utils,
 * installed in the Docker base stage) so they go through the same sharp
 * pipeline as image uploads. If pdftoppm fails (corrupt PDF, missing
 * binary in dev), we surface `PDF_RASTERIZE_FAILED` and the worker drops
 * the draft into the `awaiting_review` state — same fallback as before
 * the Q1 PDF-support ship.
 */
async function preprocessImage(buffer: Buffer, mime: string): Promise<Buffer> {
  let workingBuffer = buffer;
  if (mime === "application/pdf") {
    try {
      workingBuffer = await rasterizePdfToPng(buffer);
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "Unknown pdftoppm error";
      throw new Error(`PDF_RASTERIZE_FAILED: ${reason}`);
    }
  }
  return sharp(workingBuffer)
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

// ─── Bank-specific parsing (Q1) ────────────────────────────────────
//
// Each Turkish bank lays out its dekont slip differently. The generic
// regex-based parsers above work on most slips but lose precision when the
// amount appears next to non-amount numbers (account #, reference #) or
// when "Gönderen" is on a label-only line and the actual name follows on
// the next line. The functions below add a labeled-field extractor that
// runs first; the generic parsers stay as a fallback when the bank parser
// returns nothing.

interface BankConfig {
  /** Header keywords that identify the bank. Case-insensitive substring match. */
  detect: string[];
  /** Label variants the bank uses for each field. We look on the same line
   *  first (after a `:` or `-`) and then on the next non-empty line. */
  amountLabels: string[];
  ibanLabels: string[];
  senderLabels: string[];
  dateLabels: string[];
}

const BANK_CONFIGS: Record<Exclude<DetectedBank, "generic">, BankConfig> = {
  garanti: {
    detect: ["garanti bbva", "garanti bankası", "garanti bankasi", "garantibbva"],
    amountLabels: ["toplam tutar", "işlem tutarı", "islem tutari", "tutar"],
    ibanLabels: ["alıcı iban", "alici iban", "karşı hesap iban", "karsi hesap iban", "iban"],
    senderLabels: ["gönderen", "gonderen"],
    dateLabels: ["işlem tarihi", "islem tarihi", "tarih"],
  },
  ziraat: {
    detect: ["ziraat bankası", "ziraat bankasi", "t.c. ziraat", "tc ziraat", "ziraatbank"],
    amountLabels: ["tutar (tl)", "işlem tutarı", "islem tutari", "tutar"],
    ibanLabels: ["alıcı iban", "alici iban", "iban"],
    senderLabels: ["gönderen ad soyad", "gonderen ad soyad", "gönderen", "gonderen"],
    dateLabels: ["işlem tarihi", "islem tarihi", "tarih"],
  },
  is_bankasi: {
    detect: ["türkiye iş bankası", "turkiye is bankasi", "iş bankası", "is bankasi", "işbank", "isbank"],
    amountLabels: ["işlem tutarı", "islem tutari", "tutar"],
    ibanLabels: ["alıcı iban", "alici iban", "karşı iban", "karsi iban", "iban"],
    senderLabels: ["gönderen", "gonderen"],
    dateLabels: ["işlem tarihi", "islem tarihi", "tarih"],
  },
  yapi_kredi: {
    detect: ["yapı kredi", "yapi kredi", "yapikredi"],
    amountLabels: ["tutar", "işlem tutarı", "islem tutari"],
    ibanLabels: ["alıcı iban", "alici iban", "iban"],
    senderLabels: ["gönderen", "gonderen"],
    dateLabels: ["işlem tarihi", "islem tarihi", "tarih"],
  },
  akbank: {
    detect: ["akbank"],
    amountLabels: ["tutar", "işlem tutarı", "islem tutari"],
    ibanLabels: ["alıcı iban", "alici iban", "iban"],
    senderLabels: ["gönderen", "gonderen"],
    dateLabels: ["işlem tarihi", "islem tarihi", "tarih"],
  },
};

/**
 * Lower-case + strip combining diacritics so Turkish "İ"/"Ş"/"Ğ"/"Ç" all
 * match against ASCII-only keyword forms ("garanti", "is bankasi"). Tesseract
 * occasionally emits the combining-dot form even when the visual text is plain
 * Turkish, so we normalise both sides of the match.
 */
function foldForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function detectBank(text: string): DetectedBank {
  const folded = foldForMatch(text);
  for (const [bank, cfg] of Object.entries(BANK_CONFIGS) as Array<
    [Exclude<DetectedBank, "generic">, BankConfig]
  >) {
    if (cfg.detect.some((kw) => folded.includes(foldForMatch(kw)))) return bank;
  }
  return "generic";
}

/**
 * Find the value associated with one of the given labels. Tries inline first
 * ("Tutar: 1.299,50") then the next non-empty line ("Tutar\n1.299,50"). Returns
 * the raw value string (caller parses to typed value).
 */
function extractLabelledValue(
  text: string,
  labels: string[]
): string | undefined {
  const lines = text.split(/\r?\n/);
  // Pre-fold labels and each line for Turkish-aware matching, but slice into
  // the ORIGINAL line (preserving diacritics + casing) to return the value
  // unchanged for downstream display.
  const foldedLabels = labels.map((l) => foldForMatch(l));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const folded = foldForMatch(line);
    for (const label of foldedLabels) {
      const idx = folded.indexOf(label);
      if (idx === -1) continue;
      // Inline: "Tutar: 1.299,50 TL". We slice the original line by the same
      // index — NFD-stripping changes character count when combining marks
      // exist, but in practice Turkish dekonts use the precomposed forms so
      // indices align. If not, the tail will still trim cleanly because we
      // strip leading punctuation.
      const tail = line
        .slice(idx + label.length)
        .replace(/^[\s:\-—–]+/, "")
        .trim();
      if (tail) return tail;
      // Stacked: value on the next non-empty line.
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const cand = lines[j].trim();
        if (cand) return cand;
      }
    }
  }
  return undefined;
}

function parseAmountStringToKurus(raw: string): number | undefined {
  const match = raw.match(/(\d{1,3}(?:[.\s]\d{3})*[,.]\d{2})/);
  if (!match) return undefined;
  const normalized = match[1].replace(/[\s.]/g, "").replace(",", ".");
  const v = Number(normalized);
  if (!Number.isFinite(v) || v < 1) return undefined;
  return Math.round(v * 100);
}

/**
 * Run the bank-specific extractors. Returned fields override the generic
 * parsers only when defined — undefined leaves the generic value intact.
 */
export function extractByBank(
  bank: DetectedBank,
  text: string
): {
  amountKurus?: number;
  iban?: string;
  sender?: string;
  date?: string;
} {
  if (bank === "generic") return {};
  const cfg = BANK_CONFIGS[bank];

  const amountRaw = extractLabelledValue(text, cfg.amountLabels);
  const amountKurus = amountRaw ? parseAmountStringToKurus(amountRaw) : undefined;

  const ibanRaw = extractLabelledValue(text, cfg.ibanLabels);
  const ibanMatch = ibanRaw?.match(/TR\s*\d[\d\s]{20,30}/i);
  const iban = ibanMatch
    ? ibanMatch[0].replace(/\s+/g, "").toUpperCase().slice(0, 26)
    : undefined;

  const sender = extractLabelledValue(text, cfg.senderLabels)?.slice(0, 80);

  const dateRaw = extractLabelledValue(text, cfg.dateLabels);
  let date: string | undefined;
  if (dateRaw) {
    const m = dateRaw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (m) {
      const [, d, mo, y] = m;
      const yyyy = y.length === 2 ? `20${y}` : y;
      date = `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return { amountKurus, iban, sender, date };
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
      bank: "generic",
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
      bank: "generic",
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

  // Bank detection → bank-specific labeled-value extraction → generic
  // regex fallback. Each field prefers the bank parser's answer if defined.
  const bank = detectBank(text);
  const bankFields = extractByBank(bank, text);

  const iban = bankFields.iban ?? parseIban(text);
  const ibanMatchesExpected = options.expectedIban
    ? iban
      ? normaliseIban(iban) === normaliseIban(options.expectedIban)
      : false
    : null;

  return {
    rawText: text,
    amountKurus: bankFields.amountKurus ?? parseAmountToKurus(text),
    iban,
    sender: bankFields.sender ?? parseSender(text),
    date: bankFields.date ?? parseDate(text),
    referenceFound,
    referenceFuzzyMatched,
    keywordMatches: countKeywords(text),
    ibanMatchesExpected,
    bank,
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
