"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";

export default function LoginPage() {
  const router = useRouter();
  const d = useDictionary();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

      router.push("/account");
    } catch {
      setError(d["common.error"]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-surface-50">
      <SiteHeader />

      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Decorative panel (desktop) */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden" style={{ background: "var(--gradient-cta)" }}>
          <div className="absolute top-20 left-10 w-64 h-64 rounded-full bg-white/10" />
          <div className="absolute bottom-20 right-10 w-48 h-48 rounded-full bg-white/5" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 rotate-45 border-2 border-white/10 rounded-2xl" />
          <div className="relative z-10 flex flex-col items-center justify-center w-full px-12 text-white">
            <svg className="w-20 h-20 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
            <h2 className="mt-6 text-3xl font-bold">Figurine Studio</h2>
            <p className="mt-3 text-lg text-white/70 text-center max-w-sm">
              {d["landing.hero.subtitle"]}
            </p>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="w-full max-w-sm">
            {/* Brand icon (visible on all screens) */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2">
                <svg className="w-8 h-8 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                </svg>
                <span className="text-xl font-bold text-gray-900">Figurine Studio</span>
              </div>
            </div>

            <div className="card shadow-elevated p-8 sm:p-10">
              <h1 className="text-2xl font-bold text-gray-900 text-center">
                {d["login.title"]}
              </h1>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
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
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
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
                  <div className="bg-error-50 text-error-500 rounded-xl p-3 text-sm text-center flex items-center justify-center gap-2">
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

              <p className="mt-6 text-sm text-center text-gray-500">
                {d["login.noAccount"]}{" "}
                <Link href="/register" className="text-primary-600 hover:text-primary-800 font-semibold">
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
