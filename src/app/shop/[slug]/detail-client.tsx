"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { ModelViewer } from "@/components/model-viewer";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import {
  PhoneInput,
  phoneInputToE164,
} from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { track } from "@/lib/analytics/client";

interface ProductDetail {
  id: string;
  title: string;
  description: string;
  priceKurus: number;
  material: string | null;
  leadTimeDays: number | null;
  sellerName: string | null;
  images: string[];
  model3dUrl: string | null;
  boxContents: { name: string; quantity: number; unit: string | null }[];
}

export function ProductDetailClient({ product }: { product: ProductDetail }) {
  const d = useDictionary();
  const locale = useLocale();
  const router = useRouter();

  const [activeImage, setActiveImage] = useState(0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Auth + identity prefill.
  const [loggedIn, setLoggedIn] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  // Address state.
  const [adres, setAdres] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [mahalle, setMahalle] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phoneNational, setPhoneNational] = useState("");

  const [paymentMethod, setPaymentMethod] = useState<"card" | "bank_transfer">(
    "card"
  );

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

  // Funnel: product viewed.
  useEffect(() => {
    track("view_item", {
      productId: product.id,
      itemName: product.title,
      valueKurus: product.priceKurus,
    });
  }, [product.id, product.title, product.priceKurus]);

  const t = (key: string, fallback: string) =>
    d[key as keyof typeof d] || fallback;

  const materialLabel = product.material
    ? d[`material.${product.material}` as keyof typeof d] || product.material
    : null;

  async function handleBuy(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Guard against a second submit (e.g. Enter key while the button is
    // disabled) which would create a duplicate draft/order.
    if (submitting) return;

    const telefonE164 = phoneInputToE164(phoneCountry, phoneNational);
    if (!telefonE164) {
      setError(t("validator.phone.invalid", "Geçerli bir telefon girin"));
      return;
    }
    if (!loggedIn && (!guestName.trim() || !guestEmail.trim())) {
      setError(t("shop.checkout.guestRequired", "Ad ve e-posta zorunludur"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderType: "marketplace",
          productId: product.id,
          quantity: 1,
          shippingAddress: {
            adres,
            mahalle,
            ilce,
            il,
            postaKodu,
            telefon: telefonE164,
          },
          paymentMethod,
          guestEmail: !loggedIn ? guestEmail.trim() : undefined,
          guestName: !loggedIn ? guestName.trim() : undefined,
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

      const reference = data.reference ?? data.orderNumber;
      if (data.autoConfirmed) {
        router.push(`/track/${reference}`);
        return;
      }
      if (data.paymentMethod === "card" && data.iframeUrl) {
        window.location.href = data.iframeUrl;
        return;
      }
      if (data.paymentMethod === "bank_transfer") {
        router.push(data.redirectUrl ?? `/havale/${reference}`);
        return;
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
    <div className="mt-6 grid md:grid-cols-2 gap-10">
      {/* Gallery */}
      <div>
        <div className="aspect-square bg-bg-elevated rounded-2xl overflow-hidden">
          {product.images[activeImage] ? (
            <img
              src={product.images[activeImage]}
              alt={product.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
        {product.images.length > 1 && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {product.images.map((url, i) => (
              <button
                key={url}
                onClick={() => setActiveImage(i)}
                className={`w-16 h-16 rounded-lg overflow-hidden border-2 ${
                  i === activeImage ? "border-green-500" : "border-transparent"
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {product.model3dUrl && (
          <div className="mt-3 rounded-2xl overflow-hidden border border-bg-subtle bg-bg-elevated">
            <ModelViewer url={product.model3dUrl} className="h-72 w-full" />
            <p className="text-xs text-text-muted text-center py-1.5">
              {t("product.preview3d", "3B önizleme — döndürmek için sürükleyin")}
            </p>
          </div>
        )}
      </div>

      {/* Info + checkout */}
      <div>
        <h1 className="text-2xl font-serif text-text-primary">{product.title}</h1>
        {product.sellerName && (
          <p className="mt-1 text-sm text-text-muted">
            {t("product.detail.soldBy", "Satıcı")}: {product.sellerName}
          </p>
        )}
        <p className="mt-4 text-3xl font-semibold text-text-primary">
          {formatCurrency(product.priceKurus, locale)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {materialLabel && (
            <span className="px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary border border-bg-subtle">
              {materialLabel}
            </span>
          )}
          {product.leadTimeDays != null && (
            <span className="px-2 py-0.5 rounded-full bg-bg-elevated text-text-secondary border border-bg-subtle">
              {t("shop.leadTime", "Kargo")}: ~{product.leadTimeDays}{" "}
              {t("shop.days", "gün")}
            </span>
          )}
        </div>

        <p className="mt-6 text-text-secondary whitespace-pre-line leading-relaxed">
          {product.description}
        </p>

        {product.boxContents.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-text-primary mb-2">
              {t("product.boxContents", "Kutu içeriği")}
            </h3>
            <ul className="space-y-1">
              {product.boxContents.map((c, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 text-sm text-text-secondary"
                >
                  <svg
                    className="h-4 w-4 shrink-0 text-green-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span>
                    {c.name}{" "}
                    <span className="text-text-muted">
                      × {c.quantity}
                      {c.unit ? ` ${c.unit}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!checkoutOpen ? (
          <div className="mt-8 space-y-2">
            <AddToCartButton productId={product.id} />
            <button
              onClick={() => setCheckoutOpen(true)}
              className="w-full rounded-xl border border-bg-subtle bg-bg-base py-3 text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {t("shop.buy", "Satın Al")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleBuy} className="mt-8 space-y-4">
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

            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${
                  paymentMethod === "card"
                    ? "border-green-500 bg-green-500/5"
                    : "border-bg-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="pm"
                  checked={paymentMethod === "card"}
                  onChange={() => setPaymentMethod("card")}
                />
                {t("payment.card", "Kart")}
              </label>
              <label
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer text-sm ${
                  paymentMethod === "bank_transfer"
                    ? "border-green-500 bg-green-500/5"
                    : "border-bg-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="pm"
                  checked={paymentMethod === "bank_transfer"}
                  onChange={() => setPaymentMethod("bank_transfer")}
                />
                {t("payment.bankTransfer", "Havale/EFT")}
              </label>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full btn-primary py-3 rounded-xl font-medium disabled:opacity-60"
            >
              {submitting
                ? t("shop.checkout.processing", "İşleniyor…")
                : `${t("shop.checkout.pay", "Öde")} · ${formatCurrency(
                    product.priceKurus,
                    locale
                  )}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
