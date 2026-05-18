export const dynamic = "force-dynamic";

import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerAssignmentEvaluations,
  manufacturers,
  orders,
} from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { getCanaryPercent } from "@/lib/config/manufacturer-scoring";

/**
 * Q7 admin diff view. Lists the last 100 manufacturer-assignment
 * evaluations with v1 vs v2 winners side by side. The "agree/disagree"
 * column is what we eyeball before bumping
 * MANUFACTURER_SCORING_V2_PERCENT in canary phase.
 *
 * Reads from `manufacturer_assignment_evaluations` populated by
 * `rankForOrderWithShadow`.
 */
export default async function ScoringEvaluationsPage() {
  const v1Mfg = alias(manufacturers, "v1_mfg");
  const v2Mfg = alias(manufacturers, "v2_mfg");

  const rows = await db
    .select({
      id: manufacturerAssignmentEvaluations.id,
      orderId: manufacturerAssignmentEvaluations.orderId,
      orderNumber: orders.orderNumber,
      v1WinnerName: v1Mfg.companyName,
      v2WinnerName: v2Mfg.companyName,
      v1WinnerId: manufacturerAssignmentEvaluations.v1WinnerId,
      v2WinnerId: manufacturerAssignmentEvaluations.v2WinnerId,
      authoritative: manufacturerAssignmentEvaluations.authoritative,
      weightsVersion: manufacturerAssignmentEvaluations.weightsVersion,
      createdAt: manufacturerAssignmentEvaluations.createdAt,
    })
    .from(manufacturerAssignmentEvaluations)
    .leftJoin(orders, eq(manufacturerAssignmentEvaluations.orderId, orders.id))
    .leftJoin(
      v1Mfg,
      eq(manufacturerAssignmentEvaluations.v1WinnerId, v1Mfg.id)
    )
    .leftJoin(
      v2Mfg,
      eq(manufacturerAssignmentEvaluations.v2WinnerId, v2Mfg.id)
    )
    .orderBy(desc(manufacturerAssignmentEvaluations.createdAt))
    .limit(100);

  const total = rows.length;
  const agree = rows.filter(
    (r) => r.v1WinnerId && r.v2WinnerId && r.v1WinnerId === r.v2WinnerId
  ).length;
  const disagree = rows.filter(
    (r) =>
      r.v1WinnerId !== null &&
      r.v2WinnerId !== null &&
      r.v1WinnerId !== r.v2WinnerId
  ).length;
  const v1Only = rows.filter((r) => r.v1WinnerId && !r.v2WinnerId).length;
  const v2Only = rows.filter((r) => !r.v1WinnerId && r.v2WinnerId).length;
  const canaryPercent = getCanaryPercent();

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Scoring v2 Evaluations</h1>
        <p className="text-sm text-gray-500 mt-1">
          Q7 shadow + canary log. Compare v1 (legacy) and v2 (env-tuned)
          winners. When disagreement settles and v2 quality holds,
          increase <code className="text-xs bg-gray-100 px-1 rounded">
            MANUFACTURER_SCORING_V2_PERCENT
          </code> to expand canary.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Stat label="Total" value={total} />
        <Stat label="Agree" value={agree} tone="green" />
        <Stat label="Disagree" value={disagree} tone="amber" />
        <Stat label="v1 only" value={v1Only} />
        <Stat label="v2 only" value={v2Only} />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm text-blue-900">
        Canary route share: <strong>{canaryPercent}%</strong> of orders
        treat v2 as authoritative.{" "}
        {canaryPercent === 0
          ? "Pure shadow mode — v1 wins everywhere."
          : canaryPercent === 100
            ? "Full v2 cutover."
            : `${canaryPercent}% canary.`}
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">
            Henüz hiç değerlendirme yok. Bir admin sipariş detayı
            açtığında veya N12 reddet akışı tetiklendiğinde
            satırlar buraya düşer.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
              <tr>
                <th className="text-left py-2 px-3">Order</th>
                <th className="text-left py-2 px-3">v1 winner</th>
                <th className="text-left py-2 px-3">v2 winner</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Active</th>
                <th className="text-left py-2 px-3">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const same =
                  r.v1WinnerId &&
                  r.v2WinnerId &&
                  r.v1WinnerId === r.v2WinnerId;
                const disagreeing =
                  r.v1WinnerId &&
                  r.v2WinnerId &&
                  r.v1WinnerId !== r.v2WinnerId;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 px-3 font-mono text-xs">
                      <Link
                        href={`/admin/orders/${r.orderId}`}
                        className="text-indigo-600 hover:underline"
                      >
                        {r.orderNumber ?? r.orderId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-gray-700">
                      {r.v1WinnerName ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-gray-700">
                      {r.v2WinnerName ?? "—"}
                    </td>
                    <td className="py-2 px-3">
                      {same && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                          agree
                        </span>
                      )}
                      {disagreeing && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
                          disagree
                        </span>
                      )}
                      {!same && !disagreeing && (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                          partial
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.authoritative === "v2"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.authoritative}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">
                      {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "text-green-700 bg-green-50 border-green-200"
      : tone === "amber"
        ? "text-amber-700 bg-amber-50 border-amber-200"
        : "text-gray-700 bg-white border-gray-200";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  );
}
