import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Privacy Policy — Figurunica",
};

export default async function PrivacyPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Gizlilik Politikası" : "Privacy Policy"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 31 Mart 2026" : "Last updated: March 31, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Figurunica (&quot;Şirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) olarak kişisel verilerinizin korunmasına büyük önem veriyoruz.
                Bu Gizlilik Politikası, 6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) ve ilgili mevzuat kapsamında
                kişisel verilerinizin nasıl toplandığı, işlendiği, saklandığı ve korunduğunu açıklamaktadır.
              </p>

              <h2>1. Veri Sorumlusu</h2>
              <p>
                Kişisel verileriniz bakımından veri sorumlusu Figurunica&apos;dur. Bize aşağıdaki kanallardan ulaşabilirsiniz:
              </p>
              <ul>
                <li>E-posta: info@figurunica.com</li>
                <li>Web sitesi: figurunica.com</li>
              </ul>

              <h2>2. Toplanan Kişisel Veriler</h2>
              <p>Hizmetlerimizi sunabilmek için aşağıdaki kişisel verileri topluyoruz:</p>

              <h3>2.1 Hesap Bilgileri</h3>
              <ul>
                <li>Ad soyad</li>
                <li>E-posta adresi</li>
                <li>Telefon numarası</li>
                <li>Şifre (şifreli/hashli olarak saklanır)</li>
              </ul>

              <h3>2.2 Sipariş ve Teslimat Bilgileri</h3>
              <ul>
                <li>Teslimat adresi (il, ilçe, mahalle, posta kodu)</li>
                <li>Sipariş geçmişi ve durumu</li>
                <li>Figürin boyutu, stili ve tercihler</li>
              </ul>

              <h3>2.3 Fotoğraflar ve Görseller</h3>
              <ul>
                <li>Figürin oluşturmak için yüklediğiniz fotoğraflar</li>
                <li>AI tarafından oluşturulan 3D model önizlemeleri</li>
                <li>Galeriye paylaşmayı tercih ettiğiniz figürin görselleri</li>
              </ul>

              <h3>2.4 Ödeme Bilgileri</h3>
              <ul>
                <li>Ödeme işlemleri PayTR üzerinden gerçekleştirilir. Kredi kartı bilgileriniz tarafımızca saklanmaz; doğrudan PayTR&apos;nin güvenli altyapısında işlenir.</li>
                <li>Hediye kartı kodları ve bakiye bilgileri</li>
              </ul>

              <h3>2.5 Teknik Veriler</h3>
              <ul>
                <li>IP adresi</li>
                <li>Tarayıcı türü ve sürümü</li>
                <li>Cihaz bilgileri</li>
                <li>Çerez verileri</li>
                <li>Sayfa görüntülenme ve etkileşim verileri</li>
              </ul>

              <h2>3. Verilerin İşlenme Amaçları</h2>
              <p>Kişisel verileriniz aşağıdaki amaçlarla işlenmektedir:</p>
              <ul>
                <li>Sipariş oluşturma, üretim sürecinin yönetimi ve teslimat</li>
                <li>Yapay zeka destekli 3D model oluşturma hizmetinin sunulması</li>
                <li>Ödeme işlemlerinin gerçekleştirilmesi ve fatura düzenlenmesi</li>
                <li>Müşteri destek taleplerinin karşılanması</li>
                <li>Sipariş durumu hakkında bilgilendirme (e-posta)</li>
                <li>Hizmet kalitesinin arttırılması ve iyileştirme çalışmaları</li>
                <li>Yasal yükümlülüklerin yerine getirilmesi</li>
                <li>Dolandırıcılık önleme ve güvenlik</li>
              </ul>

              <h2>4. Verilerin İşlenmesinin Hukuki Sebebi</h2>
              <p>Kişisel verileriniz KVKK&apos;nın 5. maddesi kapsamında aşağıdaki hukuki sebeplerle işlenmektedir:</p>
              <ul>
                <li>Sözleşmenin kurulması veya ifası için gerekli olması (sipariş ve teslimat)</li>
                <li>Kanunlarda açıkça öngörülmesi (vergi mevzuatı, tüketici hakları)</li>
                <li>Meşru menfaatlerimiz için zorunlu olması (hizmet iyileştirme, güvenlik)</li>
                <li>Açık rızanız (pazarlama iletişimleri, galeri paylaşımları)</li>
              </ul>

              <h2>5. Verilerin Aktarılması</h2>
              <p>Kişisel verileriniz aşağıdaki taraflarla paylaşılabilir:</p>
              <ul>
                <li><strong>Ödeme işleme:</strong> PayTR (PCI DSS uyumlu ödeme altyapısı)</li>
                <li><strong>Bulut depolama:</strong> Amazon Web Services (AWS S3 — fotoğraf ve 3D model depolama)</li>
                <li><strong>E-posta hizmeti:</strong> Resend (sipariş bildirimleri)</li>
                <li><strong>Yapay zeka hizmeti:</strong> Meshy.ai (3D model oluşturma — yalnızca fotoğraflar işlenir)</li>
                <li><strong>Kargo şirketleri:</strong> Teslimat için gerekli adres ve iletişim bilgileri</li>
                <li><strong>Üretici firmalar:</strong> Üretim için gerekli sipariş detayları</li>
                <li><strong>Yasal makamlar:</strong> Kanuni zorunluluk halinde yetkili kurumlara</li>
              </ul>
              <p>
                Verileriniz yurt dışında bulunan hizmet sağlayıcılara aktarılabilir. Bu aktarımlar, KVKK&apos;nın 9. maddesi
                kapsamında gerekli önlemler alınarak gerçekleştirilir.
              </p>

              <h2>6. Verilerin Saklanma Süresi</h2>
              <ul>
                <li><strong>Hesap bilgileri:</strong> Hesap aktif olduğu sürece</li>
                <li><strong>Sipariş bilgileri:</strong> Yasal zorunluluklar gereği en az 10 yıl (Türk Ticaret Kanunu)</li>
                <li><strong>Fotoğraflar:</strong> Sipariş tamamlandıktan 90 gün sonra otomatik silinir (galeriye paylaştığınız görseller hariç)</li>
                <li><strong>3D modeller:</strong> Sipariş tamamlandıktan 90 gün sonra otomatik silinir</li>
                <li><strong>Ödeme kayıtları:</strong> 10 yıl (vergi mevzuatı)</li>
                <li><strong>Teknik loglar:</strong> 6 ay</li>
              </ul>

              <h2>7. Çerezler</h2>
              <p>Web sitemizde aşağıdaki çerezler kullanılmaktadır:</p>
              <ul>
                <li><strong>Zorunlu çerezler:</strong> Oturum yönetimi, dil tercihi, güvenlik (Cloudflare Turnstile)</li>
                <li><strong>İşlevsel çerezler:</strong> Kullanıcı tercihlerinin hatırlanması</li>
              </ul>
              <p>Pazarlama veya üçüncü taraf izleme çerezleri kullanmıyoruz.</p>

              <h2>8. Veri Güvenliğine İlişkin Önlemler</h2>
              <ul>
                <li>SSL/TLS şifreleme ile veri iletimi</li>
                <li>Şifrelerin bcrypt ile hashli saklanması</li>
                <li>Ödeme bilgilerinin PayTR tarafından PCI DSS standartlarına uygun işlenmesi</li>
                <li>Erişim kontrolü ve yetkilendirme mekanizmaları</li>
                <li>Düzgün veri yedekleme prosedürü</li>
              </ul>

              <h2>9. Kişisel Veri Sahibinin Hakları</h2>
              <p>KVKK&apos;nın 11. maddesi uyarınca aşağıdaki haklara sahipsiniz:</p>
              <ul>
                <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme</li>
                <li>Kişisel verileriniz işlenmişse buna ilişkin bilgi talep etme</li>
                <li>Kişisel verilerinizin işlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme</li>
                <li>Yurt içinde veya yurt dışında kişisel verilerin aktarıldığı üçüncü kişileri bilme</li>
                <li>Kişisel verilerin eksik veya yanlış işlenmiş olması halinde bunların düzeltilmesini isteme</li>
                <li>Kişisel verilerin silinmesini veya yok edilmesini isteme</li>
                <li>İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhine bir sonucun ortaya çıkmasına itiraz etme</li>
                <li>Kişisel verilerin kanuna aykırı olarak işlenmesi sebebiyle zarara uğramanız halinde zararın giderilmesini talep etme</li>
              </ul>
              <p>
                Bu haklarınızı kullanmak için info@figurunica.com adresine başvurabilirsiniz.
                Başvurular en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.
              </p>

              <h2>10. Çocukların Gizliliği</h2>
              <p>
                Hizmetlerimiz 18 yaşından küçüklere yönelik değildir. Bilecek şekilde 18 yaş altı kullanıcılara
                ait kişisel veri toplamamaktayız. Bir çocuğun kişisel verisinin tarafımıza ulaştığını fark etmeniz
                halinde lütfen bizimle iletişime geçin.
              </p>

              <h2>11. Politika Değişiklikleri</h2>
              <p>
                Bu Gizlilik Politikası&apos;nı zaman zaman güncelleyebiliriz. Değişiklikler web sitemizde yayınlandığından itibaren
                geçerli olacaktır. Önemli değişiklikler hakkında kayıtlı kullanıcılara e-posta ile bildirim yapılır.
              </p>

              <h2>12. İletişim</h2>
              <p>
                Gizlilik politikamız hakkında sorularınız veya talepleriniz için bizimle iletişime geçebilirsiniz:
              </p>
              <ul>
                <li>E-posta: info@figurunica.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                At Figurunica (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;), we are committed to protecting your personal data.
                This Privacy Policy explains how your personal information is collected, processed, stored, and protected
                in accordance with applicable data protection laws, including Turkey&apos;s Personal Data Protection Law No. 6698 (&quot;KVKK&quot;).
              </p>

              <h2>1. Data Controller</h2>
              <p>Figurunica is the data controller for your personal data. You can reach us through:</p>
              <ul>
                <li>Email: info@figurunica.com</li>
                <li>Website: figurunica.com</li>
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
                <li>Payments are processed through PayTR. Your credit card details are never stored by us; they are processed directly on PayTR&apos;s secure infrastructure.</li>
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
                <li><strong>Payment processing:</strong> PayTR (PCI DSS compliant payment infrastructure)</li>
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
                <li>Payment data processed by PayTR in accordance with PCI DSS standards</li>
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
                To exercise these rights, contact us at info@figurunica.com.
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
                <li>Email: info@figurunica.com</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
