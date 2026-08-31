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
 * tek bir `</script>` stored XSS'tir. `<` JSON içinde `<` ile birebir aynı
 * anlama gelir (JSON.parse aynı metni geri verir), yani kaçış veriyi bozmaz.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
