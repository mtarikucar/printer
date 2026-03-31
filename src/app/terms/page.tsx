import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Terms of Service — Figurine Studio",
};

export default async function TermsPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Kullanim Kosullari" : "Terms of Service"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son guncelleme: 31 Mart 2026" : "Last updated: March 31, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Kullanim Kosullari (&quot;Kosullar&quot;), Figurine Studio (&quot;Sirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) tarafindan
                figurinestudio.com web sitesi ve iliskili hizmetler uzerinden sunulan hizmetlerin kullanimina
                iliskin sartlari duzenlemektedir. Hizmetlerimizi kullanarak bu Kosullar&apos;i kabul etmis sayilirsiniz.
              </p>

              <h2>1. Hizmet Tanimi</h2>
              <p>Figurine Studio asagidaki hizmetleri sunmaktadir:</p>
              <ul>
                <li>Kullanici tarafindan yuklenen fotograflardan yapay zeka destekli 3D model olusturma</li>
                <li>Olusturulan 3D modellerin recine baski ile fiziksel figurin uretimi</li>
                <li>Figurin ile birlikte boyama kiti (boyalar, fircalar, rehber) gonderimi</li>
                <li>3D obje olusturma ve baski hizmeti</li>
                <li>Dijital STL dosyasi satisi</li>
                <li>Hediye karti satis ve kullanim hizmeti</li>
              </ul>

              <h2>2. Siparis Sureci</h2>

              <h3>2.1 Siparis Olusturma</h3>
              <ul>
                <li>Kullanici, web sitemiz uzerinden fotograf yukleyerek, figurin boyutunu ve stilini secerek siparis olusturur.</li>
                <li>Siparis sonrasi yapay zekamiz bir 3D model onizlemesi olusturur.</li>
                <li>Kullanici, 3D onizlemeyi inceleyip onayladiktan sonra odeme islemine gecer.</li>
                <li>Odeme tamamlandiktan sonra uretim sureci baslar.</li>
              </ul>

              <h3>2.2 Onizleme ve Onay</h3>
              <ul>
                <li>Her siparis icin baski oncesi dijital onizleme sunulur.</li>
                <li>Kullanici, onizlemeyi onaylayana kadar baski islemi baslamaz.</li>
                <li>Onizleme, nihai urunun yaklasik bir temsilidir; malzeme, renk ve detaylarda kucuk farkliliklar olabilir.</li>
              </ul>

              <h3>2.3 Uretim ve Teslimat</h3>
              <ul>
                <li>Onaylanan siparisler genellikle 5-7 is gunu icinde uretilir.</li>
                <li>Yurici kargo ucretsizdir ve 2-3 is gunu surer.</li>
                <li>Belirtilen sureler tahmini olup, yogunluk donemlerinde uzayabilir.</li>
                <li>Teslimat adresi siparis sirasinda belirtilen adrestir; adres degisikligi icin uretim baslamadan once iletisime geciniz.</li>
              </ul>

              <h2>3. Fiyatlandirma ve Odeme</h2>

              <h3>3.1 Fiyatlar</h3>
              <ul>
                <li>Tum fiyatlar Turk Lirasi (TL) cinsinden ve KDV dahildir.</li>
                <li>Guncel fiyatlar web sitemizde belirtilmektedir.</li>
                <li>Sirket, fiyatlari onceden bildirimde bulunmaksizin degistirme hakkini sakli tutar. Degisiklikler mevcut siparisleri etkilemez.</li>
              </ul>

              <h3>3.2 Odeme Yontemleri</h3>
              <ul>
                <li>Kredi karti / banka karti (Stripe uzerinden)</li>
                <li>Hediye karti</li>
                <li>Hediye karti + kredi karti kombinasyonu</li>
              </ul>

              <h3>3.3 Hediye Kartlari</h3>
              <ul>
                <li>Hediye kartlari satin alinma tarihinden itibaren 1 yil gecerlidir.</li>
                <li>Hediye kartlari iade edilemez ve nakde cevrilemez.</li>
                <li>Hediye karti bakiyesi siparis tutarini karsilamazsa, kalan tutar baska bir odeme yontemiyle tamamlanabilir.</li>
                <li>Hediye karti bakiyesi siparis tutarini asarsa, kalan bakiye bir sonraki sipariste kullanilabilir.</li>
              </ul>

              <h2>4. Iptal ve Iade Politikasi</h2>

              <h3>4.1 Siparis Iptali</h3>
              <ul>
                <li>Uretim baslamadan once siparis iptal edilebilir.</li>
                <li>Onizleme onayi verilmeden onceki siparisler ucretsiz iptal edilebilir.</li>
                <li>Onizleme onaylandiktan ve uretim basladiktan sonra iptal kabul edilmez.</li>
              </ul>

              <h3>4.2 Iade</h3>
              <ul>
                <li>Her figurin ozel uretim oldugu icin standart iade kabul edilmemektedir.</li>
                <li>Urun hasar gormus veya hatali olarak teslim edilmisse, teslim tarihinden itibaren 14 gun icinde bizimle iletisime geciniz.</li>
                <li>Kalite sorunu tespit edilmesi halinde ucretsiz yeniden uretim veya iade yapilir.</li>
                <li>Urunun fotografi ve sorunun aciklamasi ile birlikte info@figurinestudio.com adresine basvuru yapilmalidir.</li>
              </ul>

              <h3>4.3 Mesafeli Satis Sozlesmesi</h3>
              <p>
                6502 sayili Tuketicinin Korunmasi Hakkinda Kanun&apos;un 48. maddesi ve Mesafeli Sozlesmeler Yonetmeligi
                kapsaminda, ozel uretim urunler (kisiye ozel figurinler) cayma hakki kapsaminda degildir.
                Ancak urunun ayipli teslimi halinde tuketici haklari saklidir.
              </p>

              <h2>5. Fikri Mulkiyet Haklari</h2>

              <h3>5.1 Sirket Haklari</h3>
              <ul>
                <li>Figurine Studio markasi, logosu, web sitesi tasarimi, yazilimi ve icerigi Sirket&apos;in fikri mulkiyetidir.</li>
                <li>Yapay zeka modelleri ve uretim surecleri Sirket&apos;e aittir.</li>
              </ul>

              <h3>5.2 Kullanici Icerigi</h3>
              <ul>
                <li>Yuklediginiz fotograflarin telif hakki size aittir.</li>
                <li>Fotograf yukleyerek, bu fotografin figurin olusturma amacli islenmesine izin vermis olursunuz.</li>
                <li>Galeriye paylastiginiz figurin gorsellerinin Sirket tarafindan tanitim amacli kullanilmasina izin vermis olursunuz.</li>
                <li>Galeriden paylasimlarinizi istediginiz zaman kaldirabilirsiniz.</li>
              </ul>

              <h3>5.3 Yasaklar</h3>
              <p>Asagidaki icerikler icin siparis veremezsiniz:</p>
              <ul>
                <li>Baskalarinin telif haklarina tecavuz eden icerikler</li>
                <li>Pornografik, nefret iceren veya siddet iceren icerikler</li>
                <li>Yasadisi faaliyetleri tesvik eden icerikler</li>
                <li>Ucuncu kisilerin gizlilik haklarini ihlal eden icerikler</li>
              </ul>

              <h2>6. Sorumluluk Sinirlamasi</h2>

              <h3>6.1 Hizmet Garantisi</h3>
              <ul>
                <li>Yapay zeka tarafindan olusturulan 3D modellerin kalitesi, yuklenen fotografin kalitesine baglidir.</li>
                <li>Onizleme ile nihai urun arasinda kucuk farkliliklar olabilir (renk tonlari, detay seviyeleri vb.).</li>
                <li>3D baski surecinin dogasi geregi, her urun essizdir ve kucuk farkliliklar uretim toleranslari icerisindedir.</li>
              </ul>

              <h3>6.2 Sorumluluk Siniri</h3>
              <ul>
                <li>Sirket, hizmet kesintileri, teknik arizalar veya ucuncu taraf hizmet saglayicilardan kaynaklanan aksakliklar nedeniyle olusan dolayli zararlardan sorumlu degildir.</li>
                <li>Sirket&apos;in toplam sorumlulugu, ilgili siparisin bedelini asmaz.</li>
              </ul>

              <h2>7. Hesap Kullanimi</h2>
              <ul>
                <li>Hesabinizi baskasina devredemezsiniz.</li>
                <li>Hesap bilgilerinizin guvenliginden siz sorumlusunuz.</li>
                <li>Hesabinizda yetkisiz erisim farketmeniz halinde derhal bizimle iletisime geciniz.</li>
                <li>Sirket, bu Kosullar&apos;i ihlal eden hesaplari askiya alma veya kapatma hakkini sakli tutar.</li>
              </ul>

              <h2>8. Mucbir Sebepler</h2>
              <p>
                Dogal afetler, salginlar, savas, grev, hukumet kararlari, internet altyapi sorunlari ve benzeri
                kontrol disinda gelisen olaylar nedeniyle hizmetlerin aksamasi veya gecikmesi halinde Sirket sorumlu tutulamaz.
              </p>

              <h2>9. Uyusmazlik Cozumu</h2>
              <ul>
                <li>Bu Kosullar Turkiye Cumhuriyeti kanunlarina tabidir.</li>
                <li>Uyusmazliklarda Istanbul Mahkemeleri ve Icra Daireleri yetkilidir.</li>
                <li>Tuketici sikayetleri icin Tuketici Hakem Heyetlerine basvurulabilir.</li>
              </ul>

              <h2>10. Degisiklikler</h2>
              <p>
                Sirket, bu Kosullar&apos;i herhangi bir zamanda degistirme hakkini sakli tutar. Degisiklikler
                web sitemizde yayinlandiginda yururluge girer. Onemli degisiklikler hakkinda kayitli
                kullanicilara e-posta ile bildirim yapilir.
              </p>

              <h2>11. Iletisim</h2>
              <p>Bu Kullanim Kosullari hakkinda sorulariniz icin:</p>
              <ul>
                <li>E-posta: info@figurinestudio.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                These Terms of Service (&quot;Terms&quot;) govern the use of services provided by Figurine Studio (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;)
                through the figurinestudio.com website and related services. By using our services, you agree to these Terms.
              </p>

              <h2>1. Service Description</h2>
              <p>Figurine Studio provides the following services:</p>
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
                <li>Credit card / debit card (via Stripe)</li>
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
                <li>Applications should be made to info@figurinestudio.com with a photo of the product and description of the issue.</li>
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
                <li>The Figurine Studio brand, logo, website design, software, and content are the intellectual property of the Company.</li>
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
                <li>Email: info@figurinestudio.com</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
