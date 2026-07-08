"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function PainterLoginPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  // Set by /painter/register after a successful registration that's pending
  // admin approval. The user just submitted the form but cannot log in until
  // activation, so we show a friendly banner instead of silently letting them
  // try (and fail) to log in.
  const justRegisteredPending = searchParams.get("pending") === "1";

  // Redirect if already logged in. Full navigation, not router.replace: the
  // painter layout renders without the sidebar shell for guest pages, and a
  // client-side navigation would keep that bare layout mounted.
  useEffect(() => {
    fetch("/api/painter/auth/me")
      .then((res) => {
        if (res.ok) {
          window.location.replace("/painter/dashboard");
        } else {
          setCheckingAuth(false);
        }
      })
      .catch(() => setCheckingAuth(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/painter/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Giriş başarısız");
        return;
      }

      window.location.assign("/painter/dashboard");
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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-full max-w-sm px-4">
          <div className="text-center mb-6">
            <span className="text-xl font-serif text-gray-900">Figurunica</span>
            <p className="text-sm text-indigo-600 mt-1">Boyama Paneli</p>
          </div>
          {justRegisteredPending && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Kaydınız alındı 🎉</p>
              <p className="mt-1">
                Hesabınız admin onayı bekliyor. Onaylandığında e-posta ile
                bilgilendirileceksiniz; ardından giriş yapabilirsiniz.
              </p>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 p-6 sm:p-8">
            <h1 className="text-2xl font-serif text-gray-900 text-center">
              Boyacı Girişi
            </h1>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  E-posta
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="boyaci@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Şifre
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              {error && (
                <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm text-center flex items-center justify-center gap-2">
                  <svg
                    className="w-4 h-4 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-4 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors text-sm"
              >
                {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
              </button>
            </form>
          </div>
          <p className="mt-6 text-sm text-center text-gray-500">
            Hesabınız yok mu?{" "}
            <Link
              href="/painter/register"
              className="text-indigo-600 hover:text-indigo-500 font-semibold"
            >
              Kayıt Ol
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
