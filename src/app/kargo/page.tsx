import { getLocale } from "@/lib/i18n/get-locale";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Kargo ve Teslimat Politikasi — Figurunica",
};

export default async function KargoPage() {
  const locale = await getLocale();
  const isTr = locale === "tr";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-5 py-16 md:py-24">
        <h1 className="font-display text-4xl md:text-5xl text-text-primary mb-4">
          {isTr ? "Kargo ve Teslimat Politikasi" : "Shipping & Delivery Policy"}
        </h1>
        <p className="text-sm text-text-muted mb-12">
          {isTr ? "Son guncelleme: 9 Haziran 2026" : "Last updated: June 9, 2026"}
        </p>

        <div className="prose prose-neutral max-w-none [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-text-primary [&_h2]:mt-12 [&_h2]:mb-4 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-text-secondary [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-text-secondary [&_ul]:mb-4 [&_ul]:ml-6 [&_ul]:list-disc [&_li]:mb-2 [&_li]:leading-relaxed [&_strong]:text-text-primary">

          {isTr ? (
            <>
              <p>
                Bu Kargo ve Teslimat Politikasi, Figurunica (&quot;Sirket&quot;, &quot;biz&quot;, &quot;bizim&quot;) tarafindan
                hazirlanan kisiye ozel figurinlerin uretim ve teslimat surecini aciklamaktadir. Sorulariniz icin
                info@figurunica.com adresinden veya +90 546 678 04 95 numarali telefondan bize ulasabilirsiniz.
              </p>

              <h2>1. Kargo Firmasi ve Ucret</h2>
              <ul>
                <li>Gonderilerimiz <strong>Yurtici Kargo</strong> ile gerceklestirilir.</li>
                <li>Turkiye ici kargo <strong>ucretsizdir</strong>; siparis bedeline ek bir kargo ucreti yansitilmaz.</li>
                <li>Gonderiler Ankara (Etimesgut) merkezimizden hazirlanip kargoya verilir.</li>
              </ul>

              <h2>2. Uretim Suresi</h2>
              <p>
                Her figurin siparise ozel olarak uretildigi icin uretim, onizleme onayindan sonra baslar.
              </p>
              <ul>
                <li>Kisiye ozel figuriniz, onizleme onayindan sonra <strong>5-7 is gunu</strong> icinde uretilir.</li>
                <li>Uretim suresi yogun donemlerde bir miktar uzayabilir; bu durumda sizi e-posta ile bilgilendiririz.</li>
                <li>Uretim suresi yalnizca is gunlerini kapsar; hafta sonu ve resmi tatiller dahil degildir.</li>
              </ul>

              <h2>3. Teslimat Suresi</h2>
              <ul>
                <li>Uretim tamamlandiktan sonra gonderiniz kargoya verilir.</li>
                <li>Turkiye ici kargo teslimati genellikle <strong>2-3 is gunu</strong> surer.</li>
                <li>Teslimat suresi, bulundugunuz il ve ilceye gore degisiklik gosterebilir.</li>
              </ul>

              <h2>4. Toplam Teslimat Tahmini</h2>
              <p>
                Onizleme onayindan urununuzun elinize ulasmasina kadar gecen toplam sure yaklasik
                <strong> 7-10 is gunudur</strong>. Bu sure, uretim (5-7 is gunu) ve kargo (2-3 is gunu)
                asamalarinin toplamidir ve tahmini olup garanti edilmez.
              </p>

              <h2>5. Kargo Takibi</h2>
              <ul>
                <li>Gonderiniz kargoya verildiginde, kargo takip numaraniz e-posta ile sizinle paylasilir.</li>
                <li>Siparisinizin durumunu ve kargo hareketlerini istediginiz zaman <strong>/track</strong> sayfasindan takip edebilirsiniz.</li>
                <li>Takip numarasi kargo firmasinin sistemine islendikten kisa bir sure sonra aktif hale gelir.</li>
              </ul>

              <h2>6. Teslim Edilemeyen Gonderiler</h2>
              <ul>
                <li>Adreste bulunamama, yanlis/eksik adres veya iletisim kurulamamasi nedeniyle teslim edilemeyen gonderiler tarafimiza iade donebilir.</li>
                <li>Iade donen gonderilerin tekrar gonderimi icin sizinle iletisime geceriz ve adres bilgilerinizi teyit ederiz.</li>
                <li>Musteriden kaynaklanan nedenlerle (hatali adres, teslim alinmamasi) iade donen gonderilerin tekrar gonderiminde olusabilecek ek kargo masraflari talep edilebilir.</li>
                <li>Teslimatin sorunsuz tamamlanabilmesi icin lutfen adres ve telefon bilgilerinizin guncel ve eksiksiz oldugundan emin olun.</li>
              </ul>

              <h2>7. Uluslararasi Teslimat</h2>
              <p>
                Su an icin yalnizca <strong>Turkiye ici</strong> teslimat yapilmaktadir. Uluslararasi teslimat
                yakinda hizmete girecek olup, talep uzerine degerlendirilmektedir. Yurt disi gonderim talebiniz
                icin info@figurunica.com adresinden bize ulasabilirsiniz.
              </p>

              <h2>8. Hasarli Paket</h2>
              <ul>
                <li>Gonderinizi teslim aldiginizda paketi kontrol etmenizi oneririz.</li>
                <li>Urun hasarli ulastiysa, teslimattan sonra <strong>48 saat icinde</strong> hasarin fotograflari ile birlikte info@figurunica.com adresine bildirim yapmaniz gerekir.</li>
                <li>Hasar tarafimizca dogrulandiginda, urununuz <strong>ucretsiz olarak yeniden gonderilir</strong>.</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                This Shipping & Delivery Policy explains the production and delivery process for custom figurines
                prepared by Figurunica (&quot;Company&quot;, &quot;we&quot;, &quot;our&quot;). For any questions, you can reach us at
                info@figurunica.com or by phone at +90 546 678 04 95.
              </p>

              <h2>1. Carrier and Shipping Cost</h2>
              <ul>
                <li>Our shipments are carried out with <strong>Yurtici Kargo</strong>.</li>
                <li>Domestic shipping within Turkey is <strong>free</strong>; no additional shipping fee is added to your order total.</li>
                <li>Shipments are prepared and dispatched from our facility in Ankara (Etimesgut).</li>
              </ul>

              <h2>2. Production Time</h2>
              <p>
                Since every figurine is custom-made, production begins only after you approve the preview.
              </p>
              <ul>
                <li>Your custom figurine is produced within <strong>5-7 business days</strong> after preview approval.</li>
                <li>Production time may be slightly extended during peak periods; in that case we will notify you by email.</li>
                <li>Production time covers business days only; weekends and public holidays are not included.</li>
              </ul>

              <h2>3. Delivery Time</h2>
              <ul>
                <li>Once production is complete, your shipment is handed over to the carrier.</li>
                <li>Domestic delivery within Turkey typically takes <strong>2-3 business days</strong>.</li>
                <li>Delivery time may vary depending on your city and district.</li>
              </ul>

              <h2>4. Total Delivery Estimate</h2>
              <p>
                The total time from preview approval to the product reaching you is approximately
                <strong> 7-10 business days</strong>. This is the sum of the production (5-7 business days)
                and shipping (2-3 business days) stages, and is an estimate that is not guaranteed.
              </p>

              <h2>5. Shipment Tracking</h2>
              <ul>
                <li>When your shipment is handed over to the carrier, your tracking number is shared with you by email.</li>
                <li>You can follow your order status and shipment movements at any time on the <strong>/track</strong> page.</li>
                <li>The tracking number becomes active shortly after it is registered in the carrier&apos;s system.</li>
              </ul>

              <h2>6. Undeliverable Shipments</h2>
              <ul>
                <li>Shipments that cannot be delivered due to absence at the address, an incorrect/incomplete address, or inability to make contact may be returned to us.</li>
                <li>For re-shipment of returned packages, we will contact you and confirm your address details.</li>
                <li>For shipments returned due to customer-related reasons (incorrect address, non-collection), any additional shipping costs incurred for re-shipment may be charged.</li>
                <li>To ensure smooth delivery, please make sure your address and phone details are current and complete.</li>
              </ul>

              <h2>7. International Delivery</h2>
              <p>
                At this time, we deliver only <strong>within Turkey</strong>. International delivery is coming soon
                and is evaluated upon request. For an international shipping request, you can reach us at
                info@figurunica.com.
              </p>

              <h2>8. Damaged Package</h2>
              <ul>
                <li>We recommend inspecting the package when you receive your shipment.</li>
                <li>If the product arrives damaged, you must report it with photos of the damage to info@figurunica.com <strong>within 48 hours</strong> of delivery.</li>
                <li>Once the damage is confirmed by us, your product is <strong>re-shipped free of charge</strong>.</li>
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
