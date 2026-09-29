"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { useRouter } from "next/navigation";
import { PhoneInput, e164ToPhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DistanceContractConsent } from "@/components/distance-contract-consent";
import { FormField, Input, Select, Textarea } from "@/components/ui";
import { track } from "@/lib/analytics/client";
import { consentVariantForOrderType } from "@/lib/config/distance-contract";
import type { PresentedQuote } from "@/lib/config/quote-types";
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
 * zaten oturum ister), hediye kartı YOKTUR (rezervasyon yalnız `/api/orders`
 * içinde satır içi yazılmış) ve gövde teklife özgü üç alan taşır
 * (`expectedVersion`, `expectedTotalKurus`, `invoice`). Tek bir bileşeni
 * bayraklarla bu üç hâle birden esnetmek, ödeme gibi tek bir hata payı olan
 * yerde en pahalı kısayoldu.
 *
 * **Hiçbir tutar burada hesaplanmaz**: gösterilen toplam da havale indirimi de
 * sunucudan gelir (`totalKurus`, `havaleDiscountKurus`). Ekranın kendi
 * çarpması, bir gün ayar değiştiğinde tahsil edilen tutardan ayrışırdı.
 */

export interface QuoteCheckoutFormProps {
  quote: PresentedQuote;
  /** KDV dâhil toplam (kuruş) — sunucu hesabı. */
  totalKurus: number;
  /** Havale seçilirse düşülecek indirim; ayar kapalıysa 0. */
  havaleDiscountKurus: number;
  /** Müşterinin adres defterindeki varsayılan adresi; yoksa null. */
  savedAddress: TurkishAddress | null;
}

type PaymentMethod = "card" | "bank_transfer";

/** Ödeme gövdesinin yanıtı — `/api/orders` ile aynı şekil. */
interface CheckoutResponse {
  reference?: string;
  paymentMethod?: PaymentMethod;
  iframeUrl?: string;
  redirectUrl?: string;
  error?: string;
}

export function QuoteCheckoutForm({
  quote,
  totalKurus,
  havaleDiscountKurus,
  savedAddress,
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");

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

  const payableKurus =
    paymentMethod === "bank_transfer" ? totalKurus - havaleDiscountKurus : totalKurus;

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
            analyticsEventId: payEventId,
          }),
        }
      );
      const data = (await res.json().catch(() => null)) as CheckoutResponse | null;
      if (!res.ok) {
        throw new Error(data?.error || d["instantQuote.checkout.failed"]);
      }
      // Kart: PayTR iframe'i TAM SAYFA açılır (SPA gezinmesi değil).
      if (data?.iframeUrl) {
        window.location.href = data.iframeUrl;
        return;
      }
      if (data?.redirectUrl) {
        router.push(data.redirectUrl);
        return;
      }
      router.push(`/track/${data?.reference ?? ""}`);
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
                  onChange={() => setPaymentMethod(method)}
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
