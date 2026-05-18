"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Card, Input, FormField } from "@/components/ui";

export default function ForgotPasswordPage() {
  const d = useDictionary();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || d["common.error"]);
        return;
      }
      // Server always returns `{ sent: true }` whether or not the email is
      // registered (anti-enumeration). Show the same confirmation either way.
      setSubmitted(true);
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
            {d["auth.forgot.title"]}
          </h1>
          {submitted ? (
            <div className="space-y-4 mt-4">
              <p className="text-sm text-text-secondary">
                {d["auth.forgot.sentBody"]}
              </p>
              <Button href="/login" variant="secondary" size="sm">
                {d["auth.forgot.backToLogin"]}
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-text-secondary mb-6">
                {d["auth.forgot.subtitle"]}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <FormField label={d["common.email"]} required>
                  <Input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ornek@email.com"
                  />
                </FormField>
                {error && <p className="text-sm text-error">{error}</p>}
                <Button type="submit" disabled={!email} loading={loading} fullWidth>
                  {loading ? d["common.loading"] : d["auth.forgot.submit"]}
                </Button>
                <p className="text-center text-sm">
                  <Link href="/login" className="text-text-muted hover:text-text-primary underline">
                    {d["auth.forgot.backToLogin"]}
                  </Link>
                </p>
              </form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
