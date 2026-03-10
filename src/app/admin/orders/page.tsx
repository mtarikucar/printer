export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  generating: "bg-indigo-100 text-indigo-700",
  processing_mesh: "bg-indigo-100 text-indigo-700",
  review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  printing: "bg-purple-100 text-purple-700",
  shipped: "bg-emerald-100 text-emerald-700",
  delivered: "bg-emerald-100 text-emerald-700",
  failed_generation: "bg-red-100 text-red-700",
  failed_mesh: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;
  const locale = await getLocale();
  const d = getDictionary(locale);

  const whereClause = filterStatus
    ? eq(orders.status, filterStatus as any)
    : undefined;

  const allOrders = await db.query.orders.findMany({
    where: whereClause,
    orderBy: [desc(orders.createdAt)],
    limit: 100,
  });

  const statuses = [
    "all",
    "pending_payment",
    "review",
    "approved",
    "printing",
    "shipped",
    "failed_generation",
    "failed_mesh",
    "rejected",
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.orders.title"]}</h1>

      {/* Status filter tabs */}
      <div className="mt-4 flex gap-2 flex-wrap">
        {statuses.map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/admin/orders" : `/admin/orders?status=${s}`}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              (s === "all" && !filterStatus) || s === filterStatus
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {s === "all" ? d["admin.orders.all"] : d[`admin.status.${s}` as keyof typeof d] || s}
          </Link>
        ))}
      </div>

      {/* Orders table */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.order"]}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.customer"]}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.size"]}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.status"]}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.amount"]}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.orders.table.date"]}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {allOrders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm font-medium">{order.orderNumber}</td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
                  <p className="text-xs text-gray-500">{order.email}</p>
                </td>
                <td className="px-4 py-3 text-sm">
                  {d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                    {d[`admin.status.${order.status}` as keyof typeof d] || order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {formatCurrency(order.amountKurus, locale)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {formatDate(order.createdAt, locale)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/orders/${order.id}`}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    {d["admin.orders.view"]}
                  </Link>
                </td>
              </tr>
            ))}
            {allOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  {d["admin.orders.empty"]}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
