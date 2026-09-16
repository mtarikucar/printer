"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Boyacı, bekleyen (henüz bir ödemeye girmemiş) hakedişlerini tek bir ödeme
// talebinde toplar (/api/painter/payout-request). Talep admin'in
// /admin/payouts → Boyacılar kuyruğuna "Boyacı talebi" olarak düşer; transfer
// yapılınca admin "Ödendi" işaretler. Uç vardı ama çağıran bir ekran yoktu.
export function PainterPayoutRequestButton({
  owedKurus,
  hasIban,
}: {
  owedKurus: number;
  hasIban: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (owedKurus <= 0) return null;

  // IBAN'sız bir talep admin kuyruğunda ödenemez hâlde bekler; önce IBAN.
  if (!hasIban) {
    return (
      <p className="text-sm text-amber-800">
        Ödeme talep etmek için önce{" "}
        <Link href="/painter/profile" className="font-medium underline">
          profilinize IBAN ekleyin
        </Link>
        .
      </p>
    );
  }

  const request = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/painter/payout-request", { method: "POST" });
      if (r.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      const d = await r.json().catch(() => ({}));
      // Sunucunun Türkçe mesajı varsa o gösterilir (401/403 de dahil); kod
      // eşleştirmesi yalnızca mesajsız eski yanıtlar için yedektir.
      setError(
        typeof d.message === "string" && d.message
          ? d.message
          : d.error === "nothing_owed"
            ? "Talep edilecek bekleyen kazanç yok."
            : "Talep oluşturulamadı. Lütfen tekrar deneyin."
      );
    } catch {
      setError("Talep oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return <p className="text-sm font-medium text-emerald-600">Ödeme talebiniz alındı.</p>;
  }
  return (
    <div>
      <button
        type="button"
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
