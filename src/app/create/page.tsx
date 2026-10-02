import { Suspense } from "react";
import { CreateFactsBand } from "@/components/create/product-facts";
import { createUrlSellsFixedPriceFigure } from "@/lib/create/design-templates";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
import { JsonLd } from "@/lib/seo/jsonld";
import { buildFigurineProductJsonLd } from "@/lib/seo/figurine";
import { CreateFlowShell, CreateRouter } from "./create-client";

/**
 * `/create` — üretim hunisinin girişi.
 *
 * Bu dosya SUNUCU bileşeni; akışın tamamı (`create-client.tsx`) istemcide
 * kaldı. Bölünmenin tek nedeni, ürün gerçeklerinin sunucu çıktısında BULUNMASI:
 *
 *   Ölçüm (2026-10-02, canlı üretim sunucusunun HTML'i): `/create`in gövdesi
 *   51 KB ve yol seçici sunucuda çiziliyor — yani `useSearchParams` burada
 *   HTML'i boşaltmıyor; rota `ƒ` (dinamik) ve alt ağaç gerçekten render
 *   ediliyor. Buna rağmen HTML'de "3.499" SIFIR kez geçiyordu, çünkü fiyatı
 *   yazan ürün kartı `(photoKey || selectedFile)` kapısının arkasında: kart
 *   ancak müşteri fotoğraf yükledikten SONRA, istemcide doğuyor. Hiçbir
 *   sunucu render'ı o kapıyı geçemez.
 *
 * Çözüm bu yüzden "gerçekleri Suspense'in fallback'ine koymak" DEĞİL: dinamik
 * render'da fallback hiç servis edilmez, statik üretimde ise hidrasyonda
 * kaybolur. Gerçekler sınırın DIŞINDA, `<CreateFactsBand>` ile çiziliyor —
 * böylece her render biçiminde HTML'de bulunuyorlar.
 *
 * Band KOŞULLU: `CreateRouter`ın dört dalından üçü ekranda liste fiyatı
 * OLMADIĞINI söylüyor (teklif dalları), yani o URL'lerde "₺3.499 · 5-7 iş günü"
 * yayınlamak sayfanın kendi beyanını yalanlar. Koşulun kendisi ve her dalın
 * gerekçesi `createUrlSellsFixedPriceFigure` başlığında; burada iki kopya
 * tutulmuyor ki bir gün ayrışmasınlar.
 *
 * `force-dynamic` / `revalidate = 0` YOK ve eklenmeyecek: ikisi de bütün
 * segmenti önbelleğin (ve ileride PPR'ın) dışına atar, oysa bu sayfanın
 * sunucudan istediği tek şey URL'in kendisi. Ama bunun karşılığı dürüstçe
 * söylenmeli: `searchParams` okuyan bir sayfa statik ÜRETİLEMEZ, yani bu rota
 * tasarımı gereği dinamiktir — "bir gün statikleşir" iddiası geri çekildi.
 * Rakamı doğru dalda yayınlamak, rakamı yanlış dalda da yayınlamaya yeğdir.
 *
 * `getLocale()` (bir `cookies()` okuması) BİLEREK duruyor: `searchParams` statik
 * üretimi zaten kapattığı için çerez okumasını kaldırmanın kazancı sıfır,
 * bedeli ise bandın üç cümlesini Türkçeye çivilemek olurdu. (`/` ve
 * `/3d-baski` tersini yapıyor çünkü onların TEK sunucu bağımlılığı o çerezdi —
 * bkz. `components/last-updated.tsx` başlığı.)
 *
 * MÜŞTERİ DAVRANIŞI DEĞİŞMEDİ: yönlendirici, yol seçici ve `?path=`/`?style=`/
 * `?previewId=`/`?fromOrder=` dallarının hepsi aynı dosyada, aynı sırada.
 */
export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const d = getDictionary(await getLocale());
  const sellsFixedPriceFigure = createUrlSellsFixedPriceFigure(await searchParams);

  return (
    <>
      <Suspense fallback={<CreateFlowShell />}>
        <CreateRouter />
      </Suspense>
      {sellsFixedPriceFigure && (
        <>
          {/* Yapısal veri bandın AYNI kapısının arkasında: band susan bir
              URL'de ekranda ₺ rakamı yok, yani `Offer` yayınlamak sayfada
              görünmeyen bir fiyat beyan etmek olurdu ("structured data
              mismatch"). `@id` `/figur` ve `/nasil-calisir` ile AYNI — tek
              ürünün üç yüzeyi, üç ayrı ürün değil. */}
          <JsonLd data={buildFigurineProductJsonLd(d)} />
          <CreateFactsBand
            title={d["create.product.title"]}
            spec={d["create.product.spec"]}
            included={d["create.product.included"]}
          />
        </>
      )}
    </>
  );
}
