"use client";

import { useEffect, useState, type FormEvent, type JSX } from "react";
import Link from "next/link";
import { Button, Card, FormField, Input } from "@/components/ui";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { useDictionary } from "@/lib/i18n/locale-context";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { track } from "@/lib/analytics/client";

/**
 * Fiyat kapısı: teklifini gören ama FİYATINI göremeyen ziyaretçiyi hesaba
 * bağlar.
 *
 * Neden ayrı bir modal (var olan /login + /register sayfaları dururken):
 * çalışma alanı sayfadan ayrılınca kaybolacak bir şey değil — parçalar zaten
 * sunucuda — ama ziyaretçi bunu BİLMEZ. Tam sayfa yönlendirme "yüklediklerim
 * uçtu mu?" sorusunu doğurur; modal teklifi arkasında açık tutar ve tek işi
 * bu korkuyu ortadan kaldırmaktır: başlık neden açıldığını, alt satır
 * parçaların kayıtlı kaldığını söyler.
 *
 * Kapı PERDE DEĞİL: fiyatlar sunucuda ayıklanır (`presentQuote`), bu bileşen
 * yalnız oturumu açar. Başarıdan sonra `figurunica:auth-changed` olayını
 * yayar (üst menü kendini tazelesin) ve `onAuthenticated` ile çağırana döner;
 * teklifin SAHİPLENİLMESİ (`POST /api/quotes/[id]/claim`) çağıranın işidir.
 */

export type PriceGateTab = "register" | "login";

export interface PriceGateModalProps {
  open: boolean;
  onClose: () => void;
  /** Oturum açıldı: çağıran teklifi sahiplenip yeniden çeker. */
  onAuthenticated: () => void;
  /** Google dönüşünde geri gelinecek yol (teklifin kendisi). */
  redirectPath: string;
  initialTab?: PriceGateTab;
}

/** Kayıt ve giriş aynı yazımı kullansın: uçlar da küçük harfe indiriyor. */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function PriceGateModal({
  open,
  onClose,
  onAuthenticated,
  redirectPath,
  initialTab = "register",
}: PriceGateModalProps): JSX.Element | null {
  const d = useDictionary();
  const [tab, setTab] = useState<PriceGateTab>(initialTab);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleOnly, setGoogleOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  // Her açılış temiz başlar: kapatılmış bir hatanın bir sonraki açılışta
  // ekranda durması, olmayan bir sorunu varmış gibi gösterir.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setError(null);
    setGoogleOnly(false);
    setLoading(false);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const isRegister = tab === "register";

  function succeed(signedUp: boolean) {
    // Üst menü `/api/auth/me`'yi BİR KEZ okur; bu olay olmadan kullanıcı
    // giriş yapmış olmasına rağmen "Giriş yap" düğmesini görmeye devam eder.
    window.dispatchEvent(new Event("figurunica:auth-changed"));
    if (signedUp) track("sign_up");
    onAuthenticated();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGoogleOnly(false);

    const body: Record<string, unknown> = {
      email: normalizeEmail(email),
      password,
    };
    if (isRegister) {
      const phoneE164 = phoneInputToE164(phoneCountry, phone);
      if (!phoneE164) {
        setError(d["instantQuote.modal.phoneInvalid"]);
        return;
      }
      body.fullName = fullName;
      body.phone = phoneE164;
      body.marketingConsent = marketingConsent;
    }

    setLoading(true);
    try {
      const res = await fetch(isRegister ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));

      if (res.ok) {
        succeed(isRegister);
        return;
      }
      if (res.status === 429) {
        setError(d["instantQuote.modal.rateLimited"]);
        return;
      }
      if (isRegister && res.status === 409) {
        // Hesap zaten var: e-postayı yeniden yazdırmadan giriş sekmesine geç.
        setTab("login");
        setError(d["instantQuote.modal.emailExists"]);
        return;
      }
      if (!isRegister && res.status === 400 && /google/i.test(data.error ?? "")) {
        // Şifresiz hesap. Misafir siparişiyle açılmış olabilir: "şifre belirle"
        // artık gerçekten çalışıyor (bkz. password-reset.ts misafir dalı).
        setGoogleOnly(true);
        setError(d["instantQuote.modal.googleOnly"]);
        return;
      }
      setError(data.error || d["instantQuote.modal.failed"]);
    } catch {
      setError(d["instantQuote.modal.failed"]);
    } finally {
      setLoading(false);
    }
  }

  const tabButton = (key: PriceGateTab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => {
        setTab(key);
        setError(null);
        setGoogleOnly(false);
      }}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        tab === key
          ? "bg-bg-base text-text-primary shadow-sm"
          : "text-text-muted hover:text-text-secondary"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        padding="lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-gate-title"
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto animate-scale-in"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={d["instantQuote.modal.close"]}
          className="absolute right-4 top-4 rounded-full p-2 text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 id="price-gate-title" className="pr-8 font-serif text-xl text-text-primary">
          {isRegister
            ? d["instantQuote.modal.title.register"]
            : d["instantQuote.modal.title.login"]}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {d["instantQuote.modal.subtitle"]}
        </p>

        <div role="tablist" className="mt-5 flex gap-1 rounded-xl bg-bg-muted p-1">
          {tabButton("register", d["instantQuote.modal.tab.register"])}
          {tabButton("login", d["instantQuote.modal.tab.login"])}
        </div>

        <div className="mt-5">
          <GoogleSignInButton
            label={
              isRegister
                ? d["instantQuote.modal.google.register"]
                : d["instantQuote.modal.google.login"]
            }
            redirect={redirectPath}
          />
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-bg-subtle" />
          <span className="text-xs text-text-muted">{d["instantQuote.modal.orEmail"]}</span>
          <div className="h-px flex-1 bg-bg-subtle" />
        </div>

        <form onSubmit={submit} className="space-y-4">
          {isRegister && (
            <FormField label={d["instantQuote.modal.fullName"]} required>
              <Input
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </FormField>
          )}

          <FormField label={d["instantQuote.modal.email"]} required>
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </FormField>

          {isRegister && (
            <FormField label={d["instantQuote.modal.phone"]} required>
              <PhoneInput
                required
                country={phoneCountry}
                nationalNumber={phone}
                onCountryChange={setPhoneCountry}
                onNationalNumberChange={setPhone}
              />
            </FormField>
          )}

          <FormField
            label={d["instantQuote.modal.password"]}
            required
            hint={isRegister ? d["instantQuote.modal.passwordHint"] : undefined}
          >
            <Input
              type="password"
              required
              minLength={6}
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>

          {isRegister && (
            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-bg-subtle text-green-500 focus:ring-green-500"
              />
              <span>
                {d["instantQuote.modal.marketingConsent"]}{" "}
                <Link href="/ticari-ileti" className="text-green-500 hover:text-green-400">
                  {d["instantQuote.modal.marketingConsentLink"]}
                </Link>
              </span>
            </label>
          )}

          {error && (
            <div className="rounded-xl bg-error-50 p-3 text-sm text-error" role="alert">
              {error}
              {googleOnly && (
                <>
                  {" "}
                  <Link href="/forgot-password" className="font-semibold underline">
                    {d["instantQuote.modal.forgotPassword"]}
                  </Link>
                </>
              )}
            </div>
          )}

          <Button type="submit" fullWidth loading={loading} className="!block text-center">
            {loading
              ? d["instantQuote.modal.submitting"]
              : isRegister
                ? d["instantQuote.modal.submitRegister"]
                : d["instantQuote.modal.submitLogin"]}
          </Button>
        </form>

        {isRegister ? (
          <p className="mt-4 text-xs text-text-muted">
            {d["instantQuote.modal.kvkkPrefix"]}{" "}
            <Link href="/privacy" className="text-green-500 hover:text-green-400">
              {d["instantQuote.modal.kvkkLink"]}
            </Link>{" "}
            {d["instantQuote.modal.kvkkSuffix"]}
          </p>
        ) : (
          <p className="mt-4 text-xs text-text-muted">
            <Link href="/forgot-password" className="text-green-500 hover:text-green-400">
              {d["instantQuote.modal.forgotPassword"]}
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}
