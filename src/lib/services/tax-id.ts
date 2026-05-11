export type TaxIdType = "vkn" | "tckn";

export type ParseResult =
  | { ok: true; type: TaxIdType; normalized: string }
  | { ok: false; reason: "empty" | "invalid_length" | "invalid_checksum" };

function normalize(input: string): string {
  return input.replace(/\D+/g, "");
}

// Turkish VKN (Vergi Kimlik Numarasi) — 10 digits
// Algorithm: for each of the first 9 digits at index i (0..8) with weight w = 9 - i,
//   tmp = (digit + w) mod 10
//   v   = tmp == 0 ? 0 : ((tmp * 2^w) mod 9) || 9
// check digit = (10 - (sum(v) mod 10)) mod 10  must equal the 10th digit.
function validateVkn(digits: string): boolean {
  if (digits.length !== 10) return false;
  const d = digits.split("").map((c) => Number(c));
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const w = 9 - i;
    const tmp = (d[i] + w) % 10;
    if (tmp === 0) {
      // contribute 0
    } else {
      let v = (tmp * Math.pow(2, w)) % 9;
      if (v === 0) v = 9;
      sum += v;
    }
  }
  const check = (10 - (sum % 10)) % 10;
  return check === d[9];
}

// Turkish TCKN (TC Kimlik Numarasi) — 11 digits
// Rules:
//   1) First digit non-zero.
//   2) digit_10 = ((sum_odd * 7) - sum_even) mod 10
//      where sum_odd  = d0 + d2 + d4 + d6 + d8
//            sum_even = d1 + d3 + d5 + d7
//   3) digit_11 = (sum of d0..d9) mod 10
function validateTckn(digits: string): boolean {
  if (digits.length !== 11) return false;
  const d = digits.split("").map((c) => Number(c));
  if (d[0] === 0) return false;
  const sumOdd = d[0] + d[2] + d[4] + d[6] + d[8];
  const sumEven = d[1] + d[3] + d[5] + d[7];
  const check10 = ((sumOdd * 7 - sumEven) % 10 + 10) % 10;
  if (check10 !== d[9]) return false;
  const sumFirst10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  const check11 = sumFirst10 % 10;
  return check11 === d[10];
}

export function parseTaxId(raw: string | null | undefined): ParseResult {
  if (raw == null) return { ok: false, reason: "empty" };
  const normalized = normalize(raw);
  if (normalized.length === 0) return { ok: false, reason: "empty" };
  if (normalized.length !== 10 && normalized.length !== 11) {
    return { ok: false, reason: "invalid_length" };
  }
  const isVkn = normalized.length === 10;
  const valid = isVkn ? validateVkn(normalized) : validateTckn(normalized);
  if (!valid) return { ok: false, reason: "invalid_checksum" };
  return { ok: true, type: isVkn ? "vkn" : "tckn", normalized };
}
