"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

export default function ManufacturerRegisterPage() {
  const router = useRouter();
  const d = useDictionary();
  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Redirect if already logged in
  useEffect(() => {
    fetch("/api/manufacturer/auth/me")
      .then((res) => {
        if (res.ok) {
          router.replace("/manufacturer/dashboard");
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
      setError(
        (d["manufacturer.register.passwordMismatch" as keyof typeof d] as string) ||
          "Passwords do not match"
      );
      return;
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
          phone,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            (d["manufacturer.register.failed" as keyof typeof d] as string) ||
            "Registration failed"
        );
        return;
      }

      router.push("/manufacturer/dashboard");
    } catch {
      setError(
        (d["common.error" as keyof typeof d] as string) ||
          "An error occurred"
      );
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
      <div className="flex items-center justify-center min-h-screen py-12">
        <div className="w-full max-w-sm px-4">
          <div className="text-center mb-6">
            <span className="text-xl font-serif text-gray-900">
              Figurine Studio
            </span>
            <p className="text-sm text-indigo-600 mt-1">
              {(d["manufacturer.nav.panel" as keyof typeof d] as string) ||
                "Manufacturer Panel"}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-8">
            <h1 className="text-2xl font-serif text-gray-900 text-center">
              {(d["manufacturer.register.title" as keyof typeof d] as string) ||
                "Manufacturer Registration"}
            </h1>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["manufacturer.register.companyName" as keyof typeof d] as string) ||
                    "Company Name"}
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={
                    (d["manufacturer.register.placeholder.companyName" as keyof typeof d] as string) ||
                    "Acme Manufacturing Ltd."
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["manufacturer.register.contactPerson" as keyof typeof d] as string) ||
                    "Contact Person"}
                </label>
                <input
                  type="text"
                  required
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={
                    (d["manufacturer.register.placeholder.contactPerson" as keyof typeof d] as string) ||
                    "Full Name"
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["common.email" as keyof typeof d] as string) || "Email"}
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={
                    (d["manufacturer.register.placeholder.email" as keyof typeof d] as string) ||
                    "manufacturer@example.com"
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["common.phone" as keyof typeof d] as string) || "Phone"}
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={
                    (d["manufacturer.register.placeholder.phone" as keyof typeof d] as string) ||
                    "05XX XXX XXXX"
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["common.password" as keyof typeof d] as string) ||
                    "Password"}
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={
                    (d["manufacturer.register.placeholder.password" as keyof typeof d] as string) ||
                    "Min 6 characters"
                  }
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {(d["manufacturer.register.passwordConfirm" as keyof typeof d] as string) ||
                    "Confirm Password"}
                </label>
                <input
                  type="password"
                  required
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
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
                {loading
                  ? (d["manufacturer.register.submitting" as keyof typeof d] as string) ||
                    "Registering..."
                  : (d["manufacturer.register.submit" as keyof typeof d] as string) ||
                    "Register"}
              </button>
            </form>
          </div>
          <p className="mt-6 text-sm text-center text-gray-500">
            {(d["manufacturer.register.hasAccount" as keyof typeof d] as string) ||
              "Already have an account?"}{" "}
            <Link
              href="/manufacturer/login"
              className="text-indigo-600 hover:text-indigo-500 font-semibold"
            >
              {(d["manufacturer.register.login" as keyof typeof d] as string) ||
                "Sign In"}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
