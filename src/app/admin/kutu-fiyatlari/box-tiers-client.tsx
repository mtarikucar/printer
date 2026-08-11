"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ABSOLUTE_MAX_LINE_QTY,
  BOX_QUANTITY_STEP,
  MAX_TIERS_PER_PRODUCT,
  type PriceTierConfig,
} from "@/lib/config/bulk";

interface Row {
  minQuantity: string;
  unitPriceTry: string;
}

const tl = (kurus: number) => (kurus / 100).toString();
const toKurus = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 100);

export function BoxTiersClient({
  initialTiers,
  eligible,
}: {
  initialTiers: PriceTierConfig[];
  eligible: Array<{ id: string; title: string; priceKurus: number }>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    initialTiers.map((t) => ({
      minQuantity: String(t.minQuantity),
      unitPriceTry: tl(t.unitPriceKurus),
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const cheapest = eligible[0] ?? null;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/admin/box-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiers: rows
            .filter((t) => t.minQuantity.trim() && t.unitPriceTry.trim())
            .map((t) => ({
              minQuantity: Number(t.minQuantity),
              unitPriceKurus: toKurus(t.unitPriceTry),
            })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || "Kaydedilemedi");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const sorted = [...rows]
    .map((r) => ({ qty: Number(r.minQuantity), kurus: toKurus(r.unitPriceTry) }))
    .filter((r) => r.qty > 0)
    .sort((a, b) => a.qty - b.qty);
  const minimum = sorted[0]?.qty ?? 0;

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Kutu fiyat kademeleri
          </h2>
          {minimum > 0 && (
            <span className="text-xs text-gray-500">
              Kutu alt sınırı: {minimum} adet
            </span>
          )}
        </div>

        <p className="mt-1 text-xs text-gray-500">
          Adetler {BOX_QUANTITY_STEP}&apos;un katı olmalı (müşteri de{" "}
          {BOX_QUANTITY_STEP}&apos;ar seçiyor). Adet arttıkça birim fiyat düşmeli.
          {cheapest && (
            <>
              {" "}
              Kutu fiyatı, kutuya uygun en ucuz ürünün (
              <strong>{cheapest.title}</strong> — ₺{tl(cheapest.priceKurus)})
              altında kalmalı; aksi halde kutu tek tek almaktan pahalıya gelir.
            </>
          )}
        </p>

        <div className="mt-4 space-y-2">
          {rows.length === 0 && (
            <p className="text-sm text-gray-500">
              Henüz kademe yok. Kutu sayfası, en az bir kademe girilene kadar
              müşteriye kapalı görünür.
            </p>
          )}

          {rows.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">En az</span>
              <input
                type="number"
                min={BOX_QUANTITY_STEP}
                max={ABSOLUTE_MAX_LINE_QTY}
                step={BOX_QUANTITY_STEP}
                value={t.minQuantity}
                onChange={(e) => setRow(i, { minQuantity: e.target.value })}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-gray-500">adet →</span>
              <input
                type="text"
                inputMode="decimal"
                value={t.unitPriceTry}
                onChange={(e) => setRow(i, { unitPriceTry: e.target.value })}
                className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-gray-500">₺ / adet</span>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                Kaldır
              </button>
            </div>
          ))}

          {rows.length < MAX_TIERS_PER_PRODUCT && (
            <button
              type="button"
              onClick={() =>
                setRows((prev) => [...prev, { minQuantity: "", unitPriceTry: "" }])
              }
              className="text-sm font-medium text-green-700 hover:text-green-800"
            >
              + Kademe ekle
            </button>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {busy ? "Kaydediliyor…" : "Kutu fiyatlarını kaydet"}
          </button>
          {saved && <span className="text-sm text-green-700">Kaydedildi ✓</span>}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Kutuya uygun ürünler ({eligible.length})
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Bir ürünü kutuya eklemek için ürün sayfasındaki &quot;Toplu sipariş&quot;
          kutusundan <strong>kutuya uygun</strong> işaretini açın.
        </p>
        {eligible.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Henüz kutuya uygun ürün yok — kutu sayfası boş görünür.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {eligible.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <Link
                  href={`/admin/products/${p.id}`}
                  className="truncate text-blue-700 hover:underline"
                >
                  {p.title}
                </Link>
                <span className="shrink-0 tabular-nums text-gray-600">
                  ₺{tl(p.priceKurus)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
