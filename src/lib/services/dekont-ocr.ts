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
  keywordMatches: number;
  failureReason?: string;
}

export type OcrConfidence = "high" | "medium" | "low";

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

export async function ocrDekont(
  buffer: Buffer,
  storageKey: string,
  expectedReference: string
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
      keywordMatches: 0,
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
      keywordMatches: 0,
      failureReason: err instanceof Error ? err.message : "OCR failed",
    };
  }

  const normalizedText = text.replace(/\s+/g, " ");
  const referenceFound = normalizedText
    .toUpperCase()
    .includes(expectedReference.toUpperCase()) ||
    normalizedText
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .includes(expectedReference.replace(/[^A-Z0-9]/gi, "").toUpperCase());

  return {
    rawText: text,
    amountKurus: parseAmountToKurus(text),
    iban: parseIban(text),
    sender: parseSender(text),
    date: parseDate(text),
    referenceFound,
    keywordMatches: countKeywords(text),
  };
}

export function scoreOcr(
  result: OcrResult,
  expectedAmountKurus: number
): OcrConfidence {
  if (result.failureReason) return "low";

  const amountOk =
    result.amountKurus !== undefined &&
    Math.abs(result.amountKurus - expectedAmountKurus) <=
      RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS;
  const refOk = result.referenceFound;
  const keywordsOk = result.keywordMatches >= RECEIPT_OCR_MIN_KEYWORD_MATCHES;

  if (amountOk && refOk && keywordsOk) return "high";
  if (amountOk || refOk) return "medium";
  return "low";
}
