export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { digitalOrders } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { AdminDigitalOrderActions } from "./actions";

export default async function AdminDigitalOrdersPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const orders = await db
    .select()
    .from(digitalOrders)
    .orderBy(desc(digitalOrders.createdAt));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.digitalOrders.title"]}</h1>
      <p className="text-gray-500 mt-1">{d["admin.digitalOrders.subtitle"]}</p>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.order"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.customer"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.amount"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.sourceOrder"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.status"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.downloads"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.digitalOrders.table.date"]}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                  {d["admin.digitalOrders.empty"]}
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{order.orderNumber}</td>
                  <td className="px-4 py-3 text-xs">{order.customerName}<br /><span className="text-gray-400">{order.email}</span></td>
                  <td className="px-4 py-3 font-mono">{formatCurrency(order.amountKurus, locale)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{order.sourceOrderId}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      order.status === "ready" ? "bg-green-100 text-green-700" :
                      order.status === "pending_payment" ? "bg-yellow-100 text-yellow-700" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {d[`digital.status.${order.status}` as keyof typeof d] || order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">{order.downloadCount}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(order.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    {order.status === "pending_payment" && (
                      <AdminDigitalOrderActions orderId={order.id} />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
