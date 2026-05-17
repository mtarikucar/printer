/**
 * Validate a Turkish IBAN: structural format + ISO 13616 mod-97 checksum.
 *
 * The structural regex (`^TR\d{24}$`) catches typos but accepts strings like
 * `TR00 0000 0000 0000 0000 0000 00` that real banks reject. The mod-97 check
 * weeds those out so we don't accept payout details that will fail downstream.
 */

const IBAN_STRUCT_TR = /^TR\d{24}$/;

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidTrIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!IBAN_STRUCT_TR.test(iban)) return false;
  // Mod-97: move first 4 chars to end, convert letters to two-digit numbers,
  // and check remainder === 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  // Convert letters: A=10 … Z=35.
  let numeric = "";
  for (const ch of rearranged) {
    if (ch >= "0" && ch <= "9") {
      numeric += ch;
    } else if (ch >= "A" && ch <= "Z") {
      numeric += String(ch.charCodeAt(0) - 55);
    } else {
      return false;
    }
  }
  // Compute numeric mod 97 in chunks to avoid BigInt for hot path.
  let remainder = 0;
  for (let i = 0; i < numeric.length; i++) {
    remainder = (remainder * 10 + (numeric.charCodeAt(i) - 48)) % 97;
  }
  return remainder === 1;
}
