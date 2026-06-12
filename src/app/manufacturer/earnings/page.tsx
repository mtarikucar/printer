export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, manufacturerEarnings, payouts } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { PayoutRequestButton } from "@/components/manufacturer/payout-request-button";

export default async function ManufacturerEarningsPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/login");
  }

  const locale = (await getLocale()) as Locale;
  const d = getDictionary(locale);

  const earnings = await db.query.manufacturerEarnings.findMany({
    where: eq(manufacturerEarnings.manufacturerId, session.manufacturerId),
    with: { order: { columns: { orderNumber: true } } },
    orderBy: [desc(manufacturerEarnings.createdAt)],
    limit: 200,
  });
  const payoutRows = await db.query.payouts.findMany({
    where: eq(payouts.manufacturerId, session.manufacturerId),
    orderBy: [desc(payouts.createdAt)],
    limit: 50,
  });

  const owed = earnings
    .filter((e) => e.status === "pending")
    .reduce((s, e) => s + e.netKurus, 0);
  const paidTotal = earnings
    .filter((e) => e.status === "paid")
    .reduce((s, e) => s + e.netKurus, 0);

  const statusLabel: Record<string, string> = {
    pending: d["manufacturer.earnings.status.pending"],
    paid: d["manufacturer.earnings.status.paid"],
    reversed: d["manufacturer.earnings.status.reversed"],
  };
  const statusColor: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    paid: "bg-emerald-100 text-emerald-700",
    reversed: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {d["manufacturer.earnings.title"]}
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
            {d["manufacturer.earnings.owed"]}
          </p>
          <p className="text-3xl font-bold text-amber-900 mt-1">
            {formatCurrency(owed, locale)}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
            {d["manufacturer.earnings.paidTotal"]}
          </p>
          <p className="text-3xl font-bold text-emerald-900 mt-1">
            {formatCurrency(paidTotal, locale)}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <PayoutRequestButton owedKurus={owed} />
      </div>

      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
        {d["manufacturer.earnings.perOrder"]}
      </h2>
      {earnings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          {d["manufacturer.earnings.empty"]}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left py-2.5 px-4 font-medium">#</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.gross"]}</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.commission"]}</th>
                <th className="text-right py-2.5 px-4 font-medium">{d["manufacturer.earnings.net"]}</th>
                <th className="text-right py-2.5 px-4 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {earnings.map((e) => (
                <tr key={e.id}>
                  <td className="py-2.5 px-4 font-mono text-gray-700">
                    {e.order?.orderNumber ?? "—"}
                  </td>
                  <td className="py-2.5 px-4 text-right text-gray-500">{formatCurrency(e.grossKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right text-gray-500">−{formatCurrency(e.commissionKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right font-semibold text-gray-900">{formatCurrency(e.netKurus, locale)}</td>
                  <td className="py-2.5 px-4 text-right">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[e.status]}`}>
                      {statusLabel[e.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payoutRows.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            {d["manufacturer.earnings.payouts"]}
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {payoutRows.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-gray-700">
                  {formatDate(p.createdAt.toISOString(), locale)} · {p.earningCount} sipariş
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{formatCurrency(p.totalKurus, locale)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                    {p.status === "paid" ? statusLabel.paid : statusLabel.pending}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
