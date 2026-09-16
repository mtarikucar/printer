"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Faz 6: lets a manufacturer request payout of their pending earnings. The
// payout lands in the admin queue to be paid out.
export function PayoutRequestButton({ owedKurus }: { owedKurus: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // Başarısızlık SESSİZ kalmasın: uç yalnız `r.ok` ile okunuyordu, yani hesap
  // askıya alındığında ya da hakediş arada partilenmiş olduğunda düğme hiçbir
  // şey söylemeden eski hâline dönüyordu. Boyacı düğmesinin aynası.
  const [error, setError] = useState<string | null>(null);

  if (owedKurus <= 0) return null;

  const request = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/manufacturer/payout-request", { method: "POST" });
      if (r.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const d = await r.json().catch(() => ({}));
      setError(
        typeof d.message === "string" && d.message
          ? d.message
          : "Talep oluşturulamadı. Lütfen tekrar deneyin."
      );
    } catch {
      setError("Talep oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return <p className="text-sm font-medium text-emerald-600">Ödeme talebin alındı.</p>;
  }
  return (
    <div>
      <button
        onClick={request}
        disabled={loading}
        className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
      >
        {loading ? "…" : "Ödeme talep et"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
