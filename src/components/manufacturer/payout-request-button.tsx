"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Faz 6: lets a manufacturer request payout of their pending earnings. The
// payout lands in the admin queue to be paid out.
export function PayoutRequestButton({ owedKurus }: { owedKurus: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (owedKurus <= 0) return null;

  const request = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/manufacturer/payout-request", { method: "POST" });
      if (r.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return <p className="text-sm font-medium text-emerald-600">Ödeme talebin alındı.</p>;
  }
  return (
    <button
      onClick={request}
      disabled={loading}
      className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
    >
      {loading ? "…" : "Ödeme talep et"}
    </button>
  );
}
