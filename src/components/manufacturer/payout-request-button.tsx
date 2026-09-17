"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Faz 6: lets a manufacturer request payout of their pending earnings. The
// payout lands in the admin queue to be paid out.
export function PayoutRequestButton({ owedKurus, hasClaimable = owedKurus > 0 }: { owedKurus: number; hasClaimable?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  // Başarısızlık SESSİZ kalmasın: uç yalnız `r.ok` ile okunuyordu, yani hesap
  // askıya alındığında ya da hakediş arada partilenmiş olduğunda düğme hiçbir
  // şey söylemeden eski hâline dönüyordu. Boyacı düğmesinin aynası.
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <p className="text-sm font-medium text-emerald-600">{done}</p>;
  }
  if (!hasClaimable) return null;

  const request = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/manufacturer/payout-request", { method: "POST" });
      if (r.ok) {
        const outcome = await r.json().catch(() => null);
        setDone(outcome?.message || "Talebiniz yönetici kuyruğuna alındı.");
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


  return (
    <div>
      <button
        onClick={request}
        disabled={loading}
        className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
      >
        {loading ? "…" : owedKurus === 0 ? "Mahsup talep et" : "Ödeme talep et"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
