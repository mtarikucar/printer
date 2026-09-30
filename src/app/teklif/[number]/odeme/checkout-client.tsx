"use client";

import Link from "next/link";
import { useState, type JSX } from "react";
import { useDisplayCurrency } from "@/components/quote/display-currency";
import { QuoteCheckoutForm } from "@/components/quote/quote-checkout-form";
import { fill, fxSurface, lineMoney, money } from "@/components/quote/format";
import { Card } from "@/components/ui";
import { KDV_RATE_BPS } from "@/lib/config/prices";
import {
  tenderViewFor,
  type TenderPaymentMethod,
  type TenderViews,
} from "@/lib/config/quote-tender";
import type {
  DisplayCurrency,
  FrozenFxRate,
  PresentedQuote,
  QuoteTotals,
} from "@/lib/config/quote-types";
import type { TurkishAddress } from "@/lib/db/schema";
import type { QuoteGiftCardPreview } from "@/lib/services/quote-checkout";
import { formatCurrency, formatDateLong, formatMoneyMinor } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";

export interface QuoteCheckoutClientProps {
  quote: PresentedQuote;
  /** KDV dâhil BRÜT toplam; hediye kartı bunu DÜŞÜRMEZ (tasarım §3.2). */
  totalKurus: number;
  /** Kartsız TABAN: iki yöntemin havale indirimi ve ödenecek tutarı. */
  tender: TenderViews;
  /** `quote_gift_card_enabled`; kapalıyken kod alanı HİÇ çizilmez. */
  giftCardEnabled: boolean;
  savedAddress: TurkishAddress | null;
  /**
   * Seçili gösterim birimi. Varsayılan olarak TERCİH DEPOSUNDAN okunur (aynı
   * depo çalışma alanını da besliyor), bu yüzden `?kur=` gerekmez: ödeme
   * ekranı bir istemci bileşenidir ve müşteri seçimini sayfa değiştirince
   * kaybetmez. Prop yalnız testin niyetini beyan etmesi için var.
   */
  currency?: DisplayCurrency;
}

/**
 * Ödeme sayfasının gövdesi: solda form, sağda FİŞ.
 *
 * Fiş, çalışma alanındaki özet panelinin ödeme anındaki hâlidir: müşteri
 * "neyi, kaç paraya, ne zaman" sorusunun üçünü de kart bilgisini girmeden
 * önce görmeli (MSY m.6/2-a özetinin ekrandaki karşılığı; sözleşme kutusunun
 * kendi özet bloğu da formda ayrıca duruyor).
 *
 * ÖDEME YÖNTEMİ ve HEDİYE KARTI durumu burada durur, formda değil: ikisi de
 * tahsil edilen tutarı belirliyor ve fiş ile ödeme düğmesinin aynı rakamı
 * göstermesi bu özelliğin tek gerçek şartı. İki ayrı kopya bir gün ayrışırdı.
 *
 * Buradaki her rakam SUNUCUDAN gelir (`totals`, `tender`, ön izleme); bu
 * dosyada çarpma, bölme ya da oran yoktur — yalnız yöntem SEÇİMİ
 * (`tenderViewFor`).
 */
export function QuoteCheckoutClient({
  quote,
  totalKurus,
  tender,
  giftCardEnabled,
  savedAddress,
  currency,
}: QuoteCheckoutClientProps): JSX.Element {
  const d = useDictionary();
  const [paymentMethod, setPaymentMethod] = useState<TenderPaymentMethod>("card");
  const [giftPreview, setGiftPreview] = useState<QuoteGiftCardPreview | null>(null);
  const preferred = useDisplayCurrency();
  // Seçim → teklifin KENDİ dondurduğu kur, YÜZEY kapısından (`fxSurface`):
  // fiş çevrilemiyorsa (gösterim tavanı, bozuk kur) kur `null` olur ve ekranın
  // TAMAMI ₺ kalır — kalemleri `€` toplamı `₺` bir fiş doğamaz. Fişin ÜST
  // tarafı (parça satırı, ek hizmet, brüt toplam, KDV) bu kurla ikinci bir
  // okuma alır; TAHSİL EDİLECEK rakamlar almaz (aşağıdaki fişte gerekçesi
  // yazılı).
  const { rate } = fxSurface(
    quote.display?.snapshot,
    currency ?? preferred,
    quote.totals,
    quote.parts
  );

  // Kart uygulandıysa iki rakam da ön izlemeden gelir; yoksa kartsız tabandan.
  const views = giftPreview ?? tender;
  const view = tenderViewFor(views, paymentMethod);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">
          {d["instantQuote.checkout.title"]} · {quote.number}
        </h1>
        <Link
          href={`/teklif/${encodeURIComponent(quote.number)}`}
          className="text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          {d["instantQuote.checkout.backToQuote"]}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card padding="md" className="order-2 lg:order-1">
          <QuoteCheckoutForm
            quote={quote}
            totalKurus={totalKurus}
            tender={tender}
            rate={rate}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            giftCardEnabled={giftCardEnabled}
            giftPreview={giftPreview}
            onGiftPreviewChange={setGiftPreview}
            savedAddress={savedAddress}
          />
        </Card>

        <div className="order-1 lg:order-2 lg:sticky lg:top-6 lg:h-fit">
          <QuoteCheckoutReceipt
            quote={quote}
            totalKurus={totalKurus}
            rate={rate}
            giftCardAmountKurus={giftPreview?.giftCardAmountKurus ?? 0}
            havaleDiscountKurus={views.bankTransfer.havaleDiscountKurus}
            payableKurus={view.payableKurus}
          />
        </div>
      </div>
    </main>
  );
}

/**
 * Ödeme FİŞİ — yalnız çizer.
 *
 * Kendi bileşeni olması bilinçli: fişin gösterdiği tender dökümü (brüt toplam →
 * hediye kartı → ödenecek tutar) ekranın en kolay sessizce bayatlayan yeridir ve
 * ayrı bir bileşen onu durumdan bağımsız SINANABİLİR kılar
 * (`scripts/test-quote-ui.ts`).
 */
export function QuoteCheckoutReceipt({
  quote,
  totalKurus,
  giftCardAmountKurus,
  havaleDiscountKurus,
  payableKurus,
  rate: wantedRate = null,
}: {
  quote: PresentedQuote;
  /**
   * İSTENEN gösterim biriminin DONMUŞ kuru; `null` = yalnız ₺.
   *
   * Fişin ÜST tarafı ikinci bir okuma alır (ne alıyorum, brüt kaça). TAHSİL
   * EDİLEN üç satır — hediye kartından karşılanan, havale indirimi ve ödenecek
   * tutar — ₺ KALIR: müşteri yaklaşık bir sayıyı ödeyeceği tutar sanmamalı
   * (MSY m.6/2-a + 32 Sayılı Karar m.4/g).
   *
   * Bir İSTEKTİR, karar değil: fiş TOPLANAN bir küme çizdiği için kapıyı
   * (`fxSurface`) kendisi de uygular — çevrilemeyen bir fişte prop dolu olsa
   * bile yüzeyin tamamı ₺ kalır.
   */
  rate?: FrozenFxRate | null;
  totalKurus: number;
  /** Hediye kartından karşılanan tutar; kart yoksa 0. */
  giftCardAmountKurus: number;
  /** Havale seçilirse düşülecek indirim (kartın düştüğü NAKİT üzerinden). */
  havaleDiscountKurus: number;
  /** Seçili yöntemde TAHSİL EDİLECEK tutar. */
  payableKurus: number;
}): JSX.Element {
  const d = useDictionary();
  const totals = quote.totals as QuoteTotals;
  // Fişin SATIR KÜMESİ aynı kapıdan okunur: parça satırları ara toplama
  // AYRILMIŞ değerlerle basılır ve satırlar ile brüt toplam arasındaki
  // yuvarlama farkı GÖRÜNEN bir satır olur. Aksi hâlde müşteri, satırları
  // toplayınca toplamı tutmayan bir fiş okurdu (tasarım §3.2 R5).
  //
  // Kapı burada İKİNCİ kez uygulanıyor (yüzeyi `QuoteCheckoutClient` de
  // kapılıyor) çünkü fişin çizdiği şey TOPLANAN bir kümedir: kuru dolu ama
  // fişi çevrilemeyen bir çağrıda satırlar `€` toplam `₺` olurdu.
  const { rate, receipt, partLineMinor } = fxSurface(
    quote.display?.snapshot,
    wantedRate?.currency ?? "TRY",
    totals,
    quote.parts
  );

  return (
    <Card padding="none" className="h-fit overflow-hidden">
      <div className="border-b border-border-default px-4 py-3">
        <h2 className="text-sm font-semibold text-text-primary">
          {d["instantQuote.checkout.summaryTitle"]}
        </h2>
      </div>

      <div className="space-y-4 px-4 py-4">
        <p className="text-xs text-text-muted">
          {fill(d["instantQuote.summary.parts"], {
            parts: quote.partCount,
            units: quote.unitCount,
          })}
        </p>

        <ul className="space-y-2">
          {quote.parts.map((part) => (
            <li key={part.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-text-secondary">
                {part.name}
                {part.config.quantity > 1 && (
                  <span className="text-text-muted"> × {part.config.quantity}</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-text-secondary">
                {part.price
                  ? lineMoney(part.price.lineKurus, partLineMinor.get(part.id), rate)
                  : "—"}
              </span>
            </li>
          ))}
        </ul>

        {totals.addonLines.length > 0 && (
          <dl className="space-y-1.5 border-t border-border-default pt-3">
            {totals.addonLines.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-text-secondary">{line.name}</dt>
                <dd className="text-sm tabular-nums text-text-secondary">
                  {money(line.kurus, rate)}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {totals.minOrderTopUpKurus > 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border-default pt-3">
            <span className="text-sm text-text-secondary">
              {d["instantQuote.summary.minOrderTopUp"]}
            </span>
            <span className="text-sm tabular-nums text-text-secondary">
              {money(totals.minOrderTopUpKurus, rate)}
            </span>
          </div>
        )}

        {/* YUVARLAMA: satırlar ayrı ayrı yuvarlandığı için toplamları
            çevrilmiş brüt toplamdan sapabilir. Fark GİZLENMEZ — fişi satır
            satır toplayan müşteri onu bulmak zorunda (tasarım §3.2 R5). ₺
            gösterimde fark YOKTUR (sunucu hesabı), o yüzden satır yalnız
            döviz seçiliyken ve fark ≠ 0 iken doğar. */}
        {receipt && receipt.roundingMinor !== 0 && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border-default pt-3">
            <span className="text-sm text-text-secondary">{d["instantQuote.fx.rounding"]}</span>
            <span className="text-sm tabular-nums text-text-secondary">
              {formatMoneyMinor(receipt.roundingMinor, receipt.currency, "tr")}
            </span>
          </div>
        )}

        <div className="border-t border-border-default pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-text-primary">
              {d["instantQuote.summary.total"]}
            </span>
            <span className="text-xl font-semibold tabular-nums text-text-primary">
              {money(totalKurus, rate)}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {d["instantQuote.summary.kdvIncluded"]}
            {" · "}
            {fill(d["instantQuote.summary.kdv"], { rate: KDV_RATE_BPS / 100 })}{" "}
            <span className="tabular-nums">{money(totals.kdvKurus, rate)}</span>
          </p>
          {/* Hediye kartı bir ÖDEME ARACIDIR: brüt toplamı ve fatura matrahını
              düşürmez (tasarım §3.3), o yüzden "indirim" DEĞİL "karşılanan"
              diye yazılır ve toplamın ALTINDA durur. */}
          {giftCardAmountKurus > 0 && (
            <p className="mt-1 text-xs text-text-secondary">
              {fill(d["instantQuote.checkout.giftCard.applied"], {
                amount: formatCurrency(giftCardAmountKurus, "tr"),
              })}
            </p>
          )}
          {havaleDiscountKurus > 0 && (
            <p className="mt-1 text-xs text-text-secondary">
              {d["payment.havaleDiscount"]}{" "}
              <span className="tabular-nums">−{formatCurrency(havaleDiscountKurus, "tr")}</span>
            </p>
          )}
          {/* Tahsil edilecek tutar brütten AYRILDIĞI anda yazılır: müşterinin
              ödeme yükümlülüğünden önce gördüğü rakam budur (MSY m.6/2-a). */}
          {payableKurus !== totalKurus && (
            <p className="mt-2 text-sm font-medium tabular-nums text-text-primary">
              {fill(d["instantQuote.checkout.giftCard.remaining"], {
                amount: formatCurrency(payableKurus, "tr"),
              })}
            </p>
          )}
        </div>

        {quote.shipByDate && (
          <p className="text-xs text-text-muted">
            {/* Kademe seçici ve teklif belgesi tarihi okunur yazıyor; fişin ham
                gün anahtarını ("2026-11-02") basması yalnız burada kalmış bir
                kaçaktı. */}
            {fill(d["instantQuote.lead.shipBy"], {
              date: formatDateLong(quote.shipByDate, "tr"),
            })}
          </p>
        )}
        <p className="text-xs text-text-muted">{d["instantQuote.summary.freeShipping"]}</p>
      </div>
    </Card>
  );
}
