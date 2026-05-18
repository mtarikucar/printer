"use client";

import { useState, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Card, Input, FormField } from "@/components/ui";

export default function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const d = useDictionary();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError(d["auth.reset.minLength"]);
      return;
    }
    if (password !== confirm) {
      setError(d["auth.reset.mismatch"]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || d["common.error"]);
        return;
      }
      setSuccess(true);
      // Brief delay so the user reads the success state, then send to login.
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError(d["common.error"]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-md mx-auto px-4 py-16">
        <Card padding="lg" elevated className="overflow-hidden">
          <h1 className="text-2xl font-serif text-text-primary mb-2">
            {d["auth.reset.title"]}
          </h1>
          {success ? (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-green-700 bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                {d["auth.reset.successBody"]}
              </p>
              <Button href="/login" size="sm">
                {d["auth.reset.goToLogin"]}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary mb-6">
                {d["auth.reset.subtitle"]}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <FormField label={d["auth.reset.newPassword"]} required>
                  <Input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <FormField label={d["auth.reset.confirmPassword"]} required>
                  <Input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </FormField>
                {error && <p className="text-sm text-error">{error}</p>}
                <Button
                  type="submit"
                  disabled={!password || !confirm}
                  loading={loading}
                  fullWidth
                >
                  {loading ? d["common.loading"] : d["auth.reset.submit"]}
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
