import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";
import {
  BUSINESS_ADDRESS_FULL,
  BUSINESS_TAX_ID,
} from "@/lib/config/business-identity";

export const metadata = {
  title: "Ticari Elektronik İleti Onay Metni — Figurunica",
};

export default async function CommercialMessageConsentPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Ticari Elektronik İleti Onay Metni" : "Commercial Electronic Message Consent"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son güncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu metin, 6563 sayılı Elektronik Ticaretin Düzenlenmesi Hakkında Kanun ve Ticari İletişim ve Ticari
                Elektronik İletiler Hakkında Yönetmelik kapsamında, Figurunica tarafından gönderilecek ticari elektronik
                iletilere ilişkin onayınızı düzenler. Onay tamamen isteğe bağlıdır.
              </p>

              <h2>1. Onayın Kapsamı</h2>
              <p>
                Onay vermeniz halinde Figurunica; kampanya, indirim, yeni ürün, hatırlatma ve benzeri tanıtım
                içeriklerini aşağıdaki kanallar üzerinden sizinle paylaşabilir:
              </p>
              <ul>
                <li>E-posta</li>
                <li>SMS</li>
              </ul>

              <h2>2. Veri Sorumlusu / Hizmet Sağlayıcı</h2>
              <ul>
                <li>Unvan: Figurunica</li>
                <li>Vergi Kimlik No (VKN): {BUSINESS_TAX_ID}</li>
                <li>E-posta: info@figurunica.com</li>
                <li>Telefon: +90 850 840 73 03</li>
                <li>Adres: {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>3. Onayın Alınması ve İYS Kaydı</h2>
              <p>
                Onayınız, kayıt sırasında ilgili kutucuğu işaretlemeniz ile alınır ve onay tarihi sistemlerimize
                kaydedilir. Ticari elektronik ileti onaylarının, mevzuat gereği İleti Yönetim Sistemi&apos;ne (İYS)
                bildirilmesi gerekir. Şu an için İYS entegrasyonumuz tamamlanmamıştır; bu nedenle
                <strong> hiçbir ticari elektronik ileti göndermiyoruz</strong> ve onayınız yalnızca kendi
                sistemlerimizde saklanmaktadır. Sipariş durumu, ödeme ve teslimat bildirimleri gibi işleme ilişkin
                bilgilendirmeler ticari elektronik ileti kapsamında değildir ve bu kapsamdan bağımsız olarak gönderilir.
                İYS entegrasyonu tamamlandığında onaylarınız mevzuatta öngörülen süre içinde İYS&apos;ye bildirilecek
                ve bu metin güncellenecektir.
              </p>

              <h2>4. Onaydan Vazgeçme (Ret Hakkı)</h2>
              <p>
                Dilediğiniz zaman, ücretsiz olarak ve gerekçe göstermeksizin ticari elektronik ileti almayı
                reddedebilirsiniz. Ret hakkınızı şu yollarla kullanabilirsiniz:
              </p>
              <ul>
                <li>Gönderilen her e-postadaki abonelikten çık / ileti almak istemiyorum bağlantısı,</li>
                <li>info@figurunica.com adresine talebinizi iletmek,</li>
                <li>İYS entegrasyonu tamamlandığında İYS üzerinden onayınızı geri almak.</li>
              </ul>
              <p>
                Ret talebiniz, mevzuatta öngörülen süre içinde işlenir ve bu süreden sonra tarafınıza ticari elektronik
                ileti gönderilmez. Sipariş durumu, teslimat ve ödeme gibi işlemsel (bilgilendirme amaçlı) bildirimler bu
                kapsamda değildir ve hizmetin sağlanması için gönderilmeye devam eder.
              </p>

              <h2>5. Kişisel Verilerin Korunması</h2>
              <p>
                İletişim bilgileriniz yalnızca onay verdiğiniz kanallarda ve belirtilen amaçlarla işlenir. Ayrıntılı
                bilgi için <a href="/privacy">Gizlilik Politikası</a> sayfamızı inceleyebilirsiniz.
              </p>
            </>
          ) : (
            <>
              <p>
                This consent governs the commercial electronic messages Figurunica may send you, under Turkish Law No.
                6563 on the Regulation of Electronic Commerce and the related Regulation on Commercial Communication and
                Commercial Electronic Messages. Consent is entirely optional.
              </p>

              <h2>1. Scope of Consent</h2>
              <p>
                If you consent, Figurunica may share campaigns, discounts, new products, reminders and similar
                promotional content with you through the following channels:
              </p>
              <ul>
                <li>Email</li>
                <li>SMS</li>
              </ul>

              <h2>2. Data Controller / Service Provider</h2>
              <ul>
                <li>Name: Figurunica</li>
                <li>Tax ID (VKN): {BUSINESS_TAX_ID}</li>
                <li>Email: info@figurunica.com</li>
                <li>Phone: +90 850 840 73 03</li>
                <li>Address: {BUSINESS_ADDRESS_FULL}</li>
              </ul>

              <h2>3. How Consent Is Collected and the IYS Record</h2>
              <p>
                Your consent is collected when you tick the relevant box during registration, and the date of consent is
                recorded in our systems. Commercial-message consents must be reported to the Message Management System
                (IYS) as required by law. Our IYS integration is not yet complete, so we currently
                <strong> do not send any commercial electronic messages</strong> and your consent is stored only in our
                own systems. Transactional notices — order status, payment and delivery updates — are not commercial
                electronic messages and are sent independently of this. Once the IYS integration is complete, consents
                will be reported to IYS within the period prescribed by law and this text will be updated.
              </p>

              <h2>4. Withdrawing Consent (Right to Opt Out)</h2>
              <p>
                You may refuse to receive commercial electronic messages at any time, free of charge and without giving a
                reason. You can exercise this right via:
              </p>
              <ul>
                <li>the unsubscribe / opt-out link in every email we send,</li>
                <li>emailing your request to info@figurunica.com,</li>
                <li>withdrawing your consent through IYS.</li>
              </ul>
              <p>
                Your opt-out request is processed within the period set by law, after which no commercial electronic
                messages are sent to you. Transactional (informational) notifications such as order status, delivery and
                payment are not covered by this consent and continue to be sent to provide the service.
              </p>

              <h2>5. Protection of Personal Data</h2>
              <p>
                Your contact details are processed only via the channels you consented to and for the stated purposes.
                For details, please see our <a href="/privacy">Privacy Policy</a>.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
