/**
 * JSON-LD yayıcısı.
 *
 * Next.js'in resmî deseni: layout/page içinde NATIVE `<script>`, `next/script`
 * DEĞİL ("Since JSON-LD is structured data, not executable code, a native
 * `<script>` tag is the right choice"). `metadata` API'si JSON-LD üretemez.
 */

/**
 * Bir değeri `<script type="application/ld+json">` gövdesine güvenle
 * yazılabilecek metne çevirir.
 *
 * `.replace(/</g, "\\u003c")` OPSİYONEL DEĞİL. Bu sitede pazaryeri satıcıları
 * ürün başlığı/açıklaması, müşteriler yorum yazıyor; bu metinler ileride
 * Product/Review JSON-LD'sine girecek. HTML ayrıştırıcısı `<script>` gövdesini
 * ham metin olarak okur ve ilk `</script>` dizisinde bloğu KAPATIR — kaçırılmayan
 * tek bir `</script>` stored XSS'tir. Kaçış veriyi bozmaz: `\u003c` JSON dizgi
 * dilbilgisinde `<` ile birebir aynı karakteri kodlar, JSON.parse aynı metni
 * geri verir — yalnızca HTML ayrıştırıcısı artık bir etiket sonu görmez.
 *
 * U+2028/U+2029 (LINE/PARAGRAPH SEPARATOR) de aynı sebeple kaçırılır: bugün
 * `application/ld+json` yürütülmediği için sömürülebilir değil, ama emitter
 * genel amaçlı — müşteri yorumları Word/PDF'ten yapıştırıldığında bu
 * karakterleri taşıyabilir, ve ileride bir JS `<script>` bağlamında yeniden
 * kullanılırsa (JS dizgi değişmezlerinde bu karakterler yasaktır) kırılır.
 *
 * `data` `undefined`/döngüsel olduğunda da fırlatmaz: bu bileşen root
 * layout'ta çalışıyor, tek bir kötü değer site genelinde 500'e dönüşmesin
 * diye sessizce `"{}"` (boş JSON-LD) döner.
 */
export function serializeJsonLd(data: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(data);
  } catch {
    return "{}";
  }
  if (typeof json !== "string") return "{}";
  return json
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
