"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";

export default function ManufacturerLoginPage() {
  const router = useRouter();
  const d = useDictionary();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/manufacturer/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(
          data.error ||
            (d["manufacturer.login.failed" as keyof typeof d] as string) ||
            "Login failed"
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
      <div className="flex items-center justify-center min-h-screen">
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
              {(d["manufacturer.login.title" as keyof typeof d] as string) ||
                "Manufacturer Login"}
            </h1>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
                    (d[
                      "manufacturer.login.placeholder.email" as keyof typeof d
                    ] as string) || "manufacturer@example.com"
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
                {loading
                  ? (d[
                      "manufacturer.login.submitting" as keyof typeof d
                    ] as string) || "Signing in..."
                  : (d[
                      "manufacturer.login.submit" as keyof typeof d
                    ] as string) || "Sign In"}
              </button>
            </form>
          </div>
          <p className="mt-6 text-sm text-center text-gray-500">
            {(d[
              "manufacturer.login.noAccount" as keyof typeof d
            ] as string) || "Don't have an account?"}{" "}
            <Link
              href="/manufacturer/register"
              className="text-indigo-600 hover:text-indigo-500 font-semibold"
            >
              {(d[
                "manufacturer.login.register" as keyof typeof d
              ] as string) || "Register"}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
