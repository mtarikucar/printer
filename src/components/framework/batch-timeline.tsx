"use client";

/**
 * PARTİ ZAMAN ÇİZELGESİ: sırası, planlanan sevki, tutarı, durumu, klon teklifi,
 * siparişi ve tam para dökümü.
 *
 * ─── PARA DÖKÜMÜ TEK KAYNAKTAN GELİR ───────────────────────────────────────
 *
 * Komisyon ve partner net rakamları `deriveOrderMoneyBreakdown`
 * (`src/lib/config/order-money.ts`) tarafından üretilir ve buraya HAZIR iner.
 * Bu bileşen hiçbir çıkarma yapmaz: kendi hesabını kuran bir ekran, aynı
 * parayı iki yerden yönetmek olurdu.
 *
 * ─── KOMİSYON ORANI ÜRETİCİ KABULÜNDE DONAR ────────────────────────────────
 *
 * Aynı anlaşmanın iki partisi FARKLI `commissionRateBps` taşıyabilir. Bu bir
 * hata DEĞİLDİR ve ekran onu hata gibi göstermez: partner payı, işi kabul
 * ettiği günün oranıdır — çerçeve müşteri fiyatını kilitler, partner oranını
 * kilitlemez.
 */
import Link from "next/link";
import {
  BATCH_STATUS_LABELS_TR,
  BATCH_STATUS_TONES,
} from "@/app/admin/cerceve/[id]/framework-values";
import type { FrameworkBatchStatus } from "@/lib/config/quote-framework";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/i18n/format";

/** Partinin siparişinin para dökümü — sunucuda türetilmiş, HAZIR sayılar. */
export interface BatchMoneyView {
  amountKurus: number;
  cashCollectedKurus: number;
  revenueKurus: number;
  paymentStatus: string;
  cancelled: boolean;
  platformCommissionKurus: number;
  platformNetKurus: number;
  shares: Array<{
    party: "manufacturer" | "painter";
    partnerName: string | null;
    baseKurus: number;
    commissionKurus: number;
    netKurus: number;
    rateBps: number;
    rateIsEstimate: boolean;
    accrued: boolean;
  }>;
  warnings: string[];
}

export interface BatchRow {
  id: string;
  position: number;
  status: FrameworkBatchStatus;
  plannedShipDate: string;
  units: number;
  amountKurus: number;
  quoteId: string | null;
  quoteNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  commissionRateBps: number | null;
  releasedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  releaseWindowOpen: boolean;
  lines: Array<{ partId: string; quantity: number; unitKurus: number; lineKurus: number }>;
  money: BatchMoneyView | null;
  /** Para okunamadı: BOŞ DEĞİL, BİLİNMİYOR. */
  moneyUnreadable: boolean;
}

const PARTY_LABELS: Record<"manufacturer" | "painter", string> = {
  manufacturer: "Üretici",
  painter: "Boyacı",
};

export function BatchTimeline({
  batches,
  totalBatches,
  partNames,
  busy,
  onRelease,
  onCancel,
}: {
  batches: BatchRow[];
  /** "Parti 3/8"in ikinci yarısı: iptal edilmemiş parti sayısı. */
  totalBatches: number;
  partNames: Record<string, string>;
  busy: string | null;
  onRelease?: (batch: BatchRow) => void;
  onCancel?: (batch: BatchRow) => void;
}) {
  if (batches.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Bu anlaşmada henüz parti yok. Aşağıdaki planlayıcıyla ilk partiyi kurun.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {batches.map((b) => (
        <li key={b.id} className="rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-gray-900">
              Parti {b.position}/{totalBatches}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${BATCH_STATUS_TONES[b.status]}`}
            >
              {BATCH_STATUS_LABELS_TR[b.status]}
            </span>
            <span className="text-sm text-gray-600">
              planlanan sevk {formatDate(b.plannedShipDate, "tr")}
            </span>
            <span className="text-sm text-gray-600">{b.units} adet</span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900">
              {formatCurrency(b.amountKurus, "tr")}
            </span>
          </div>

          {b.status === "planned" && b.releaseWindowOpen && (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>Serbest bırakma penceresi açıldı.</strong> Bu partiyi bugün
              bıraksanız planlanan sevk tarihine ancak yetişir (ölçü: plan kapısının
              iş günü kuralının tersi). Beklemek tarihi kaydırır.
            </p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {b.lines.map((l) => (
                  <tr key={l.partId}>
                    <td className="py-1.5 pr-3 text-gray-700">
                      {partNames[l.partId] ?? l.partId}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-gray-600">
                      {l.quantity} ×
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-gray-600">
                      {formatCurrency(l.unitKurus, "tr")}
                    </td>
                    <td className="py-1.5 pl-3 text-right tabular-nums text-gray-900">
                      {formatCurrency(l.lineKurus, "tr")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            {b.quoteNumber && b.quoteId && (
              <Link
                href={`/admin/teklifler/${b.quoteId}`}
                className="text-green-700 hover:underline"
              >
                Klon teklif: {b.quoteNumber}
              </Link>
            )}
            {b.orderNumber && b.orderId && (
              <Link
                href={`/admin/orders/${b.orderId}`}
                className="font-medium text-indigo-600 hover:underline"
              >
                Sipariş: {b.orderNumber} →
              </Link>
            )}
            {b.releasedAt && (
              <span className="text-gray-500">
                serbest bırakıldı {formatDateTime(b.releasedAt, "tr")}
              </span>
            )}
            {b.cancelledAt && (
              <span className="text-red-600">
                iptal {formatDateTime(b.cancelledAt, "tr")}
                {b.cancelReason ? ` · ${b.cancelReason}` : ""}
              </span>
            )}
          </div>

          {b.note && <p className="mt-2 text-xs text-gray-600">Not: {b.note}</p>}

          {b.moneyUnreadable && (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            >
              Bu partinin para dökümü şu anda okunamadı. Rakamların yokluğu
              &quot;tahsilat yok&quot; anlamına GELMEZ; siparişin kendi sayfasında
              dökümün tamamı var.
            </p>
          )}

          {b.money && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Figure label="Parti tutarı" value={b.money.amountKurus} />
                <Figure label="Tahsil edilen nakit" value={b.money.cashCollectedKurus} />
                <Figure label="Ciroya sayılan" value={b.money.revenueKurus} />
                <Figure label="Platform komisyonu" value={b.money.platformCommissionKurus} />
              </div>
              <div className="mt-2 space-y-1 text-xs">
                {b.money.shares.map((s) => (
                  <div key={s.party} className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-500">{PARTY_LABELS[s.party]}</span>
                    <span className="text-gray-900">{s.partnerName ?? "atanmadı"}</span>
                    <span className="text-gray-500">
                      taban {formatCurrency(s.baseKurus, "tr")} · komisyon{" "}
                      {formatCurrency(s.commissionKurus, "tr")} · net{" "}
                      <strong>{formatCurrency(s.netKurus, "tr")}</strong>
                    </span>
                    <span className="text-gray-400">
                      oran {s.rateBps} bps{s.rateIsEstimate ? " (tahmin)" : ""}
                      {s.accrued ? " · tahakkuk etti" : ""}
                    </span>
                  </div>
                ))}
                <div className="text-gray-500">
                  Platform net: <strong>{formatCurrency(b.money.platformNetKurus, "tr")}</strong>
                </div>
              </div>
              {b.commissionRateBps !== null && (
                <p className="mt-2 text-[11px] text-gray-500">
                  Bu partinin komisyon oranı üretici KABULÜNDE dondu:{" "}
                  {b.commissionRateBps} bps. Aynı anlaşmanın başka bir partisi farklı
                  bir oran taşıyabilir — bu bir hata değil, oranın kabul anında
                  donmasının doğal sonucu.
                </p>
              )}
              {b.money.warnings.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-[11px] text-amber-800">
                  {b.money.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {b.status === "planned" && (onRelease || onCancel) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onRelease && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onRelease(b)}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {busy === `release:${b.id}` ? "Bırakılıyor…" : "Partiyi serbest bırak"}
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => onCancel(b)}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-40"
                >
                  {busy === `batch-cancel:${b.id}` ? "İptal ediliyor…" : "Partiyi iptal et"}
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="tabular-nums font-medium text-gray-900">
        {formatCurrency(value, "tr")}
      </div>
    </div>
  );
}
