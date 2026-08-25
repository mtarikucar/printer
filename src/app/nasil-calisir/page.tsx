import type { Metadata } from "next";
import Link from "next/link";
import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";
import { FIGURINE_PRICE_KURUS, UPSELL_PRICES_KURUS } from "@/lib/config/prices";
import { SIZE_PRESETS, formatCm } from "@/lib/config/sizes";

// Every number on this page is DERIVED, never typed. This is the page an AI
// assistant reads when someone asks it "how does Figurunica work?", so a stale
// price or a retired size here is worse than a stale price in a UI label: it
// gets quoted back to customers. Same pattern as /on-bilgilendirme and
// /mesafeli-satis.
const HEIGHT = formatCm(SIZE_PRESETS[0].heightMm);
const PRICE_TR = (FIGURINE_PRICE_KURUS / 100).toLocaleString("tr-TR");
const PRICE_EN = (FIGURINE_PRICE_KURUS / 100).toLocaleString("en-US");
const tr = (kurus: number) => (kurus / 100).toLocaleString("tr-TR");
const en = (kurus: number) => (kurus / 100).toLocaleString("en-US");

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const isTr = locale === "tr";
  return {
    title: isTr ? "Nasıl Çalışır — Figurunica" : "How It Works — Figurunica",
    description: isTr
      ? `Fotoğrafından kişiye özel figür: ${HEIGHT}, SLA reçine baskı, profesyonel el boyamalı, ${PRICE_TR} TL (KDV dahil), Türkiye içi kargo ücretsiz. Üretim 5-7, kargo 2-3 iş günü.`
      : `A custom figurine from your photo: ${HEIGHT}, SLA resin printed, professionally hand-painted, ${PRICE_EN} TL (VAT included), free shipping within Türkiye. 5-7 business days to produce, 2-3 to ship.`,
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
              ? "Fotoğraftan elde boyanmış figüre"
              : "From a photo to a hand-painted figurine"}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-text-secondary">
            {isTr
              ? `Kişiye özel figür tek bir üründür: ${HEIGHT} boyunda, SLA reçine baskı, profesyonel el boyamalı ve sergilemeye hazır. ${PRICE_TR} TL (KDV dahil), Türkiye içi kargo ücretsiz. Yanı sıra hazır ürünlerin satıldığı bir pazaryeri ve teklifle ilerleyen özel işler var.`
              : `The custom figurine is a single product: ${HEIGHT} tall, SLA resin printed, professionally hand-painted, display-ready. ${PRICE_EN} TL (VAT included), free shipping within Türkiye. Alongside it we run a marketplace of ready-made products and take bespoke work by quote.`}
          </p>
        </div>
      </section>

      {/* Body */}
      <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary [&_ol]:text-text-secondary [&_ol]:mb-4 [&_ol]:ml-6 [&_ol]:list-decimal">
          {isTr ? (
            <>
              <h2>Kişiye özel figür: tek ürün, tek fiyat</h2>
              <p>
                Seçilecek boyut, malzeme ya da bitiş paketi yoktur. Herkes aynı ürünü alır:
              </p>
              <ul>
                <li><strong>Boyut:</strong> {HEIGHT} yükseklik — satılan tek ölçü.</li>
                <li><strong>Baskı:</strong> SLA reçine. Katman izi görünmeyecek kadar ince çözünürlük; yüz hatları, saç telleri ve kumaş kıvrımları çıkar.</li>
                <li><strong>Boyama:</strong> Boyacı partnerimiz figürü fırçayla, elde boyar. Kutudan sergilemeye hazır çıkar; içinde boya kiti <strong>yoktur</strong>.</li>
                <li><strong>Fiyat:</strong> {PRICE_TR} TL, KDV dahil. Tek fiyat — boyuta, malzemeye veya bitişe göre değişmez.</li>
                <li><strong>Kargo:</strong> Yurtiçi Kargo ile Türkiye içi <strong>ücretsiz</strong>. Sepet tutarı eşiği yoktur.</li>
              </ul>
              <p>
                İsteğe bağlı eklentileri ödeme ekranında işaretleyebilirsin: ekstra boya katmanı{" "}
                {tr(UPSELL_PRICES_KURUS.extra_paint)} TL, hediye paketi {tr(UPSELL_PRICES_KURUS.gift_wrap)} TL,
                hızlı kargo {tr(UPSELL_PRICES_KURUS.rush_shipping)} TL, dijital dosyalar (STL + OBJ){" "}
                {tr(UPSELL_PRICES_KURUS.digital_files)} TL. Hiçbiri zorunlu değildir ve toplam, ödemeden önce
                sipariş ekranında görünür.
              </p>

              <h2>Sipariş adım adım</h2>
              <ol>
                <li>
                  <strong>Fotoğrafı yükle.</strong> Yüzün net göründüğü tek bir fotoğraf yeterlidir.
                  Gerçekçi desende birden fazla fotoğraf (farklı açılar ya da bir çift) yükleyebilirsin.
                </li>
                <li>
                  <strong>Tasarım desenini seç.</strong> Gerçekçi, Masalsı Animasyon, Anime, Chibi,
                  Vinil Figür ya da Kil Animasyon.
                </li>
                <li>
                  <strong>Önizlemeyi onayla.</strong> Yapay zekâ destekli hattımız fotoğraftan iki stilize
                  görsel üretir; hangisinin basılacağına sen karar verirsin. Beğenmezsen düzeltiriz —
                  sen onaylamadan üretim başlamaz.
                </li>
                <li>
                  <strong>Ödemeni yap.</strong> Kredi/banka kartı (PayTR altyapısı, 3D Secure) ya da
                  havale/EFT. Havalede üretim, ödemenin hesaba geçtiği teyit edildikten sonra başlar.
                </li>
                <li>
                  <strong>3D model + baskı.</strong> Ekibimiz onayladığın görselden baskıya hazır 3D modeli
                  hazırlar; üretici partnerimiz SLA reçineyle basar, destekleri temizler ve kalite
                  kontrolünden geçirir. Bu aşama önizleme onayından sonra <strong>5-7 iş günü</strong> sürer.
                </li>
                <li>
                  <strong>El boyama ve kargo.</strong> Figür boyacı partnerimize geçer, elde boyanır ve
                  Yurtiçi Kargo&apos;ya verilir; teslimat <strong>2-3 iş günü</strong> sürer. Kapıdan kapıya
                  toplam süre <strong>7-10 iş günü</strong>dür.
                </li>
              </ol>
              <p>
                Siparişinin hangi aşamada olduğunu hesabından ve her adımda gönderdiğimiz e-postalardan
                takip edersin; kargoya verildiğinde takip numarası da e-postayla gelir. Kutunun içindeki
                karekodu okutunca, fotoğrafından figüre giden yolculuğu anlatan kişiye özel hatıra sayfan
                açılır.
              </p>

              <h2>Tasarım desenleri</h2>
              <p>
                Desen, aynı fotoğrafın hangi tarza dönüştürüleceğini belirler. Fiyatı değiştirmez —
                hepsi aynı {PRICE_TR} TL&apos;dir.
              </p>
              <ul>
                <li><strong>Gerçekçi:</strong> fotoğrafa sadık, doğal yüz hatları ve ten tonu — birebir benzerlik isteyenler için.</li>
                <li><strong>Masalsı Animasyon:</strong> büyük gözler, yumuşak hatlar, çizgi-film sıcaklığı — çocuk doğum günleri ve çiftler için.</li>
                <li><strong>Anime:</strong> anime gözleri, keskin saç, karakter pozu.</li>
                <li><strong>Chibi:</strong> büyük kafa, küçük gövde, abartılı sevimli oranlar.</li>
                <li><strong>Vinil Figür:</strong> koleksiyon vinil oyuncakların sade, kalın hatlı görünümü.</li>
                <li><strong>Kil Animasyon:</strong> stop-motion kil karakter dokusu, parmak izi hissi veren yüzey.</li>
              </ul>
              <p>
                Fotoğraftaki poz, jest ve ifade korunur — figür T-pozunda değil, senin fotoğraftaki
                halinde basılır.
              </p>

              <h2>Teklifle ilerleyen işler</h2>
              <p>
                Sabit fiyatlı ürün yalnızca kişiye özel figürdür. Aşağıdakiler için sabit fiyat yoktur;
                fiyat, modelin karmaşıklığına ve baskı hacmine göre <strong>elle</strong> belirlenir ve
                sipariş öncesi WhatsApp üzerinden yazılı olarak bildirilir:
              </p>
              <ul>
                <li><strong>Obje / nesne baskısı:</strong> bir araba, oyuncak ya da koleksiyon parçasının fotoğrafından üretim.</li>
                <li><strong>2D tasarım veya logo:</strong> çizim, logo ya da düz görselden 3D obje (rölyev plaka, masaüstü obje vb.).</li>
                <li><strong>Kendi 3D modelin (STL/OBJ):</strong> hazır dosyanı yükle; modeli doğrulayıp fiyatlandıralım.</li>
                <li><strong>Farklı ölçü:</strong> {HEIGHT} dışında bir boy istiyorsan da fiyat aynı şekilde ayrıca belirlenir.</li>
              </ul>

              <h2>Pazaryeri: hazır ürünler</h2>
              <p>
                <Link href="/shop">Mağazada</Link> üreticilerimizin ve satıcılarımızın hazırladığı 3D baskı
                ürünleri kategoriye, malzemeye ve fiyata göre gezebilirsin. Her listede malzeme, tahmini
                teslim süresi ve satıcı bilgisi yer alır; kişiye özel figürden farklı olarak fiyat ve
                teslim süresi ürüne göre değişir. Sipariş verdiğinde ürün siparişe özel basılır, kalite
                kontrolünden geçer ve sana gönderilir. Kendi ürünlerini satmak isteyen üreticiler de
                başvurabilir.
              </p>

              <div className="not-prose mt-12 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/create"
                  className="inline-flex items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  Figürünü oluştur
                </Link>
                <Link
                  href="/shop"
                  className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
                >
                  Pazaryerini keşfet
                </Link>
              </div>
            </>
          ) : (
            <>
              <h2>The custom figurine: one product, one price</h2>
              <p>There is no size, material, or finish package to choose. Everyone gets the same product:</p>
              <ul>
                <li><strong>Size:</strong> {HEIGHT} tall — the only size we sell.</li>
                <li><strong>Printing:</strong> SLA resin, at a resolution fine enough to hide layer lines — facial features, strands of hair, and fabric folds come through.</li>
                <li><strong>Painting:</strong> our painter partner paints it by hand, with a brush. It arrives display-ready; there is <strong>no</strong> paint kit in the box.</li>
                <li><strong>Price:</strong> {PRICE_EN} TL, VAT included. One price — it does not change with size, material, or finish.</li>
                <li><strong>Shipping:</strong> <strong>free</strong> within Türkiye via Yurtiçi Kargo. There is no order-value threshold.</li>
              </ul>
              <p>
                Optional add-ons can be ticked at checkout: an extra paint layer {en(UPSELL_PRICES_KURUS.extra_paint)} TL,
                gift wrapping {en(UPSELL_PRICES_KURUS.gift_wrap)} TL, rush shipping {en(UPSELL_PRICES_KURUS.rush_shipping)} TL,
                digital files (STL + OBJ) {en(UPSELL_PRICES_KURUS.digital_files)} TL. None are required, and the total is
                shown on the order screen before you pay.
              </p>

              <h2>An order, step by step</h2>
              <ol>
                <li>
                  <strong>Upload the photo.</strong> One photo with a clearly visible face is enough. The
                  Realistic template also accepts several photos (different angles, or a couple).
                </li>
                <li>
                  <strong>Pick a design template.</strong> Realistic, Storybook, Anime, Chibi, Vinyl, or Claymation.
                </li>
                <li>
                  <strong>Approve the preview.</strong> Our AI-assisted pipeline turns the photo into two
                  stylized images; you choose which one gets printed. Not happy? We revise it — nothing is
                  produced until you approve.
                </li>
                <li>
                  <strong>Pay.</strong> Card (via PayTR, 3D Secure) or bank transfer. With a bank transfer,
                  production starts once we confirm the money has landed.
                </li>
                <li>
                  <strong>3D model + printing.</strong> Our team builds the print-ready 3D model from the
                  image you approved; our manufacturing partner prints it in SLA resin, removes the
                  supports, and quality-checks it. This takes <strong>5-7 business days</strong> after
                  preview approval.
                </li>
                <li>
                  <strong>Hand painting and shipping.</strong> The figurine goes to our painter partner, is
                  painted by hand, and is handed to Yurtiçi Kargo; delivery takes{" "}
                  <strong>2-3 business days</strong>. Door to door that is <strong>7-10 business days</strong>.
                </li>
              </ol>
              <p>
                You follow every stage from your account and from the emails we send at each step; the
                tracking number arrives by email once it ships. Scanning the QR code in the box opens a
                personal keepsake page telling the story from your photo to the figurine.
              </p>

              <h2>Design templates</h2>
              <p>
                The template decides what style the same photo is turned into. It does not change the
                price — all of them are {PRICE_EN} TL.
              </p>
              <ul>
                <li><strong>Realistic:</strong> true to the photo — natural features and skin tone, for an exact likeness.</li>
                <li><strong>Storybook:</strong> big eyes, soft features, animated warmth — for kids&apos; birthdays and couples.</li>
                <li><strong>Anime:</strong> anime eyes, sharp hair, character pose.</li>
                <li><strong>Chibi:</strong> big head, tiny body, exaggerated cuteness.</li>
                <li><strong>Vinyl:</strong> the clean, chunky look of collectible vinyl toys.</li>
                <li><strong>Claymation:</strong> stop-motion clay texture, a surface that reads as thumb-worked.</li>
              </ul>
              <p>
                The pose, gesture, and expression from the photo are preserved — the figurine is not
                printed in a T-pose, but as you were in the photo.
              </p>

              <h2>Work that goes by quote</h2>
              <p>
                The custom figurine is our only fixed-price product. The following have no list price:
                it is set <strong>by hand</strong> from the model&apos;s complexity and print volume, and
                confirmed in writing over WhatsApp before you order:
              </p>
              <ul>
                <li><strong>Object prints:</strong> made from a photo of a car, a toy, or a collectible.</li>
                <li><strong>A 2D design or logo:</strong> a drawing, logo, or flat image turned into a 3D object (relief plaques, desk objects, and so on).</li>
                <li><strong>Your own 3D model (STL/OBJ):</strong> upload the file you already have and we validate and price it.</li>
                <li><strong>A different size:</strong> anything other than {HEIGHT} is quoted the same way.</li>
              </ul>

              <h2>Marketplace: ready-made products</h2>
              <p>
                In the <Link href="/shop">shop</Link> you can browse 3D-printed products from our makers
                and sellers by category, material, and price. Each listing shows its material, estimated
                lead time, and seller; unlike the custom figurine, price and lead time vary per product.
                When you order, the product is printed to order, quality-checked, and shipped to you.
                Makers who want to sell their own products can apply too.
              </p>

              <div className="not-prose mt-12 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/create"
                  className="inline-flex items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                >
                  Create your figurine
                </Link>
                <Link
                  href="/shop"
                  className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
                >
                  Explore the marketplace
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
