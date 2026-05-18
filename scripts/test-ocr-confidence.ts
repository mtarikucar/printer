// Q1 + Q8 — pure-logic tests for scoreOcr. This function decides
// whether an OCR-parsed dekont auto-promotes to paid (high), goes
// to admin review (medium/low), or hard-fails. The decisions drive
// money flow so the boundaries need explicit lock-in.
//
// Run: npx tsx scripts/test-ocr-confidence.ts

import {
  scoreOcr,
  type OcrResult,
  RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS,
  RECEIPT_OCR_MIN_KEYWORD_MATCHES,
} from "../src/lib/services/dekont-ocr";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EXPECTED = 139900; // ₺1399.00 (orta figurine price)

function base(overrides: Partial<OcrResult> = {}): OcrResult {
  return {
    rawText: "synthetic",
    referenceFound: false,
    referenceFuzzyMatched: false,
    keywordMatches: 0,
    ibanMatchesExpected: null,
    bank: "generic",
    ...overrides,
  };
}

// ─── Hard floors ─────────────────────────────────────────────────
check(
  "failureReason → low (any other signals ignored)",
  scoreOcr(
    base({
      failureReason: "PDF_RASTERIZE_FAILED",
      amountKurus: EXPECTED,
      referenceFound: true,
      keywordMatches: 10,
      ibanMatchesExpected: true,
    }),
    EXPECTED
  ) === "low"
);

check(
  "ibanMatchesExpected=false → low (fraud signal, hard floor)",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: true,
      keywordMatches: 10,
      ibanMatchesExpected: false, // wrong IBAN — never promote
    }),
    EXPECTED
  ) === "low"
);

// ─── High path: amount + ref + keywords ──────────────────────────
check(
  "amount + ref + keywords → high",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: true,
      keywordMatches: RECEIPT_OCR_MIN_KEYWORD_MATCHES,
    }),
    EXPECTED
  ) === "high"
);

check(
  "amount within tolerance + ref + keywords → high",
  scoreOcr(
    base({
      amountKurus: EXPECTED + RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS,
      referenceFound: true,
      keywordMatches: 2,
    }),
    EXPECTED
  ) === "high"
);

check(
  "amount exceeds tolerance by 1 kuruş → not high (drops to medium via refOk)",
  scoreOcr(
    base({
      amountKurus: EXPECTED + RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS + 1,
      referenceFound: true,
      keywordMatches: 2,
    }),
    EXPECTED
  ) === "medium"
);

// ─── IBAN boost path ─────────────────────────────────────────────
// Even with weaker signals (only amount OR only ref), IBAN match
// alone elevates to high.
check(
  "iban match + amount only (no ref, no keywords) → high",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: false,
      keywordMatches: 0,
      ibanMatchesExpected: true,
    }),
    EXPECTED
  ) === "high"
);

check(
  "iban match + ref only (amount missing) → high",
  scoreOcr(
    base({
      amountKurus: undefined,
      referenceFound: true,
      keywordMatches: 0,
      ibanMatchesExpected: true,
    }),
    EXPECTED
  ) === "high"
);

check(
  "iban match alone (no amount, no ref) → NOT high (still medium/low)",
  scoreOcr(
    base({
      amountKurus: undefined,
      referenceFound: false,
      keywordMatches: 0,
      ibanMatchesExpected: true,
    }),
    EXPECTED
  ) !== "high"
);

// ─── Medium path: only one of amount/ref ────────────────────────
check(
  "amount only → medium",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: false,
      keywordMatches: 10,
    }),
    EXPECTED
  ) === "medium"
);

check(
  "ref only → medium",
  scoreOcr(
    base({
      referenceFound: true,
      keywordMatches: 0,
    }),
    EXPECTED
  ) === "medium"
);

// ─── Low path: nothing parsed ────────────────────────────────────
check(
  "no signals → low",
  scoreOcr(base(), EXPECTED) === "low"
);

check(
  "only keywords (no amount, no ref) → low",
  scoreOcr(
    base({ keywordMatches: 5 }),
    EXPECTED
  ) === "low"
);

// ─── High path requires keywords too ─────────────────────────────
// Subtle: amount + ref but zero keywords → drops to medium, not high
check(
  "amount + ref + ZERO keywords → not high (keywords are part of high gate)",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: true,
      keywordMatches: 0,
    }),
    EXPECTED
  ) !== "high"
);

// ─── ibanMatchesExpected null (no expected supplied) ────────────
// Should behave as if IBAN check wasn't done at all — fall through to
// regular amount+ref+keywords path.
check(
  "ibanMatchesExpected=null + amount + ref + keywords → high",
  scoreOcr(
    base({
      amountKurus: EXPECTED,
      referenceFound: true,
      keywordMatches: 2,
      ibanMatchesExpected: null,
    }),
    EXPECTED
  ) === "high"
);

// ─── Tolerance boundary on negative side ─────────────────────────
check(
  "amount under by tolerance → still within (high path)",
  scoreOcr(
    base({
      amountKurus: EXPECTED - RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS,
      referenceFound: true,
      keywordMatches: 2,
    }),
    EXPECTED
  ) === "high"
);

check(
  "amount under by tolerance+1 → out of tolerance",
  scoreOcr(
    base({
      amountKurus: EXPECTED - RECEIPT_OCR_AMOUNT_TOLERANCE_KURUS - 1,
      referenceFound: true,
      keywordMatches: 2,
    }),
    EXPECTED
  ) === "medium"
);

console.log(`\n${pass}/${pass + fail} ocr-confidence checks passed`);
if (fail > 0) process.exit(1);
