// Smoke test for Q1 bank-specific dekont parsers.
//
// Runs synthetic dekont text (no real OCR) through detectBank + extractByBank
// to verify each bank's labeled-value extractor pulls the correct amount,
// IBAN, sender, and date. Skips the actual tesseract step.
//
// Run with: npx tsx scripts/test-dekont-parsers.ts

import { detectBank, extractByBank } from "../src/lib/services/dekont-ocr";

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
