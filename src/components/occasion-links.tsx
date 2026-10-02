import Link from "next/link";
import { OCCASIONS, occasionPath, type OccasionDict } from "@/lib/config/occasions";

/**
 * ALTI ÖZEL GÜN SAYFASINA İÇ BAĞLANTI — anasayfa ve `/figur` aynı bloğu çizer.
 *
 * Neden gerekiyor: yalnız sitemap'ten erişilen sayfa ZAYIFTIR. Sitemap keşfi
 * sağlar, iç bağlantı ise sayfanın sitenin kendi ağırlığından pay almasını
 * sağlar — hiçbir yerden bağlanmayan bir URL tarayıcı için sitenin kenarında
 * duran, önemsiz bir yaprak olarak kalır. Bu yüzden bağlantı sitemap'teki
 * önceliği 1.0 olan anasayfadan ve ürünün anlatıldığı `/figur`den veriliyor.
 *
 * METİN SÖZLÜKTEN GELİYOR ve yeni yazılmadı: `landing.useCases.*` anahtarları
 * ("Her An İçin Mükemmel Hediye" + altı özel günün adı ve açıklaması) sözlükte
 * duruyordu ve `figurunica/dict.ts`in izin listesinde olmadıkları için hiçbir
 * yer onları render etmiyordu. Blok o ölü bölümü geri getiriyor; tek fark,
 * başlıkların artık birer BAĞLANTI olması.
 *
 * SAF BİLEŞEN — hook yok, `"use client"` yok: `/figur` sayfası (sunucu) ve
 * anasayfanın vitrini (istemci) aynı düğümleri çizsin. Sözlüğü ÇAĞIRAN verir,
 * çünkü sunucu tarafında `useDictionary()` yok.
 *
 * Biçim BİLEREK sitenin ortak Tailwind dili (`CustomStrip` emsali),
 * `figurunica.module.css` değil: blok iki ayrı sayfada çiziliyor ve `/figur`in
 * yolculuk tasarımına özel sınıfları anasayfada anlamsız olurdu.
 */
export function OccasionLinks({ d }: { d: OccasionDict }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h2
        className="text-2xl text-text-primary md:text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {d["landing.useCases.title"]}
      </h2>
      <p className="mt-2 text-text-secondary">{d["landing.useCases.subtitle"]}</p>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OCCASIONS.map((occasion) => (
          <li key={occasion.slug}>
            <Link
              href={occasionPath(occasion.slug)}
              className="flex h-full flex-col rounded-2xl border border-border-default bg-bg-surface p-5 transition-colors hover:border-green-600 hover:bg-bg-elevated"
            >
              <span className="text-base font-semibold text-text-primary">
                {d[occasion.titleKey]}
              </span>
              <span className="mt-1 text-sm text-text-secondary">
                {d[occasion.descKey]}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
