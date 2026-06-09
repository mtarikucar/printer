import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Mesafeli Satış Sözleşmesi — Figurunica",
};

export default async function MesafeliSatisPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Mesafeli Satış Sözleşmesi" : "Distance Sales Agreement"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                İşbu Mesafeli Satış Sözleşmesi (&quot;Sözleşme&quot;), 6502 sayılı Tüketicinin Korunması Hakkında Kanun
                ve Mesafeli Sözleşmeler Yönetmeliği uyarınca, aşağıda bilgileri yer alan Satıcı ile figurunica.com
                üzerinden sipariş veren Alıcı (&quot;Tüketici&quot;) arasında, elektronik ortamda kurulmaktadır.
                Tüketici, siparişini onaylamakla işbu Sözleşme&apos;nin tüm hükümlerini kabul etmiş sayılır.
              </p>

              <h2>1. Taraflar</h2>
              <p><strong>Satıcı</strong></p>
              <ul>
                <li>Unvan: Figurunica</li>
                <li>Web sitesi: figurunica.com</li>
                <li>E-posta: info@figurunica.com</li>
                <li>Telefon: +90 546 678 04 95</li>
                <li>Adres: Şehit Osman Avcı Mahallesi, Akın 688 Sitesi B32, Etimesgut / Ankara</li>
              </ul>
              <p><strong>Alıcı (Tüketici)</strong></p>
              <p>
                Sipariş sırasında ad-soyad, teslimat adresi, e-posta ve telefon bilgilerini beyan eden kişidir.
                Alıcı&apos;ya ait bilgiler, sipariş kaydı ve faturada yer alan bilgilerdir.
              </p>

              <h2>2. Sözleşmenin Konusu</h2>
              <p>
                İşbu Sözleşme&apos;nin konusu; Alıcı&apos;nın, Satıcı&apos;ya ait figurunica.com web sitesi üzerinden
                elektronik ortamda siparişini verdiği, aşağıda nitelikleri ve satış fiyatı belirtilen kişiye özel
                figürin ürününün satışı ve teslimi ile tarafların hak ve yükümlülüklerinin, 6502 sayılı Kanun ve
                Mesafeli Sözleşmeler Yönetmeliği hükümleri uyarınca belirlenmesidir.
              </p>

              <h2>3. Ürün ve Hizmet Bilgileri</h2>
              <ul>
                <li>
                  <strong>Nitelik:</strong> Ürün, Alıcı&apos;nın yüklediği fotoğraflardan yapay zeka ile 3D model
                  oluşturularak reçine baskı yöntemiyle üretilen, <strong>kişiye özel (siparişe göre üretilen)</strong> bir figürindir.
                </li>
                <li>
                  Figürin; seçilen boyut, materyal ve bitiş seçeneğine (Boyanabilir Kit / El Boyaması / Lüks Vitrin)
                  göre fiyatlandırılır.
                </li>
                <li>
                  Her sipariş için baskı öncesi dijital önizleme sunulur; üretim, Alıcı önizlemeyi onaylayana kadar başlamaz.
                </li>
                <li>
                  Ürünün temel nitelikleri, adedi ve KDV dahil satış fiyatı, sipariş sayfasında ve sipariş özetinde gösterilir.
                </li>
                <li>
                  <strong>Fiyat:</strong> Tüm fiyatlar Türk Lirası (TL) cinsinden olup <strong>KDV dahildir</strong>.
                  Türkiye içi kargo ücretsizdir; Alıcı&apos;dan ayrıca kargo bedeli alınmaz.
                </li>
                <li>
                  Satıcı, fiyatları önceden bildirimde bulunmaksızın güncelleme hakkını saklı tutar; değişiklikler onaylanmış
                  mevcut siparişleri etkilemez.
                </li>
              </ul>

              <h2>4. Ödeme</h2>
              <ul>
                <li>Ödemeler <strong>PayTR</strong> altyapısı üzerinden 3D Secure kredi/banka kartı ile veya <strong>Havale/EFT</strong> ile yapılabilir.</li>
                <li>
                  Kredi kartı bilgileri Figurunica tarafından saklanmaz; ödeme bilgileri doğrudan PayTR&apos;ın güvenli
                  altyapısında işlenir.
                </li>
                <li>Havale/EFT seçiminde sipariş, ödemenin Satıcı hesabına geçtiğinin teyit edilmesinden sonra işleme alınır.</li>
                <li>Ödeme onaylandıktan ve önizleme Alıcı tarafından onaylandıktan sonra üretim süreci başlar.</li>
              </ul>

              <h2>5. Teslimat</h2>
              <ul>
                <li>Teslimat, sipariş sırasında Alıcı tarafından bildirilen adrese yapılır.</li>
                <li>Ürün, <strong>Yurtiçi Kargo</strong> ile gönderilir ve <strong>Türkiye içi kargo ücretsizdir</strong>.</li>
                <li>Üretim, önizleme onayından sonra genellikle <strong>5-7 iş günü</strong> içinde tamamlanır; kargo süreci <strong>2-3 iş günü</strong>dür.</li>
                <li>Belirtilen süreler tahmini olup yoğunluk dönemlerinde uzayabilir; her halükârda yasal azami teslim süresi 30 gündür.</li>
                <li>Adres değişikliği için üretim başlamadan önce info@figurunica.com adresinden iletişime geçilmelidir.</li>
                <li>Kargoyu teslim alırken paketi kontrol etmeniz; hasar tespitinde tutanak tutturarak ürünü teslim almamanız önerilir.</li>
              </ul>

              <h2>6. Cayma Hakkı ve İstisnaları</h2>
              <p>
                Tüketici, hazır/standart ürünlerde, ürünü teslim aldığı tarihten itibaren <strong>14 (on dört) gün</strong>
                içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkına sahiptir.
              </p>
              <p>
                Ancak; siparişe konu figürinler, Alıcı&apos;nın yüklediği fotoğraflar ve seçimleri doğrultusunda
                <strong> kişiye özel olarak üretildiğinden</strong>, Mesafeli Sözleşmeler Yönetmeliği&apos;nin 15. maddesi
                uyarınca &quot;tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallar&quot;
                kapsamında değerlendirilir ve <strong>cayma hakkı istisnasındadır</strong>. Bu nedenle önizleme onayı verilip
                üretime başlanan kişiye özel siparişler için cayma hakkı kullanılamaz.
              </p>
              <p>
                Önizleme onayı verilmeden ve üretim başlamadan önce sipariş ücretsiz iptal edilebilir.
                Ürünün ayıplı/hasarlı teslim edilmesi halinde tüketicinin yasal hakları saklıdır; bu durumda Alıcı,
                teslim tarihinden itibaren 14 gün içinde ürünün fotoğrafı ve sorunun açıklamasıyla info@figurunica.com
                adresine başvurabilir. Kalite sorunu teyit edilirse <strong>değişim, ücretsiz yeniden üretim veya iade</strong> sağlanır.
              </p>

              <h2>7. Genel Hükümler</h2>
              <ul>
                <li>Alıcı, sipariş öncesi ürünün temel nitelikleri, KDV dahil fiyatı, ödeme ve teslimat koşulları ile cayma hakkına ilişkin ön bilgileri okuyup teyit ettiğini kabul eder.</li>
                <li>Alıcı, yüklediği fotoğraflar üzerinde gerekli haklara sahip olduğunu; üçüncü kişilerin telif, gizlilik veya kişilik haklarını ihlal eden içerik göndermeyeceğini beyan eder.</li>
                <li>Önizleme nihai ürünün yaklaşık bir temsilidir; reçine baskının doğası gereği renk tonu ve detayda küçük farklılıklar üretim toleransları içinde kabul edilir.</li>
                <li>Mücbir sebep hallerinde (doğal afet, salgın, grev, kamu kararları, altyapı arızaları vb.) edimlerin ifasındaki gecikme veya imkânsızlıktan Satıcı sorumlu tutulamaz.</li>
                <li>Satıcı elektronik ticaret faaliyetini ETBİS (Elektronik Ticaret Bilgi Sistemi) kaydı kapsamında yürütmektedir.</li>
              </ul>

              <h2>8. Uyuşmazlık Çözümü</h2>
              <ul>
                <li>İşbu Sözleşme Türkiye Cumhuriyeti kanunlarına tabidir.</li>
                <li>Uyuşmazlıklarda, Ticaret Bakanlığı&apos;nca her yıl ilan edilen parasal sınırlar dâhilinde Tüketici Hakem Heyetleri ile Tüketici Mahkemeleri yetkilidir.</li>
                <li>Tüketici, başvurusunu yerleşim yerinin bulunduğu veya işlemin yapıldığı yerdeki Tüketici Hakem Heyeti&apos;ne ya da Tüketici Mahkemesi&apos;ne yapabilir.</li>
              </ul>

              <h2>9. Yürürlük</h2>
              <p>
                Alıcı&apos;nın siparişi elektronik ortamda onaylaması ile işbu Sözleşme, taraflar arasında kurulmuş ve
                yürürlüğe girmiş sayılır. Sözleşme&apos;nin bir örneği Alıcı&apos;nın bildirdiği e-posta adresine
                gönderilebilir ve sipariş kaydında saklanır.
              </p>
            </>
          ) : (
            <>
              <p>
                This Distance Sales Agreement (&quot;Agreement&quot;) is concluded electronically between the Seller
                identified below and the Buyer (&quot;Consumer&quot;) who places an order through figurunica.com,
                in accordance with Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation.
                By confirming an order, the Consumer is deemed to have accepted all provisions of this Agreement.
              </p>

              <h2>1. Parties</h2>
              <p><strong>Seller</strong></p>
              <ul>
                <li>Name: Figurunica</li>
                <li>Website: figurunica.com</li>
                <li>Email: info@figurunica.com</li>
                <li>Phone: +90 546 678 04 95</li>
                <li>Address: Şehit Osman Avcı Mahallesi, Akın 688 Sitesi B32, Etimesgut / Ankara</li>
              </ul>
              <p><strong>Buyer (Consumer)</strong></p>
              <p>
                The person who provides their full name, delivery address, email, and phone number during checkout.
                The Buyer&apos;s details are those recorded in the order and shown on the invoice.
              </p>

              <h2>2. Subject of the Agreement</h2>
              <p>
                The subject of this Agreement is the sale and delivery of the custom-made figurine product, the
                characteristics and sale price of which are specified below, ordered electronically by the Buyer through
                the Seller&apos;s figurunica.com website, and the determination of the parties&apos; rights and obligations
                in accordance with Law No. 6502 and the Distance Contracts Regulation.
              </p>

              <h2>3. Product and Service Information</h2>
              <ul>
                <li>
                  <strong>Nature:</strong> The product is a <strong>custom-made (made-to-order)</strong> figurine produced
                  by generating a 3D model with AI from the photos uploaded by the Buyer and printing it using resin.
                </li>
                <li>
                  The figurine is priced according to the selected size, material, and finish option
                  (Paintable Kit / Hand-Painted / Luxury Display).
                </li>
                <li>
                  A digital preview is provided before printing for every order; production does not begin until the
                  Buyer approves the preview.
                </li>
                <li>
                  The essential characteristics, quantity, and VAT-inclusive sale price of the product are shown on the
                  product page and in the order summary.
                </li>
                <li>
                  <strong>Price:</strong> All prices are in Turkish Lira (TL) and <strong>include VAT</strong>. Domestic
                  shipping is free; no separate shipping fee is charged to the Buyer.
                </li>
                <li>
                  The Seller reserves the right to update prices without prior notice; changes do not affect approved
                  existing orders.
                </li>
              </ul>

              <h2>4. Payment</h2>
              <ul>
                <li>Payments can be made via <strong>PayTR</strong> with a 3D Secure credit/debit card, or by <strong>bank transfer (Havale/EFT)</strong>.</li>
                <li>Credit card details are never stored by Figurunica; payment data is processed directly on PayTR&apos;s secure infrastructure.</li>
                <li>For bank transfer, the order is processed after the payment is confirmed as received in the Seller&apos;s account.</li>
                <li>Production begins after payment is confirmed and the preview is approved by the Buyer.</li>
              </ul>

              <h2>5. Delivery</h2>
              <ul>
                <li>Delivery is made to the address provided by the Buyer at the time of order.</li>
                <li>The product is shipped via <strong>Yurtiçi Kargo</strong>, and <strong>domestic shipping is free</strong>.</li>
                <li>Production is typically completed within <strong>5-7 business days</strong> after preview approval; shipping takes <strong>2-3 business days</strong>.</li>
                <li>Stated timelines are estimates and may be extended during peak periods; in any case, the statutory maximum delivery period is 30 days.</li>
                <li>For address changes, contact info@figurunica.com before production begins.</li>
                <li>When receiving the parcel, please inspect it; if damage is detected, we recommend not accepting the parcel and having a report drawn up.</li>
              </ul>

              <h2>6. Right of Withdrawal and Its Exceptions</h2>
              <p>
                For ready-made/standard products, the Consumer has the right to withdraw within <strong>14 (fourteen) days</strong>
                from the date of delivery, without providing any justification and without paying any penalty.
              </p>
              <p>
                However, since the figurines subject to the order are <strong>produced specifically for the individual</strong>
                in line with the photos and choices uploaded by the Buyer, they are considered &quot;goods prepared in line
                with the consumer&apos;s requests or personal needs&quot; under Article 15 of the Distance Contracts Regulation
                and are therefore an <strong>exception to the right of withdrawal</strong>. For this reason, the right of
                withdrawal cannot be exercised for custom-made orders that have been approved at preview and put into production.
              </p>
              <p>
                Before preview approval and the start of production, an order can be cancelled free of charge.
                In the event of a defective/damaged delivery, the Consumer&apos;s legal rights are reserved; in such cases the
                Buyer may apply to info@figurunica.com within 14 days of delivery with a photo of the product and a description
                of the issue. If a quality issue is confirmed, an <strong>exchange, free reproduction, or refund</strong> is provided.
              </p>

              <h2>7. General Provisions</h2>
              <ul>
                <li>The Buyer acknowledges having read and confirmed the preliminary information on the product&apos;s essential characteristics, VAT-inclusive price, payment and delivery terms, and the right of withdrawal prior to ordering.</li>
                <li>The Buyer declares that they hold the necessary rights over the uploaded photos and will not submit content that infringes the copyright, privacy, or personal rights of third parties.</li>
                <li>The preview is an approximate representation of the final product; due to the nature of resin printing, minor variations in color tone and detail are accepted within production tolerances.</li>
                <li>The Seller cannot be held liable for delay or impossibility in performance due to force majeure events (natural disasters, pandemics, strikes, government decisions, infrastructure failures, etc.).</li>
                <li>The Seller conducts its e-commerce activity within the scope of its ETBİS (Electronic Commerce Information System) registration.</li>
              </ul>

              <h2>8. Dispute Resolution</h2>
              <ul>
                <li>This Agreement is governed by the laws of the Republic of Turkey.</li>
                <li>For disputes, the Consumer Arbitration Committees and Consumer Courts have jurisdiction, within the monetary thresholds announced annually by the Ministry of Trade.</li>
                <li>The Consumer may file their application with the Consumer Arbitration Committee or Consumer Court at their place of residence or where the transaction took place.</li>
              </ul>

              <h2>9. Entry into Force</h2>
              <p>
                Upon the Buyer&apos;s electronic confirmation of the order, this Agreement is deemed concluded between the
                parties and in force. A copy of the Agreement may be sent to the email address provided by the Buyer and is
                stored in the order record.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
