import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const isTr = locale === "tr";
  return {
    title: isTr ? "Nasıl Çalışır — Figurunica" : "How It Works — Figurunica",
    description: isTr
      ? "3D pazaryeri ve özel üretim: hazır ürünleri keşfet ya da fotoğraf, kendi modelin veya 2D tasarımından üret."
      : "A 3D marketplace and custom studio: browse ready-made products or produce from a photo, your own model, or a 2D design.",
  };
}

export default async function HowItWorksPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border-default">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-green-400/12 blur-[120px]"
        />
        <div className="relative mx-auto max-w-3xl px-5 pt-16 pb-12 md:pt-24 md:pb-16">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {isTr ? "Nasıl Çalışır" : "How it works"}
          </p>
          <h1
            className="mt-3 text-4xl text-text-primary md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {isTr
              ? "Bir 3D pazaryeri ve üretim stüdyosu"
              : "A 3D marketplace and production studio"}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-text-secondary">
            {isTr
              ? "Hazır 3D ürünleri keşfedip satın alabilir ya da kendi ürününü ürettirebilirsin: fotoğraftan üret (hazır tasarım deseni seç), 2D tasarımdan ürün ya da kendi 3D dosyanı yükle — üçü de aktif."
              : "Browse and buy ready-made 3D products, or have your own made: create from a photo (pick a design template), turn a 2D design into a product, or upload your own 3D file — all three are live."}
          </p>
        </div>
      </section>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary [&_ol]:text-text-secondary [&_ol]:mb-4 [&_ol]:ml-6 [&_ol]:list-decimal">
          {isTr ? (
            <>
              <h2>İki yol</h2>
              <p>
                Figurunica iki şekilde kullanılır. <strong>Pazaryeri</strong> tarafında,
                üreticilerimizin ve satıcılarımızın hazırladığı 3D baskı ürünleri keşfeder,
                beğendiğini sipariş edersin — her ürün siparişe özel üretilir.
                <strong> Özel Üret</strong> tarafında ise tamamen sana ait bir ürünü, aşağıdaki
                üç yoldan biriyle ürettirirsin.
              </p>

              <h2>Pazaryeri: hazır ürünleri keşfet</h2>
              <p>
                <Link href="/shop">Mağazada</Link> kategoriye, malzemeye ve fiyata göre gezin.
                Her listede malzeme, tahmini teslim süresi ve satıcı bilgisi yer alır. Sipariş
                verdiğinde ürün siparişe özel basılır, kalite kontrolünden geçer ve sana
                gönderilir. Kendi ürünlerini satmak isteyen üreticiler de başvurabilir.
              </p>

              <h2>Özel Üret: üç üretim yolu</h2>

              <h3>1. Fotoğraftan üret</h3>
              <p>
                Bir kişinin, evcil hayvanın ya da bir nesnenin fotoğrafını yükle; yapay zeka destekli
                hattımız bir 3D önizleme üretir. Bir <strong>tasarım deseni</strong> seçersin (Gerçekçi,
                Masalsı, Anime, Chibi ya da Obje). Onayladığında üretici partnerimiz basar, seçtiğin
                bitişe göre hazırlar ve boya kitiyle birlikte gönderir.
              </p>

              <h3>2. 2D Tasarım/logo → ürün</h3>
              <p>
                Bir logo, çizim veya düz görselden 3D baskıya uygun bir obje çıkarırız (anahtarlık,
                rölyef plaka, altlık, masaüstü obje vb.). Akış aynıdır: önizleme → onay → üretim → kargo.
              </p>

              <h3>3. Kendi 3D modelin (STL/OBJ)</h3>
              <p>
                Zaten hazır bir <strong>STL/OBJ</strong> dosyan varsa doğrudan yükleyip bastırabilirsin.
                Modeli doğrular, hedef yüksekliğe ölçekler ve geometriye göre fiyatlandırırız; otomatik
                fiyatlandırmaya uygun olmayan karmaşık durumlarda sana özel teklif veririz.
              </p>

              <h2>Hazır tasarım desenleri</h2>
              <p>
                &quot;Fotoğraftan üret&quot; akışında bir tasarım deseni seçersin; her desen aynı
                fotoğrafı farklı bir tarza dönüştürür:
              </p>
              <ul>
                <li><strong>Gerçekçi:</strong> fotoğrafa sadık, doğal yüz hatları ve ten tonu — anne/babaya ya da eşe birebir benzeyen hediyeler için.</li>
                <li><strong>Masalsı Animasyon:</strong> büyük gözler, yumuşak hatlar, çizgi-film sıcaklığı — çocuk doğum günleri ve çiftler için en popüler.</li>
                <li><strong>Anime:</strong> anime gözleri, keskin saç, karakter posu — anime/manga hayranlarına.</li>
                <li><strong>Chibi:</strong> büyük kafa, küçük gövde, abartılı sevimli oranlar — mini hatıra ve çift figürini için.</li>
                <li><strong>Obje:</strong> sadece insanlar değil; sevdiğin araba, oyuncak ya da koleksiyon parçanın 3D baskısı.</li>
              </ul>

              <h2>Özel bir sipariş adım adım</h2>
              <ol>
                <li>Bir üretim yolu seç ve girdini ver (fotoğraf, model ya da tasarım).</li>
                <li>Önizlemeni incele — beğenmezsen düzeltiriz.</li>
                <li>Boyut, malzeme ve bitiş paketini seç, ödemeni yap.</li>
                <li>Üretici partnerimiz basar, kalite kontrolünden geçirir ve bitişi hazırlar.</li>
                <li>Kargoya verilir; durumu hesabından ve e-postayla takip edersin.</li>
              </ol>

              <h2>Malzeme ve bitiş</h2>
              <ul>
                <li><strong>Reçine (resin):</strong> ince detay için, figür ve heykelcikte tercih edilir.</li>
                <li><strong>Filament:</strong> daha büyük ve dayanıklı parçalar için.</li>
                <li><strong>Bitiş paketleri:</strong> ham (boyasız), standart, el boyaması ve vitrin/luxe seçenekleri — siparişte fiyatı net görürsün.</li>
              </ul>

              <h2>Fiyat ve teslimat</h2>
              <p>
                Fiyat; boyut, malzeme ve seçtiğin bitişe göre belirlenir ve ödemeden önce net olarak
                gösterilir — sürpriz ek ücret yoktur. Yüklenen modellerde fiyat geometriden (hacim ve
                hedef yükseklik) hesaplanır; karmaşık durumlarda otomatik fiyat yerine sana özel teklif
                veririz. Kargo Yurtiçi Kargo ile yapılır; tahmini teslim süresi her ürün ve siparişte
                belirtilir.
              </p>

              <div className="not-prose mt-12 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/shop"
                  className="inline-flex items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  Pazaryerini keşfet
                </Link>
                <Link
                  href="/create"
                  className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
                >
                  Özel üretime başla
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>Two paths</h2>
              <p>
                Figurunica works in two ways. On the <strong>Marketplace</strong> side, you browse
                ready-made 3D-printed products from our makers and sellers and order what you like —
                every product is made to order. On the <strong>Custom</strong> side, you have something
                entirely your own produced through one of the three paths below.
              </p>

              <h2>Marketplace: browse ready-made products</h2>
              <p>
                Explore the <Link href="/shop">shop</Link> by category, material, and price. Each
                listing shows its material, estimated lead time, and seller. When you order, the
                product is printed to order, quality-checked, and shipped to you. Makers who want to
                sell their own products can apply too.
              </p>

              <h2>Custom: three production paths</h2>

              <h3>1. Create from a photo</h3>
              <p>
                Upload a photo of a person, pet, or object and our AI-assisted pipeline generates a 3D
                preview. You pick a <strong>design template</strong> (Realistic, Storybook, Anime, Chibi,
                or Object). Once you approve, our manufacturing partner prints it, prepares it to your
                chosen finish, and ships it with a paint kit.
              </p>

              <h3>2. 2D design/logo → product</h3>
              <p>
                From a logo, drawing, or flat image we derive a print-ready 3D object (keychains, relief
                plaques, coasters, desk objects, and more). The flow is the same: preview → approve →
                production → shipping.
              </p>

              <h3>3. Your own 3D file (STL/OBJ)</h3>
              <p>
                If you already have an <strong>STL/OBJ</strong> file, upload it and print directly. We
                validate the model, scale it to your target height, and price it from the geometry; for
                complex cases that don&apos;t fit automatic pricing we send you a custom quote.
              </p>

              <h2>Design templates</h2>
              <p>
                In the &quot;create from a photo&quot; flow you pick a design template; each one turns the
                same photo into a different style:
              </p>
              <ul>
                <li><strong>Realistic:</strong> true to the photo — natural facial features and skin tone, for gifts that look exactly like the recipient.</li>
                <li><strong>Storybook:</strong> big eyes, soft features, animated warmth — our most popular for kids&apos; birthdays and couples.</li>
                <li><strong>Anime:</strong> anime eyes, sharp hair, character pose — for anime/manga fans.</li>
                <li><strong>Chibi:</strong> big head, tiny body, exaggerated cuteness — great for mini keepsakes and couple figurines.</li>
                <li><strong>Object:</strong> not just people — a 3D print of your favorite car, toy, or collectible.</li>
              </ul>

              <h2>A custom order, step by step</h2>
              <ol>
                <li>Pick a production path and give your input (photo, model, or design).</li>
                <li>Review your preview — if you&apos;re not happy, we revise it.</li>
                <li>Choose size, material, and finish package, then pay.</li>
                <li>Our manufacturing partner prints it, quality-checks it, and prepares the finish.</li>
                <li>It ships; you track status from your account and by email.</li>
              </ol>

              <h2>Materials and finishes</h2>
              <ul>
                <li><strong>Resin:</strong> for fine detail, preferred for figurines and statuettes.</li>
                <li><strong>Filament:</strong> for larger, more durable parts.</li>
                <li><strong>Finish packages:</strong> raw (unpainted), standard, hand-painted, and display/luxe — the price is shown clearly at order time.</li>
              </ul>

              <h2>Pricing and delivery</h2>
              <p>
                Price is set by size, material, and your chosen finish, and is shown clearly before you
                pay — no surprise add-ons. For uploaded models, price is computed from the geometry
                (volume and target height); for complex cases we give you a custom quote instead of an
                automatic price. Shipping is via Yurtiçi Kargo; an estimated lead time is shown on every
                product and order.
              </p>

              <div className="not-prose mt-12 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/shop"
                  className="inline-flex items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  Explore the marketplace
                </Link>
                <Link
                  href="/create"
                  className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
                >
                  Start a custom order
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
