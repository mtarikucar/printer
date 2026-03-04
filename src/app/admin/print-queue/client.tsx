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
  stlUrl: string | null;
  updatedAt: string;
}

export function PrintQueueClient({ items }: { items: QueueItem[] }) {
  const d = useDictionary();
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  };

  const downloadSelected = () => {
    for (const id of selected) {
      const item = items.find((i) => i.id === id);
      if (item?.stlUrl) {
        window.open(item.stlUrl, "_blank");
      }
    }
  };

  const approvedItems = items.filter((i) => i.status === "approved");
  const printingItems = items.filter((i) => i.status === "printing");

  return (
    <div className="mt-6 space-y-8">
      {/* Action bar */}
      {items.length > 0 && (
        <div className="flex gap-3">
          <button
            onClick={downloadSelected}
            disabled={selected.size === 0}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {d["admin.printQueue.downloadStl"]} ({selected.size})
          </button>
        </div>
      )}

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
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      onChange={toggleAll}
                      checked={selected.size === items.length && items.length > 0}
                      className="rounded"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.order"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.customer"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.approvalDate"]}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{d["admin.printQueue.table.stl"]}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {approvedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{item.orderNumber}</td>
                    <td className="px-4 py-3 text-sm">{item.customerName}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(item.updatedAt, locale)}
                    </td>
                    <td className="px-4 py-3">
                      {item.stlUrl ? (
                        <a href={item.stlUrl} className="text-sm text-blue-600 hover:text-blue-800" download>
                          {d["admin.printQueue.download"]}
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">{d["admin.printQueue.notAvailable"]}</span>
                      )}
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
