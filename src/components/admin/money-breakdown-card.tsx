"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { isRefunded } from "@/lib/config/order-status-policy";
import {
  MONEY_LINE_KIND_LABELS_TR,
  type OrderMoneyBreakdown,
  type MoneyLine,
  type PartyShare,
  type PartnerEarningRow,
} from "@/lib/config/order-money";

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  awaiting_model: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  generating: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  processing_mesh: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  review: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  awaiting_customer_approval: "bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200",
  approved: "bg-green-50 text-green-700 ring-1 ring-green-200",
  printing: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  quality_check: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  painting: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
  shipped: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  failed_generation: "bg-red-50 text-red-700 ring-1 ring-red-200",
  failed_mesh: "bg-red-50 text-red-700 ring-1 ring-red-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
};

// Module level, not inside the page component, because the money card labels
// its cart sibling orders with the same words as the header and the stepper.
/** admin.status.<status>; the readable enum only for a status tr.ts lacks. */
function orderStatusLabel(d: Dictionary, status: string): string {
  return d[`admin.status.${status}` as keyof Dictionary] || status.replace(/_/g, " ");
}

/** admin.payment.status.<status>; the raw value only for a status tr.ts lacks. */
function paymentStatusLabel(d: Dictionary, status: string): string {
  return d[`admin.payment.status.${status}` as keyof Dictionary] || status;
}

const MONEY_KIND_TONE: Record<MoneyLine["kind"], string> = {
  production: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  painting: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200",
  addon: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
  discount: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  // A price row is part of the customer's price build-up and is shared between
  // production and painting (its split sits under it). Blue or fuchsia would
  // hand the whole row to one party, so it stays neutral.
  price: "bg-gray-100 text-gray-700 ring-1 ring-gray-200",
};

const PARTY_LABEL: Record<PartyShare["party"], string> = {
  manufacturer: "Üretici",
  painter: "Boyacı",
};

/**
 * A manufacturer who paints in house earns the painting kalem as well, and the
 * derivation then emits no painter share at all. The label has to say so, or
 * the admin reads a base that looks too big and goes looking for a painter.
 */
function partyLabel(s: PartyShare): string {
  const base = PARTY_LABEL[s.party] ?? s.party;
  return s.party === "manufacturer" && s.includesPainting ? `${base} (boyama dahil)` : base;
}

// earning_status: pending = accrued but not paid out yet.
const EARNING_STATUS_LABEL: Record<string, string> = {
  pending: "Ödenmedi",
  paid: "Ödendi",
  reversed: "Geri alındı",
};

const EARNING_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  paid: "bg-green-50 text-green-700 ring-1 ring-green-200",
  reversed: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
};

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  pending: "Ödeme partisinde, havale bekliyor",
  paid: "Ödendi",
};

const MONEY_SECTION_HEADING =
  "text-[11px] font-semibold uppercase tracking-wider text-gray-500";

/** "%40", "%37,5": Turkish writes the sign before the number. */
function formatRateBps(bps: number): string {
  return `%${(bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

/**
 * True for an earning a refund will NOT claw back. reverseEarning and
 * reversePainterEarning skip rows already marked paid (that money has left the
 * platform). Rows merely batched into a still-pending payout ARE reversed and
 * deducted from that payout, so they do not count here.
 */
function isPaidOut(e: PartnerEarningRow | null): boolean {
  return !!e && (e.status === "paid" || e.payout?.status === "paid");
}

const VOIDED_MUTED = "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
const VOIDED_ALERT = "bg-red-50 text-red-700 ring-1 ring-red-200";

/**
 * A partner share on a refunded order (PartyShare.voided). No expected figure
 * applies any more, so only the earning row itself is left to report: the
 * refund reverses unpaid rows and cannot touch paid ones. A row still pending
 * here escaped the reversal (it accrued after the refund, say) and would be
 * paid out, so it is flagged instead of muted.
 */
function voidedShareState(e: PartnerEarningRow | null): {
  badge: string;
  accrual: string;
  tone: string;
  note: string;
} {
  if (!e) {
    return {
      badge: "Hakediş yok",
      accrual: "İade nedeniyle tahakkuk olmayacak",
      tone: VOIDED_MUTED,
      note: "İade edildi — hakediş oluşmaz.",
    };
  }
  if (e.status === "reversed") {
    return {
      badge: "Geri alındı",
      accrual: "Geri alındı",
      tone: VOIDED_MUTED,
      note: "İade edildi — hakediş oluşmaz; tahakkuk etmiş satır geri alındı.",
    };
  }
  if (e.payout?.settlementKind === "netting") {
    return {
      badge: e.payout.status === "paid" ? "Mahsupla kapandı" : "Mahsup bekliyor",
      accrual: e.payout.status === "paid" ? "Mahsupla kapandı" : "Mahsup bekliyor",
      tone: VOIDED_MUTED,
      note: "Hakediş ve ayrı düzeltmeler birlikte mahsuplaşır; bu parti için banka transferi yapılmaz.",
    };
  }
  if (isPaidOut(e)) {
    return {
      badge: "Ödenmiş, geri alınmadı",
      accrual: "Ödenmiş, geri alınmadı",
      tone: VOIDED_ALERT,
      note: "Kayıtlı hakediş kapatılmıştır; sistem geri almaz. Nakit etki, ayrı düzeltmelerle birlikte Platform bölümünde gösterilir.",
    };
  }
  return {
    badge: "Geri alınmadı",
    accrual: "Tahakkuk etti, geri alınmadı",
    tone: VOIDED_ALERT,
    note: "İade edildi ama bu hakediş geri alınmadı; ödeme partisine girerse partnere ödenir. Elle kontrol edilmeli.",
  };
}

/** One label/amount line of a money list. Must sit directly inside a <dl>. */
function MoneyRow({
  label,
  value,
  strong = false,
  divider = false,
  valueClass,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  divider?: boolean;
  valueClass?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "font-semibold text-gray-900" : ""
      } ${divider ? "border-t border-gray-100 pt-1.5" : ""}`}
    >
      <dt className={strong ? "" : "text-gray-500"}>{label}</dt>
      <dd className={`text-right tabular-nums ${valueClass ?? (strong ? "" : "text-gray-800")}`}>
        {value}
      </dd>
    </div>
  );
}

/** The earning row that really accrued: gross, commission, net and payout. */
function EarningRows({ e, loc }: { e: PartnerEarningRow; loc: Locale }) {
  const fc = (k: number) => formatCurrency(k, loc);
  return (
    <dl className="mt-1 space-y-1 text-sm">
      <MoneyRow label="Brüt" value={fc(e.grossKurus)} />
      <MoneyRow label="Komisyon oranı" value={formatRateBps(e.rateBps)} />
      <MoneyRow label="Komisyon" value={`−${fc(e.commissionKurus)}`} />
      <MoneyRow label="Net" value={fc(e.netKurus)} strong divider />
      <MoneyRow
        label="Ödeme"
        value={
          e.payout ? (
            <span className="text-xs">
              <Link href="/admin/payouts" className="text-blue-700 hover:underline">
                {e.payout.voidedAt ? "Parti iptal edildi"
                  : e.payout.settlementKind === "netting"
                    ? e.payout.status === "paid" ? "Mahsupla kapandı" : "Mahsup bekliyor"
                    : PAYOUT_STATUS_LABEL[e.payout.status] ?? e.payout.status}
              </Link>
              {e.payout.reference && (
                <span className="block font-mono text-[11px] text-gray-500">
                  {e.payout.reference}
                </span>
              )}
              {e.payout.paidAt && (
                <span className="block text-[11px] text-gray-500">
                  {formatDateTime(e.payout.paidAt, loc)}
                </span>
              )}
            </span>
          ) : (
            <span className="text-xs text-gray-500">Ödeme partisine girmedi</span>
          )
        }
      />
    </dl>
  );
}

/** Expected share (from the stored bases) next to the earning row that really accrued. */
function PartyShareBlock({ share: s, loc }: { share: PartyShare; loc: Locale }) {
  const fc = (k: number) => formatCurrency(k, loc);
  const e = s.earning;

  // Refunded: the expected base, rate and net read as money still on its way
  // to the partner, while the Platform block and the warnings on the same card
  // already treat the order as closed. Only the real earning row, if any, is
  // left to show.
  if (s.voided) {
    const v = voidedShareState(e);
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-500">
            {partyLabel(s)}
            <span className="ml-1 font-normal text-gray-400">· {s.partnerName ?? "atanmadı"}</span>
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.tone}`}>
            {v.badge}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-gray-500">{v.note}</p>
        {e && (
          <div className={`mt-2 ${e.status === "reversed" ? "opacity-60" : ""}`}>
            <p className="text-[11px] font-medium text-gray-400">Gerçekleşen</p>
            <EarningRows e={e} loc={loc} />
          </div>
        )}
      </div>
    );
  }

  // A reversed row is history (refund, revoke); comparing it with today's
  // expectation would only raise false alarms.
  const differs =
    !!e &&
    e.status !== "reversed" &&
    (e.grossKurus !== s.baseKurus || e.netKurus !== s.expectedNetKurus);
  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">
          {partyLabel(s)}
          <span className="ml-1 font-normal text-gray-500">· {s.partnerName ?? "atanmadı"}</span>
        </p>
        {e ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              EARNING_STATUS_TONE[e.status] ?? "bg-gray-100 text-gray-700"
            }`}
          >
            {e.payout?.settlementKind === "netting" && e.payout.status === "paid"
              ? "Mahsupla kapandı" : EARNING_STATUS_LABEL[e.status] ?? e.status}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
            Hakediş satırı yok
          </span>
        )}
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium text-gray-400">Beklenen</p>
          <dl className="mt-1 space-y-1 text-sm">
            <MoneyRow label="Taban" value={fc(s.baseKurus)} />
            <MoneyRow
              label="Komisyon oranı"
              value={
                <span className="inline-flex items-center gap-1.5">
                  {formatRateBps(s.rateBps)}
                  {s.rateIsEstimate ? (
                    <span
                      title="Oran siparişe henüz sabitlenmedi; bugünkü oran gösteriliyor."
                      className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"
                    >
                      tahmini
                    </span>
                  ) : (
                    <span
                      title="Siparişe sabitlenmiş oran"
                      className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
                    >
                      sabit
                    </span>
                  )}
                </span>
              }
            />
            <MoneyRow label="Komisyon" value={`−${fc(s.expectedCommissionKurus)}`} />
            <MoneyRow label="Net" value={fc(s.expectedNetKurus)} strong divider />
          </dl>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-400">Gerçekleşen</p>
          {e ? (
            <EarningRows e={e} loc={loc} />
          ) : (
            <p className="mt-1 text-xs text-gray-500">Henüz tahakkuk etmedi.</p>
          )}
        </div>
      </div>
      {differs && e && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Gerçekleşen hakediş beklenenden farklı: brüt {fc(e.grossKurus)} (beklenen{" "}
          {fc(s.baseKurus)}), net {fc(e.netKurus)} (beklenen {fc(s.expectedNetKurus)}).
          Tahakkuktan sonra kalemler ya da oran değişmiş olabilir; tahakkuk eden satır
          kendiliğinden düzelmez.
        </p>
      )}
    </div>
  );
}

/**
 * Para dökümü: every line of the order and its value, what was collected, who
 * gets what, and what has accrued or been paid out. Read-only; rows rebuilt from
 * today's constants (no frozen copy on the order) are marked as such.
 */
export function MoneyBreakdownCard({
  money,
  loc,
}: {
  money: OrderMoneyBreakdown | null | undefined;
  loc: Locale;
}) {
  const d = useDictionary();
  // Fold negative zero, and only that: formatCurrency prints its sign, so a
  // refunded order's platform net of −0 read as "-₺0,00". `k || 0` also turned
  // NaN into ₺0,00, which would hide a broken figure behind a plausible one.
  const fc = (k: number) => formatCurrency(Object.is(k, -0) ? 0 : k, loc);

  if (!money) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Para dökümü</h3>
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
          Para dökümü hesaplanamadı (hata sunucu günlüğünde). Siparişin diğer işlemleri
          etkilenmez.
        </p>
      </div>
    );
  }

  const { lines, totals, collection, shares: allShares, platform, warnings, adjustments = [] } = money;
  const recomputedCount = lines.filter((l) => l.recomputed).length;
  const hasPriceRows = lines.some((l) => l.kind === "price");
  // C2'' emits no painter share when the manufacturer paints in house; this
  // only guards the display. A painter share with a ₺0 base, nobody assigned
  // and no earning row would render as "Boyacı · atanmadı" plus a pending
  // accrual that can never happen.
  const inHousePainting = allShares.some((s) => s.party === "manufacturer" && s.includesPainting);
  const shares = inHousePainting
    ? allShares.filter(
        (s) => s.party !== "painter" || s.earning !== null || s.partnerName !== null || s.baseKurus !== 0
      )
    : allShares;
  const refunded = isRefunded(collection);
  const paymentMethodLabel =
    collection.paymentMethod === "card"
      ? d["admin.payment.method.card"]
      : collection.paymentMethod === "bank_transfer"
        ? d["admin.payment.method.bankTransfer"]
        : collection.paymentMethod === "gift_card_full"
          ? d["admin.payment.method.giftCardFull"]
          : collection.paymentMethod ?? "—";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Para dökümü</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {totals.legacySplit && (
            <span
              title="Sipariş kalem modelinden önce açıldı: üretim tabanı siparişe yazılmamış, eski kurala göre (tutar eksi boyama payı) türetildi."
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200"
            >
              kalem öncesi sipariş
            </span>
          )}
          {recomputedCount > 0 && (
            <span
              title="Bu satırlar siparişte saklanmadı; bugünkü fiyat sabitlerinden yeniden hesaplandı ve satış anındaki değerden farklı olabilir."
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200"
            >
              {recomputedCount} satır yeniden hesaplandı
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Salt okunur: satırlar, tahsilat, kim ne alır, ne tahakkuk etti ve ne ödendi.
      </p>

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {warnings.map((w, i) => (
            <li key={`${i}-${w}`} className="flex gap-2">
              <span aria-hidden>⚠</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Kalemler */}
      <section className="mt-5">
        <h4 className={MONEY_SECTION_HEADING}>Kalemler</h4>
        {!totals.splitMatches && (
          <p
            role="alert"
            className="mt-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            <strong>Kalem toplamı sipariş tutarını tutmuyor.</strong> Üretim{" "}
            {fc(totals.productionBaseKurus)} + boyama {fc(totals.paintingPriceKurus)}, sipariş
            tutarı ise {fc(totals.amountKurus)}. Partner hakediş tabanları bu ikisinden
            türediği için elle düzeltilmesi gerekir.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">Bu sipariş için kalem bulunamadı.</p>
        ) : (
          <ul className="mt-2 divide-y divide-gray-100">
            {lines.map((l, i) => {
              const badgeLabel = MONEY_LINE_KIND_LABELS_TR[l.kind] ?? l.kind;
              const badgeCls = MONEY_KIND_TONE[l.kind] ?? "bg-gray-100 text-gray-700";
              const isDiscount = l.kind === "discount";
              // "qty × unit" only where it IS the row's amount. A row carrying one
              // party's share of a line (or a remainder) used to print "2 × ₺450"
              // next to ₺522,22, which reads as an arithmetic error.
              const unitShown =
                l.qty != null && l.unitKurus != null && l.qty * l.unitKurus === l.amountKurus
                  ? { qty: l.qty, unitKurus: l.unitKurus }
                  : null;
              return (
                <li key={`${l.kind}-${i}`} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${badgeCls}`}
                      >
                        {badgeLabel}
                      </span>
                      <span className="text-sm text-gray-900">{l.label}</span>
                      {l.recomputed && (
                        <span
                          title="Siparişte saklanmadı; bugünkü sabitlerden yeniden hesaplandı."
                          className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200"
                        >
                          yeniden hesaplandı
                        </span>
                      )}
                    </div>
                    {unitShown ? (
                      <p className="mt-0.5 text-xs text-gray-500 tabular-nums">
                        {unitShown.qty} × {fc(unitShown.unitKurus)}
                      </p>
                    ) : l.qty != null && l.qty !== 1 ? (
                      <p className="mt-0.5 text-xs text-gray-500">{l.qty} adet</p>
                    ) : null}
                    {l.split && (
                      <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] tabular-nums text-gray-500">
                        <span>
                          Üretim <span className="text-blue-700">{fc(l.split.productionKurus)}</span>
                        </span>
                        <span aria-hidden>·</span>
                        <span>
                          Boyama <span className="text-fuchsia-700">{fc(l.split.paintingKurus)}</span>
                        </span>
                      </p>
                    )}
                    {l.note && <p className="mt-0.5 text-xs text-gray-500">{l.note}</p>}
                  </div>
                  <span
                    className={`shrink-0 text-sm font-medium tabular-nums ${
                      isDiscount ? "text-amber-700" : "text-gray-900"
                    }`}
                  >
                    {isDiscount ? `−${fc(Math.abs(l.amountKurus))}` : fc(l.amountKurus)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {/* Pay dağılımı: where the rows above land. Production, add-on and the
            production part of every price row add up to the production base;
            painting rows and painting parts add up to the painting base. */}
        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[11px] font-medium text-gray-500">Pay dağılımı</p>
          <dl className="mt-1 space-y-1 text-sm">
            <MoneyRow label="Üretim tabanı" value={fc(totals.productionBaseKurus)} />
            <MoneyRow label="Boyama tabanı" value={fc(totals.paintingPriceKurus)} />
            <MoneyRow label="Sipariş tutarı" value={fc(totals.amountKurus)} strong divider />
          </dl>
          {hasPriceRows && (
            <p className="mt-1 text-[11px] text-gray-500">
              Her fiyat satırının altındaki üretim / boyama payı bu iki tabana eklenir.
            </p>
          )}
        </div>
        {totals.splitMatches && (
          <p className="mt-1 text-[11px] text-green-700">✓ Üretim + boyama sipariş tutarına eşit.</p>
        )}
      </section>

      {/* Tahsilat */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Tahsilat</h4>
        <dl className="mt-2 space-y-1.5 text-sm">
          <MoneyRow label="Sipariş tutarı" value={fc(collection.amountKurus)} />
          {collection.giftCardKurus > 0 && (
            <MoneyRow
              label="Hediye kartı"
              value={`−${fc(collection.giftCardKurus)}`}
              valueClass="text-green-700"
            />
          )}
          {collection.havaleDiscountKurus > 0 && (
            <MoneyRow
              label="Havale indirimi"
              value={`−${fc(collection.havaleDiscountKurus)}`}
              valueClass="text-amber-700"
            />
          )}
          <MoneyRow
            label="Tahsil edilen (nakit)"
            value={fc(collection.cashCollectedKurus)}
            strong
            divider
          />
          {/* C3: cash counts as revenue only while the payment stands, so a
              refund drops revenueKurus to 0 while the cash above stays what was
              taken. Shown only when the two differ; otherwise it would repeat the
              row above. */}
          {collection.revenueKurus !== collection.cashCollectedKurus && (
            <MoneyRow
              label="Ciroya sayılan"
              value={fc(collection.revenueKurus)}
              valueClass={refunded ? "text-red-700" : undefined}
            />
          )}
          <MoneyRow label="Ödeme yöntemi" value={paymentMethodLabel} />
          <MoneyRow
            label="Ödeme durumu"
            value={
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  refunded
                    ? "bg-red-600 text-white"
                    : "bg-green-50 text-green-700 ring-1 ring-green-200"
                }`}
              >
                {paymentStatusLabel(d, collection.paymentStatus)}
              </span>
            }
          />
        </dl>
        {collection.siblings.length > 0 && (
          <div className="mt-3 rounded-xl bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-600">Aynı sepetin diğer siparişleri</p>
            <ul className="mt-1 divide-y divide-gray-200">
              {collection.siblings.map((sib) => (
                <li key={sib.id} className="py-1.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Link
                        href={`/admin/orders/${sib.id}`}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {sib.orderNumber}
                      </Link>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          STATUS_COLORS[sib.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {orderStatusLabel(d, sib.status)}
                      </span>
                      {isRefunded(sib) && (
                        <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {paymentStatusLabel(d, sib.paymentStatus)}
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-gray-700">{fc(sib.amountKurus)}</span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap justify-end gap-x-3 tabular-nums text-[11px] text-gray-500">
                    {sib.giftCardKurus > 0 && <span>Hediye kartı −{fc(sib.giftCardKurus)}</span>}
                    {sib.havaleDiscountKurus > 0 && (
                      <span>Havale indirimi −{fc(sib.havaleDiscountKurus)}</span>
                    )}
                    <span className="font-medium text-gray-700">
                      Nakit {fc(sib.cashCollectedKurus)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-gray-500">
              Tek sepet ödemesi satıcıya göre alt siparişlere bölündü. Hediye kartı, havale
              indirimi ve nakit her alt siparişin kendi kaydından okunur.
            </p>
          </div>
        )}
      </section>

      {/* Kim ne alır */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Kim ne alır</h4>
        <div className="mt-2 space-y-3">
          {shares.length === 0 && (
            <p className="text-sm text-gray-400">Bu siparişte partner payı yok.</p>
          )}
          {shares.map((s) => (
            <PartyShareBlock key={s.party} share={s} loc={loc} />
          ))}
          {adjustments.length > 0 && (
            <div className="rounded-xl border border-gray-200 p-3">
              <h5 className="text-sm font-semibold text-gray-900">Ek partner düzeltmeleri</h5>
              <p className="mt-1 text-xs text-gray-500">
                Net tutarlar ayrı kayıtlardır; yukarıdaki asıl hakediş tutarları değişmez.
              </p>
              <ul className="mt-2 divide-y divide-gray-100">
                {adjustments.map(a => (
                  <li key={a.id} className="py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900">
                          {a.kind === "reprint" ? "Platform karşılamalı yeniden üretim" : a.kind === "topup" ? "Ek net ödeme" : "Ödenmemiş kaynaktan mahsup"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {a.partnerKind === "manufacturer" ? "Üretici" : "Boyacı"} · {a.partnerName ?? a.partnerId}
                        </p>
                      </div>
                      <span className={`shrink-0 font-semibold tabular-nums ${a.status === "voided" ? "text-gray-400 line-through" : "text-gray-900"}`}>
                        {a.netKurus > 0 ? "+" : ""}{fc(a.netKurus)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-600">{a.reason}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {a.status === "voided" ? "İptal edildi — toplama dahil değil"
                        : a.status === "settled" ? a.settlementKind === "netting" ? "Mahsupla kapandı" : "Ödendi"
                          : a.activePending ? a.payoutId ? "Ödeme partisinde — henüz ödenmedi" : "Ödenebilir — henüz ödenmedi"
                            : "Kaynak ödenebilir değil — toplama dahil değil"}
                      {" · "}{formatDateTime(a.createdAt, loc)}
                      {a.payoutId && <> · <Link href="/admin/payouts" className="text-blue-700 hover:underline">Ödeme partisi</Link></>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm font-semibold text-gray-900">Platform</p>
            {refunded ? (
              // Refunded: nothing counts as revenue and pending earnings were
              // reversed, so the platform is left with only the paid-out,
              // unrecoverable partner earnings (as a loss).
              <>
                <dl className="mt-2 space-y-1 text-sm">
                  {(platform.settledAdjustmentNetKurus ?? 0) !== 0 && (
                    <MoneyRow label="Gerçekleşen düzeltmelerin net etkisi" value={fc(-(platform.settledAdjustmentNetKurus ?? 0))} />
                  )}
                  <MoneyRow
                    label="Platform net (iade)"
                    value={fc(platform.netKurus)}
                    strong
                    valueClass={platform.netKurus < 0 ? "text-red-700" : undefined}
                  />
                  {(platform.pendingAdjustmentNetKurus ?? 0) > 0 && (
                    <MoneyRow label="Bekleyen ek partner borcu (henüz ödenmedi)" value={fc(platform.pendingAdjustmentNetKurus ?? 0)} valueClass="text-amber-700" />
                  )}
                </dl>
                <p className="mt-1 text-[11px] text-gray-500">
                  İadede tahsilat ciroya sayılmaz. Kapatılmış hakedişler ve gerçekleşen düzeltmelerin neti nakit zararı belirler;
                  bekleyen ek borç bu zarara dahil değildir. Mahsup, banka transferi değildir.
                </p>
              </>
            ) : (
              <dl className="mt-2 space-y-1 text-sm">
                <MoneyRow label="Partner komisyonları" value={fc(platform.commissionKurus)} />
                {/* Shown whenever non-zero: a negative value means partner
                    earnings exceed the order total and must be looked at. */}
                {platform.unassignedBaseKurus !== 0 && (
                  <MoneyRow
                    label="Partneri olmayan taban"
                    value={fc(platform.unassignedBaseKurus)}
                    valueClass={platform.unassignedBaseKurus < 0 ? "text-red-700" : undefined}
                  />
                )}
                {/* Geri alınmış hakediş tabanı AYRI bir satırdır: "partneri
                    olmayan taban" hiç kimsenin kazanmadığı tabandır, bu ise
                    kazanılmış sonra geri alınmış olandır. Türetim (order-money.ts)
                    bu tutarı platform NET'ine KATMAZ; satır da bunu söyler.
                    Satır olmadan tutar yalnızca uyarı cümlesinde geçiyordu:
                    admin "Platform net ₺0,00" okuyup parayı kartın hiçbir
                    yerinde göremiyordu. Hiçbir tutar değişmez, yalnız görünür. */}
                {platform.reversedBaseKurus !== 0 && (
                  <MoneyRow
                    label="Geri alınmış hakediş tabanı (gelire yazılmadı)"
                    value={fc(platform.reversedBaseKurus)}
                    valueClass="text-amber-700"
                  />
                )}
                {collection.giftCardKurus > 0 && (
                  <MoneyRow label="Hediye kartı" value={`−${fc(collection.giftCardKurus)}`} />
                )}
                {collection.havaleDiscountKurus > 0 && (
                  <MoneyRow
                    label="Havale indirimi"
                    value={`−${fc(collection.havaleDiscountKurus)}`}
                  />
                )}
                {(platform.adjustmentNetKurus ?? 0) !== 0 && (
                  <MoneyRow label="Ek partner düzeltmelerinin net etkisi" value={fc(-(platform.adjustmentNetKurus ?? 0))} />
                )}
                <MoneyRow
                  label="Platform net"
                  value={fc(platform.netKurus)}
                  strong
                  divider
                  valueClass={platform.netKurus < 0 ? "text-red-700" : undefined}
                />
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* Tahakkuk */}
      <section className="mt-5 border-t border-gray-100 pt-4">
        <h4 className={MONEY_SECTION_HEADING}>Tahakkuk</h4>
        {shares.length === 0 ? (
          <p className="mt-2 text-sm text-gray-400">Tahakkuk edecek partner yok.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shares.map((s) => {
              // Refunded: "Henüz tahakkuk etmedi" would promise an accrual the
              // refund has ruled out; an existing row reports its own state.
              const voided = s.voided ? voidedShareState(s.earning) : null;
              return (
              <li key={s.party} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className={`font-medium ${voided ? "text-gray-500" : "text-gray-900"}`}>
                    {partyLabel(s)}
                    {s.partnerName && (
                      <span className="ml-1 font-normal text-gray-500">· {s.partnerName}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">{s.accrualEvent}</p>
                </div>
                {voided ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${voided.tone}`}>
                    {voided.accrual}
                  </span>
                ) : s.accrualMissing ? (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    tahakkuk eksik
                  </span>
                ) : s.earning ? (
                  s.earning.status === "reversed" ? (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                      Tahakkuk geri alındı
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-green-200">
                      Tahakkuk etti
                    </span>
                  )
                ) : (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    Henüz tahakkuk etmedi
                  </span>
                )}
              </li>
              );
            })}
          </ul>
        )}
        {shares.some((s) => s.accrualMissing) && (
          <p
            role="alert"
            className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900"
          >
            Sipariş kargolandı ya da boyacıya devredildi ama hakediş satırı yok. Tahakkuk
            arka planda sessizce başarısız olmuş olabilir; bu satır olmadan partner bu iş için
            ödeme partisine girmez. Elle düzeltilmesi gerekir.
          </p>
        )}
      </section>
    </div>
  );
}
