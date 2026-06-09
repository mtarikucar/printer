"use client";

import { useState } from "react";

// Faz 6 polish: pause/resume new order assignments. PATCHes the manufacturer
// profile; the assignment scorer already respects `acceptingOrders`.
export function AcceptingOrdersToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    try {
      const r = await fetch("/api/manufacturer/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptingOrders: next }),
      });
      if (r.ok) setOn(next);
    } finally {
      setSaving(false);
    }
  };

  return (
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
  );
}
