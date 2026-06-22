"use client";

import { useState } from "react";

/**
 * Mints a fresh PayTR token for this draft then redirects to PayTR's hosted
 * payment page. Minting happens on click (not render) so re-opening the link
 * never burns a merchant_oid, and so PayTR sees the payer's real IP.
 */
export function PayCardButton({ reference }: { reference: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${reference}/paytr`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.iframeUrl) {
        throw new Error(data.error || "Ödeme başlatılamadı, lütfen tekrar deneyin.");
      }
      window.location.href = data.iframeUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bir hata oluştu.");
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={pay}
        disabled={loading}
        className="w-full rounded-full bg-green-600 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
      >
        {loading ? "Ödeme sayfasına yönlendiriliyor…" : "Kart ile Öde"}
      </button>
      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
