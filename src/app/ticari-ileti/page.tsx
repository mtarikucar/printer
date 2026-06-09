import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Ticari Elektronik Ileti Onay Metni — Figurunica",
};

export default async function CommercialMessageConsentPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Ticari Elektronik Ileti Onay Metni" : "Commercial Electronic Message Consent"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son guncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu metin, 6563 sayili Elektronik Ticaretin Duzenlenmesi Hakkinda Kanun ve Ticari Iletisim ve Ticari
                Elektronik Iletiler Hakkinda Yonetmelik kapsaminda, Figurunica tarafindan gonderilecek ticari elektronik
                iletilere iliskin onayinizi duzenler. Onay tamamen istege baglidir.
              </p>

              <h2>1. Onayin Kapsami</h2>
              <p>
                Onay vermeniz halinde Figurunica; kampanya, indirim, yeni urun, hatirlatma ve benzeri tanitim
                iceriklerini asagidaki kanallar uzerinden sizinle paylasabilir:
              </p>
              <ul>
                <li>E-posta</li>
                <li>SMS</li>
              </ul>

              <h2>2. Veri Sorumlusu / Hizmet Saglayici</h2>
              <ul>
                <li>Unvan: Figurunica</li>
                <li>E-posta: info@figurunica.com</li>
                <li>Telefon: +90 546 678 04 95</li>
                <li>Adres: Sehit Osman Avci Mahallesi, Akin 688 Sitesi B32, Etimesgut / Ankara</li>
              </ul>

              <h2>3. Onayin Alinmasi ve IYS Kaydi</h2>
              <p>
                Onayiniz, kayit sirasinda ilgili kutucugu isaretlemeniz ile alinir ve onay tarihi sistemlerimize
                kaydedilir. Ticari elektronik ileti onaylari, mevzuat geregi Ileti Yonetim Sistemi&apos;ne (IYS) iletilir;
                onay durumunuzu IYS uzerinden de yonetebilirsiniz.
              </p>

              <h2>4. Onaydan Vazgecme (Ret Hakki)</h2>
              <p>
                Diledginiz zaman, ucretsiz olarak ve gerekce gostermeksizin ticari elektronik ileti almayi
                reddedebilirsiniz. Ret hakkinizi su yollarla kullanabilirsiniz:
              </p>
              <ul>
                <li>Gonderilen her e-postadaki abonelikten cik / ileti almak istemiyorum baglantisi,</li>
                <li>info@figurunica.com adresine talebinizi iletmek,</li>
                <li>IYS uzerinden onayinizi geri almak.</li>
              </ul>
              <p>
                Ret talebiniz, mevzuatta ongorulen sure icinde islenir ve bu sureden sonra tarafiniza ticari elektronik
                ileti gonderilmez. Siparis durumu, teslimat ve odeme gibi islemsel (bilgilendirme amacli) bildirimler bu
                kapsamda degildir ve hizmetin saglanmasi icin gonderilmeye devam eder.
              </p>

              <h2>5. Kisisel Verilerin Korunmasi</h2>
              <p>
                Iletisim bilgileriniz yalnizca onay verdiginiz kanallarda ve belirtilen amaclarla islenir. Ayrintili
                bilgi icin <a href="/privacy">Gizlilik Politikasi</a> sayfamizi inceleyebilirsiniz.
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
                <li>Email: info@figurunica.com</li>
                <li>Phone: +90 546 678 04 95</li>
                <li>Address: Sehit Osman Avci Mahallesi, Akin 688 Sitesi B32, Etimesgut / Ankara</li>
              </ul>

              <h2>3. How Consent Is Collected and the IYS Record</h2>
              <p>
                Your consent is collected when you tick the relevant box during registration, and the date of consent is
                recorded in our systems. Commercial-message consents are reported to the Message Management System (IYS)
                as required by law; you can also manage your consent status through IYS.
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
