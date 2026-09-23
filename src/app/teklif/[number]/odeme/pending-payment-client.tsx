"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type JSX } from "react";
import { Card } from "@/components/ui";
import type { PendingQuoteCheckout } from "@/lib/services/quote-checkout";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Bekleyen ödemenin ÇIKIŞ KAPISI.
 *
 * Bu ekran olmadan bekleyen bir taslak teklifi `CARD_DEADLINE_HOURS` boyunca
 * tek yönteme kilitliyordu: sayfa koşulsuz `/pay/<ref>`e yönlendiriyor, uç ise
 * farklı yöntemle gelen isteği reddediyordu (`pending_other_method`).
 * İptal yalnız PayTR ekranı HİÇ açılmamış kart taslağında görünür; kararı
 * sunucu verir (`cancellable`), ekran yalnız çizer.
 */
export function QuotePendingPaymentClient({
  quoteNumber,
  pending,
}: {
  quoteNumber: string;
  pending: PendingQuoteCheckout;
}): JSX.Element {
  const d = useDictionary();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/quotes/${encodeURIComponent(quoteNumber)}/checkout`,
        { method: "DELETE", credentials: "same-origin" }
      );
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error || d["common.error"]);
      // TAM yenileme: sayfanın sunucu tarafı bekleyen ödemeyi yeniden okumalı.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : d["common.error"]);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-xl font-semibold text-text-primary">
        {d["instantQuote.checkout.title"]} · {quoteNumber}
      </h1>

      <Card padding="md">
        <h2 className="text-sm font-semibold text-text-primary">
          {d["instantQuote.pendingPayment.title"]}
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          {pending.paymentMethod === "bank_transfer"
            ? d["instantQuote.pendingPayment.havale"]
            : d["instantQuote.pendingPayment.card"]}
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href={pending.paymentUrl}
            className="rounded-lg bg-text-primary px-4 py-2 text-center text-sm font-medium text-white"
          >
            {d["instantQuote.pendingPayment.continue"]}
          </Link>
          {pending.cancellable && (
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary disabled:opacity-50"
            >
              {busy
                ? d["instantQuote.pendingPayment.cancelling"]
                : d["instantQuote.pendingPayment.cancel"]}
            </button>
          )}
        </div>

        {pending.cancellable && (
          <p className="mt-3 text-xs text-text-muted">
            {d["instantQuote.pendingPayment.cancelHint"]}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <Link
          href={`/teklif/${encodeURIComponent(quoteNumber)}`}
          className="mt-4 inline-block text-sm text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          {d["instantQuote.checkout.backToQuote"]}
        </Link>
      </Card>
    </main>
  );
}
