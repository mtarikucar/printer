"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDictionary } from "@/lib/i18n/locale-context";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { MANUFACTURER_ONBOARDING_TR } from "@/lib/content/manufacturer-onboarding";

type Step = "onboarding" | "form";

export default function ManufacturerRegisterPage() {
  const router = useRouter();
  const d = useDictionary();
  const [step, setStep] = useState<Step>("onboarding");
  const [accepted, setAccepted] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Account
  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [waCountry, setWaCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Tax
  const [taxId, setTaxId] = useState("");
  const [taxIdError, setTaxIdError] = useState<string | null>(null);

  // Address
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [mahalle, setMahalle] = useState("");
  const [adres, setAdres] = useState("");
  const [postaKodu, setPostaKodu] = useState("");

  // Bank
  const [iban, setIban] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");

  // Capacity
  const [maxConcurrentOrders, setMaxConcurrentOrders] = useState(5);

  // Production materials (capabilities). At least one required; drives which
  // orders (resin vs filament) get routed to this manufacturer.
  const [materials, setMaterials] = useState<string[]>(["resin"]);
  const toggleMaterial = (key: string) =>
    setMaterials((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const districtOptions = useMemo(
    () => (il ? DISTRICTS[il] ?? [] : []),
    [il]
  );

  useEffect(() => {
    fetch("/api/manufacturer/auth/me")
      .then((res) => {
        if (res.ok) {
          router.replace("/manufacturer/orders");
        } else {
          setCheckingAuth(false);
        }
      })
      .catch(() => setCheckingAuth(false));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTaxIdError(null);

    if (password !== passwordConfirm) {
      setError(
        (d["manufacturer.register.passwordMismatch" as keyof typeof d] as string) ||
          "Şifreler eşleşmiyor"
      );
      return;
    }
    const taxIdTrimmed = taxId.replace(/\D+/g, "");
    if (taxIdTrimmed.length > 0 && taxIdTrimmed.length !== 10 && taxIdTrimmed.length !== 11) {
      setTaxIdError("VKN 10, TCKN 11 hane olmalı");
      return;
    }

    const ibanClean = iban.replace(/\s+/g, "").toUpperCase();
    if (!/^TR\d{24}$/.test(ibanClean)) {
      setError("Geçersiz IBAN (TR ile başlayan 26 karakter olmalı)");
      return;
    }

    if (materials.length === 0) {
      setError("En az bir üretim malzemesi seçmelisiniz");
      return;
    }

    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin");
      return;
    }
    let whatsappE164: string | null = null;
    if (whatsappPhone.trim()) {
      whatsappE164 = phoneInputToE164(waCountry, whatsappPhone);
      if (!whatsappE164) {
        setError("Geçerli bir WhatsApp numarası girin");
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/manufacturer/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactPerson,
          email,
          phone: phoneE164,
          whatsappPhone: whatsappE164,
          taxId: taxIdTrimmed || null,
          password,
          address: {
            adres,
            mahalle: mahalle || undefined,
            ilce,
            il,
            postaKodu,
            telefon: phoneE164,
          },
          iban: ibanClean,
          bankAccountHolder,
          bankName,
          maxConcurrentOrders: Number(maxConcurrentOrders),
          materials,
          onboardingAccepted: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Kayıt başarısız");
        return;
      }
      // No auto-login; account is created with status=pending_approval and the
      // user must wait for admin activation before logging in.
      if (data.pendingApproval) {
        router.push("/manufacturer/login?pending=1");
        return;
      }
      // Backward-compat: in case the server ever short-circuits to active.
      router.push("/manufacturer/login");
    } catch {
      setError("Bir hata oluştu");
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  if (step === "onboarding") {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="text-center mb-6">
            <span className="text-xl font-serif text-gray-900">Figurunica</span>
            <p className="text-sm text-indigo-600 mt-1">Üretici Paneli</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
            <h1 className="text-2xl font-serif text-gray-900 mb-4">
              Başvurudan önce lütfen okuyun
            </h1>
            {/* Scrollable so the long agreement doesn't push the accept box off
                screen. Bold spans render bold + underlined ([&_strong]) so the
                content's `**…**` doubles as the "important clause" marker. */}
            <div
              className="prose prose-sm max-w-none max-h-[60vh] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-4 leading-relaxed text-gray-700 [&_a]:text-indigo-600 [&_blockquote]:border-l-indigo-300 [&_blockquote]:text-gray-500 [&_h1]:text-xl [&_h2]:mt-5 [&_h2]:text-base [&_strong]:font-semibold [&_strong]:text-gray-900 [&_strong]:underline [&_strong]:decoration-indigo-400 [&_strong]:decoration-2 [&_strong]:underline-offset-2"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {MANUFACTURER_ONBOARDING_TR}
              </ReactMarkdown>
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm text-gray-800 select-none">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                Yukarıdaki şartları okudum ve üretici ortaklığını bu şartlar
                altında kabul ediyorum.
              </span>
            </label>
            <div className="mt-6 flex items-center justify-between">
              <Link
                href="/manufacturer/login"
                className="text-sm text-indigo-600 hover:text-indigo-500"
              >
                Hesabım var, giriş yap
              </Link>
              <button
                type="button"
                disabled={!accepted}
                onClick={() => setStep("form")}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Devam et
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-6">
          <span className="text-xl font-serif text-gray-900">Figurunica</span>
          <p className="text-sm text-indigo-600 mt-1">Üretici Paneli</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 space-y-6">
          <h1 className="text-2xl font-serif text-gray-900">Üretici Kaydı</h1>

          {/* Hesap */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Hesap</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Firma Adı *</label>
                <input className={inputCls} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Yetkili Kişi *</label>
                <input className={inputCls} required value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">E-posta *</label>
                <input type="email" className={inputCls} required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Telefon *</label>
                <PhoneInput
                  required
                  country={phoneCountry}
                  nationalNumber={phone}
                  onCountryChange={setPhoneCountry}
                  onNationalNumberChange={setPhone}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp (opsiyonel, admin iletişimi için)</label>
                <PhoneInput
                  country={waCountry}
                  nationalNumber={whatsappPhone}
                  onCountryChange={setWaCountry}
                  onNationalNumberChange={setWhatsappPhone}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Şifre *</label>
                <input type="password" className={inputCls} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Şifre Tekrar *</label>
                <input type="password" className={inputCls} required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* VKN/TCKN */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700">Vergi Numarası</legend>
            <p className="text-xs text-gray-500 mt-1 mb-2">VKN (10 hane) veya TCKN (11 hane). Boş bırakılırsa admin manuel inceleme yapar.</p>
            <input className={inputCls} inputMode="numeric" maxLength={11} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            {taxIdError && <p className="mt-1 text-xs text-red-600">{taxIdError}</p>}
          </fieldset>

          {/* Adres */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Üretim / İş Adresi</legend>
            <p className="text-xs text-gray-500">Lokasyona göre sipariş atamasında kullanılır.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">İl *</label>
                <select className={inputCls} required value={il} onChange={(e) => { setIl(e.target.value); setIlce(""); }}>
                  <option value="">Seçiniz</option>
                  {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">İlçe *</label>
                <select className={inputCls} required disabled={!il} value={ilce} onChange={(e) => setIlce(e.target.value)}>
                  <option value="">Seçiniz</option>
                  {districtOptions.map((dist) => <option key={dist} value={dist}>{dist}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Mahalle</label>
                <input className={inputCls} value={mahalle} onChange={(e) => setMahalle(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Posta Kodu *</label>
                <input className={inputCls} required value={postaKodu} onChange={(e) => setPostaKodu(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Açık Adres *</label>
                <textarea className={inputCls} required rows={2} value={adres} onChange={(e) => setAdres(e.target.value)} />
              </div>
            </div>
          </fieldset>

          {/* Banka */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Banka Bilgileri</legend>
            <p className="text-xs text-gray-500">Üretici ödemeleri bu IBAN&apos;a yapılır.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">IBAN *</label>
                <input className={`${inputCls} font-mono uppercase`} required value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} placeholder="TR12 3456 7890 1234 5678 9012 34" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Hesap Sahibi *</label>
                <input className={inputCls} required value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Banka *</label>
                <input className={inputCls} required value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ör. Garanti BBVA" />
              </div>
            </div>
          </fieldset>

          {/* Kapasite */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700">Kapasite</legend>
            <p className="text-xs text-gray-500 mt-1 mb-2">Aynı anda elinizde tutabileceğiniz maksimum sipariş sayısı.</p>
            <input
              type="number"
              min={1}
              max={50}
              className={`${inputCls} max-w-[140px]`}
              value={maxConcurrentOrders}
              onChange={(e) => setMaxConcurrentOrders(Number(e.target.value) || 1)}
            />
          </fieldset>

          {/* Üretim Malzemeleri */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700">Üretim Malzemeleri *</legend>
            <p className="text-xs text-gray-500 mt-1 mb-2">
              Hangi malzemelerle baskı yapıyorsunuz? Siparişler yalnızca uygun
              malzemeyi basabilen üreticilere atanır. (En az bir seçim)
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "resin", label: "Reçine (Resin)", desc: "Yüksek detay, premium yüzey" },
                { key: "filament", label: "Filament (FDM)", desc: "Ekonomik, dayanıklı baskı" },
              ].map((m) => {
                const active = materials.includes(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleMaterial(m.key)}
                    className={`flex-1 min-w-[160px] text-left rounded-xl border p-3 transition ${
                      active
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 bg-white hover:border-indigo-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">{m.label}</span>
                      <span
                        className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                          active ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                        }`}
                      >
                        {active && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {error && (
            <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm text-center">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={() => setStep("onboarding")} className="text-sm text-gray-500 hover:text-gray-700">
              ← Geri
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors text-sm"
            >
              {loading ? "Kayıt yapılıyor..." : "Kaydı Tamamla"}
            </button>
          </div>

          <p className="text-sm text-center text-gray-500">
            Hesabınız var mı?{" "}
            <Link href="/manufacturer/login" className="text-indigo-600 hover:text-indigo-500 font-semibold">
              Giriş Yap
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
