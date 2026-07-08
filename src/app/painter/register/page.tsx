"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";

type Step = "onboarding" | "form";

// Painting-technique capability tags. Optional at signup; drives which painting
// jobs get routed to this atölye. Values are stored as capabilities: string[].
const CAPABILITY_OPTIONS: { key: string; label: string; desc: string }[] = [
  { key: "hand", label: "El fırçası", desc: "Klasik fırça ile boyama" },
  { key: "airbrush", label: "Havalı fırça (Airbrush)", desc: "Pürüzsüz geçişler, degrade" },
  { key: "detail", label: "İnce detay", desc: "Yüz, göz, ince desen boyama" },
  { key: "priming", label: "Astarlama", desc: "Yüzey hazırlık / primer" },
  { key: "sealing", label: "Vernik / Koruma", desc: "Mat/parlak koruyucu kaplama" },
];

export default function PainterRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("onboarding");
  const [accepted, setAccepted] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Account
  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // Address (location-based job routing).
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");

  // Painting techniques (capabilities). Optional.
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const toggleCapability = (key: string) =>
    setCapabilities((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const districtOptions = useMemo(() => (il ? DISTRICTS[il] ?? [] : []), [il]);

  useEffect(() => {
    fetch("/api/painter/auth/me")
      .then((res) => {
        if (res.ok) {
          router.replace("/painter/dashboard");
        } else {
          setCheckingAuth(false);
        }
      })
      .catch(() => setCheckingAuth(false));
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError("Şifreler eşleşmiyor");
      return;
    }

    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/painter/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactPerson,
          email,
          phone: phoneE164,
          password,
          address: {
            il,
            ilce,
            telefon: phoneE164,
          },
          capabilities,
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
      router.push("/painter/login?pending=1");
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
            <p className="text-sm text-indigo-600 mt-1">Boyama Paneli</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
            <h1 className="text-2xl font-serif text-gray-900 mb-4">
              Başvurudan önce lütfen okuyun
            </h1>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/50 p-4 leading-relaxed text-sm text-gray-700 space-y-4">
              <p>
                Figurunica boyama ortağı olarak, üreticiden gelen baskıları
                boyar ve tamamlanan figürü doğrudan müşteriye kargolarsınız. İş
                akışı: <strong className="font-semibold text-gray-900">atandı → kabul → boyama → boyandı → kargo</strong>.
              </p>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  Size atanan işleri panelinizden kabul eder, boyar ve
                  müşteriye gönderirsiniz. Kabul ettiğiniz işi zamanında
                  tamamlamak sizin sorumluluğunuzdadır.
                </li>
                <li>
                  Boyama ücreti sipariş başına belirlenir ve iş tamamlanıp
                  kargolandığında hak edişinize eklenir; ödemeler kayıtlı
                  IBAN&apos;ınıza yapılır.
                </li>
                <li>
                  Referans görselinden belirgin sapma, gecikme veya kalite
                  sorunları uyarı (strike) doğurabilir; tekrarı hesabın askıya
                  alınmasına yol açabilir.
                </li>
                <li>
                  Hesabınız, başvurunuz admin tarafından onaylanana kadar iş
                  alamaz. Onay için geçmiş çalışma örneği istenebilir.
                </li>
              </ul>
              <p>
                Devam ederek bu şartlar altında Figurunica boyama ortaklığını
                kabul etmiş olursunuz.
              </p>
            </div>
            <label className="mt-6 flex items-start gap-3 text-sm text-gray-800 select-none">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span>
                Yukarıdaki şartları okudum ve boyama ortaklığını bu şartlar
                altında kabul ediyorum.
              </span>
            </label>
            <div className="mt-6 flex items-center justify-between">
              <Link
                href="/painter/login"
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
          <p className="text-sm text-indigo-600 mt-1">Boyama Paneli</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8 space-y-6"
        >
          <h1 className="text-2xl font-serif text-gray-900">Boyacı Kaydı</h1>

          {/* Hesap */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Hesap</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Atölye / Boyacı Adı *
                </label>
                <input
                  className={inputCls}
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Yetkili Kişi *
                </label>
                <input
                  className={inputCls}
                  required
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  E-posta *
                </label>
                <input
                  type="email"
                  className={inputCls}
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Telefon *
                </label>
                <PhoneInput
                  required
                  country={phoneCountry}
                  nationalNumber={phone}
                  onCountryChange={setPhoneCountry}
                  onNationalNumberChange={setPhone}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Şifre *
                </label>
                <input
                  type="password"
                  className={inputCls}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Şifre Tekrar *
                </label>
                <input
                  type="password"
                  className={inputCls}
                  required
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {/* Konum */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-gray-700">Konum</legend>
            <p className="text-xs text-gray-500">
              Lokasyona göre iş atamasında kullanılır.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  İl *
                </label>
                <select
                  className={inputCls}
                  required
                  value={il}
                  onChange={(e) => {
                    setIl(e.target.value);
                    setIlce("");
                  }}
                >
                  <option value="">Seçiniz</option>
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  İlçe *
                </label>
                <select
                  className={inputCls}
                  required
                  disabled={!il}
                  value={ilce}
                  onChange={(e) => setIlce(e.target.value)}
                >
                  <option value="">Seçiniz</option>
                  {districtOptions.map((dist) => (
                    <option key={dist} value={dist}>
                      {dist}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          {/* Boyama Teknikleri */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-700">
              Boyama Teknikleri
            </legend>
            <p className="text-xs text-gray-500 mt-1 mb-2">
              Hangi tekniklerde çalışıyorsunuz? (Opsiyonel — sonradan
              profilinizden güncelleyebilirsiniz.)
            </p>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_OPTIONS.map((c) => {
                const active = capabilities.includes(c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleCapability(c.key)}
                    className={`flex-1 min-w-[160px] text-left rounded-xl border p-3 transition ${
                      active
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 bg-white hover:border-indigo-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {c.label}
                      </span>
                      <span
                        className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                          active
                            ? "bg-indigo-600 border-indigo-600"
                            : "border-gray-300"
                        }`}
                      >
                        {active && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={3}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
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
            <button
              type="button"
              onClick={() => setStep("onboarding")}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
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
            <Link
              href="/painter/login"
              className="text-indigo-600 hover:text-indigo-500 font-semibold"
            >
              Giriş Yap
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
