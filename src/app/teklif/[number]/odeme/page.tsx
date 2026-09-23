import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { calculateHavaleDiscount } from "@/lib/config/payment";
import { listAddresses } from "@/lib/services/address-book";
import { quoteApiEnabled, resolveQuoteAccess } from "@/lib/services/quote-access";
import { loadPresentedQuote } from "@/lib/services/quote-service";
import { QuoteCheckoutClient } from "./checkout-client";

/**
 * Teklif ödemesi — `/teklif/T-000123/odeme`.
 *
 * Sayfanın işi KAPILARI tutmak ve parayı sunucuda hesaplamaktır; tek bir form
 * alanı bile burada doğrulanmaz.
 *
 *   - Bayrak kapalı → sayfa YOK (uçlarla aynı kapı).
 *   - Sahibi olmayan / fiyat kapısını geçmemiş izleyici → çalışma alanına
 *     geri; orada kapıyı açan modal var, burada yalnız kapalı bir form olurdu.
 *   - Bekleyen ödeme varsa → `/pay/<ref>`. Teklif o sırada salt okunurdur ve
 *     ikinci bir taslak açmak ikinci bir tahsilat riskidir (uç da aynı
 *     referansı döndürür; bu yalnız müşteriyi doğru sayfaya götürür).
 *   - Ödemeye engel varsa → çalışma alanı; engellerin Türkçe listesi orada.
 *
 * Tutarlar `PresentedQuote.totals`tan gelir (fiyat kapısı uygulanmış) ve
 * havale indirimi burada, teklifin KENDİ snapshot ayarından hesaplanır —
 * tarayıcı hiçbir para aritmetiği yapmaz.
 *
 * `noindex` kök düzenden gelir (`isNoindexPath("/teklif")`).
 */
export const dynamic = "force-dynamic";

export default async function QuoteCheckoutPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;
  if (!(await quoteApiEnabled())) notFound();

  const decoded = decodeURIComponent(number);
  // Paylaşım token'ı BİLEREK okunmaz: ödeme sahibin işidir.
  const access = await resolveQuoteAccess(decoded);
  if (!access) notFound();

  const workspace = `/teklif/${encodeURIComponent(decoded)}`;
  const { quote, viewer, sessionUserId } = access;
  if (!viewer.isOwner || !viewer.canSeePrices || quote.userId !== sessionUserId) {
    redirect(workspace);
  }

  const presented = await loadPresentedQuote(access);
  // `liveDraftReference` yalnız sahibe gönderilir; kapıyı yukarıda geçtik.
  if (presented.liveDraftReference) {
    redirect(`/pay/${encodeURIComponent(presented.liveDraftReference)}`);
  }
  if (!presented.totals || !presented.readiness.canCheckout) redirect(workspace);

  const totalKurus = presented.totals.totalKurus;
  const havaleDiscountKurus = quote.pricingSnapshot.settings.havaleDiscountApplies
    ? calculateHavaleDiscount(totalKurus)
    : 0;
  // Adres defteri varsayılanı formu doldurur; müşteri her hâlde düzenleyebilir.
  const saved = (await listAddresses(quote.userId!).catch(() => []))[0] ?? null;

  return (
    <>
      <SiteHeader />
      <QuoteCheckoutClient
        quote={presented}
        totalKurus={totalKurus}
        havaleDiscountKurus={havaleDiscountKurus}
        savedAddress={
          saved
            ? {
                adres: saved.adres,
                mahalle: saved.mahalle ?? "",
                ilce: saved.ilce,
                il: saved.il,
                postaKodu: saved.postaKodu,
                telefon: saved.phone,
              }
            : null
        }
      />
    </>
  );
}
