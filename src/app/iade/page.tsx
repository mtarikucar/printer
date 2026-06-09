import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "İade, Değişim ve Hasar Politikası — Figurunica",
};

export default async function IadePage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "İade, Değişim ve Hasar Politikası" : "Returns, Exchange & Damage Policy"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Figurunica olarak amacımız, elinize geçen her ürünün sizi memnun etmesidir. Üretimden önce sunduğumuz
                3D önizleme onayı, ücretsiz revizyon hakkı ve hasarlı teslimatlara karşı sağladığımız güvence ile
                alışverişinizin her aşamasında yanınızdayız. Bu politika; iade, değişim, hasarlı veya ayıplı ürün
                durumlarında haklarınızı ve izlemeniz gereken adımları açıklar.
              </p>

              <h2>1. Genel İlke</h2>
              <p>İki tür ürün satıyoruz ve iade koşulları ürün tipine göre farklılık gösterir:</p>
              <ul>
                <li><strong>Kişiye özel figürinler (sipariş üzerine üretim):</strong> Yüklediğiniz fotoğrafa göre özel olarak üretildiğinden kişiselleştirilmiş mal niteliğindedir ve standart 14 günlük cayma hakkı kapsamı dışındadır.</li>
                <li><strong>Hazır / standart mağaza ürünleri:</strong> Stoktan satılan kişiselleştirilmemiş ürünler, yasal 14 günlük cayma hakkı kapsamındadır ve süresi içinde iade edilebilir.</li>
              </ul>
              <p>
                Ürün tipinden bağımsız olarak, ürün hasarlı veya ayıplı teslim edilirse tüketici olarak yasal haklarınız
                her zaman saklıdır (bkz. 5. madde).
              </p>

              <h2>2. Önizleme ve Revizyon Güvencesi</h2>
              <p>
                Kişiye özel ürünlerde memnuniyetinizi baskı başlamadan önce güvence altına alıyoruz. Süreç şöyle işler:
              </p>
              <ul>
                <li>Siparişiniz için yapay zekâmız bir <strong>3D önizleme</strong> hazırlar ve onayınıza sunar.</li>
                <li>Önizlemeyi onaylamadığınız sürece <strong>baskı başlamaz</strong>.</li>
                <li>Önizlemede düzeltilmesini istediğiniz noktalar varsa <strong>1 ücretsiz revizyon</strong> hakkınız vardır.</li>
                <li>Yalnızca siz onayladıktan sonra üretime geçeriz; böylece elinize geçecek ürünü baştan görmüş olursunuz.</li>
              </ul>
              <p>
                Bu adım, kişiye özel üründe sürprizleri ortadan kaldırır ve memnuniyetinizi en baştan garanti etmek için
                tasarlanmıştır.
              </p>

              <h2>3. Kişiye Özel Figürinlerde İade</h2>
              <p>
                Kişiye özel figürinler size özel üretildiği için, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve
                Mesafeli Sözleşmeler Yönetmeliği uyarınca standart 14 günlük cayma hakkı kapsamında değildir. Bu nedenle
                fikir değişikliği veya beğenmeme gerekçesiyle iade kabul edilememektedir.
              </p>
              <p>Bununla birlikte memnuniyetiniz bizim için esastır:</p>
              <ul>
                <li>Üretimden önceki <strong>önizleme onayı ve ücretsiz revizyon</strong> hakkı, ürünü beklentinize uygun hâle getirmeniz içindir.</li>
                <li>Önizleme onayı verilmeden önce siparişinizi ücretsiz iptal edebilirsiniz.</li>
                <li>Ürün <strong>hasarlı, ayıplı veya yanlış</strong> teslim edilirse ücretsiz yeniden üretim, değişim veya bedel iadesi sağlanır (bkz. 5. madde).</li>
              </ul>

              <h2>4. Hazır Mağaza Ürünlerinde Cayma (14 Gün)</h2>
              <p>
                Stoktan satılan hazır / standart mağaza ürünleri için, hiçbir gerekçe göstermeden teslim aldığınız
                tarihten itibaren <strong>14 gün</strong> içinde cayma hakkınızı kullanabilirsiniz.
              </p>
              <ul>
                <li>Cayma talebinizi sipariş numaranızla birlikte info@figurunica.com adresine iletmeniz yeterlidir.</li>
                <li>Ürünün, kullanılmamış ve yeniden satılabilir durumda (mümkünse orijinal ambalajıyla) iade edilmesi gerekir.</li>
                <li>Cayma hakkının usulüne uygun kullanılması hâlinde ödediğiniz bedel iade edilir (bkz. 6. madde).</li>
                <li>Dijital STL dosyaları gibi anında teslim edilen dijital ürünler ve kişiselleştirilmiş ürünler bu kapsamın dışındadır.</li>
              </ul>

              <h2>5. Hasarlı / Ayıplı Ürün</h2>
              <p>
                Elinize geçen ürünün kargoda zarar görmesi ya da bir üretim hatası içermesi durumunda sorunu ücretsiz
                olarak çözeriz.
              </p>

              <h3>5.1 Kargoda Hasarlı Teslimat</h3>
              <ul>
                <li>Ürünü teslim aldıktan sonra <strong>48 saat içinde</strong>, hasarı gösteren fotoğraflarla birlikte info@figurunica.com adresine bildirimde bulunun.</li>
                <li>Mümkünse paketin/kargonun dış görünümünü de fotoğraflayın.</li>
                <li>Onay sonrası size <strong>ücretsiz yeniden üretim veya değişim</strong> sağlanır; ek bir ücret talep edilmez.</li>
              </ul>

              <h3>5.2 Üretim Hatası / Ayıplı Ürün</h3>
              <ul>
                <li>Üründe baskı, malzeme veya üretim kaynaklı bir kusur tespit edilirse tüketici olarak yasal haklarınız saklıdır.</li>
                <li>Tercihinize ve durumun niteliğine göre <strong>ücretsiz yeniden üretim, değişim veya bedel iadesi</strong> seçeneklerinden biri uygulanır.</li>
                <li>3D baskının doğası gereği her ürün eşsizdir; üretim toleransları içindeki küçük farklılıklar ayıp sayılmaz.</li>
              </ul>

              <h2>6. İade Süreci ve Bedel İadesi Süresi</h2>
              <p>İade veya değişim talebiniz için izlemeniz gereken adımlar:</p>
              <ul>
                <li><strong>1. Başvuru:</strong> info@figurunica.com adresine sipariş numaranızla birlikte talebinizi (hasar/ayıp durumunda fotoğraflarla) iletin.</li>
                <li><strong>2. İnceleme:</strong> Talebinizi kısa sürede değerlendirip izlenecek adımlar hakkında sizi bilgilendiririz.</li>
                <li><strong>3. Çözüm:</strong> Duruma göre yeniden üretim, değişim veya bedel iadesi uygulanır.</li>
              </ul>
              <p>
                Onaylanan bedel iadelerinde tutar, <strong>5-10 iş günü içinde</strong> ödemeyi yaptığınız yönteme geri
                yansıtılır:
              </p>
              <ul>
                <li>Kredi / banka kartı ile yapılan ödemeler <strong>PayTR üzerinden kart iadesi</strong> ile,</li>
                <li>Havale / EFT ile yapılan ödemeler ise <strong>banka hesabınıza havale</strong> yoluyla iade edilir.</li>
              </ul>
              <p>
                İade tutarının hesabınıza yansıma süresi, bankanızın ve ödeme kuruluşunun işleyişine bağlı olarak
                değişebilir.
              </p>

              <h2>7. İletişim</h2>
              <p>İade, değişim veya hasar konusundaki her türlü soru ve talebiniz için bize ulaşın:</p>
              <ul>
                <li>E-posta: info@figurunica.com (lütfen sipariş numaranızı belirtin)</li>
                <li>Telefon: +90 546 678 04 95</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                At Figurunica, our goal is for every product you receive to make you happy. With the 3D preview approval
                we offer before production, your free revision right, and the guarantee we provide against damaged
                deliveries, we are with you at every stage of your purchase. This policy explains your rights and the
                steps to follow in cases of returns, exchanges, and damaged or defective products.
              </p>

              <h2>1. General Principle</h2>
              <p>We sell two types of products, and return conditions differ by product type:</p>
              <ul>
                <li><strong>Personalized figurines (made-to-order):</strong> Produced specifically from the photo you upload, these qualify as personalized goods and are therefore excluded from the standard 14-day right of withdrawal.</li>
                <li><strong>Ready / standard store products:</strong> Non-personalized items sold from stock fall under the statutory 14-day right of withdrawal and can be returned within that period.</li>
              </ul>
              <p>
                Regardless of product type, if a product is delivered damaged or defective, your statutory consumer
                rights are always reserved (see Section 5).
              </p>

              <h2>2. Preview and Revision Guarantee</h2>
              <p>
                For personalized products, we secure your satisfaction before printing begins. The process works as
                follows:
              </p>
              <ul>
                <li>Our AI prepares a <strong>3D preview</strong> for your order and presents it for your approval.</li>
                <li>Printing <strong>does not begin</strong> until you approve the preview.</li>
                <li>If there are points you would like adjusted in the preview, you have <strong>1 free revision</strong>.</li>
                <li>We move to production only after you approve, so you see the product you will receive in advance.</li>
              </ul>
              <p>
                This step removes surprises on personalized products and is designed to guarantee your satisfaction from
                the very start.
              </p>

              <h2>3. Returns on Personalized Figurines</h2>
              <p>
                Because personalized figurines are produced specifically for you, they are exempt from the standard
                14-day right of withdrawal under Turkish Consumer Protection Law No. 6502 and the Distance Contracts
                Regulation. For this reason, returns based on a change of mind or simply not liking the item cannot be
                accepted.
              </p>
              <p>Nevertheless, your satisfaction is essential to us:</p>
              <ul>
                <li>The <strong>preview approval and free revision</strong> right before production exist so you can make the product match your expectations.</li>
                <li>You can cancel your order free of charge before giving preview approval.</li>
                <li>If the product is delivered <strong>damaged, defective, or incorrect</strong>, free reproduction, exchange, or a refund is provided (see Section 5).</li>
              </ul>

              <h2>4. Right of Withdrawal on Ready Store Products (14 Days)</h2>
              <p>
                For ready / standard store products sold from stock, you may exercise your right of withdrawal within
                <strong> 14 days</strong> of delivery without giving any reason.
              </p>
              <ul>
                <li>Simply send your withdrawal request to info@figurunica.com along with your order number.</li>
                <li>The product must be returned unused and in resalable condition (in its original packaging where possible).</li>
                <li>If the right of withdrawal is exercised properly, the amount you paid is refunded (see Section 6).</li>
                <li>Instantly delivered digital products such as STL files and personalized products are outside this scope.</li>
              </ul>

              <h2>5. Damaged / Defective Product</h2>
              <p>
                If the product you receive is damaged in transit or contains a manufacturing fault, we resolve the issue
                free of charge.
              </p>

              <h3>5.1 Damage in Transit</h3>
              <ul>
                <li>Notify us at info@figurunica.com <strong>within 48 hours</strong> of receiving the product, together with photos showing the damage.</li>
                <li>Where possible, also photograph the external condition of the package/parcel.</li>
                <li>After confirmation, you are provided a <strong>free reproduction or exchange</strong>; no additional charge applies.</li>
              </ul>

              <h3>5.2 Manufacturing Fault / Defective Product</h3>
              <ul>
                <li>If a defect arising from printing, material, or production is identified, your statutory consumer rights are reserved.</li>
                <li>Depending on your preference and the nature of the situation, one of the options of <strong>free reproduction, exchange, or refund</strong> is applied.</li>
                <li>Due to the nature of 3D printing, each product is unique; minor variations within production tolerances are not considered defects.</li>
              </ul>

              <h2>6. Return Process and Refund Timeframe</h2>
              <p>Steps to follow for your return or exchange request:</p>
              <ul>
                <li><strong>1. Application:</strong> Send your request to info@figurunica.com with your order number (with photos in case of damage/defect).</li>
                <li><strong>2. Review:</strong> We assess your request promptly and inform you about the steps to follow.</li>
                <li><strong>3. Resolution:</strong> Depending on the case, reproduction, exchange, or a refund is applied.</li>
              </ul>
              <p>
                For approved refunds, the amount is returned to your original payment method <strong>within 5-10 business
                days</strong>:
              </p>
              <ul>
                <li>Payments made by credit / debit card are refunded via <strong>card refund through PayTR</strong>,</li>
                <li>Payments made by bank transfer (havale / EFT) are refunded via <strong>bank transfer to your account</strong>.</li>
              </ul>
              <p>
                The time it takes for the refund to appear in your account may vary depending on your bank and payment
                provider.
              </p>

              <h2>7. Contact</h2>
              <p>For any questions or requests regarding returns, exchanges, or damage, please reach out to us:</p>
              <ul>
                <li>Email: info@figurunica.com (please include your order number)</li>
                <li>Phone: +90 546 678 04 95</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
