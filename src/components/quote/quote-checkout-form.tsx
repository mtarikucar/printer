"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput, e164ToPhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DistanceContractConsent } from "@/components/distance-contract-consent";
import { FormField, Input, Select, Textarea } from "@/components/ui";
import { track } from "@/lib/analytics/client";
import { consentVariantForOrderType } from "@/lib/config/distance-contract";
import {
  tenderViewFor,
  type RecordedPaymentMethod,
  type TenderPaymentMethod,
  type TenderViews,
} from "@/lib/config/quote-tender";
import type { FrozenFxRate, PresentedQuote } from "@/lib/config/quote-types";
import type { QuoteGiftCardPreview } from "@/lib/services/quote-checkout";
import type { CountryCode } from "@/lib/phone";
import { DISTRICTS, PROVINCES } from "@/lib/data/turkey-address";
import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { TurkishAddress } from "@/lib/db/schema";
import { fill } from "./format";

/**
 * Teklif ödemesinin formu — `/api/quotes/<id>/checkout`.
 *
 * `CheckoutForm`un ÇATALIDIR, sarmalayıcısı değil. Ortak görünen alanların
 * altında üç ayrı sözleşme var: burada misafir alışverişi YOKTUR (fiyat kapısı
 * zaten oturum ister), hediye kartı alanı BAYRAK arkasındadır
 * (`quote_gift_card_enabled` kapalıyken hiç çizilmez — gizlenmez, ÇİZİLMEZ; kod
 * gelirse sunucu da 400 der) ve gövde teklife özgü üç alan taşır
 * (`expectedVersion`, `expectedTotalKurus`, `invoice`). Tek bir bileşeni
 * bayraklarla bu üç hâle birden esnetmek, ödeme gibi tek bir hata payı olan
 * yerde en pahalı kısayoldu.
 *
 * **Hiçbir tutar burada hesaplanmaz**: brüt toplam, havale indirimi ve ödenecek
 * tutar sunucudan gelir (`totalKurus`, `tender`, `giftPreview`) ve ekran yalnız
 * SEÇER (`tenderViewFor`). Ekranın kendi çıkarması, zincire yeni bir indirim
 * girdiği gün tahsil edilen tutardan sessizce ayrışırdı — ve müşteriye ödeme
 * yükümlülüğünden önce gösterilen tutar MSY m.6/2-a'nın konusudur.
 *
 * Hediye kartı DURUMU yukarıda (`checkout-client`) tutulur: fiş ile bu formun
 * aynı rakamı göstermesi şart, iki ayrı kopya bir gün ayrışırdı.
 */

export interface QuoteCheckoutFormProps {
  quote: PresentedQuote;
  /** KDV dâhil BRÜT toplam (kuruş) — sunucu hesabı, hediye kartı bunu düşürmez. */
  totalKurus: number;
  /** Kartsız TABAN: iki yöntemin havale indirimi ve ödenecek tutarı. */
  tender: TenderViews;
  paymentMethod: TenderPaymentMethod;
  onPaymentMethodChange: (paymentMethod: TenderPaymentMethod) => void;
  /** `quote_gift_card_enabled`; kapalıyken hediye kartı alanı HİÇ çizilmez. */
  giftCardEnabled: boolean;
  /** Uygulanmış kartın sunucu ön izlemesi; yoksa null. */
  giftPreview: QuoteGiftCardPreview | null;
  onGiftPreviewChange: (preview: QuoteGiftCardPreview | null) => void;
  /**
   * Seçili gösterim biriminin DONMUŞ kuru; `null` = yalnız ₺.
   *
   * Bu formda HİÇBİR tutar çevrilmez — havale indirimi, hediye kartı, düğme
   * üstündeki tutar ve mesafeli sözleşme özetindeki "vergiler dâhil toplam
   * fiyat" (MSY m.6/2-a) ₺ KALIR. Kur yalnız TAHSİLATIN ₺ olduğunu söyleyen
   * uyarının çizilip çizilmeyeceğini belirler: ₺ gösterimdeki müşteriye o
   * cümle anlamsız bir tekrar olurdu.
   */
  rate?: FrozenFxRate | null;
  /** Müşterinin adres defterindeki varsayılan adresi; yoksa null. */
  savedAddress: TurkishAddress | null;
}

/** Ödeme gövdesinin yanıtı — `/api/orders` ile aynı şekil. */
export interface CheckoutResponse {
  reference?: string;
  paymentMethod?: RecordedPaymentMethod;
  iframeUrl?: string;
  redirectUrl?: string;
  /** Tamamı hediye kartından karşılandı ve taslak siparişe döndü. */
  autoConfirmed?: boolean;
  /** `autoConfirmed` ise doğan siparişin numarası. */
  orderNumber?: string;
  error?: string;
  /** Reddin makine kodu (`{error, code}` sözleşmesi). */
  code?: string;
}

/**
 * Reddin konusu KART mı?
 *
 * Kodun öneki sunucu sözleşmesidir: `quote-checkout.ts` kart redlerini
 * `gift_card_<sebep>` olarak (ve bayrak kapalıyken `gift_card_disabled` olarak)
 * döner. Önemi para: ön izleme uygulanmışken ödeme kart yüzünden reddedilirse
 * ekran "₺X hediye kartından karşılandı" yazmaya DEVAM ederdi, oysa o tutar
 * tahsilattan düşmeyecek — müşterinin gördüğü rakam ile ödeyeceği rakam
 * ayrışırdı.
 */
export function isGiftCardRefusal(code: string | undefined): boolean {
  return typeof code === "string" && code.startsWith("gift_card_");
}

/** Başarılı bir cevabın müşteriyi GÖTÜRDÜĞÜ yer. */
export type CheckoutNavigation =
  /** PayTR iframe'i: SPA gezinmesi değil, TAM sayfa. */
  | { kind: "external"; url: string }
  | { kind: "push"; url: string }
  /** Gidilecek yer YOK: ekran hatayı yazar ve formda kalır. */
  | { kind: "error"; message: string };

/**
 * Cevabın nereye götürdüğü — SAF karar (tarayıcı yok, bu yüzden sınanabilir).
 *
 * Sıra kuralın kendisidir: `autoConfirmed: false` gövdesi 200'DÜR (bakiye düştü,
 * rezervasyon duruyor, bakım turu terfiyi yeniden deneyecek) ama sipariş henüz
 * YOKTUR — o hâlde takip sayfasına gitmek, müşteriye siparişinin olmadığını
 * söyleyen bir 404 göstermek olurdu. Tam karşılanan ödemede ise PayTR de havale
 * de hiç açılmaz ve tek doğru varış siparişin KENDİ numarasıdır (taslak
 * referansı bugün aynı dizgi olsa da, çok siparişli bölünmede olmayacak).
 */
export function checkoutNavigation(
  data: CheckoutResponse | null,
  fallbackError: string
): CheckoutNavigation {
  if (data?.iframeUrl) return { kind: "external", url: data.iframeUrl };
  if (data?.redirectUrl) return { kind: "push", url: data.redirectUrl };
  if (data?.autoConfirmed === false) {
    return { kind: "error", message: data.error || fallbackError };
  }
  const orderNumber = data?.orderNumber ?? data?.reference;
  if (orderNumber) return { kind: "push", url: `/track/${orderNumber}` };
  return { kind: "error", message: data?.error || fallbackError };
}

export function QuoteCheckoutForm({
  quote,
  totalKurus,
  tender,
  paymentMethod,
  onPaymentMethodChange,
  giftCardEnabled,
  giftPreview,
  onGiftPreviewChange,
  savedAddress,
  rate = null,
}: QuoteCheckoutFormProps): JSX.Element {
  const d = useDictionary();
  const router = useRouter();

  const [adres, setAdres] = useState(savedAddress?.adres ?? "");
  const [il, setIl] = useState(savedAddress?.il ?? "");
  const [ilce, setIlce] = useState(savedAddress?.ilce ?? "");
  const [mahalle, setMahalle] = useState(savedAddress?.mahalle ?? "");
  const [postaKodu, setPostaKodu] = useState(savedAddress?.postaKodu ?? "");
  // Kayıtlı telefon E.164'tür; alan ülke kodu + ulusal parça ister.
  const seededPhone = e164ToPhoneInput(savedAddress?.telefon);
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(seededPhone.country);
  const [phoneNational, setPhoneNational] = useState(seededPhone.nationalNumber);

  const invoice = quote.invoice ?? null;
  const [invoiceType, setInvoiceType] = useState<"individual" | "corporate">(
    invoice?.type ?? "individual"
  );
  const [companyName, setCompanyName] = useState(invoice?.companyName ?? "");
  const [taxId, setTaxId] = useState(invoice?.taxId ?? "");
  const [taxOffice, setTaxOffice] = useState(invoice?.taxOffice ?? "");
  const [poNumber, setPoNumber] = useState(quote.poNumber ?? "");

  const [contractConsentOk, setContractConsentOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hediye kartı: KOD alanı ve reddi burada, uygulanmış ÖN İZLEME yukarıda.
  const [giftCode, setGiftCode] = useState("");
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);

  /**
   * İstek başına değil, FORM başına bir anahtar: çift tıklama iki taslak
   * açmasın. Uç 4xx verirse istem serbest bırakılır, yani düzeltip aynı
   * anahtarla tekrar göndermek çalışır.
   */
  const idempotencyKey = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `quote-checkout-${crypto.randomUUID()}`
      : `quote-checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  // Huni: ödeme ekranı tutarla birlikte açıldı.
  const began = useRef(false);
  useEffect(() => {
    if (began.current || !totalKurus) return;
    began.current = true;
    track("begin_checkout", { valueKurus: totalKurus });
  }, [totalKurus]);

  // Uygulanmış kart varsa rakamlar ÖN İZLEMEDEN, yoksa kartsız tabandan gelir;
  // her iki hâlde de sunucu hesabı, ekranın seçtiği tek şey YÖNTEM.
  const view = tenderViewFor(giftPreview ?? tender, paymentMethod);
  const payableKurus = view.payableKurus;
  const havaleDiscountKurus = (giftPreview ?? tender).bankTransfer.havaleDiscountKurus;

  /**
   * Kodu SUNUCUYA sorar; rezervasyon YAPMAZ (`POST …/gift-card` salt okunur).
   *
   * Ön izleme bir söz değil bir gösterimdir: gerçek rezervasyon ödeme anında,
   * kartın kilitli bakiyesinden yapılır. Bu yüzden kod uygulanmış olsa bile
   * ödeme reddedilebilir (arada başka bir teklif aynı kartı harcamışsa) ve o
   * reddin cümlesi de sunucudan gelir.
   */
  async function applyGiftCard() {
    const code = giftCode.trim();
    if (giftBusy || !code) return;
    setGiftBusy(true);
    setGiftError(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quote.number)}/gift-card`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as
        | (QuoteGiftCardPreview & { error?: string })
        | null;
      if (!res.ok || !data?.valid) {
        // 404 = yüzeyin KENDİSİ yok (bayrak kapandı). Gövdedeki "teklif
        // bulunamadı" cümlesi müşteriyi teklifinde bir sorun olduğuna
        // inandırırdı; sorun kartın bu ödemede kullanılamamasıdır.
        throw new Error(
          res.status === 404
            ? d["instantQuote.checkout.giftCard.disabled"]
            : data?.error || d["common.error"]
        );
      }
      onGiftPreviewChange(data);
      // Sunucunun normalleştirdiği kod (büyük harf) gövdeye de o hâliyle gider.
      setGiftCode(data.code);
    } catch (err) {
      onGiftPreviewChange(null);
      setGiftError(err instanceof Error ? err.message : d["common.error"]);
    } finally {
      setGiftBusy(false);
    }
  }

  function removeGiftCard() {
    onGiftPreviewChange(null);
    setGiftCode("");
    setGiftError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);

    const telefon = phoneInputToE164(phoneCountry, phoneNational);
    if (!telefon) {
      setError(d["validator.phone.invalid"]);
      return;
    }
    if (!contractConsentOk) {
      setError(d["consent.contract.required"]);
      return;
    }
    // Kurumsal fatura alanlarının zorunluluğu tarayıcının `required`ı ile
    // tutulur; eksik/hatalı VKN'nin TÜRKÇE cümlesi sunucudan gelir
    // (`resolveInvoice`) — aynı kuralı iki yerde yazmayız.

    setSubmitting(true);
    // Piksel ile sunucu kaydı AYNI kimliği paylaşsın (Meta/TikTok tekilleştirme).
    const payEventId = track("add_payment_info", { valueKurus: payableKurus });
    const shippingAddress = { adres, mahalle, ilce, il, postaKodu, telefon };

    try {
      const res = await fetch(
        `/api/quotes/${encodeURIComponent(quote.number)}/checkout`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey.current,
          },
          body: JSON.stringify({
            expectedVersion: quote.version,
            expectedTotalKurus: totalKurus,
            shippingAddress,
            paymentMethod,
            distanceContractConsent: true,
            preliminaryInfoConsent: true,
            invoice:
              invoiceType === "corporate"
                ? {
                    type: "corporate",
                    companyName: companyName.trim(),
                    taxId: taxId.trim(),
                    taxOffice: taxOffice.trim(),
                    // v1'de fatura adresi teslimat adresidir; ayrı bir fatura
                    // adresi teklif çalışma alanından (PATCH) girilir.
                    billingAddress: shippingAddress,
                  }
                : {
                    type: "individual",
                    ...(taxId.trim() ? { taxId: taxId.trim() } : {}),
                  },
            ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
            // Kod YALNIZ uygulanmış ön izlemeden gider: alana yazılıp
            // uygulanmamış bir kod, müşterinin görmediği bir tutarla ödeme
            // demek olurdu.
            ...(giftCardEnabled && giftPreview ? { giftCardCode: giftPreview.code } : {}),
            analyticsEventId: payEventId,
          }),
        }
      );
      const data = (await res.json().catch(() => null)) as CheckoutResponse | null;
      if (!res.ok) {
        // Kart reddedildiyse ekrandaki ön izleme de DÜŞER: aksi hâlde müşteri
        // karşılanmayacak bir tutarı karşılanmış görmeye devam ederdi.
        if (isGiftCardRefusal(data?.code)) onGiftPreviewChange(null);
        throw new Error(data?.error || d["instantQuote.checkout.failed"]);
      }
      const next = checkoutNavigation(data, d["instantQuote.checkout.failed"]);
      if (next.kind === "error") throw new Error(next.message);
      // PayTR iframe'i TAM SAYFA açılır (SPA gezinmesi değil).
      if (next.kind === "external") {
        window.location.href = next.url;
        return;
      }
      router.push(next.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : d["common.error"]);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 text-left">
      {/* ── Teslimat ────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">
          {d["shop.checkout.title"]}
        </h2>

        <FormField label={d["shop.checkout.address"]} required>
          <Textarea
            rows={2}
            value={adres}
            onChange={(e) => setAdres(e.target.value)}
            required
          />
        </FormField>

        {/* Genişlikler SARMALAYICIDA: `.input-base` %100 genişliktir ve
            alandaki bir `w-*` sınıfını yener. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label={d["shop.checkout.province"]} required>
            <Select
              value={il}
              onChange={(e) => {
                setIl(e.target.value);
                setIlce("");
              }}
              required
            >
              <option value="">{d["shop.checkout.province"]}</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={d["shop.checkout.district"]} required>
            <Select
              value={ilce}
              onChange={(e) => setIlce(e.target.value)}
              required
              disabled={!il}
            >
              <option value="">{d["shop.checkout.district"]}</option>
              {(DISTRICTS[il] ?? []).map((district) => (
                <option key={district} value={district}>
                  {district}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={d["shop.checkout.neighborhood"]} required>
            <Input value={mahalle} onChange={(e) => setMahalle(e.target.value)} required />
          </FormField>
          <FormField label={d["shop.checkout.postalCode"]} required>
            <Input
              value={postaKodu}
              onChange={(e) => setPostaKodu(e.target.value)}
              inputMode="numeric"
              required
            />
          </FormField>
        </div>

        <FormField label={d["common.phone"]} required>
          <PhoneInput
            country={phoneCountry}
            nationalNumber={phoneNational}
            onCountryChange={setPhoneCountry}
            onNationalNumberChange={setPhoneNational}
            required
            className="input-base"
          />
        </FormField>
      </section>

      {/* ── Fatura ──────────────────────────────────────────────────────── */}
      <section className="space-y-4 border-t border-border-default pt-5">
        <h2 className="text-sm font-semibold text-text-primary">
          {d["instantQuote.checkout.invoice.title"]}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          {(["individual", "corporate"] as const).map((type) => (
            <label
              key={type}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                invoiceType === type
                  ? "border-green-500 bg-green-500/5"
                  : "border-border-default"
              }`}
            >
              <input
                type="radio"
                name="invoiceType"
                checked={invoiceType === type}
                onChange={() => setInvoiceType(type)}
              />
              {type === "individual"
                ? d["instantQuote.checkout.invoice.individual"]
                : d["instantQuote.checkout.invoice.corporate"]}
            </label>
          ))}
        </div>

        {invoiceType === "corporate" ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label={d["instantQuote.checkout.invoice.companyName"]}
              required
              className="sm:col-span-2"
            >
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </FormField>
            <FormField label={d["instantQuote.checkout.invoice.taxId"]} required>
              <Input
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                inputMode="numeric"
                required
              />
            </FormField>
            <FormField label={d["instantQuote.checkout.invoice.taxOffice"]} required>
              <Input
                value={taxOffice}
                onChange={(e) => setTaxOffice(e.target.value)}
                required
              />
            </FormField>
          </div>
        ) : (
          <FormField label={d["instantQuote.checkout.invoice.taxId"]}>
            <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} inputMode="numeric" />
          </FormField>
        )}

        <FormField
          label={d["instantQuote.checkout.poNumber"]}
          hint={d["instantQuote.checkout.poNumberHint"]}
        >
          <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={64} />
        </FormField>
      </section>

      {/* ── Hediye kartı (bayrak açıkken) ───────────────────────────────── */}
      {giftCardEnabled && (
        <section className="space-y-3 border-t border-border-default pt-5">
          <h2 className="text-sm font-semibold text-text-primary">
            {d["instantQuote.checkout.giftCard.title"]}
          </h2>

          {giftPreview ? (
            <div className="space-y-1.5 rounded-xl border border-green-500 bg-green-500/5 px-3 py-2.5">
              <p className="text-sm font-medium tabular-nums text-text-primary">
                {giftPreview.code}
              </p>
              <p className="text-sm tabular-nums text-text-secondary">
                {fill(d["instantQuote.checkout.giftCard.applied"], {
                  amount: formatCurrency(giftPreview.giftCardAmountKurus, "tr"),
                })}
              </p>
              <p className="text-sm tabular-nums text-text-primary">
                {fill(d["instantQuote.checkout.giftCard.remaining"], {
                  amount: formatCurrency(payableKurus, "tr"),
                })}
              </p>
              {giftPreview.fullyCovered && (
                <p className="text-xs text-text-secondary">
                  {d["instantQuote.checkout.giftCard.fullyCovered"]}
                </p>
              )}
              <button
                type="button"
                onClick={removeGiftCard}
                className="text-xs text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                {d["instantQuote.checkout.giftCard.remove"]}
              </button>
            </div>
          ) : (
            <FormField
              label={d["instantQuote.checkout.giftCard.codeLabel"]}
              hint={d["instantQuote.checkout.giftCard.hint"]}
            >
              {/* Genişlik SARMALAYICIDA: `.input-base` %100'dür ve alandaki bir
                  `flex-1`i yener. */}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    name="giftCardCode"
                    value={giftCode}
                    onChange={(e) => setGiftCode(e.target.value)}
                    maxLength={30}
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  onClick={applyGiftCard}
                  disabled={giftBusy || giftCode.trim().length < 3}
                  className="shrink-0 rounded-lg border border-border-default px-3 py-2 text-sm text-text-secondary disabled:opacity-50"
                >
                  {giftBusy
                    ? d["instantQuote.checkout.giftCard.applying"]
                    : d["instantQuote.checkout.giftCard.apply"]}
                </button>
              </div>
            </FormField>
          )}

          {giftError && (
            <p role="alert" className="text-sm text-error">
              {giftError}
            </p>
          )}
        </section>
      )}

      {/* ── Ödeme yöntemi ───────────────────────────────────────────────── */}
      <section className="space-y-3 border-t border-border-default pt-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["card", "bank_transfer"] as const).map((method) => (
            <label
              key={method}
              className={`flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 text-sm ${
                paymentMethod === method
                  ? "border-green-500 bg-green-500/5"
                  : "border-border-default"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === method}
                  onChange={() => onPaymentMethodChange(method)}
                />
                {method === "card" ? d["payment.card"] : d["payment.bankTransfer"]}
              </span>
              {method === "bank_transfer" && havaleDiscountKurus > 0 && (
                <span className="pl-6 text-xs text-text-secondary">
                  {d["payment.havaleDiscount"]} ·{" "}
                  <span className="tabular-nums">
                    −{formatCurrency(havaleDiscountKurus, "tr")}
                  </span>
                </span>
              )}
            </label>
          ))}
        </div>
      </section>

      {/* Tahsilatın ₺ olduğu, ödeme yükümlülüğünden HEMEN ÖNCE ve mesafeli
          sözleşme onayının ÜSTÜNDE yazılı durur: döviz karşılıklarını okumuş
          müşteri hangi rakamın tahsil edileceğini tartışmasız bilmeli (tasarım
          §3.5'teki dört azaltmadan biri). */}
      {rate && (
        <p className="rounded-xl border border-border-default bg-bg-muted px-3 py-2.5 text-xs text-text-secondary">
          {fill(d["instantQuote.fx.chargedInTry"], { amount: formatCurrency(payableKurus, "tr") })}
        </p>
      )}

      <DistanceContractConsent
        variant={consentVariantForOrderType("upload")}
        productName={fill(d["instantQuote.checkout.contractProduct"], {
          number: quote.number,
          parts: quote.partCount,
        })}
        priceKurus={payableKurus}
        onChange={setContractConsentOk}
      />

      {error && <p className="text-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !contractConsentOk}
        className="btn-primary w-full rounded-xl py-3 font-medium disabled:opacity-60"
      >
        {submitting
          ? d["instantQuote.checkout.submitting"]
          : `${d["instantQuote.checkout.submit"]} · ${formatCurrency(payableKurus, "tr")}`}
      </button>
    </form>
  );
}
