// Smoke test for Q1 bank-specific dekont parsers.
//
// Two modes:
//   default → synthetic text through detectBank + extractByBank (fast)
//   --pdf   → synthesize a PDF per fixture with pdfkit, then run the full
//             ocrDekont pipeline (pdftoppm → sharp → tesseract → parser).
//             Requires `pdftoppm` in PATH (installed in the Docker base
//             stage; on dev machines without it, --pdf gracefully skips).
//
// Run with: npx tsx scripts/test-dekont-parsers.ts
//      or:  npx tsx scripts/test-dekont-parsers.ts --pdf

import { execFileSync } from "node:child_process";
import { detectBank, extractByBank, ocrDekont } from "../src/lib/services/dekont-ocr";

interface Fixture {
  name: string;
  text: string;
  expectedBank: ReturnType<typeof detectBank>;
  expected: {
    amountKurus?: number;
    iban?: string;
    sender?: string;
    date?: string;
  };
}

const fixtures: Fixture[] = [
  {
    name: "Garanti — inline labels",
    text: `GARANTİ BBVA
İşlem Detayı
İşlem Tarihi: 14.05.2026
Gönderen: AYŞE YILMAZ
Alıcı IBAN: TR12 0006 2000 0000 0000 0000 00
Toplam Tutar: 1.399,00 TL
Açıklama: FIG-ABC123`,
    expectedBank: "garanti",
    expected: {
      amountKurus: 139900,
      iban: "TR120006200000000000000000",
      sender: "AYŞE YILMAZ",
      date: "2026-05-14",
    },
  },
  {
    name: "Ziraat — stacked labels",
    text: `T.C. ZİRAAT BANKASI A.Ş.
Para Transferi Dekontu
Tarih
14.05.2026
Gönderen Ad Soyad
MEHMET KAYA
Alıcı IBAN
TR55 0001 0000 0000 0000 0000 00
Tutar (TL)
1.299,50
Açıklama: FIG-XYZ789`,
    expectedBank: "ziraat",
    expected: {
      amountKurus: 129950,
      iban: "TR550001000000000000000000",
      sender: "MEHMET KAYA",
      date: "2026-05-14",
    },
  },
  {
    name: "İş Bankası — no colons",
    text: `TÜRKİYE İŞ BANKASI A.Ş.
İŞBANK Dekont
İşlem Tarihi  14/05/2026
Gönderen     ALİ DEMİR
Karşı IBAN   TR99 0006 4000 0001 1111 2222 33
İşlem Tutarı 1.799,00 TL
Açıklama     FIG-IJK456`,
    expectedBank: "is_bankasi",
    expected: {
      amountKurus: 179900,
      iban: "TR990006400000011111222233",
      sender: "ALİ DEMİR",
      date: "2026-05-14",
    },
  },
  {
    name: "Yapı Kredi — mixed layout",
    text: `Yapı Kredi Bankası A.Ş.
Para Transferi Dekontu
İşlem Tarihi: 14.05.2026
Gönderen: ZEYNEP DEMİREL
Alıcı IBAN: TR33 0006 7000 0000 1234 5678 90
Tutar: 999,00 TL
Açıklama: FIG-YKB777`,
    expectedBank: "yapi_kredi",
    expected: {
      amountKurus: 99900,
      iban: "TR330006700000001234567890",
      sender: "ZEYNEP DEMİREL",
      date: "2026-05-14",
    },
  },
  {
    name: "Akbank — standard layout",
    text: `AKBANK T.A.Ş.
EFT/Havale Dekontu
İşlem Tarihi 14/05/2026
Gönderen FATMA ÖZKAN
Alıcı IBAN TR47 0004 6000 0000 0000 0099 88
İşlem Tutarı 1.999,99 TL
Açıklama FIG-AKB123`,
    expectedBank: "akbank",
    expected: {
      amountKurus: 199999,
      iban: "TR470004600000000000009988",
      sender: "FATMA ÖZKAN",
      date: "2026-05-14",
    },
  },
  {
    name: "Unknown bank — detection falls back to generic",
    text: `RANDOM HOLDING BANK
A Receipt
Tutar: 99,00 TL`,
    expectedBank: "generic",
    expected: {},
  },
];

let pass = 0;
let fail = 0;

for (const fx of fixtures) {
  const bank = detectBank(fx.text);
  const result = extractByBank(bank, fx.text);

  const checks: Array<[string, unknown, unknown]> = [
    ["bank", bank, fx.expectedBank],
  ];
  if (fx.expected.amountKurus !== undefined)
    checks.push(["amountKurus", result.amountKurus, fx.expected.amountKurus]);
  if (fx.expected.iban !== undefined)
    checks.push(["iban", result.iban, fx.expected.iban]);
  if (fx.expected.sender !== undefined)
    checks.push(["sender", result.sender, fx.expected.sender]);
  if (fx.expected.date !== undefined)
    checks.push(["date", result.date, fx.expected.date]);

  let ok = true;
  const lines: string[] = [];
  for (const [field, got, want] of checks) {
    if (got !== want) {
      ok = false;
      lines.push(`    ${field}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  }
  if (ok) {
    console.log(`✓ ${fx.name}`);
    pass++;
  } else {
    console.log(`✗ ${fx.name}`);
    for (const line of lines) console.log(line);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} fixtures passed`);
if (fail > 0) process.exit(1);

// ─── PDF mode (--pdf flag) ─────────────────────────────────────
//
// Synthesizes a minimal one-page PDF from each fixture's text, then runs
// the full ocrDekont() pipeline. Verifies the pdftoppm rasterize → sharp
// → tesseract chain works end-to-end. We don't assert exact field
// equality because tesseract introduces noise on rasterized synthetic
// PDFs — instead we assert bank detection still resolves correctly,
// which is the most stable signal across OCR noise.

async function runPdfMode() {
  // Verify pdftoppm is available; skip gracefully if not (dev machines
  // without poppler-utils installed should still be able to run the
  // default text-mode tests above).
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
  } catch {
    console.log(
      "\n[--pdf] pdftoppm not found in PATH — skipping PDF mode. " +
        "Install poppler-utils to enable."
    );
    return;
  }

  // pdfkit is required only in --pdf mode. Dynamic import so the default
  // mode doesn't pay the cost on machines that never run --pdf.
  const PDFDocumentMod = await import("pdfkit");
  const PDFDocument = (PDFDocumentMod.default ??
    PDFDocumentMod) as typeof import("pdfkit");

  function synthesizePdf(text: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      // Use a font size large enough that tesseract has a chance on the
      // ~200 DPI rasterized output.
      doc.fontSize(14).text(text, { lineGap: 4 });
      doc.end();
    });
  }

  console.log("\n[--pdf] Running OCR pipeline on synthesized PDFs…");
  let pdfPass = 0;
  let pdfFail = 0;

  for (const fx of fixtures) {
    if (fx.expectedBank === "generic") continue; // bank detection signal only
    try {
      const pdf = await synthesizePdf(fx.text);
      const result = await ocrDekont(pdf, "test.pdf", "FIG-NONE");
      if (result.failureReason) {
        console.log(`✗ ${fx.name} (PDF): ${result.failureReason}`);
        pdfFail++;
        continue;
      }
      // Soft assertion: bank detection should still resolve. OCR noise
      // doesn't tend to corrupt the bank header on a clean synthesized PDF.
      if (result.bank === fx.expectedBank) {
        console.log(`✓ ${fx.name} (PDF) — bank detected: ${result.bank}`);
        pdfPass++;
      } else {
        console.log(
          `✗ ${fx.name} (PDF) — expected bank ${fx.expectedBank}, got ${result.bank}`
        );
        console.log(`    OCR text snippet: ${result.rawText.slice(0, 120)}…`);
        pdfFail++;
      }
    } catch (err) {
      console.log(
        `✗ ${fx.name} (PDF) threw: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      pdfFail++;
    }
  }

  console.log(`\n[--pdf] ${pdfPass}/${pdfPass + pdfFail} PDF fixtures passed`);
  if (pdfFail > 0) process.exit(1);
}

if (process.argv.includes("--pdf")) {
  runPdfMode().catch((err) => {
    console.error("[--pdf] runner failed:", err);
    process.exit(1);
  });
}
