import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Terms of Service — Figurunica",
};

export default async function TermsPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Kullanım Koşulları" : "Terms of Service"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 31 Mart 2026" : "Last updated: March 31, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Kullanım Koşulları (&quot;Koşullar&quot;), Figurunica (&quot;Şirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) tarafından
                figurunica.com web sitesi ve ilişkili hizmetler üzerinden sunulan hizmetlerin kullanımına
                ilişkin şartları düzenlemektedir. Hizmetlerimizi kullanarak bu Koşullar&apos;ı kabul etmiş sayılırsınız.
              </p>

              <h2>1. Hizmet Tanımı</h2>
              <p>Figurunica aşağıdaki hizmetleri sunmaktadır:</p>
              <ul>
                <li>Kullanıcı tarafından yüklenen fotoğraflardan yapay zeka destekli 3D model oluşturma</li>
                <li>Oluşturulan 3D modellerin reçine baskı ile fiziksel figürin üretimi</li>
                <li>Figürin ile birlikte boyama kiti (boyalar, fırçalar, rehber) gönderimi</li>
                <li>3D obje oluşturma ve baskı hizmeti</li>
                <li>Dijital STL dosyası satışı</li>
                <li>Hediye kartı satış ve kullanım hizmeti</li>
              </ul>

              <h2>2. Sipariş Süreci</h2>

              <h3>2.1 Sipariş Oluşturma</h3>
              <ul>
                <li>Kullanıcı, web sitemiz üzerinden fotoğraf yükleyerek, figürin boyutunu ve stilini seçerek sipariş oluşturur.</li>
                <li>Sipariş sonrası yapay zekamız bir 3D model önizlemesi oluşturur.</li>
                <li>Kullanıcı, 3D önizlemeyi inceleyip onayladıktan sonra ödeme işlemine geçer.</li>
                <li>Ödeme tamamlandıktan sonra üretim süreci başlar.</li>
              </ul>

              <h3>2.2 Önizleme ve Onay</h3>
              <ul>
                <li>Her sipariş için baskı öncesi dijital önizleme sunulur.</li>
                <li>Kullanıcı, önizlemeyi onaylayana kadar baskı işlemi başlamaz.</li>
                <li>Önizleme, nihai ürünün yaklaşık bir temsilidir; malzeme, renk ve detaylarda küçük farklılıklar olabilir.</li>
              </ul>

              <h3>2.3 Üretim ve Teslimat</h3>
              <ul>
                <li>Onaylanan siparişler genellikle 5-7 iş günü içinde üretilir.</li>
                <li>Yurt içi kargo ücretsizdir ve 2-3 iş günü sürer.</li>
                <li>Belirtilen süreler tahmini olup, yoğunluk dönemlerinde uzayabilir.</li>
                <li>Teslimat adresi sipariş sırasında belirtilen adrestir; adres değişikliği için üretim başlamadan önce iletişime geçiniz.</li>
              </ul>

              <h2>3. Fiyatlandırma ve Ödeme</h2>

              <h3>3.1 Fiyatlar</h3>
              <ul>
                <li>Tüm fiyatlar Türk Lirası (TL) cinsinden ve KDV dahildir.</li>
                <li>Güncel fiyatlar web sitemizde belirtilmektedir.</li>
                <li>Şirket, fiyatları önceden bildirimde bulunmaksızın değiştirme hakkını saklı tutar. Değişiklikler mevcut siparişleri etkilemez.</li>
              </ul>

              <h3>3.2 Ödeme Yöntemleri</h3>
              <ul>
                <li>Kredi kartı / banka kartı (PayTR üzerinden)</li>
                <li>Hediye kartı</li>
                <li>Hediye kartı + kredi kartı kombinasyonu</li>
              </ul>

              <h3>3.3 Hediye Kartları</h3>
              <ul>
                <li>Hediye kartları satın alınma tarihinden itibaren 1 yıl geçerlidir.</li>
                <li>Hediye kartları iade edilemez ve nakde çevrilemez.</li>
                <li>Hediye kartı bakiyesi sipariş tutarını karşılamazsa, kalan tutar başka bir ödeme yöntemiyle tamamlanabilir.</li>
                <li>Hediye kartı bakiyesi sipariş tutarını aşarsa, kalan bakiye bir sonraki siparişte kullanılabilir.</li>
              </ul>

              <h2>4. İptal ve İade Politikası</h2>

              <h3>4.1 Sipariş İptali</h3>
              <ul>
                <li>Üretim başlamadan önce sipariş iptal edilebilir.</li>
                <li>Önizleme onayı verilmeden önceki siparişler ücretsiz iptal edilebilir.</li>
                <li>Önizleme onaylandıktan ve üretim başladıktan sonra iptal kabul edilmez.</li>
              </ul>

              <h3>4.2 İade</h3>
              <ul>
                <li>Her figürin özel üretim olduğu için standart iade kabul edilmemektedir.</li>
                <li>Ürün hasar görmüş veya hatalı olarak teslim edilmişse, teslim tarihinden itibaren 14 gün içinde bizimle iletişime geçiniz.</li>
                <li>Kalite sorunu tespit edilmesi halinde ücretsiz yeniden üretim veya iade yapılır.</li>
                <li>Ürünün fotoğrafı ve sorunun açıklaması ile birlikte info@figurunica.com adresine başvuru yapılmalıdır.</li>
              </ul>

              <h3>4.3 Mesafeli Satış Sözleşmesi</h3>
              <p>
                6502 sayılı Tüketicinin Korunması Hakkında Kanun&apos;un 48. maddesi ve Mesafeli Sözleşmeler Yönetmeliği
                kapsamında, özel üretim ürünler (kişiye özel figürinler) cayma hakkı kapsamında değildir.
                Ancak ürünün ayıplı teslimi halinde tüketici hakları saklıdır.
              </p>

              <h2>5. Fikri Mülkiyet Hakları</h2>

              <h3>5.1 Şirket Hakları</h3>
              <ul>
                <li>Figurunica markası, logosu, web sitesi tasarımı, yazılımı ve içeriği Şirket&apos;in fikri mülkiyetidir.</li>
                <li>Yapay zeka modelleri ve üretim süreçleri Şirket&apos;e aittir.</li>
              </ul>

              <h3>5.2 Kullanıcı İçeriği</h3>
              <ul>
                <li>Yüklediğiniz fotoğrafların telif hakkı size aittir.</li>
                <li>Fotoğraf yükleyerek, bu fotoğrafın figürin oluşturma amaçlı işlenmesine izin vermiş olursunuz.</li>
                <li>Galeriye paylaştığınız figürin görsellerinin Şirket tarafından tanıtım amaçlı kullanılmasına izin vermiş olursunuz.</li>
                <li>Galeriden paylaşımlarınızı istediğiniz zaman kaldırabilirsiniz.</li>
              </ul>

              <h3>5.3 Yasaklar</h3>
              <p>Aşağıdaki içerikler için sipariş veremezsiniz:</p>
              <ul>
                <li>Başkalarının telif haklarına tecavüz eden içerikler</li>
                <li>Pornografik, nefret içeren veya şiddet içeren içerikler</li>
                <li>Yasadışı faaliyetleri teşvik eden içerikler</li>
                <li>Üçüncü kişilerin gizlilik haklarını ihlal eden içerikler</li>
              </ul>

              <h2>6. Sorumluluk Sınırlaması</h2>

              <h3>6.1 Hizmet Garantisi</h3>
              <ul>
                <li>Yapay zeka tarafından oluşturulan 3D modellerin kalitesi, yüklenen fotoğrafın kalitesine bağlıdır.</li>
                <li>Önizleme ile nihai ürün arasında küçük farklılıklar olabilir (renk tonları, detay seviyeleri vb.).</li>
                <li>3D baskı sürecinin doğası gereği, her ürün eşsizdir ve küçük farklılıklar üretim toleransları içerisindedir.</li>
              </ul>

              <h3>6.2 Sorumluluk Sınırı</h3>
              <ul>
                <li>Şirket, hizmet kesintileri, teknik arızalar veya üçüncü taraf hizmet sağlayıcılardan kaynaklanan aksaklıklar nedeniyle oluşan dolaylı zararlardan sorumlu değildir.</li>
                <li>Şirket&apos;in toplam sorumluluğu, ilgili siparişin bedelini aşmaz.</li>
              </ul>

              <h2>7. Hesap Kullanımı</h2>
              <ul>
                <li>Hesabınızı başkasına devredemezsiniz.</li>
                <li>Hesap bilgilerinizin güvenliğinden siz sorumlusunuz.</li>
                <li>Hesabınızda yetkisiz erişim farketmeniz halinde derhal bizimle iletişime geçiniz.</li>
                <li>Şirket, bu Koşullar&apos;ı ihlal eden hesapları askıya alma veya kapatma hakkını saklı tutar.</li>
              </ul>

              <h2>8. Mücbir Sebepler</h2>
              <p>
                Doğal afetler, salgınlar, savaş, grev, hükümet kararları, internet altyapı sorunları ve benzeri
                kontrol dışında gelişen olaylar nedeniyle hizmetlerin aksaması veya gecikmesi halinde Şirket sorumlu tutulamaz.
              </p>

              <h2>9. Uyuşmazlık Çözümü</h2>
              <ul>
                <li>Bu Koşullar Türkiye Cumhuriyeti kanunlarına tabidir.</li>
                <li>Uyuşmazlıklarda İstanbul Mahkemeleri ve İcra Daireleri yetkilidir.</li>
                <li>Tüketici şikayetleri için Tüketici Hakem Heyetlerine başvurulabilir.</li>
              </ul>

              <h2>10. Değişiklikler</h2>
              <p>
                Şirket, bu Koşullar&apos;ı herhangi bir zamanda değiştirme hakkını saklı tutar. Değişiklikler
                web sitemizde yayınlandığında yürürlüğe girer. Önemli değişiklikler hakkında kayıtlı
                kullanıcılara e-posta ile bildirim yapılır.
              </p>

              <h2>11. İletişim</h2>
              <p>Bu Kullanım Koşulları hakkında sorularınız için:</p>
              <ul>
                <li>E-posta: info@figurunica.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                These Terms of Service (&quot;Terms&quot;) govern the use of services provided by Figurunica (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;)
                through the figurunica.com website and related services. By using our services, you agree to these Terms.
              </p>

              <h2>1. Service Description</h2>
              <p>Figurunica provides the following services:</p>
              <ul>
                <li>AI-powered 3D model generation from user-uploaded photos</li>
                <li>Physical figurine production from generated 3D models using resin printing</li>
                <li>Paint kit delivery with figurines (paints, brushes, guide)</li>
                <li>3D object creation and printing service</li>
                <li>Digital STL file sales</li>
                <li>Gift card sales and usage service</li>
              </ul>

              <h2>2. Order Process</h2>

              <h3>2.1 Creating an Order</h3>
              <ul>
                <li>Users create orders by uploading a photo, selecting figurine size and style through our website.</li>
                <li>After the order, our AI generates a 3D model preview.</li>
                <li>After reviewing and approving the 3D preview, the user proceeds to payment.</li>
                <li>Production begins after payment is completed.</li>
              </ul>

              <h3>2.2 Preview and Approval</h3>
              <ul>
                <li>A digital preview is provided before printing for every order.</li>
                <li>Printing does not begin until the user approves the preview.</li>
                <li>The preview is an approximate representation of the final product; minor differences in material, color, and details may occur.</li>
              </ul>

              <h3>2.3 Production and Delivery</h3>
              <ul>
                <li>Approved orders are typically produced within 5-7 business days.</li>
                <li>Domestic shipping is free and takes 2-3 business days.</li>
                <li>Stated timelines are estimates and may be extended during peak periods.</li>
                <li>The delivery address is the one provided at the time of order; for address changes, contact us before production begins.</li>
              </ul>

              <h2>3. Pricing and Payment</h2>

              <h3>3.1 Prices</h3>
              <ul>
                <li>All prices are in Turkish Lira (TL) and include VAT.</li>
                <li>Current prices are listed on our website.</li>
                <li>The Company reserves the right to change prices without prior notice. Changes do not affect existing orders.</li>
              </ul>

              <h3>3.2 Payment Methods</h3>
              <ul>
                <li>Credit card / debit card (via PayTR)</li>
                <li>Gift card</li>
                <li>Gift card + credit card combination</li>
              </ul>

              <h3>3.3 Gift Cards</h3>
              <ul>
                <li>Gift cards are valid for 1 year from the date of purchase.</li>
                <li>Gift cards are non-refundable and cannot be converted to cash.</li>
                <li>If the gift card balance does not cover the order amount, the remaining amount can be paid with another payment method.</li>
                <li>If the gift card balance exceeds the order amount, the remaining balance can be used on the next order.</li>
              </ul>

              <h2>4. Cancellation and Return Policy</h2>

              <h3>4.1 Order Cancellation</h3>
              <ul>
                <li>Orders can be cancelled before production begins.</li>
                <li>Orders before preview approval can be cancelled free of charge.</li>
                <li>Cancellations are not accepted after preview approval and production start.</li>
              </ul>

              <h3>4.2 Returns</h3>
              <ul>
                <li>Standard returns are not accepted as each figurine is custom-made.</li>
                <li>If the product is delivered damaged or defective, contact us within 14 days of delivery.</li>
                <li>If a quality issue is confirmed, free reproduction or refund will be provided.</li>
                <li>Applications should be made to info@figurunica.com with a photo of the product and description of the issue.</li>
              </ul>

              <h3>4.3 Distance Sales Contract</h3>
              <p>
                Under Article 48 of Turkish Consumer Protection Law No. 6502 and the Distance Contracts Regulation,
                custom-made products (personalized figurines) are exempt from the right of withdrawal.
                However, consumer rights in case of defective delivery are reserved.
              </p>

              <h2>5. Intellectual Property Rights</h2>

              <h3>5.1 Company Rights</h3>
              <ul>
                <li>The Figurunica brand, logo, website design, software, and content are the intellectual property of the Company.</li>
                <li>AI models and production processes belong to the Company.</li>
              </ul>

              <h3>5.2 User Content</h3>
              <ul>
                <li>You retain copyright of the photos you upload.</li>
                <li>By uploading a photo, you grant permission for it to be processed for figurine creation purposes.</li>
                <li>By sharing figurine images to the gallery, you grant the Company permission to use them for promotional purposes.</li>
                <li>You can remove your gallery shares at any time.</li>
              </ul>

              <h3>5.3 Prohibited Content</h3>
              <p>You may not place orders for the following content:</p>
              <ul>
                <li>Content that infringes on others&apos; copyrights</li>
                <li>Pornographic, hateful, or violent content</li>
                <li>Content that promotes illegal activities</li>
                <li>Content that violates third parties&apos; privacy rights</li>
              </ul>

              <h2>6. Limitation of Liability</h2>

              <h3>6.1 Service Guarantee</h3>
              <ul>
                <li>The quality of AI-generated 3D models depends on the quality of the uploaded photo.</li>
                <li>Minor differences may exist between the preview and the final product (color tones, detail levels, etc.).</li>
                <li>Due to the nature of 3D printing, each product is unique and minor variations are within production tolerances.</li>
              </ul>

              <h3>6.2 Liability Limit</h3>
              <ul>
                <li>The Company is not liable for indirect damages arising from service interruptions, technical failures, or disruptions caused by third-party service providers.</li>
                <li>The Company&apos;s total liability shall not exceed the price of the relevant order.</li>
              </ul>

              <h2>7. Account Usage</h2>
              <ul>
                <li>You may not transfer your account to another person.</li>
                <li>You are responsible for the security of your account credentials.</li>
                <li>Contact us immediately if you notice unauthorized access to your account.</li>
                <li>The Company reserves the right to suspend or close accounts that violate these Terms.</li>
              </ul>

              <h2>8. Force Majeure</h2>
              <p>
                The Company shall not be held responsible for service disruptions or delays caused by events beyond its control,
                including but not limited to natural disasters, pandemics, war, strikes, government decisions, and internet infrastructure issues.
              </p>

              <h2>9. Dispute Resolution</h2>
              <ul>
                <li>These Terms are governed by the laws of the Republic of Turkey.</li>
                <li>Istanbul Courts and Enforcement Offices have jurisdiction for disputes.</li>
                <li>Consumer complaints may be filed with Consumer Arbitration Committees.</li>
              </ul>

              <h2>10. Changes</h2>
              <p>
                The Company reserves the right to modify these Terms at any time. Changes take effect when published
                on our website. Registered users will be notified via email about significant changes.
              </p>

              <h2>11. Contact</h2>
              <p>For questions about these Terms of Service:</p>
              <ul>
                <li>Email: info@figurunica.com</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
