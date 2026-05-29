"use client";

import { useState } from "react";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

interface Invoice {
  invoiceNumber: string;
  subtotalKurus: number;
  kdvKurus: number;
  totalKurus: number;
}

// Lazily fetches (creating on first view) the KDV invoice for the customer's
// paid order, then renders the breakdown inline.
export function OrderInvoice({ orderNumber }: { orderNumber: string }) {
  const d = useDictionary();
  const loc = useLocale() as Locale;
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/customer/orders/${encodeURIComponent(orderNumber)}/invoice`
      );
      if (res.ok) setInvoice(await res.json());
    } finally {
      setLoading(false);
    }
  };

  if (!invoice) {
    return (
      <button
        onClick={load}
        disabled={loading}
        className="text-sm text-green-600 hover:text-green-700 font-medium disabled:text-gray-400"
      >
        {loading ? "…" : d["track.invoice.button"]}
      </button>
    );
  }

  return (
    <div className="text-sm text-text-secondary">
      <p className="font-medium text-text-primary mb-2">{d["track.invoice.title"]}</p>
      <div className="space-y-1">
        <div className="flex justify-between">
          <span>{d["track.invoice.number"]}</span>
          <span className="font-mono">{invoice.invoiceNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>{d["track.invoice.subtotal"]}</span>
          <span>{formatCurrency(invoice.subtotalKurus, loc)}</span>
        </div>
        <div className="flex justify-between">
          <span>{d["track.invoice.kdv"]}</span>
          <span>{formatCurrency(invoice.kdvKurus, loc)}</span>
        </div>
        <div className="flex justify-between font-semibold text-text-primary border-t border-bg-subtle pt-1 mt-1">
          <span>{d["track.invoice.total"]}</span>
          <span>{formatCurrency(invoice.totalKurus, loc)}</span>
        </div>
      </div>
    </div>
  );
}
