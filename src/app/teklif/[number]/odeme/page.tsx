import { notFound, redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { listAddresses } from "@/lib/services/address-book";
import { isFlagEnabled } from "@/lib/services/flags";
import { quoteApiEnabled, resolveQuoteAccess } from "@/lib/services/quote-access";
import { pendingQuoteCheckout, quoteTenderViews } from "@/lib/services/quote-checkout";
import { loadPresentedQuote } from "@/lib/services/quote-service";
import { QuoteCheckoutClient } from "./checkout-client";
import { QuotePendingPaymentClient } from "./pending-payment-client";

/**
 * Teklif ödemesi — `/teklif/T-000123/odeme`.
 *
 * Sayfanın işi KAPILARI tutmak ve parayı sunucuda hesaplamaktır; tek bir form
 * alanı bile burada doğrulanmaz.
 *
 *   - Bayrak kapalı → sayfa YOK (uçlarla aynı kapı).
 *   - Sahibi olmayan / fiyat kapısını geçmemiş izleyici → çalışma alanına
 *     geri; orada kapıyı açan modal var, burada yalnız kapalı bir form olurdu.
 *   - Bekleyen ödeme varsa → o taslağın KENDİ sayfası (`/pay/<ref>` ya da
 *     `/havale/<ref>`). Teklif o sırada salt okunurdur ve ikinci bir taslak
 *     açmak ikinci bir tahsilat riskidir. Taslak hiç başlamamış bir kart
 *     ödemesiyse yönlendirme YERİNE seçenek ekranı çizilir: devam et ya da
 *     iptal edip yöntemi değiştir (uç farklı yöntemi reddeder, kapı olmasa
 *     müşteri 72 saat karta kilitli kalırdı).
 *   - Ödemeye engel varsa → çalışma alanı; engellerin Türkçe listesi orada.
 *
 * Tutarlar `PresentedQuote.totals`tan gelir (fiyat kapısı uygulanmış) ve iki
 * yöntemin tahsilat görünümü burada, teklifin KENDİ snapshot ayarından ve
 * ödemenin kullandığı TEK zincirden (`quoteTenderViews` → `computeTender`)
 * hesaplanır — tarayıcı hiçbir para aritmetiği yapmaz.
 *
 * Hediye kartı bayrağı da burada okunur: kapalıyken alan çizilmez (sunucu da
 * kod kabul etmez, `quote-checkout.ts`).
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

  // Adres parçası Next tarafından zaten çözülmüştür (bkz. `../page.tsx`).
  // Paylaşım token'ı BİLEREK okunmaz: ödeme sahibin işidir.
  const access = await resolveQuoteAccess(number);
  if (!access) notFound();

  const workspace = `/teklif/${encodeURIComponent(number)}`;
  const { quote, viewer, sessionUserId } = access;
  if (!viewer.isOwner || !viewer.canSeePrices || quote.userId !== sessionUserId) {
    redirect(workspace);
  }

  const presented = await loadPresentedQuote(access);
  // `liveDraftReference` yalnız sahibe gönderilir; kapıyı yukarıda geçtik.
  if (presented.liveDraftReference) {
    const pending = await pendingQuoteCheckout(quote.id);
    // Vazgeçilebilir bir kart taslağı varsa müşteri SEÇEBİLMELİ: koşulsuz
    // yönlendirme, yöntemini değiştirmek isteyeni 72 saat karta kilitliyordu
    // (uç farklı yöntemi `pending_other_method` ile reddediyor).
    if (!pending) redirect(`/pay/${encodeURIComponent(presented.liveDraftReference)}`);
    if (!pending.cancellable) redirect(pending.paymentUrl);
    return (
      <>
        <SiteHeader />
        <QuotePendingPaymentClient quoteNumber={presented.number} pending={pending} />
      </>
    );
  }
  if (!presented.totals || !presented.readiness.canCheckout) redirect(workspace);

  const totalKurus = presented.totals.totalKurus;
  // Kartsız TABAN: hediye kartı uygulanınca ekran aynı şekli ön izleme
  // ucundan alır, yani iki hâlde de rakam AYNI zincirden çıkar.
  const tender = quoteTenderViews({
    amountKurus: totalKurus,
    giftCardBalanceKurus: 0,
    havaleDiscountApplies: quote.pricingSnapshot.settings.havaleDiscountApplies,
  });
  const giftCardEnabled = await isFlagEnabled("quote_gift_card_enabled");
  // Adres defteri varsayılanı formu doldurur; müşteri her hâlde düzenleyebilir.
  const saved = (await listAddresses(quote.userId!).catch(() => []))[0] ?? null;

  return (
    <>
      <SiteHeader />
      <QuoteCheckoutClient
        quote={presented}
        totalKurus={totalKurus}
        tender={tender}
        giftCardEnabled={giftCardEnabled}
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
