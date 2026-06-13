"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { track } from "@/lib/analytics/client";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";

// Reusable single-payment checkout. Collects guest identity (when logged out),
// a Turkish shipping address, and a payment method, then POSTs `orderPayload`
// (the order-type-specific fields, e.g. {orderType:'upload', uploadedModelId})
// merged with the common checkout fields to /api/orders and handles the
// PayTR / havale / track redirect. Shared by the upload flow (Faz 2) and the
// cart checkout (Faz 4).
export function CheckoutForm({
  orderPayload,
  priceKurus,
  submitLabel,
  onSuccess,
}: {
  orderPayload: Record<string, unknown>;
  priceKurus: number;
  submitLabel?: string;
  onSuccess?: () => Promise<void> | void;
}) {
  const d = useDictionary();
  const locale = useLocale();
  const router = useRouter();
  const t = (k: string, fb: string) => d[k as keyof typeof d] || fb;

  const [loggedIn, setLoggedIn] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [adres, setAdres] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [mahalle, setMahalle] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phoneNational, setPhoneNational] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "bank_transfer">("card");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setLoggedIn(true);
          if (data.user.fullName) setGuestName(data.user.fullName);
          if (data.user.email) setGuestEmail(data.user.email);
        }
      })
      .catch(() => {});
  }, []);

  // Funnel: checkout started (the form is on screen with an amount due).
  const beganCheckout = useRef(false);
  useEffect(() => {
    if (beganCheckout.current || !priceKurus) return;
    beganCheckout.current = true;
    track("begin_checkout", {
      valueKurus: priceKurus,
      productId: typeof orderPayload.productId === "string" ? orderPayload.productId : undefined,
    });
  }, [priceKurus, orderPayload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (submitting) return;

    const telefon = phoneInputToE164(phoneCountry, phoneNational);
    if (!telefon) {
      setError(t("validator.phone.invalid", "Geçerli bir telefon girin"));
      return;
    }
    if (!loggedIn && (!guestName.trim() || !guestEmail.trim())) {
      setError(t("shop.checkout.guestRequired", "Ad ve e-posta zorunludur"));
      return;
    }

    setSubmitting(true);
    // Funnel: payment initiated. The shared event id lets the browser pixel and
    // the server-side AddPaymentInfo event deduplicate at Meta/TikTok.
    const payEventId = track("add_payment_info", {
      valueKurus: priceKurus,
      productId: typeof orderPayload.productId === "string" ? orderPayload.productId : undefined,
    });
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...orderPayload,
          shippingAddress: { adres, mahalle, ilce, il, postaKodu, telefon },
          paymentMethod,
          giftCardCode: giftCardCode.trim() || undefined,
          guestEmail: !loggedIn ? guestEmail.trim() : undefined,
          guestName: !loggedIn ? guestName.trim() : undefined,
          analyticsEventId: payEventId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(data.error)
            ? data.error[0]?.message
            : data.error || t("shop.checkout.failed", "Sipariş oluşturulamadı")
        );
      }
      await onSuccess?.();
      const reference = data.reference ?? data.orderNumber;
      if (data.autoConfirmed) return void router.push(`/track/${reference}`);
      if (data.paymentMethod === "card" && data.iframeUrl) {
        window.location.href = data.iframeUrl;
        return;
      }
      if (data.paymentMethod === "bank_transfer") {
        return void router.push(data.redirectUrl ?? `/havale/${reference}`);
      }
      router.push(`/track/${reference}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : d["common.error"]);
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full px-3 py-2 border border-bg-subtle rounded-xl bg-bg-base text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-green-500";

  return (
    <form onSubmit={submit} className="space-y-4 text-left">
      <h2 className="font-medium text-text-primary">
        {t("shop.checkout.title", "Teslimat ve Ödeme")}
      </h2>

      {!loggedIn && (
        <div className="grid grid-cols-1 gap-3">
          <input
            className={inputCls}
            placeholder={t("shop.checkout.name", "Ad Soyad")}
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            required
          />
          <input
            className={inputCls}
            type="email"
            placeholder={t("shop.checkout.email", "E-posta")}
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
            required
          />
        </div>
      )}

      <textarea
        className={inputCls}
        placeholder={t("shop.checkout.address", "Adres")}
        value={adres}
        onChange={(e) => setAdres(e.target.value)}
        required
        rows={2}
      />
      <div className="grid grid-cols-2 gap-3">
        <select
          className={inputCls}
          value={il}
          onChange={(e) => {
            setIl(e.target.value);
            setIlce("");
          }}
          required
        >
          <option value="">{t("shop.checkout.province", "İl")}</option>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={inputCls}
          value={ilce}
          onChange={(e) => setIlce(e.target.value)}
          required
          disabled={!il}
        >
          <option value="">{t("shop.checkout.district", "İlçe")}</option>
          {(DISTRICTS[il] ?? []).map((dst) => (
            <option key={dst} value={dst}>
              {dst}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          className={inputCls}
          placeholder={t("shop.checkout.neighborhood", "Mahalle")}
          value={mahalle}
          onChange={(e) => setMahalle(e.target.value)}
          required
        />
        <input
          className={inputCls}
          placeholder={t("shop.checkout.postalCode", "Posta Kodu")}
          value={postaKodu}
          onChange={(e) => setPostaKodu(e.target.value)}
          inputMode="numeric"
          required
        />
      </div>
      <PhoneInput
        country={phoneCountry}
        nationalNumber={phoneNational}
        onCountryChange={setPhoneCountry}
        onNationalNumberChange={setPhoneNational}
        required
        className={inputCls}
      />

      <input
        value={giftCardCode}
        onChange={(e) => setGiftCardCode(e.target.value)}
        placeholder={t("checkout.giftCard", "Hediye kartı kodu (opsiyonel)")}
        className={inputCls}
      />

      <div className="grid grid-cols-2 gap-3">
        {(["card", "bank_transfer"] as const).map((pm) => (
          <label
            key={pm}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${
              paymentMethod === pm ? "border-green-500 bg-green-500/5" : "border-bg-subtle"
            }`}
          >
            <input
              type="radio"
              name="pm"
              checked={paymentMethod === pm}
              onChange={() => setPaymentMethod(pm)}
            />
            {pm === "card" ? t("payment.card", "Kart") : t("payment.bankTransfer", "Havale/EFT")}
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full btn-primary py-3 rounded-xl font-medium disabled:opacity-60"
      >
        {submitting
          ? t("shop.checkout.processing", "İşleniyor…")
          : `${submitLabel ?? t("shop.checkout.pay", "Öde")} · ${formatCurrency(priceKurus, locale)}`}
      </button>
    </form>
  );
}
