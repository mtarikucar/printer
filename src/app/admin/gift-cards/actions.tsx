"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

interface Props {
  cardId: string;
  code: string;
  status: string;
  d: Dictionary;
}

export function AdminGiftCardActions({ cardId, code, status, d }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeactivate = async () => {
    setDeactivating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gift-cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cardId, action: "deactivate" }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(d["common.error"]);
      }
    } catch {
      setError(d["common.error"]);
    } finally {
      setDeactivating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={copyCode}
        className="px-2 py-1 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
      >
        {copied ? d["admin.giftCards.copied"] : d["admin.giftCards.copyCode"]}
      </button>
      {(status === "active" || status === "partially_used") && (
        <button
          onClick={handleDeactivate}
          disabled={deactivating}
          className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 rounded hover:bg-red-100 disabled:opacity-50"
        >
          {d["admin.giftCards.deactivate"]}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
