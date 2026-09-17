import { formatCurrency, formatDate } from "@/lib/i18n/format";

export interface PartnerHistoryRow {
  id: string;
  totalKurus: number;
  earningCount: number;
  adjustmentCount: number;
  status: string;
  settlementKind: "transfer" | "netting";
  createdAt: string;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reference: string | null;
  blockedReason: string | null;
  requestedByPartner: boolean;
  earnings: Array<{ orderNumber: string; netKurus: number }>;
  adjustments: Array<{ id: string; reason: string; netKurus: number }>;
}

export function PartnerPayoutHistory({ rows, unavailable }: { rows: PartnerHistoryRow[]; unavailable: boolean }) {
  if (unavailable) return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
    Ödeme geçmişi okunamadı. Bu durum kayıt olmadığı anlamına gelmez; yukarıdaki bakiyeler ayrı bir okumadan gelir. Lütfen sayfayı yenileyin.
  </div>;
  if (!rows.length) return <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">Bu filtreye uyan ödeme partisi yok.</p>;
  return <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
    {rows.map(row => <details key={row.id} className="p-4 text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
        <span className="text-gray-700">
          {formatDate(row.createdAt, "tr")} · {row.earningCount} hak ediş · {row.adjustmentCount} düzeltme
          {row.requestedByPartner ? " · sizin talebiniz" : ""}
        </span>
        <span className="flex items-center gap-3">
          <strong>{formatCurrency(row.totalKurus, "tr")}</strong>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">
            {row.voidedAt ? "İptal edildi" : row.settlementKind === "netting" ? row.status === "paid" ? "Mahsup edildi" : "Mahsup bekliyor" : row.status === "paid" ? "Ödendi" : "Transfer bekleniyor"}
          </span>
        </span>
      </summary>
      {row.reference && <p className="mt-2 font-mono text-xs text-gray-500">Ref: {row.reference}</p>}
      {row.paidAt && <p className="mt-2 text-xs text-gray-500">Kapatılma: {formatDate(row.paidAt, "tr")}</p>}
      {row.voidedAt && <p className="mt-2 text-xs text-gray-600">İptal: {formatDate(row.voidedAt, "tr")} · {row.voidReason}. Gösterilen eski parti tutarı ödenecek bakiye değildir; bağlı kayıtlar serbest bırakılmıştır.</p>}
      {row.blockedReason && <p role="alert" className="mt-2 text-xs text-amber-800">{row.blockedReason}</p>}
      <ul className="mt-3 space-y-1 text-xs text-gray-600">
        {row.earnings.map((earning, index) => <li key={index} className="flex justify-between gap-3"><span>{earning.orderNumber}</span><span>{formatCurrency(earning.netKurus, "tr")}</span></li>)}
        {row.adjustments.map(adjustment => <li key={adjustment.id} className="flex justify-between gap-3"><span>{adjustment.reason}</span><span>{formatCurrency(adjustment.netKurus, "tr")}</span></li>)}
      </ul>
    </details>)}
  </div>;
}
