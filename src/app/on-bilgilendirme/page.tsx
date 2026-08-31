import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";
import { FIGURINE_PRICE_KURUS, UPSELL_PRICES_KURUS } from "@/lib/config/prices";
import {
  BUSINESS_ADDRESS_FULL,
  BUSINESS_TAX_ID,
} from "@/lib/config/business-identity";

export const metadata = {
  title: "Ön Bilgilendirme Formu — Figurunica",
};

export default async function OnBilgilendirmePage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  // Prices are DERIVED, never typed by hand: this is a legally binding
  // pre-contract form, so it must state exactly what checkout charges.
  const numberLocale = isTr ? "tr-TR" : "en-US";
  const tl = (kurus: number) => Math.round(kurus / 100).toLocaleString(numberLocale);
  const figurinePrice = tl(FIGURINE_PRICE_KURUS);
  const extraPaintPrice = tl(UPSELL_PRICES_KURUS.extra_paint);
  const giftWrapPrice = tl(UPSELL_PRICES_KURUS.gift_wrap);
  const rushShippingPrice = tl(UPSELL_PRICES_KURUS.rush_shipping);
  const digitalFilesPrice = tl(UPSELL_PRICES_KURUS.digital_files);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Ön Bilgilendirme Formu" : "Preliminary Information Form"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 24 Ağustos 2026" : "Last updated: August 24, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Ön Bilgilendirme Formu, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler
                Yönetmeliği kapsamında, Figurunica (&quot;Satıcı&quot;) tarafından figurunica.com üzerinden sunulan
                kişiye özel figürin ürünlerine ilişkin olarak sipariş vermeden önce sizi bilgilendirmek amacıyla
                hazırlanmıştır. Siparişi onaylayarak bu formda yer alan tüm hususları okuduğunuzu ve kabul ettiğinizi
                beyan etmiş sayılırsınız.
              </p>

              <h2>1. Satıcı Bilgileri</h2>
              <ul>
                <li><strong>Unvan:</strong> Figurunica</li>
                <li><strong>Vergi Kimlik No (VKN):</strong> {BUSINESS_TAX_ID}</li>
                <li><strong>Web sitesi:</strong> figurunica.com</li>
                <li><strong>E-posta:</strong> info@figurunica.com</li>
                <li><strong>Telefon:</strong> +90 850 840 73 03</li>
                <li><strong>Adres:</strong> {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>2. Ürünün Temel Nitelikleri ve Fiyatı</h2>
              <p>
                Siparişe konu ürün, tarafınızca yüklenen fotoğraftan oluşturulan kişiye özel (kişiselleştirilmiş)
                bir figürindir. Tek bir standart ürün sunulmaktadır; boyut, materyal veya bitiş seçimi yoktur:
              </p>
              <ul>
                <li>
                  <strong>Ürün ve fiyat:</strong> Kişiye özel figür — 15 cm, SLA reçine baskı, profesyonel el
                  boyamalı, sergilemeye hazır. <strong>{figurinePrice} TL (KDV dahil).</strong> Türkiye içi kargo
                  ücretsizdir.
                </li>
                <li>
                  <strong>Farklı ölçü ve özel tasarım:</strong> Standart dışı bir ölçü veya özel tasarım talebinde
                  fiyat, talebin kapsamına göre ayrıca belirlenir ve sipariş oluşturulmadan önce tarafınıza yazılı
                  olarak bildirilir.
                </li>
                <li>
                  <strong>İsteğe bağlı eklentiler:</strong> Ekstra boya katmanı ({extraPaintPrice} TL), hediye paketi
                  ({giftWrapPrice} TL), hızlı kargo ({rushShippingPrice} TL), dijital dosyalar — STL + OBJ
                  ({digitalFilesPrice} TL).
                </li>
              </ul>
              <p>
                Tüm fiyatlar Türk Lirası (TL) cinsinden ve KDV dahildir. Seçtiğiniz eklentilerle birlikte hesaplanan
                güncel ve bağlayıcı nihai fiyat, herhangi bir gizli ek ücret olmaksızın ödeme öncesinde sipariş
                ekranında açıkça gösterilir.
              </p>

              <h2>3. Ödeme Şekli</h2>
              <p>Ödemenizi aşağıdaki yöntemlerden biriyle gerçekleştirebilirsiniz:</p>
              <ul>
                <li><strong>Kredi kartı / banka kartı:</strong> PayTR altyapısı üzerinden 3D Secure ile güvenli ödeme.</li>
                <li><strong>Havale / EFT:</strong> Banka hesabımıza yapılan transfer ile ödeme.</li>
              </ul>
              <p>
                Kart bilgileriniz tarafımızca saklanmaz; ödeme işlemi doğrudan PayTR&apos;nin güvenli altyapısında işlenir.
                Havale/EFT seçildiğinde üretim süreci, ödemenin hesabımıza geçtiğinin teyit edilmesinin ardından başlar.
              </p>

              <h2>4. Teslimat Şekli ve Süresi</h2>
              <ul>
                <li>Ürünler Yurtiçi Kargo ile gönderilir.</li>
                <li>Türkiye içi kargo ücretsizdir.</li>
                <li>Üretim süresi, dijital önizlemeyi onaylamanızdan sonra genellikle 5-7 iş günüdür.</li>
                <li>Üretimi tamamlanan ürünün kargoya verilmesinin ardından teslimat 2-3 iş günü sürer.</li>
                <li>Belirtilen süreler tahmini olup yoğun dönemlerde uzayabilir.</li>
                <li>Teslimat, sipariş sırasında belirttiğiniz adrese yapılır; adres değişikliği için üretim başlamadan önce bizimle iletişime geçiniz.</li>
              </ul>

              <h2>5. Cayma Hakkı ve Kullanım Koşulları</h2>
              <p>
                Mesafeli Sözleşmeler Yönetmeliği uyarınca, standart (kişiye özel olmayan) ürünlerde tüketici, malın
                teslim tarihinden itibaren 14 (on dört) gün içinde hiçbir gerekçe göstermeksizin ve cezai şart
                ödemeksizin sözleşmeden cayma hakkına sahiptir.
              </p>
              <ul>
                <li>Cayma süresi, malın tüketiciye teslim edildiği gün başlar.</li>
                <li>Cayma hakkının kullanıldığı durumlarda ürün, faturası ve varsa hediye/aksesuarları ile birlikte hasarsız olarak iade edilmelidir.</li>
                <li>Cayma bildiriminin, aşağıda belirtilen sürede ve adrese yapılması gerekir.</li>
              </ul>

              <h2>6. Cayma Hakkının Kullanılamayacağı Haller</h2>
              <p>
                Sipariş ettiğiniz figürin, tarafınızca yüklenen fotoğraf ve yaptığınız seçimler doğrultusunda yalnızca
                sizin için üretilen, başka bir müşteriye satılması mümkün olmayan <strong>özel üretim</strong> bir
                üründür. Bu nedenle Mesafeli Sözleşmeler Yönetmeliği m.15/1-(b)&apos;de düzenlenen{" "}
                <strong>&quot;tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallar&quot;</strong>{" "}
                istisnası kapsamındadır ve bu üründe <strong>14 günlük cayma hakkı bulunmamaktadır</strong>.
              </p>
              <p>
                Buna karşılık size sözleşmeyle tanınan haklar saklıdır: baskı öncesi dijital önizleme, bir kez ücretsiz
                revizyon ve <strong>önizlemeyi onaylamadığınız sürece siparişinizi ücretsiz iptal ederek ödediğiniz
                bedelin tamamını geri alma</strong> hakkı.
              </p>
              <p>
                Cayma hakkının bulunmaması, ürünün <strong>ayıplı</strong> teslim edilmesi hâlindeki yasal haklarınızı
                etkilemez. 6502 sayılı Kanun m.8-11 uyarınca <strong>teslimden itibaren iki yıl</strong> boyunca ücretsiz
                onarım, ayıpsız misli ile değişim, bedelden indirim veya sözleşmeden dönme haklarınızdan
                <strong> dilediğinizi</strong> kullanabilirsiniz. Teslim edilen ürünün onayladığınız önizlemeye uymaması
                da ayıp sayılır.
              </p>
              <p>
                <strong>Mağazamızdaki hazır/stok ürünlerde</strong> ise 14 günlük cayma hakkınız tam olarak geçerlidir.
                Cayma hâlinde ürünü anlaşmalı kargo firmamızla iade edebilirsiniz; <strong>iade kargo bedeli tarafımızca
                karşılanır</strong>. Bulunduğunuz yerde bu taşıyıcının şubesi yoksa ürünü ek masraf almadan adresinizden
                aldırırız.
              </p>
              <p>
                Uyuşmazlık hâlinde başvurularınızı <strong>tüketici hakem heyetine</strong> veya 6502 sayılı Kanun
                m.73/A uyarınca <strong>dava açılmadan önce arabulucuya başvurulması şartıyla</strong> tüketici
                mahkemesine yapabilirsiniz.
              </p>

              <h2>7. Cayma Bildiriminin Yapılacağı Adres</h2>
              <p>
                Cayma hakkına (standart ürünler için) veya ayıplı/hasarlı ürüne ilişkin taleplerinizi aşağıdaki
                kanallardan iletebilirsiniz. Ayıplı/hasarlı ürün durumunda, ürünün fotoğrafı ve sorunun açıklaması
                ile başvurmanız sürecin hızlanmasını sağlar.
              </p>
              <ul>
                <li><strong>E-posta:</strong> info@figurunica.com</li>
                <li><strong>Adres:</strong> {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>8. Şikayet ve İtiraz Mercii</h2>
              <p>
                Siparişinize ilişkin şikayet ve itirazlarınızı öncelikle info@figurunica.com adresi üzerinden bize
                iletebilirsiniz. Uyuşmazlığın çözülememesi halinde, Ticaret Bakanlığı tarafından her yıl belirlenen
                parasal sınırlar dahilinde:
              </p>
              <ul>
                <li>Yerleşim yerinizdeki <strong>Tüketici Hakem Heyeti&apos;ne</strong>, veya</li>
                <li>Yetkili <strong>Tüketici Mahkemesi&apos;ne</strong> başvurabilirsiniz.</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                This Preliminary Information Form has been prepared under Turkish Consumer Protection Law No. 6502 and
                the Distance Contracts Regulation to inform you, before placing an order, about the custom (personalized)
                figurine products offered by Figurunica (&quot;Seller&quot;) through figurunica.com. By confirming your order,
                you acknowledge that you have read and accepted all matters set out in this form.
              </p>

              <h2>1. Seller Information</h2>
              <ul>
                <li><strong>Name:</strong> Figurunica</li>
                <li><strong>Tax ID (VKN):</strong> {BUSINESS_TAX_ID}</li>
                <li><strong>Website:</strong> figurunica.com</li>
                <li><strong>Email:</strong> info@figurunica.com</li>
                <li><strong>Phone:</strong> +90 850 840 73 03</li>
                <li><strong>Address:</strong> {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>2. Essential Characteristics and Price of the Product</h2>
              <p>
                The product subject to the order is a custom (personalized) figurine created from the photo you upload.
                A single standard product is offered; there is no size, material or finish choice:
              </p>
              <ul>
                <li>
                  <strong>Product and price:</strong> Custom figurine — 15 cm, SLA resin print, professionally
                  hand-painted, display-ready. <strong>{figurinePrice} TL (VAT included).</strong> Domestic shipping
                  within Turkey is free.
                </li>
                <li>
                  <strong>Different sizes and bespoke designs:</strong> For a non-standard size or a bespoke design, the
                  price is determined separately according to the scope of the request and is communicated to you in
                  writing before the order is created.
                </li>
                <li>
                  <strong>Optional add-ons:</strong> Extra paint layer ({extraPaintPrice} TL), gift wrap
                  ({giftWrapPrice} TL), express shipping ({rushShippingPrice} TL), digital files — STL + OBJ
                  ({digitalFilesPrice} TL).
                </li>
              </ul>
              <p>
                All prices are in Turkish Lira (TL) and include VAT. The current and binding final price, calculated
                together with the add-ons you select, is displayed clearly on the order screen before payment, with no
                hidden charges.
              </p>

              <h2>3. Payment Method</h2>
              <p>You can complete your payment using one of the following methods:</p>
              <ul>
                <li><strong>Credit card / debit card:</strong> Secure payment with 3D Secure via the PayTR infrastructure.</li>
                <li><strong>Bank transfer (Havale / EFT):</strong> Payment by transfer to our bank account.</li>
              </ul>
              <p>
                Your card details are never stored by us; the payment is processed directly on PayTR&apos;s secure
                infrastructure. When bank transfer is selected, production begins after the payment is confirmed as
                received in our account.
              </p>

              <h2>4. Delivery Method and Time</h2>
              <ul>
                <li>Products are shipped via Yurtici Kargo.</li>
                <li>Domestic shipping within Turkey is free.</li>
                <li>Production time is typically 5-7 business days after you approve the digital preview.</li>
                <li>Once the completed product is handed to the courier, delivery takes 2-3 business days.</li>
                <li>The stated timelines are estimates and may be extended during peak periods.</li>
                <li>Delivery is made to the address you provided at the time of order; for address changes, contact us before production begins.</li>
              </ul>

              <h2>5. Right of Withdrawal and Conditions of Use</h2>
              <p>
                Under the Distance Contracts Regulation, for standard (non-personalized) products the consumer has the
                right to withdraw from the contract within 14 (fourteen) days from the date the product is delivered,
                without providing any justification and without paying any penalty.
              </p>
              <ul>
                <li>The withdrawal period begins on the day the product is delivered to the consumer.</li>
                <li>Where the right of withdrawal is exercised, the product must be returned undamaged together with its invoice and any gifts/accessories.</li>
                <li>The withdrawal notice must be sent within the stated period and to the address indicated below.</li>
              </ul>

              <h2>6. Cases Where the Right of Withdrawal Cannot Be Exercised</h2>
              <p>
                Pursuant to Article 15 of the Distance Contracts Regulation, goods that are personalized or prepared in
                line with the consumer&apos;s requests or personal needs fall within the exception to the right of withdrawal.
              </p>
              <ul>
                <li>Figurines produced specifically for you from the photo you upload are personalized goods and are therefore outside the scope of the right of withdrawal.</li>
                <li>For this reason, once the preview is approved and production has begun, the right of withdrawal cannot be exercised for custom products.</li>
                <li>The inability to exercise the right of withdrawal does not remove your consumer rights in the event that the product is delivered defective or damaged; those rights are reserved.</li>
              </ul>

              <h2>7. Address for Withdrawal Notices</h2>
              <p>
                You can submit your withdrawal requests (for standard products) or claims regarding a defective/damaged
                product through the following channels. In the case of a defective/damaged product, applying with a photo
                of the product and a description of the issue helps speed up the process.
              </p>
              <ul>
                <li><strong>Email:</strong> info@figurunica.com</li>
                <li><strong>Address:</strong> {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>8. Complaints and Dispute Resolution Authority</h2>
              <p>
                You can submit your complaints and objections regarding your order primarily via info@figurunica.com.
                If the dispute cannot be resolved, within the monetary limits determined annually by the Ministry of
                Trade, you may apply to:
              </p>
              <ul>
                <li>The <strong>Consumer Arbitration Committee</strong> in your place of residence, or</li>
                <li>The competent <strong>Consumer Court</strong>.</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
