"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/i18n/format";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { useCart } from "@/lib/cart/cart-context";
import {
  ABSOLUTE_MAX_LINE_QTY,
  BOX_QUANTITY_STEP,
  boxMinimumQuantity,
  nextTier,
  pickTier,
  type PriceTierConfig,
} from "@/lib/config/bulk";

export interface BoxDesign {
  id: string;
  slug: string | null;
  title: string;
  priceKurus: number;
  imageUrl: string | null;
}

/**
 * Build-a-box: pick assorted designs in tens, watch one per-piece price fall as
 * the whole box grows, order in one action.
 *
 * The price shown is a preview computed with the same pickTier the server uses;
 * /api/cart and /api/orders both re-derive it from the DB ladder, so a stale
 * page can never become a charged price.
 */
export function BoxBuilderClient({
  designs,
  tiers,
}: {
  designs: BoxDesign[];
  tiers: PriceTierConfig[];
}) {
  const locale = useLocale();
  const d = useDictionary();
  const router = useRouter();
  const { addMany } = useCart();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minimum = boxMinimumQuantity(tiers);

  const picked = useMemo(
    () =>
      designs
        .map((design) => ({ design, quantity: qty[design.id] ?? 0 }))
        .filter((r) => r.quantity > 0),
    [designs, qty]
  );

  const totalPieces = picked.reduce((s, r) => s + r.quantity, 0);
  const activeTier = pickTier(tiers, totalPieces);
  const upcoming = nextTier(tiers, totalPieces);
  // Below the first rung there is no box price — the customer would simply be
  // buying the designs at list, which is exactly what the button gate prevents.
  const unitPriceKurus = activeTier?.unitPriceKurus ?? null;
  const totalKurus = unitPriceKurus != null ? unitPriceKurus * totalPieces : 0;
  const listTotalKurus = picked.reduce(
    (s, r) => s + r.design.priceKurus * r.quantity,
    0
  );
  const savings = unitPriceKurus != null ? listTotalKurus - totalKurus : 0;
  const ready = totalPieces >= minimum && minimum > 0;

  const step = (id: string, delta: number) =>
    setQty((s) => {
      const next = Math.max(
        0,
        Math.min(ABSOLUTE_MAX_LINE_QTY, (s[id] ?? 0) + delta)
      );
      return { ...s, [id]: next };
    });

  const order = async () => {
    if (!ready || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addMany(
        picked.map((r) => ({
          productId: r.design.id,
          quantity: r.quantity,
          box: true,
        }))
      );
      // One action, as promised on the button: straight to payment rather than
      // dropping the customer back into a cart they have to find their way out of.
      router.push("/checkout");
    } catch {
      setError(d["box.orderFailed"]);
      setBusy(false);
    }
  };

  if (designs.length === 0 || tiers.length === 0) {
    return (
      <div className="card mt-8 py-16 text-center">
        <p className="text-text-muted">{d["box.unavailable"]}</p>
        <Link
          href="/shop"
          className="mt-4 inline-block rounded-full bg-green-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
        >
          {d["cart.continue"]}
        </Link>
      </div>
    );
  }

  const progressPct =
    upcoming != null
      ? Math.min(100, Math.round((totalPieces / upcoming.minQuantity) * 100))
      : 100;

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
      {/* ── Design grid ── */}
      <div>
        <div className="mb-4 rounded-xl border border-border-default bg-bg-elevated p-3 text-sm">
          <p className="text-text-secondary">
            {d["box.ladderIntro"]}{" "}
            <span className="font-medium text-text-primary">
              {tiers
                .map(
                  (t) =>
                    `${t.minQuantity}+ ${formatCurrency(t.unitPriceKurus, locale)}`
                )
                .join(" · ")}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {designs.map((design) => {
            const q = qty[design.id] ?? 0;
            const chosen = q > 0;
            return (
              <div
                key={design.id}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  chosen
                    ? "border-green-500 bg-green-50/40"
                    : "border-border-default bg-bg-base"
                }`}
              >
                <div className="aspect-square w-full overflow-hidden bg-bg-elevated">
                  {design.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={design.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium text-text-primary">
                    {design.title}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      aria-label={`${design.title}: ${BOX_QUANTITY_STEP} adet azalt`}
                      disabled={q === 0}
                      onClick={() => step(design.id, -BOX_QUANTITY_STEP)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:bg-bg-elevated disabled:opacity-40"
                    >
                      −
                    </button>
                    <span
                      className={`min-w-[3rem] text-center text-sm tabular-nums ${
                        chosen
                          ? "font-semibold text-green-700"
                          : "text-text-muted"
                      }`}
                    >
                      {q > 0 ? `${q} adet` : "—"}
                    </span>
                    <button
                      type="button"
                      aria-label={`${design.title}: ${BOX_QUANTITY_STEP} adet ekle`}
                      disabled={q >= ABSOLUTE_MAX_LINE_QTY}
                      onClick={() => step(design.id, BOX_QUANTITY_STEP)}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:bg-bg-elevated disabled:opacity-40"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Sticky box panel ── */}
      <div className="card h-fit p-5 lg:sticky lg:top-6">
        <h2 className="font-medium text-text-primary">{d["box.panelTitle"]}</h2>

        <p className="mt-3 text-3xl font-semibold tabular-nums text-text-primary">
          {totalPieces}{" "}
          <span className="text-base font-normal text-text-secondary">adet</span>
        </p>

        {unitPriceKurus != null ? (
          <p className="mt-1 text-sm font-medium text-green-700">
            {d["box.unitNow"].replace(
              "{price}",
              formatCurrency(unitPriceKurus, locale)
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-text-muted">
            {d["box.belowMinimum"].replace("{min}", String(minimum))}
          </p>
        )}

        {upcoming && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-green-800">
              {d["box.nudge"]
                .replace("{n}", String(upcoming.minQuantity - totalPieces))
                .replace(
                  "{price}",
                  formatCurrency(upcoming.unitPriceKurus, locale)
                )}
            </p>
          </div>
        )}

        {picked.length > 0 && (
          <div className="mt-4 space-y-1 border-t border-border-default pt-3 text-sm">
            {picked.map((r) => (
              <div key={r.design.id} className="flex justify-between gap-3">
                <span className="truncate text-text-secondary">
                  {r.design.title}
                </span>
                <span className="shrink-0 tabular-nums text-text-secondary">
                  {r.quantity}
                </span>
              </div>
            ))}
          </div>
        )}

        {savings > 0 && (
          <div className="mt-3 flex justify-between border-t border-border-default pt-3 text-sm text-green-700">
            <span>{d["bulk.savings"]}</span>
            <span className="font-semibold">
              −{formatCurrency(savings, locale)}
            </span>
          </div>
        )}

        <div className="mt-2 flex justify-between font-bold text-text-primary">
          <span>{d["cart.total"]}</span>
          <span>{formatCurrency(totalKurus, locale)}</span>
        </div>

        {error && (
          <p className="mt-3 text-sm text-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={order}
          disabled={busy || !ready}
          className="mt-5 w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? d["box.ordering"] : d["box.order"]}
        </button>

        {!ready && (
          <p className="mt-2 text-center text-xs text-text-muted">
            {d["box.remainingToMinimum"].replace(
              "{n}",
              String(Math.max(0, minimum - totalPieces))
            )}
          </p>
        )}

        <p className="mt-4 text-xs text-text-muted">{d["box.footnote"]}</p>
      </div>
    </div>
  );
}
