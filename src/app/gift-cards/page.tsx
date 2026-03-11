"use client";

import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { GIFT_CARD_DENOMINATIONS_KURUS, GIFT_CARD_THEMES } from "@/lib/config/prices";

type Theme = (typeof GIFT_CARD_THEMES)[number];

const THEME_COLORS: Record<Theme, string> = {
  ramazan: "from-emerald-500 to-teal-600",
  dogum_gunu: "from-pink-500 to-rose-600",
  yeni_yil: "from-blue-500 to-indigo-600",
  sevgililer_gunu: "from-red-500 to-pink-600",
  genel: "from-green-500 to-emerald-600",
};

export default function GiftCardsPage() {
  const d = useDictionary();
  const [theme, setTheme] = useState<Theme>("genel");
  const [amountKurus, setAmountKurus] = useState<number>(GIFT_CARD_DENOMINATIONS_KURUS[0]);
  const [forSelf, setForSelf] = useState(true);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientMessage, setRecipientMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ code: string; whatsappUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          amountKurus,
          recipientEmail: forSelf ? undefined : recipientEmail,
          recipientName: forSelf ? undefined : recipientName,
          recipientMessage: forSelf ? undefined : recipientMessage,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          Array.isArray(data.error) ? data.error[0]?.message : data.error
        );
      }

      const data = await res.json();
      setSuccess({ code: data.code, whatsappUrl: data.whatsappUrl });
      window.open(data.whatsappUrl, "_blank");
    } catch (err: any) {
      setError(err.message || d["common.error"]);
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = () => {
    if (success?.code) {
      navigator.clipboard.writeText(success.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-lg mx-auto px-4 py-20">
          <div className="card shadow-elevated overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-success to-green-500" />
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
                <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
              </div>
              <h1 className="text-2xl font-serif text-text-primary mb-2">{d["giftCard.success.title"]}</h1>
              <p className="text-text-secondary mb-4">{d["giftCard.success.message"]}</p>
              <div className="bg-bg-elevated rounded-xl p-4 mb-6">
                <p className="text-xs text-text-muted mb-1">{d["giftCard.success.code"]}</p>
                <p className="text-2xl font-mono font-bold text-text-primary tracking-wider">{success.code}</p>
              </div>
              <div className="space-y-3">
                <button onClick={copyCode} className="btn-secondary w-full">
                  {copied ? d["giftCard.success.copied"] : d["giftCard.success.copy"]}
                </button>
                <a href={success.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full inline-flex items-center justify-center gap-2">
                  {d["giftCard.success.resend"]}
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-serif text-text-primary animate-fade-in-up">{d["giftCard.title"]}</h1>
          <p className="mt-2 text-text-secondary animate-fade-in-up delay-100">{d["giftCard.subtitle"]}</p>
        </div>

        <div className="space-y-8">
          {/* Theme Selection */}
          <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-200">
            <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
            <div className="p-6">
              <h2 className="text-lg font-serif text-text-primary mb-4">{d["giftCard.selectTheme"]}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {GIFT_CARD_THEMES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`relative rounded-xl p-4 text-center transition-all ${
                      theme === t
                        ? "ring-2 ring-green-500 shadow-sm"
                        : "hover:shadow-sm"
                    }`}
                  >
                    <div className={`w-full h-16 rounded-lg bg-gradient-to-br ${THEME_COLORS[t]} mb-2`} />
                    <span className="text-sm font-medium text-text-primary">
                      {d[`giftCard.theme.${t}` as keyof typeof d] || t}
                    </span>
                    {theme === t && (
                      <div className="absolute top-2 right-2 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Amount Selection */}
          <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-300">
            <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
            <div className="p-6">
              <h2 className="text-lg font-serif text-text-primary mb-4">{d["giftCard.selectAmount"]}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {GIFT_CARD_DENOMINATIONS_KURUS.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setAmountKurus(amount)}
                    className={`card p-4 text-center transition-all ${
                      amountKurus === amount
                        ? "border-2 border-green-500 bg-green-500/5"
                        : "border-2 border-transparent hover:border-bg-subtle"
                    }`}
                  >
                    <span className="text-xl font-mono font-bold text-green-500">
                      ₺{(amount / 100).toLocaleString("tr-TR")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Recipient */}
          <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-400">
            <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
            <div className="p-6">
              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setForSelf(true)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    forSelf ? "bg-green-500 text-white" : "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {d["giftCard.recipientToggle.self"]}
                </button>
                <button
                  onClick={() => setForSelf(false)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    !forSelf ? "bg-green-500 text-white" : "bg-bg-elevated text-text-secondary"
                  }`}
                >
                  {d["giftCard.recipientToggle.other"]}
                </button>
              </div>

              {!forSelf && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["giftCard.recipientName"]}</label>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="input-base"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["giftCard.recipientEmail"]}</label>
                    <input
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="input-base"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["giftCard.recipientMessage"]}</label>
                    <textarea
                      value={recipientMessage}
                      onChange={(e) => setRecipientMessage(e.target.value)}
                      maxLength={500}
                      rows={3}
                      className="input-base resize-none"
                      placeholder={d["giftCard.recipientMessage.placeholder"]}
                    />
                    <p className="text-xs text-text-muted mt-1 text-right">{recipientMessage.length}/500</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-error-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-error-700">{error}</p>
            </div>
          )}

          {/* Summary */}
          <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-500">
            <div className="p-6 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-text-secondary">{d["giftCard.summary"]}</span>
                <span className="ml-2 text-sm text-text-muted">
                  {d[`giftCard.theme.${theme}` as keyof typeof d] || theme}
                </span>
              </div>
              <span className="text-2xl font-mono font-bold text-green-500">
                ₺{(amountKurus / 100).toLocaleString("tr-TR")}
              </span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn-primary w-full text-lg !py-3.5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            {submitting ? d["giftCard.submitting"] : d["giftCard.submitButton"]}
          </button>
        </div>
      </div>
    </main>
  );
}
