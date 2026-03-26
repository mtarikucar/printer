"use client";

import Link from "next/link";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

interface QueueItem {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  manufacturerStatus: string | null;
  manufacturerName: string | null;
  updatedAt: string;
}

function QueueTable({
  items,
  showManufacturer,
  d,
  locale,
}: {
  items: QueueItem[];
  showManufacturer: boolean;
  d: Record<string, string>;
  locale: Locale;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4 text-center">
        {d["admin.manufacturingQueue.noOrders"]}
      </p>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              {d["admin.printQueue.table.order"]}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              {d["admin.printQueue.table.customer"]}
            </th>
            {showManufacturer && (
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.manufacturingQueue.manufacturer"]}
              </th>
            )}
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
              {d["admin.printQueue.table.approvalDate"]}
            </th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono text-sm">{item.orderNumber}</td>
              <td className="px-4 py-3 text-sm">{item.customerName}</td>
              {showManufacturer && (
                <td className="px-4 py-3 text-sm text-gray-600">
                  {item.manufacturerName || "-"}
                </td>
              )}
              <td className="px-4 py-3 text-sm text-gray-500">
                {formatDate(item.updatedAt, locale)}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/admin/orders/${item.id}`}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {d["admin.printQueue.view"]}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrintQueueClient({ items }: { items: QueueItem[] }) {
  const d = useDictionary();
  const locale = useLocale();

  // Unassigned: approved, no manufacturer or unassigned status
  const unassignedItems = items.filter(
    (i) =>
      i.status === "approved" &&
      (!i.manufacturerStatus || i.manufacturerStatus === "unassigned")
  );

  // Waiting acceptance: assigned but not yet accepted
  const waitingItems = items.filter(
    (i) => i.manufacturerStatus === "assigned"
  );

  // In production: accepted or printing by manufacturer
  const inProductionItems = items.filter(
    (i) =>
      i.manufacturerStatus === "accepted" ||
      i.manufacturerStatus === "printing" ||
      // Backward compat: printing without manufacturer
      (i.status === "printing" && !i.manufacturerStatus)
  );

  // Ready to ship: printed by manufacturer
  const readyToShipItems = items.filter(
    (i) => i.manufacturerStatus === "printed"
  );

  const sections = [
    {
      title: d["admin.manufacturingQueue.unassigned"],
      items: unassignedItems,
      showManufacturer: false,
    },
    {
      title: d["admin.manufacturingQueue.assigned"],
      items: waitingItems,
      showManufacturer: true,
    },
    {
      title: d["admin.manufacturingQueue.inProduction"],
      items: inProductionItems,
      showManufacturer: true,
    },
    {
      title: d["admin.manufacturingQueue.printed"],
      items: readyToShipItems,
      showManufacturer: true,
    },
  ];

  return (
    <div className="mt-6 space-y-8">
      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {section.title} ({section.items.length})
          </h2>
          <QueueTable
            items={section.items}
            showManufacturer={section.showManufacturer}
            d={d}
            locale={locale}
          />
        </div>
      ))}

      {items.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">{d["admin.printQueue.empty"]}</p>
          <p className="text-sm mt-1">{d["admin.printQueue.emptySubtitle"]}</p>
        </div>
      )}
    </div>
  );
}
