"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ABSOLUTE_MAX_LINE_QTY,
  BULK_DEFAULT_MAX_QTY,
  MAX_TIERS_PER_PRODUCT,
  MIN_TIER_QUANTITY,
} from "@/lib/config/bulk";

interface TierRow {
  minQuantity: string;
  unitPriceTry: string;
}

const tl = (kurus: number) => (kurus / 100).toString();
const toKurus = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 100);

/**
 * Toplu sipariş (volume pricing) editor for the admin product form.
 *
 * The whole ladder is saved at once (PUT), because its invariants — strictly
 * decreasing prices, all below the base price, top rung reachable — only hold
 * across the complete set. The server re-validates every one of them; this UI
 * just tries to make a bad ladder hard to type.
 *
 * Seller-owned products don't get an editor at all: a tier would cut the
 * seller's payout without their consent.
 */
export function ProductBulkTiersEditor({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [ownerType, setOwnerType] = useState<"admin" | "seller">("admin");
  const [basePriceKurus, setBasePriceKurus] = useState(0);
  const [bulkEnabled, setBulkEnabled] = useState(false);
  const [boxEligible, setBoxEligible] = useState(false);
  const [maxQty, setMaxQty] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [tiers, setTiers] = useState<TierRow[]>([]);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/admin/products/${productId}/bulk-tiers`);
    if (r.ok) {
      const d = await r.json();
      setOwnerType(d.ownerType);
      setBasePriceKurus(d.priceKurus);
      setBulkEnabled(d.bulkEnabled);
      setBoxEligible(d.boxEligible ?? false);
      setMaxQty(d.bulkMaxQuantity != null ? String(d.bulkMaxQuantity) : "");
      setLeadTime(d.bulkLeadTimeDays != null ? String(d.bulkLeadTimeDays) : "");
      setTiers(
        (d.tiers ?? []).map((t: { minQuantity: number; unitPriceKurus: number }) => ({
          minQuantity: String(t.minQuantity),
          unitPriceTry: tl(t.unitPriceKurus),
        }))
      );
    }
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(`/api/admin/products/${productId}/bulk-tiers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bulkEnabled,
          boxEligible,
          bulkMaxQuantity: maxQty.trim() ? Number(maxQty) : null,
          bulkLeadTimeDays: leadTime.trim() ? Number(leadTime) : null,
          tiers: tiers
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
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setTier = (i: number, patch: Partial<TierRow>) =>
    setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  if (loading) return null;

  if (ownerType !== "admin") {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">Toplu sipariş</h3>
        <p className="mt-1 text-xs text-gray-500">
          Toplu fiyat kademeleri yalnızca platform ürünlerinde tanımlanabilir.
          Satıcı ürününe kademe eklemek, satıcının hakedişini onayı olmadan
          düşürür.
        </p>
      </div>
    );
  }

  // Live preview of what a buyer pays, so a typo'd ladder is visible before save.
  const effectiveMax = maxQty.trim() ? Number(maxQty) : BULK_DEFAULT_MAX_QTY;

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900">
          Toplu sipariş (kademeli fiyat)
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          Açıldığında müşteri sepette bu üründen {ABSOLUTE_MAX_LINE_QTY} adede
          kadar alabilir ve eşiği geçtiğinde birim fiyat otomatik düşer. Kademe
          fiyatı liste fiyatının yerine geçer; seçenek ve eklenti farkları
          üstüne binmeye devam eder.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={bulkEnabled}
          onChange={(e) => setBulkEnabled(e.target.checked)}
          className="rounded border-gray-300"
        />
        Bu ürün toplu siparişe açık
      </label>

      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={boxEligible}
          onChange={(e) => setBoxEligible(e.target.checked)}
          className="mt-0.5 rounded border-gray-300"
        />
        <span>
          Anahtarlık kutusuna uygun
          <span className="mt-0.5 block text-xs font-normal text-gray-500">
            /anahtarlik-kutusu sayfasında listelenir. Kutuda fiyat ürünün kendi
            kademelerinden değil, kutunun toplam adedinden gelir — merdiveni{" "}
            <a href="/admin/kutu-fiyatlari" className="text-blue-700 hover:underline">
              kutu fiyatları
            </a>{" "}
            sayfasından yönetirsiniz.
          </span>
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Adet tavanı (boş → {BULK_DEFAULT_MAX_QTY})
          </label>
          <input
            type="number"
            min={MIN_TIER_QUANTITY}
            max={ABSOLUTE_MAX_LINE_QTY}
            value={maxQty}
            onChange={(e) => setMaxQty(e.target.value)}
            placeholder={String(BULK_DEFAULT_MAX_QTY)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Toplu üretim teslim süresi (gün, boş → normal süre)
          </label>
          <input
            type="number"
            min={1}
            max={365}
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-sm font-medium text-gray-700">Fiyat kademeleri</h4>
          <span className="text-xs text-gray-500">
            Liste fiyatı: ₺{tl(basePriceKurus)}
          </span>
        </div>

        {tiers.length === 0 && (
          <p className="text-xs text-gray-500">
            Henüz kademe yok. Toplu siparişi açmak için en az bir kademe gerekir.
          </p>
        )}

        {tiers.map((t, i) => {
          const qty = Number(t.minQuantity);
          const priceKurus = toKurus(t.unitPriceTry);
          const unreachable = qty > effectiveMax;
          const notCheaper = priceKurus > 0 && priceKurus >= basePriceKurus;
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">En az</span>
              <input
                type="number"
                min={MIN_TIER_QUANTITY}
                max={ABSOLUTE_MAX_LINE_QTY}
                value={t.minQuantity}
                onChange={(e) => setTier(i, { minQuantity: e.target.value })}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-gray-500">adet →</span>
              <input
                type="text"
                inputMode="decimal"
                value={t.unitPriceTry}
                onChange={(e) => setTier(i, { unitPriceTry: e.target.value })}
                className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-gray-500">₺ / adet</span>
              {(unreachable || notCheaper) && (
                <span className="text-xs font-medium text-red-600">
                  {unreachable
                    ? `Tavan ${effectiveMax} — bu kademeye ulaşılamaz`
                    : "Liste fiyatından düşük olmalı"}
                </span>
              )}
              <button
                type="button"
                onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                Kaldır
              </button>
            </div>
          );
        })}

        {tiers.length < MAX_TIERS_PER_PRODUCT && (
          <button
            type="button"
            onClick={() =>
              setTiers((prev) => [...prev, { minQuantity: "", unitPriceTry: "" }])
            }
            className="text-sm font-medium text-green-700 hover:text-green-800"
          >
            + Kademe ekle
          </button>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? "Kaydediliyor…" : "Toplu ayarları kaydet"}
        </button>
        {saved && <span className="text-sm text-green-700">Kaydedildi ✓</span>}
      </div>
    </div>
  );
}
