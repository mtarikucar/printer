"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const d = useDictionary();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Redirect if already logged in
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (res.ok) {
          router.replace(redirect || "/account");
        } else {
          setCheckingAuth(false);
        }
      })
      .catch(() => setCheckingAuth(false));
  }, [router, redirect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || d["login.failed"]);
        return;
      }

      router.push(redirect || "/account");
    } catch {
      setError(d["common.error"]);
    } finally {
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  const registerHref = redirect
    ? `/register?redirect=${encodeURIComponent(redirect)}`
    : "/register";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Decorative panel (desktop) */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-bg-muted">
          <div className="absolute inset-0 bg-gradient-to-b from-bg-muted/40 to-bg-base/80" />
          <div className="relative z-10 flex flex-col items-center justify-center w-full px-12 text-text-primary">
            <h2 className="text-4xl font-serif">Figurine Studio</h2>
            <p className="mt-3 text-lg text-text-secondary text-center max-w-sm">
              {d["landing.hero.subtitle"]}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="w-full max-w-sm">
            {/* Brand icon (visible on all screens) */}
            <div className="text-center mb-8">
              <span className="text-xl font-serif text-text-primary">Figurine Studio</span>
            </div>

            <div className="card shadow-elevated p-8 sm:p-10">
              <h1 className="text-2xl font-serif text-text-primary text-center">
                {d["login.title"]}
              </h1>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    {d["common.email"]}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-base"
                    placeholder={d["login.placeholder.email"]}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    {d["common.password"]}
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-base"
                  />
                </div>

                {error && (
                  <div className="bg-error-50 text-error rounded-xl p-3 text-sm text-center flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full !block text-center"
                >
                  {loading ? d["login.submitting"] : d["login.submit"]}
                </button>
              </form>

              <p className="mt-6 text-sm text-center text-text-muted">
                {d["login.noAccount"]}{" "}
                <Link href={registerHref} className="text-green-500 hover:text-green-400 font-semibold">
                  {d["login.register"]}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
