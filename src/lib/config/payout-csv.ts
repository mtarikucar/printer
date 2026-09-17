import type { PayoutListRow, PayoutListScope } from "./payout-list";

/** RFC4180 cells with spreadsheet-formula protection. No database or I/O. */
export const CSV_BOM = "\uFEFF";
declare const encodedCsvCell: unique symbol;
export type CsvCell = string & { readonly [encodedCsvCell]: true };

const quote = (text: string): CsvCell => `"${text.replaceAll('"', '""')}"` as CsvCell;

/** All identifiers, labels, timestamps, reasons and JSON use this text branch. */
export function csvText(text: string): CsvCell {
  if (typeof text !== "string") throw new TypeError("CSV metin hücresi metin olmalıdır.");
  // Spreadsheet importers may skip Unicode whitespace, invisible format marks
  // and controls. Quoting does not prevent formula execution after that skip.
  const prefix = text.match(/^[\p{White_Space}\p{Cc}\p{Cf}]*/u)![0];
  const first = text.slice(prefix.length, prefix.length + 1);
  const dangerous = /^[=+@-]$/.test(first) || /[\t\r\n]/.test(prefix);
  return quote(dangerous ? `'${text}` : text);
}

/** Monetary/count columns are integers in kuruş, never untrusted numeric text. */
export function csvInteger(value: number): CsvCell {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError("CSV sayısal hücresi güvenli bir tam sayı olmalıdır.");
  return quote(String(value));
}

export function csvRecord(cells: readonly CsvCell[]): string {
  return `${cells.join(",")}\r\n`;
}

type Audience = PayoutListScope["audience"];
const BASE_HEADERS = [
  "Partner türü", "Ödeme parti kimliği", "Partner kimliği", "Partner adı", "Durum", "Kapatma türü",
  "Oluşturulma zamanı (DB)", "Tamamlanma zamanı", "İptal zamanı", "Kayıtlı toplam (kuruş)",
  "Kayıtlı hak ediş sayısı", "Kayıtlı düzeltme sayısı", "Güncel bağlı net (kuruş)",
  "Güncel bağlı hak ediş sayısı", "Güncel bağlı düzeltme sayısı", "Bağlı kayıtların okunması", "Bağlı kayıtların durumu", "Referans",
];
const ADMIN_HEADERS = ["Talebi açan", "Tamamlayan admin", "İptal eden admin", "İptal gerekçesi", "İptal anındaki kayıtlar (JSON)"];
const STATUS = { pending: "Bekliyor", paid: "Banka ödemesi kaydedildi", netted: "Mahsup edildi", voided: "İptal edildi" };

export function payoutCsvHeader(audience: Audience): string {
  return csvRecord([...BASE_HEADERS, ...(audience === "admin" ? ADMIN_HEADERS : [])].map(csvText));
}

/** Explicit projection: never spread the DTO, especially for partner downloads. */
export function payoutCsvRecord(row: PayoutListRow, audience: Audience): string {
  const known = !!row.expectedFingerprint;
  const mismatch = row.totalKurus !== row.heldNet || row.earningCount !== row.heldEarningCount || row.adjustmentCount !== row.heldAdjustmentCount;
  const membership = !known ? "Bilinmiyor" : row.displayStatus === "voided" ? "İptal edildi; kayıtlı toplam güncel borç değildir"
    : row.status === "paid" ? (mismatch ? "Tamamlandı; kayıtlı toplam veya sayılar bağlı kayıtlarla uyuşmuyor" : "Tamamlandı") : row.blockedReason ?? (mismatch ? "Kayıtlı toplam veya sayılar bağlı kayıtlarla uyuşmuyor"
      : row.heldEarningCount + row.heldAdjustmentCount === 0 ? "Bağlı kayıt yok; ödeme yapılamaz" : "Bağlı kayıtlar doğrulandı");
  const cells = [
    csvText(row.kind === "manufacturer" ? "Üretici" : "Boyacı"), csvText(row.id), csvText(row.partnerId), csvText(row.name),
    csvText(STATUS[row.displayStatus]), csvText(row.settlementKind === "netting" ? "Mahsup (banka transferi yok)" : "Banka transferi"),
    csvText(row.createdAtExact), csvText(row.paidAt ?? ""), csvText(row.voidedAt ?? ""),
    csvInteger(row.totalKurus), csvInteger(row.earningCount), csvInteger(row.adjustmentCount),
    known ? csvInteger(row.heldNet) : csvText(""), known ? csvInteger(row.heldEarningCount) : csvText(""), known ? csvInteger(row.heldAdjustmentCount) : csvText(""),
    csvText(known ? "Okundu" : "Okunamadı"),
    csvText(membership),
    csvText(row.reference ?? ""),
  ];
  if (audience === "admin") {
    if (!("adminEmail" in row)) throw new TypeError("Admin dışa aktarımı için denetim alanları okunamadı.");
    cells.push(csvText(row.adminEmail), csvText(row.paidBy ?? ""), csvText(row.voidedBy ?? ""), csvText(row.voidReason ?? ""), csvText(row.voidSnapshot === null ? "" : JSON.stringify(row.voidSnapshot)));
  }
  return csvRecord(cells);
}
