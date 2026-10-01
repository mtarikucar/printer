import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Takım uçlarının `code`unu EKRANIN cümlesine çevirir (0072).
 *
 * NEDEN TEK YERDE: iki yüzey birden çağırıyor (`/account/takim` ve
 * `/takim/davet/<token>`) ve ikisi aynı uç ailesinden aynı kodları alıyor. İki
 * kopya, bir gün birinin ham kod göstermesi demekti — tam da bu fonksiyonun
 * engellediği şey.
 *
 * SIRA: sözlük → ucun cümlesi → ortak hata. Uçlar zaten Türkçe bir cümle
 * döndürüyor, yine de SÖZLÜK ÖNCE sorulur çünkü ekranın metni ekranın
 * sözleşmesidir (çeviri + tutarlılık). Karşılığı olmayan bir kod ucun
 * cümlesine, o da yoksa ortak hataya düşer: **HAM KOD hiçbir dalda ekrana
 * yazılmaz.** Kod kümesi ile cümle kümesinin BİREBİR olduğunu
 * `scripts/test-customer-team-api.ts` ölçüyor.
 *
 * `server-only` YOK ve DB YOK: iki istemci bileşeni de import ediyor.
 */
export function teamErrorText(
  d: Dictionary,
  body: { error?: unknown; code?: unknown }
): string {
  const code = typeof body.code === "string" ? body.code : null;
  if (code !== null) {
    const sentence = d[`instantQuote.team.error.${code}` as keyof Dictionary];
    if (typeof sentence === "string" && sentence.length > 0) return sentence;
  }
  if (typeof body.error === "string" && body.error.length > 0) return body.error;
  return d["common.error"];
}
