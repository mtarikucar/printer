import { FIGURINE_PRICE_LABEL } from "@/lib/config/product-facts";

/**
 * `/create`in ÜRÜN GERÇEKLERİ — fiyat, ölçü/malzeme/bitiş ve teslim süresi.
 *
 * Neden ayrı bir bileşen: bu üç cümle iki yerde çizilir ve İKİSİNDE AYNI
 * olmak zorunda —
 *   1. akışın içindeki ürün kartı (fotoğraf yüklendikten sonra, istemcide),
 *   2. `page.tsx`in sunucuda çizdiği gerçekler bandı (sabit fiyatlı figürin
 *      satan URL'lerde, JS çalışmasa da — bkz. `CreateFactsBand`).
 * (2) olmadan tarayıcıya giden HTML'de hiç ₺ rakamı yoktu: kart
 * `(photoKey || selectedFile)` kapısının arkasında, yani hiçbir sunucu
 * render'ı onu çizemiyor (ölçüm 2026-10-02 — /create HTML'inde "3.499" sıfır
 * kez geçiyordu). İki kopya metin yazmak yerine tek bileşen var ki bandın
 * cümlesi kartın cümlesinden ayrışamasın.
 *
 * Fiyat PROP DEĞİL: tek kaynağı `FIGURINE_PRICE_LABEL`, yani bir çağrı yerinin
 * yanlış biçimlenmiş bir rakam geçirmesi mümkün değil.
 *
 * Saf bileşen — hook yok, `"use client"` yok: hem sunucu sayfası hem akışın
 * istemci bileşeni aynı düğümleri çizsin. Kapsayıcıyı (Card / band) çağıran
 * verir, bu yüzden parça bir fragment döner.
 */
export function CreateProductFacts({
  title,
  spec,
  included,
}: {
  /** `create.product.title` */
  title: string;
  /** `create.product.spec` — "15 cm · SLA reçine · profesyonel el boyamalı" */
  spec: string;
  /** `create.product.included` — ücretsiz kargo + 5-7 iş günü üretim */
  included: string;
}) {
  return (
    <>
      <h2 className="text-lg font-serif text-text-primary mb-1">{title}</h2>
      <p className="text-sm text-text-muted mb-3">{spec}</p>
      <p className="text-2xl font-mono font-bold text-green-500 mb-3">
        {FIGURINE_PRICE_LABEL}
      </p>
      <p className="text-sm text-text-secondary mb-4">{included}</p>
    </>
  );
}

/**
 * `page.tsx`in SUSPENSE'İN DIŞINDA çizdiği gerçekler bandı.
 *
 * Suspense'in İÇİ değil, DIŞI: sınırın içi, Next alt ağacı sunucu render'ından
 * düşürdüğünde (`CreateRouter` `useSearchParams()` çağırıyor) fallback'e inen
 * kısımdır ve dinamik render'da fallback hiç SERVİS EDİLMEZ — yani "fiyatı
 * fallback'e koy" çözümü rakamı hiçbir tarayıcıya ulaştırmaz. Band sınırın
 * dışında durduğu için hangi yolla render edilirse edilsin HTML'de kalıyor.
 * `force-dynamic`/`revalidate = 0` YOK — gerekçenin tamamı `page.tsx`
 * başlığında.
 *
 * Band HER /create URL'inde çizilmez: `page.tsx` onu
 * `createUrlSellsFixedPriceFigure` kapısının arkasında çiziyor, çünkü teklif
 * dallarında (`?path=upload`, `?path=design`, `?style=object`) ekran liste
 * fiyatı OLMADIĞINI söylüyor ve bandın ₺ rakamı o beyanı yalanlar.
 *
 * Bandın yeri akışın ALTI: dört dalın (yol seçici, fotoğraf, 2D tasarım, kendi
 * dosyam) hiçbiri kendi `<main>`ini kaybetmesin, yani müşteri davranışı
 * değişmesin.
 */
export function CreateFactsBand({
  title,
  spec,
  included,
}: {
  title: string;
  spec: string;
  included: string;
}) {
  return (
    <section className="border-t border-border-default bg-bg-surface">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <CreateProductFacts title={title} spec={spec} included={included} />
      </div>
    </section>
  );
}
