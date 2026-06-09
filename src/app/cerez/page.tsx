import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Çerez Politikası — Figurunica",
};

export default async function CerezPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Çerez Politikası" : "Cookie Policy"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Çerez Politikası, Figurunica (&quot;Şirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) tarafından
                figurunica.com web sitesinde çerezlerin nasıl kullanıldığını açıklamaktadır. Sitemizi kullanarak
                bu politikada belirtilen çerez kullanımını kabul etmiş olursunuz.
              </p>

              <h2>1. Çerez Nedir?</h2>
              <p>
                Çerezler, bir web sitesini ziyaret ettiğinizde tarayıcınız aracılığıyla cihazınıza kaydedilen
                küçük metin dosyalarıdır. Çerezler, sitenin düzgün çalışmasını sağlamak, tercihlerinizi hatırlamak
                ve site kullanımını analiz etmek için yaygın olarak kullanılır.
              </p>

              <h2>2. Kullandığımız Çerez Türleri</h2>

              <h3>2.1 Zorunlu / Teknik Çerezler</h3>
              <p>
                Bu çerezler sitenin temel işlevlerini yerine getirmesi için gereklidir ve devre dışı bırakılamaz.
              </p>
              <ul>
                <li>Oturum yönetimi ve kimlik doğrulama</li>
                <li>Güvenlik ve dolandırıcılık önleme</li>
                <li>Dil tercihinin (Türkçe / İngilizce) hatırlanması</li>
                <li>Sepet içeriğinin korunması</li>
              </ul>

              <h3>2.2 Analitik / Performans Çerezleri</h3>
              <ul>
                <li>Site kullanımını ve ziyaretçi sayısını ölçmek</li>
                <li>Hangi sayfaların daha çok kullanıldığını anlamak</li>
                <li>Site performansını ve kullanıcı deneyimini iyileştirmek</li>
              </ul>

              <h3>2.3 Pazarlama / Hedefleme Çerezleri</h3>
              <ul>
                <li>Reklam ve yeniden pazarlama (remarketing) faaliyetleri</li>
                <li>İlgi alanlarınıza uygun içerik ve tekliflerin sunulması</li>
                <li>Bu çerezler yalnızca açık onayınız (rızanız) ile kullanılır.</li>
              </ul>

              <h2>3. Üçüncü Taraf Çerezler</h2>
              <p>
                Sitemizde temel olarak dil tercihi ve oturum çerezleri kullanılır. Bununla birlikte,
                kullandığımız bazı üçüncü taraf hizmet sağlayıcıları kendi çerezlerini yerleştirebilir:
              </p>
              <ul>
                <li><strong>Ödeme:</strong> PayTR (güvenli ödeme işlemleri sırasında kendi çerezlerini kullanabilir)</li>
                <li><strong>Kargo takibi:</strong> Anlaşmalı kargo firmaları (gönderi takibi için kendi çerezlerini kullanabilir)</li>
              </ul>
              <p>
                Bu üçüncü taraf çerezler ilgili sağlayıcıların kendi gizlilik ve çerez politikalarına tabidir.
              </p>

              <h2>4. Çerezleri Yönetme ve Reddetme</h2>
              <p>
                Çerezleri tarayıcı ayarlarınızdan dilediğiniz zaman yönetebilir, silebilir veya engelleyebilirsiniz.
                Çoğu tarayıcı, çerezleri kabul etmeden önce sizi uyaracak şekilde ayarlanabilir.
              </p>
              <ul>
                <li>Tarayıcınızın &quot;Ayarlar&quot; veya &quot;Gizlilik&quot; bölümünden çerezleri yönetebilirsiniz.</li>
                <li>Kayıtlı çerezleri tarayıcınızdan silebilirsiniz.</li>
                <li>Analitik ve pazarlama çerezlerine yönelik onayınızı dilediğiniz zaman geri çekebilirsiniz.</li>
              </ul>
              <p>
                Zorunlu / teknik çerezler kapatıldığında oturum açma, sepet ve dil tercihi gibi temel
                özellikler düzgün çalışmayabilir.
              </p>

              <h2>5. KVKK ile İlişki</h2>
              <p>
                Çerezler aracılığıyla işlenen kişisel veriler, 6698 sayılı Kişisel Verilerin Korunması Kanunu
                (&quot;KVKK&quot;) ve ilgili mevzuat kapsamında işlenmektedir. Zorunlu çerezler sitenin işletilmesindeki
                meşru menfaatimize dayanırken, analitik ve pazarlama çerezleri açık rızanıza tabidir.
              </p>
              <p>
                Kişisel verilerinizin işlenmesine ilişkin ayrıntılı bilgi için{" "}
                <a href="/privacy">Gizlilik Politikamızı</a> inceleyebilirsiniz.
              </p>

              <h2>6. İletişim ve Güncellemeler</h2>
              <p>
                Bu Çerez Politikası&apos;nı zaman zaman güncelleyebiliriz. Güncel sürüm web sitemizde yayınlandığı
                tarihten itibaren geçerli olur. Çerez kullanımımız hakkında sorularınız için bizimle iletişime geçebilirsiniz:
              </p>
              <ul>
                <li>E-posta: info@figurunica.com</li>
                <li>Web sitesi: figurunica.com</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                This Cookie Policy explains how Figurunica (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;) uses cookies on the
                figurunica.com website. By using our site, you accept the use of cookies as described in this policy.
              </p>

              <h2>1. What Is a Cookie?</h2>
              <p>
                Cookies are small text files stored on your device through your browser when you visit a website.
                Cookies are commonly used to make a site work properly, remember your preferences, and analyze how the site is used.
              </p>

              <h2>2. Types of Cookies We Use</h2>

              <h3>2.1 Essential / Technical Cookies</h3>
              <p>
                These cookies are required for the core functions of the site and cannot be disabled.
              </p>
              <ul>
                <li>Session management and authentication</li>
                <li>Security and fraud prevention</li>
                <li>Remembering your language preference (Turkish / English)</li>
                <li>Preserving your shopping cart contents</li>
              </ul>

              <h3>2.2 Analytics / Performance Cookies</h3>
              <ul>
                <li>Measuring site usage and visitor numbers</li>
                <li>Understanding which pages are used most</li>
                <li>Improving site performance and user experience</li>
              </ul>

              <h3>2.3 Marketing / Targeting Cookies</h3>
              <ul>
                <li>Advertising and remarketing activities</li>
                <li>Presenting content and offers relevant to your interests</li>
                <li>These cookies are only used with your explicit consent.</li>
              </ul>

              <h2>3. Third-Party Cookies</h2>
              <p>
                Our site primarily uses language preference and session cookies. However, some third-party service
                providers we use may set their own cookies:
              </p>
              <ul>
                <li><strong>Payment:</strong> PayTR (may use its own cookies during secure payment processing)</li>
                <li><strong>Shipping tracking:</strong> Partner shipping companies (may use their own cookies for shipment tracking)</li>
              </ul>
              <p>
                These third-party cookies are subject to the respective providers&apos; own privacy and cookie policies.
              </p>

              <h2>4. Managing and Rejecting Cookies</h2>
              <p>
                You can manage, delete, or block cookies at any time through your browser settings. Most browsers can
                be configured to warn you before accepting cookies.
              </p>
              <ul>
                <li>You can manage cookies from your browser&apos;s &quot;Settings&quot; or &quot;Privacy&quot; section.</li>
                <li>You can delete stored cookies from your browser.</li>
                <li>You can withdraw your consent for analytics and marketing cookies at any time.</li>
              </ul>
              <p>
                If essential / technical cookies are disabled, core features such as signing in, the shopping cart,
                and language preference may not work properly.
              </p>

              <h2>5. Relationship with KVKK</h2>
              <p>
                Personal data processed through cookies is handled in accordance with Turkey&apos;s Personal Data
                Protection Law No. 6698 (&quot;KVKK&quot;) and related legislation. While essential cookies rely on our
                legitimate interest in operating the site, analytics and marketing cookies are subject to your explicit consent.
              </p>
              <p>
                For detailed information about how we process your personal data, please review our{" "}
                <a href="/privacy">Privacy Policy</a>.
              </p>

              <h2>6. Contact and Updates</h2>
              <p>
                We may update this Cookie Policy from time to time. The current version takes effect when published
                on our website. For questions about our use of cookies, you can contact us:
              </p>
              <ul>
                <li>Email: info@figurunica.com</li>
                <li>Website: figurunica.com</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
