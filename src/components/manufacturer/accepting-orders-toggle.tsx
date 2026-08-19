"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Faz 6 polish: pause/resume new order assignments. PATCHes the manufacturer
// profile; the assignment scorer already respects `acceptingOrders`.
export function AcceptingOrdersToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/manufacturer/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptingOrders: next }),
      });
      if (!r.ok) {
        // Swallowing this left the button silently snapping back, which reads
        // as "the switch is broken" rather than "the server said no".
        const data = await r.json().catch(() => ({}));
        setError(data.error || "Durum değiştirilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setOn(next);
      router.refresh();
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={saving}
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
          on
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-white" : "bg-gray-500"}`} />
        {on ? "Sipariş alıyorum" : "Sipariş almıyorum"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
