/**
 * Teklif yüzeyinin küçük biçimleme yardımcıları.
 *
 * Sözlük cümleleri `{anahtar}` yer tutucularıyla yazılır (ev deseni:
 * `email.ts` `.replace("{orderNumber}", …)`); teklif ekranında aynı cümlede üç
 * dört yer tutucu olduğu için zincirlenmiş `replace` çağrıları yerine tek bir
 * `fill` var. BİLİNMEYEN yer tutucu OLDUĞU GİBİ BIRAKILIR: sessizce boş
 * bırakmak, eksik bir parametreyi ekranda "… mm" gibi yarım bir cümleye
 * çevirirdi; yer tutucunun kendisi görünürse hata testte ve gözle yakalanır.
 */

export function fill(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match
  );
}

/**
 * Ölçü sayıları: en fazla bir ondalık, gereksiz sıfır yok (120, 80.5 → "120",
 * "80,5"). Türkçe ayraç `toLocaleString` ile gelir.
 */
export function mm(value: number): string {
  return Number(value.toFixed(1)).toLocaleString("tr-TR");
}

/** Hacim/alan gibi iki ondalıklı ölçüler. */
export function decimal2(value: number): string {
  return Number(value.toFixed(2)).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
