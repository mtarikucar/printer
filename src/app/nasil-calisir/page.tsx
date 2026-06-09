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
              ? "Hazır 3D ürünleri keşfedip satın alabilir ya da kendi ürününü ürettirebilirsin: fotoğraftan figür ve obje bugün çalışıyor; kendi 3D modelini yükleme ve 2D tasarımdan ürün akışları yolda."
              : "Browse and buy ready-made 3D products, or have your own made: photo-to-figurine and photo-to-object are live today; uploading your own 3D model and turning a 2D design into a product are on the way."}
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
                dört yoldan biriyle ürettirirsin.
              </p>

              <h2>Pazaryeri: hazır ürünleri keşfet</h2>
              <p>
                <Link href="/shop">Mağazada</Link> kategoriye, malzemeye ve fiyata göre gezin.
                Her listede malzeme, tahmini teslim süresi ve satıcı bilgisi yer alır. Sipariş
                verdiğinde ürün siparişe özel basılır, kalite kontrolünden geçer ve sana
                gönderilir. Kendi ürünlerini satmak isteyen üreticiler de başvurabilir.
              </p>

              <h2>Özel Üret: dört üretim yolu</h2>

              <h3>1. Fotoğraftan figür — bugün aktif</h3>
              <p>
                Bir kişinin (ya da evcil hayvanın) fotoğrafını yükle; yapay zeka destekli hattımız
                bir 3D figür önizlemesi üretir. Onayladığında üretici partnerimiz reçineyle basar,
                seçtiğin bitişe göre hazırlar ve boya kitiyle birlikte gönderir.
              </p>

              <h3>2. Fotoğraftan obje/ürün — bugün aktif</h3>
              <p>
                Figür dışındaki nesneler için &quot;obje&quot; modunu kullan: bir ürün, oyuncak,
                heykelcik veya dekoratif parçanın fotoğrafından 3D baskıya uygun bir model çıkarırız.
                Akış figürle aynıdır: önizleme → onay → üretim → kargo.
              </p>

              <h3>3. Kendi 3D modelini yükle — yakında</h3>
              <p>
                Hazır bir <strong>STL/OBJ</strong> dosyan varsa, doğrudan yükleyip bastırabileceksin.
                Modeli sunucuda doğrular (kapalı hacim, duvar kalınlığı, baskı zarfı), hedef yüksekliğe
                ölçekler ve geometriye göre fiyatlandırırız. Bu akış geliştirme aşamasında.
              </p>

              <h3>4. 2D tasarım/logo → 3D ürün — yakında</h3>
              <p>
                Bir logo, çizim veya düz görselden anahtarlık, rölyef plaka, altlık ya da masaüstü
                obje gibi 3D ürünler üreteceğiz. Bu akış da yolda.
              </p>

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
                entirely your own produced through one of the four paths below.
              </p>

              <h2>Marketplace: browse ready-made products</h2>
              <p>
                Explore the <Link href="/shop">shop</Link> by category, material, and price. Each
                listing shows its material, estimated lead time, and seller. When you order, the
                product is printed to order, quality-checked, and shipped to you. Makers who want to
                sell their own products can apply too.
              </p>

              <h2>Custom: four production paths</h2>

              <h3>1. Photo to figurine — live today</h3>
              <p>
                Upload a photo of a person (or pet) and our AI-assisted pipeline generates a 3D
                figurine preview. Once you approve, our manufacturing partner prints it in resin,
                prepares it to your chosen finish, and ships it with a paint kit.
              </p>

              <h3>2. Photo to object/product — live today</h3>
              <p>
                For things other than figurines, use &quot;object&quot; mode: from a photo of a product,
                toy, statuette, or decorative piece we derive a print-ready 3D model. The flow is the
                same as figurines: preview → approve → production → shipping.
              </p>

              <h3>3. Upload your own 3D model — coming soon</h3>
              <p>
                If you already have an <strong>STL/OBJ</strong> file, you&apos;ll be able to upload it and
                print directly. We validate the model server-side (watertightness, wall thickness, print
                envelope), scale it to your target height, and price it from the geometry. This flow is
                in development.
              </p>

              <h3>4. 2D design/logo → 3D product — coming soon</h3>
              <p>
                From a logo, drawing, or flat image we&apos;ll produce 3D products like keychains, relief
                plaques, coasters, or desk objects. This flow is on the way too.
              </p>

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
