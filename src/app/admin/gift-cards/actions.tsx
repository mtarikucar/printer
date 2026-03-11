"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdminGiftCardActions({ cardId }: { cardId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/gift-cards/${cardId}/confirm`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Confirmation failed");
      }
    } catch {
      setError("Confirmation failed");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleConfirm}
        disabled={confirming}
        className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {confirming ? "..." : "Confirm"}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
