"use client";

import { useState } from "react";
import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";

interface QueueItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  updatedAt: string;
}

export function PrintQueueClient({ items }: { items: QueueItem[] }) {
  const d = useDictionary();
  const locale = useLocale();

  const approvedItems = items.filter((i) => i.status === "approved");
  const printingItems = items.filter((i) => i.status === "printing");

  return (
    <div className="mt-6 space-y-8">
      {/* Approved - ready to print */}
      {approvedItems.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {d["admin.printQueue.readyToPrint"]} ({approvedItems.length})
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.order"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.customer"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.approvalDate"]}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {approvedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm">{item.orderNumber}</td>
                    <td className="px-4 py-3 text-sm">{item.customerName}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(item.updatedAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${item.id}`} className="text-sm text-blue-600 hover:text-blue-800">
                        {d["admin.printQueue.view"]}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Currently printing */}
      {printingItems.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {d["admin.printQueue.currentlyPrinting"]} ({printingItems.length})
          </h2>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.order"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.customer"]}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {printingItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm">{item.orderNumber}</td>
                    <td className="px-4 py-3 text-sm">{item.customerName}</td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${item.id}`} className="text-sm text-blue-600 hover:text-blue-800">
                        {d["admin.printQueue.view"]}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">{d["admin.printQueue.empty"]}</p>
          <p className="text-sm mt-1">{d["admin.printQueue.emptySubtitle"]}</p>
        </div>
      )}
    </div>
  );
}
