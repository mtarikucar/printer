/**
 * Teklif numarası: `T-000123`.
 *
 * Biçim DB'deki `quotes.number` generated kolonuyla BİREBİR aynı olmak zorunda
 * (`'T-' || lpad(seq::text, greatest(6, length(seq::text)), '0')`): 6 hane
 * doldurulur, 7+ hanede KIRPMA YOKTUR.
 *
 * SAF MODÜL: DB yok, `server-only` yok, `node:` import'u yok.
 */

const QUOTE_NUMBER_RE = /^t-(\d{6,})$/;

export function formatQuoteNumber(seq: number): string {
  return `T-${String(seq).padStart(6, "0")}`;
}

/** URL'den/kullanıcıdan gelen bir numarayı sıraya çevirir; geçersizse null. */
export function parseQuoteNumber(s: string): number | null {
  const match = QUOTE_NUMBER_RE.exec(s.trim().toLowerCase());
  if (!match) return null;
  const seq = Number(match[1]);
  if (!Number.isSafeInteger(seq) || seq < 1) return null;
  return seq;
}
