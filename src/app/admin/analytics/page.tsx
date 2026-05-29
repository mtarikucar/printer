export const dynamic = "force-dynamic";

import { sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, disputes, payouts } from "@/lib/db/schema";

const fmt = (k: number) =>
  `₺${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AdminAnalyticsPage() {
  const [byStatus, revenue, mfrCount, openDisputes, qcPending, paidPayouts] =
    await Promise.all([
      db
        .select({ status: orders.status, c: sql<number>`count(*)::int` })
        .from(orders)
        .groupBy(orders.status),
      db
        .select({ sum: sql<number>`coalesce(sum(${orders.amountKurus}),0)::int` })
        .from(orders)
        .where(eq(orders.paymentStatus, "succeeded")),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(manufacturers)
        .where(eq(manufacturers.status, "active")),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(disputes)
        .where(eq(disputes.status, "open")),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(orders)
        .where(eq(orders.manufacturerStatus, "qc_pending")),
      db
        .select({ sum: sql<number>`coalesce(sum(${payouts.totalKurus}),0)::int` })
        .from(payouts)
        .where(eq(payouts.status, "paid")),
    ]);

  const totalOrders = byStatus.reduce((s, r) => s + Number(r.c), 0);
  const cards = [
    { label: "Toplam sipariş", value: String(totalOrders) },
    { label: "Gelir (ödenmiş)", value: fmt(Number(revenue[0]?.sum ?? 0)) },
    { label: "Aktif üretici", value: String(Number(mfrCount[0]?.c ?? 0)) },
    { label: "QC bekleyen", value: String(Number(qcPending[0]?.c ?? 0)) },
    { label: "Açık anlaşmazlık", value: String(Number(openDisputes[0]?.c ?? 0)) },
    { label: "Ödenen payout", value: fmt(Number(paidPayouts[0]?.sum ?? 0)) },
  ];

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analitik</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{c.label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Durum dağılımı
      </h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {byStatus
          .slice()
          .sort((a, b) => Number(b.c) - Number(a.c))
          .map((r) => (
            <div key={r.status} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-gray-700">{r.status}</span>
              <span className="font-semibold text-gray-900">{Number(r.c)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
