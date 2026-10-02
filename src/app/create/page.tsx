import { Suspense } from "react";
import { CreateFactsBand } from "@/components/create/product-facts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/get-locale";
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
 * böylece dört dalın (yol seçici, fotoğraf, 2D tasarım, kendi dosyam) hepsinde
 * ve her render biçiminde HTML'de bulunuyorlar.
 *
 * `force-dynamic` / `revalidate = 0` YOK ve eklenmeyecek: bu sayfa yüksek
 * trafikli bir huni ve her isteği sunucuya bağlamanın bedeli bu kazancın çok
 * üstünde. (Rota bugün yine de dinamik, ama bunun nedeni kök layout'un
 * `getLocale()` → `cookies()` okuması; o gün geldiğinde burası hazır.)
 *
 * MÜŞTERİ DAVRANIŞI DEĞİŞMEDİ: yönlendirici, yol seçici ve `?path=`/`?style=`/
 * `?previewId=`/`?fromOrder=` dallarının hepsi aynı dosyada, aynı sırada.
 */
export default async function CreatePage() {
  const d = getDictionary(await getLocale());

  return (
    <>
      <Suspense fallback={<CreateFlowShell />}>
        <CreateRouter />
      </Suspense>
      <CreateFactsBand
        title={d["create.product.title"]}
        spec={d["create.product.spec"]}
        included={d["create.product.included"]}
      />
    </>
  );
}
