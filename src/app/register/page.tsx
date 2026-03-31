"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { useDictionary } from "@/lib/i18n/locale-context";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const d = useDictionary();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
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
    setError(null);

    if (password !== passwordConfirm) {
      setError(d["register.passwordMismatch"]);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, phone, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || d["register.failed"]);
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

  const loginHref = redirect
    ? `/login?redirect=${encodeURIComponent(redirect)}`
    : "/login";

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
        <div className="w-full max-w-sm px-4">
          <div className="text-center mb-6">
            <span className="text-xl font-serif text-text-primary">Figurine Studio</span>
          </div>
          <div className="card p-8">
            <h1 className="text-2xl font-serif text-text-primary text-center">
              {d["register.title"]}
            </h1>
            <div className="mt-6">
              <GoogleSignInButton label={d["register.google"]} redirect={redirect || undefined} />
            </div>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-bg-subtle" />
              <span className="text-xs text-text-muted uppercase">{d["register.orEmail"]}</span>
              <div className="flex-1 h-px bg-bg-subtle" />
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["register.fullName"]}</label>
                <input type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-base" placeholder={d["register.placeholder.fullName"]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["common.email"]}</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="input-base" placeholder={d["login.placeholder.email"]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["common.phone"]}</label>
                <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} className="input-base" placeholder={d["register.placeholder.phone"]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["common.password"]}</label>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="input-base" placeholder={d["register.placeholder.password"]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["register.passwordConfirm"]}</label>
                <input type="password" required value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} className="input-base" />
              </div>
              {error && (
                <div className="bg-error-50 text-error rounded-xl p-3 text-sm text-center flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading} className="btn-primary w-full !block text-center">
                {loading ? d["register.submitting"] : d["register.submit"]}
              </button>
            </form>
          </div>
          <p className="mt-6 text-sm text-center text-text-muted">
            {d["register.hasAccount"]}{" "}
            <Link href={loginHref} className="text-green-500 hover:text-green-400 font-semibold">
              {d["register.login"]}
            </Link>
          </p>
          <p className="mt-4 text-xs text-center text-text-muted">
            <Link href="/privacy" className="hover:text-green-500 transition-colors">{d["landing.footer.privacy"]}</Link>
            {" · "}
            <Link href="/terms" className="hover:text-green-500 transition-colors">{d["landing.footer.terms"]}</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
