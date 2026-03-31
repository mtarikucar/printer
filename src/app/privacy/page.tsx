import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Privacy Policy — Figurine Studio",
};

export default async function PrivacyPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Gizlilik Politikasi" : "Privacy Policy"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son guncelleme: 31 Mart 2026" : "Last updated: March 31, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Figurine Studio (&quot;Sirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) olarak kisisel verilerinizin korunmasina buyuk onem veriyoruz.
                Bu Gizlilik Politikasi, 6698 sayili Kisisel Verilerin Korunmasi Kanunu (&quot;KVKK&quot;) ve ilgili mevzuat kapsaminda
                kisisel verilerinizin nasil toplandigi, islendigi, saklandigi ve korundugunun aciklanmaktadir.
              </p>

              <h2>1. Veri Sorumlusu</h2>
              <p>
                Kisisel verileriniz bakimindan veri sorumlusu Figurine Studio&apos;dur. Bize asagidaki kanallardan ulasabilirsiniz:
              </p>
              <ul>
                <li>E-posta: info@figurinestudio.com</li>
                <li>Web sitesi: figurinestudio.com</li>
              </ul>

              <h2>2. Toplanan Kisisel Veriler</h2>
              <p>Hizmetlerimizi sunabilmek icin asagidaki kisisel verileri topluyoruz:</p>

              <h3>2.1 Hesap Bilgileri</h3>
              <ul>
                <li>Ad soyad</li>
                <li>E-posta adresi</li>
                <li>Telefon numarasi</li>
                <li>Sifre (sifreli/hashli olarak saklanir)</li>
              </ul>

              <h3>2.2 Siparis ve Teslimat Bilgileri</h3>
              <ul>
                <li>Teslimat adresi (il, ilce, mahalle, posta kodu)</li>
                <li>Siparis gecmisi ve durumu</li>
                <li>Figurin boyutu, stili ve tercihler</li>
              </ul>

              <h3>2.3 Fotograflar ve Gorseller</h3>
              <ul>
                <li>Figurin olusturmak icin yuklediginiz fotograflar</li>
                <li>AI tarafindan olusturulan 3D model onizlemeleri</li>
                <li>Galeriye paylasmayi tercih ettiginiz figurin gorselleri</li>
              </ul>

              <h3>2.4 Odeme Bilgileri</h3>
              <ul>
                <li>Odeme islemleri Stripe uzerinden gerceklestirilir. Kredi karti bilgileriniz tarafimizca saklanmaz; dogrudan Stripe&apos;in guvenli altyapisinda islenir.</li>
                <li>Hediye karti kodlari ve bakiye bilgileri</li>
              </ul>

              <h3>2.5 Teknik Veriler</h3>
              <ul>
                <li>IP adresi</li>
                <li>Tarayici turu ve surumu</li>
                <li>Cihaz bilgileri</li>
                <li>Cerez verileri</li>
                <li>Sayfa goruntulenme ve etkilesim verileri</li>
              </ul>

              <h2>3. Verilerin Islenme Amaclari</h2>
              <p>Kisisel verileriniz asagidaki amaclarla islenmektedir:</p>
              <ul>
                <li>Siparis olusturma, uretim surecinin yonetimi ve teslimat</li>
                <li>Yapay zeka destekli 3D model olusturma hizmetinin sunulmasi</li>
                <li>Odeme islemlerinin gerceklestirilmesi ve fatura duzenlenmesi</li>
                <li>Musteri destek taleplerinin karsilanmasi</li>
                <li>Siparis durumu hakkinda bilgilendirme (e-posta)</li>
                <li>Hizmet kalitesinin arttirilmasi ve iyilestirme calismalari</li>
                <li>Yasal yukumluluklerin yerine getirilmesi</li>
                <li>Dolandiricilik onleme ve guvenlik</li>
              </ul>

              <h2>4. Verilerin Islenmesinin Hukuki Sebebi</h2>
              <p>Kisisel verileriniz KVKK&apos;nin 5. maddesi kapsaminda asagidaki hukuki sebeplerle islenmektedir:</p>
              <ul>
                <li>Sozlesmenin kurulmasi veya ifasi icin gerekli olmasi (siparis ve teslimat)</li>
                <li>Kanunlarda acikca ongorulmesi (vergi mevzuati, tuketici haklar)</li>
                <li>Meşru menfaatlerimiz icin zorunlu olmasi (hizmet iyilestirme, guvenlik)</li>
                <li>Acik rizaniz (pazarlama iletisimleri, galeri paylasimlari)</li>
              </ul>

              <h2>5. Verilerin Aktarilmasi</h2>
              <p>Kisisel verileriniz asagidaki taraflarla paylassilabilir:</p>
              <ul>
                <li><strong>Odeme isleme:</strong> Stripe Inc. (PCI DSS uyumlu odeme altyapisi)</li>
                <li><strong>Bulut depolama:</strong> Amazon Web Services (AWS S3 — fotograf ve 3D model depolama)</li>
                <li><strong>E-posta hizmeti:</strong> Resend (siparis bildirimleri)</li>
                <li><strong>Yapay zeka hizmeti:</strong> Meshy.ai (3D model olusturma — yalnizca fotograflar islenir)</li>
                <li><strong>Kargo sirketleri:</strong> Teslimat icin gerekli adres ve iletisim bilgileri</li>
                <li><strong>Uretici firmalar:</strong> Uretim icin gerekli siparis detaylari</li>
                <li><strong>Yasal makamlar:</strong> Kanuni zorunluluk halinde yetkili kurumlara</li>
              </ul>
              <p>
                Verileriniz yurt disinda bulunan hizmet saglayicilara aktarilabilir. Bu aktarimlar, KVKK&apos;nin 9. maddesi
                kapsaminda gerekli onlemler alinarak gerceklestirilir.
              </p>

              <h2>6. Verilerin Saklanma Suresi</h2>
              <ul>
                <li><strong>Hesap bilgileri:</strong> Hesap aktif oldugu surece</li>
                <li><strong>Siparis bilgileri:</strong> Yasal zorunluluklar geregi en az 10 yil (Turk Ticaret Kanunu)</li>
                <li><strong>Fotograflar:</strong> Siparis tamamlandiktan 90 gun sonra otomatik silinir (galeriye paylastiginiz gorseller haric)</li>
                <li><strong>3D modeller:</strong> Siparis tamamlandiktan 90 gun sonra otomatik silinir</li>
                <li><strong>Odeme kayitlari:</strong> 10 yil (vergi mevzuati)</li>
                <li><strong>Teknik loglar:</strong> 6 ay</li>
              </ul>

              <h2>7. Cerezler</h2>
              <p>Web sitemizde asagidaki cerezler kullanilmaktadir:</p>
              <ul>
                <li><strong>Zorunlu cerezler:</strong> Oturum yonetimi, dil tercihi, guvenlik (Cloudflare Turnstile)</li>
                <li><strong>Islevsel cerezler:</strong> Kullanici tercihlerinin hatirlarnmasi</li>
              </ul>
              <p>Pazarlama veya ucuncu taraf izleme cerezleri kullanmiyoruz.</p>

              <h2>8. Veri Guvenligine Iliskin Onlemler</h2>
              <ul>
                <li>SSL/TLS sifreleme ile veri iletimi</li>
                <li>Sifrelerin bcrypt ile hashli saklanmasi</li>
                <li>Odeme bilgilerinin Stripe tarafindan PCI DSS standartlarina uygun islenmesi</li>
                <li>Erisim kontrolu ve yetkilendirme mekanizmalari</li>
                <li>Duzgun veri yedekleme proseduri</li>
              </ul>

              <h2>9. Kisisel Veri Sahibinin Haklari</h2>
              <p>KVKK&apos;nin 11. maddesi uyarinca asagidaki haklara sahipsiniz:</p>
              <ul>
                <li>Kisisel verilerinizin islenip islenmedigini ogrenme</li>
                <li>Kisisel verileriniz islenmisse buna iliskin bilgi talep etme</li>
                <li>Kisisel verilerinizin islenme amacini ve bunlarin amacina uygun kullanilip kullanilmadigini ogrenme</li>
                <li>Yurt icinde veya yurt disinda kisisel verilerin aktarildigi ucuncu kisileri bilme</li>
                <li>Kisisel verilerin eksik veya yanlis islenmis olmasi halinde bunlarin duzeltilmesini isteme</li>
                <li>Kisisel verilerin silinmesini veya yok edilmesini isteme</li>
                <li>Islenen verilerin munhasiran otomatik sistemler vasitasiyla analiz edilmesi suretiyle aleyhine bir sonucun ortaya cikmasina itiraz etme</li>
                <li>Kisisel verilerin kanuna aykiri olarak islenmesi sebebiyle zarara ugramaniz halinde zararin giderilmesini talep etme</li>
              </ul>
              <p>
                Bu haklarinizi kullanmak icin info@figurinestudio.com adresine basvurabilirsiniz.
                Basvurular en gec 30 gun icinde ucretsiz olarak sonuclandirilir.
              </p>

              <h2>10. Cocuklarin Gizliligi</h2>
              <p>
                Hizmetlerimiz 18 yasindan kucuklere yonelik degildir. Bilecek sekilde 18 yas alti kullanicilara
                ait kisisel veri toplamamaktayiz. Bir cocugun kisisel verisinin tarafimiza ulastigini fark etmeniz
                halinde lutfen bizimle iletisime gecin.
              </p>

              <h2>11. Politika Degisiklikleri</h2>
              <p>
                Bu Gizlilik Politikasi&apos;ni zaman zaman guncelleyebiliriz. Degisiklikler web sitemizde yayinlandigindan itibaren
                gecerli olacaktir. Onemli degisiklikler hakkinda kayitli kullanicilara e-posta ile bildirim yapilir.
              </p>

              <h2>12. Iletisim</h2>
              <p>
                Gizlilik politikamiz hakkinda sorulariniz veya talepleriniz icin bizimle iletisime gecebilirsiniz:
              </p>
              <ul>
                <li>E-posta: info@figurinestudio.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                At Figurine Studio (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;), we are committed to protecting your personal data.
                This Privacy Policy explains how your personal information is collected, processed, stored, and protected
                in accordance with applicable data protection laws, including Turkey&apos;s Personal Data Protection Law No. 6698 (&quot;KVKK&quot;).
              </p>

              <h2>1. Data Controller</h2>
              <p>Figurine Studio is the data controller for your personal data. You can reach us through:</p>
              <ul>
                <li>Email: info@figurinestudio.com</li>
                <li>Website: figurinestudio.com</li>
              </ul>

              <h2>2. Personal Data We Collect</h2>
              <p>We collect the following personal data to provide our services:</p>

              <h3>2.1 Account Information</h3>
              <ul>
                <li>Full name</li>
                <li>Email address</li>
                <li>Phone number</li>
                <li>Password (stored in hashed form)</li>
              </ul>

              <h3>2.2 Order and Delivery Information</h3>
              <ul>
                <li>Shipping address (city, district, neighborhood, postal code)</li>
                <li>Order history and status</li>
                <li>Figurine size, style, and preferences</li>
              </ul>

              <h3>2.3 Photos and Images</h3>
              <ul>
                <li>Photos you upload for figurine creation</li>
                <li>AI-generated 3D model previews</li>
                <li>Figurine images you choose to share in the gallery</li>
              </ul>

              <h3>2.4 Payment Information</h3>
              <ul>
                <li>Payments are processed through Stripe. Your credit card details are never stored by us; they are processed directly on Stripe&apos;s secure infrastructure.</li>
                <li>Gift card codes and balance information</li>
              </ul>

              <h3>2.5 Technical Data</h3>
              <ul>
                <li>IP address</li>
                <li>Browser type and version</li>
                <li>Device information</li>
                <li>Cookie data</li>
                <li>Page views and interaction data</li>
              </ul>

              <h2>3. Purposes of Data Processing</h2>
              <p>Your personal data is processed for the following purposes:</p>
              <ul>
                <li>Order creation, production management, and delivery</li>
                <li>Providing AI-powered 3D model generation services</li>
                <li>Processing payments and issuing invoices</li>
                <li>Responding to customer support requests</li>
                <li>Sending order status notifications (email)</li>
                <li>Improving service quality and conducting enhancement activities</li>
                <li>Fulfilling legal obligations</li>
                <li>Fraud prevention and security</li>
              </ul>

              <h2>4. Legal Basis for Processing</h2>
              <p>Your personal data is processed under the following legal bases:</p>
              <ul>
                <li>Necessity for the performance of a contract (orders and delivery)</li>
                <li>Legal obligations (tax legislation, consumer rights)</li>
                <li>Legitimate interests (service improvement, security)</li>
                <li>Your explicit consent (marketing communications, gallery sharing)</li>
              </ul>

              <h2>5. Data Sharing</h2>
              <p>Your personal data may be shared with the following parties:</p>
              <ul>
                <li><strong>Payment processing:</strong> Stripe Inc. (PCI DSS compliant payment infrastructure)</li>
                <li><strong>Cloud storage:</strong> Amazon Web Services (AWS S3 — photo and 3D model storage)</li>
                <li><strong>Email service:</strong> Resend (order notifications)</li>
                <li><strong>AI service:</strong> Meshy.ai (3D model generation — only photos are processed)</li>
                <li><strong>Shipping companies:</strong> Address and contact details required for delivery</li>
                <li><strong>Manufacturers:</strong> Order details necessary for production</li>
                <li><strong>Legal authorities:</strong> When required by law</li>
              </ul>
              <p>
                Your data may be transferred to service providers located outside of Turkey.
                Such transfers are carried out with appropriate safeguards as required by applicable law.
              </p>

              <h2>6. Data Retention Period</h2>
              <ul>
                <li><strong>Account information:</strong> As long as the account remains active</li>
                <li><strong>Order information:</strong> Minimum 10 years as required by Turkish Commercial Code</li>
                <li><strong>Photos:</strong> Automatically deleted 90 days after order completion (except images shared to the gallery)</li>
                <li><strong>3D models:</strong> Automatically deleted 90 days after order completion</li>
                <li><strong>Payment records:</strong> 10 years (tax legislation)</li>
                <li><strong>Technical logs:</strong> 6 months</li>
              </ul>

              <h2>7. Cookies</h2>
              <p>Our website uses the following cookies:</p>
              <ul>
                <li><strong>Essential cookies:</strong> Session management, language preference, security (Cloudflare Turnstile)</li>
                <li><strong>Functional cookies:</strong> Remembering user preferences</li>
              </ul>
              <p>We do not use marketing or third-party tracking cookies.</p>

              <h2>8. Data Security Measures</h2>
              <ul>
                <li>SSL/TLS encryption for data transmission</li>
                <li>Password hashing with bcrypt</li>
                <li>Payment data processed by Stripe in accordance with PCI DSS standards</li>
                <li>Access control and authorization mechanisms</li>
                <li>Regular data backup procedures</li>
              </ul>

              <h2>9. Your Rights</h2>
              <p>Under applicable data protection law, you have the following rights:</p>
              <ul>
                <li>Learn whether your personal data is being processed</li>
                <li>Request information about processing if your data has been processed</li>
                <li>Learn the purpose of processing and whether data is used in accordance with its purpose</li>
                <li>Know the third parties to whom personal data is transferred domestically or abroad</li>
                <li>Request correction if personal data is incomplete or inaccurately processed</li>
                <li>Request deletion or destruction of personal data</li>
                <li>Object to outcomes arising from analysis of processed data exclusively through automated systems</li>
                <li>Claim compensation for damages arising from unlawful processing of personal data</li>
              </ul>
              <p>
                To exercise these rights, contact us at info@figurinestudio.com.
                Requests are processed free of charge within 30 days at the latest.
              </p>

              <h2>10. Children&apos;s Privacy</h2>
              <p>
                Our services are not directed at individuals under 18 years of age. We do not knowingly collect
                personal data from children. If you become aware that a child has provided us with personal data,
                please contact us.
              </p>

              <h2>11. Policy Changes</h2>
              <p>
                We may update this Privacy Policy from time to time. Changes take effect when published on our website.
                Registered users will be notified via email about significant changes.
              </p>

              <h2>12. Contact</h2>
              <p>For questions or requests about our privacy policy, you can contact us:</p>
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
