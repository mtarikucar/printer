"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

const MFR_STATUS_COLORS: Record<string, string> = {
  assigned: "bg-blue-100 text-blue-700",
  accepted: "bg-indigo-100 text-indigo-700",
  printing: "bg-purple-100 text-purple-700",
  printed: "bg-amber-100 text-amber-700",
  shipped: "bg-emerald-100 text-emerald-700",
};

const STATUSES = ["all", "assigned", "accepted", "printing", "printed", "shipped"];

interface ManufacturerOrdersClientProps {
  orders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    figurineSize: string;
    style: string;
    modifiers: string[] | null;
    manufacturerStatus: string | null;
    assignedAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
  filterStatus: string | null;
  locale: string;
}

export function ManufacturerOrdersClient({
  orders,
  total,
  page,
  pageSize,
  filterStatus,
  locale,
}: ManufacturerOrdersClientProps) {
  const router = useRouter();
  const d = useDictionary();
  const loc = locale as Locale;

  const totalPages = Math.ceil(total / pageSize);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const buildUrl = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const params = new URLSearchParams();
      const merged = {
        status: filterStatus || undefined,
        page: String(page),
        ...overrides,
      };

      for (const [key, value] of Object.entries(merged)) {
        if (value && key === "status") {
          params.set(key, value);
        }
      }

      if (merged.page && merged.page !== "1") {
        params.set("page", merged.page);
      }

      const qs = params.toString();
      return `/manufacturer/orders${qs ? `?${qs}` : ""}`;
    },
    [filterStatus, page]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">
        {(d["manufacturer.orders.title" as keyof typeof d] as string) ||
          "Orders"}
      </h1>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={buildUrl({
              status: s === "all" ? undefined : s,
              page: "1",
            })}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              (s === "all" && !filterStatus) || s === filterStatus
                ? "bg-indigo-600 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {s === "all"
              ? (d["manufacturer.orders.all" as keyof typeof d] as string) ||
                "All"
              : (d[
                  `manufacturer.status.${s}` as keyof typeof d
                ] as string) || s.charAt(0).toUpperCase() + s.slice(1)}
          </Link>
        ))}
      </div>

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.order" as keyof typeof d] as string) ||
                  "Order"}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.customer" as keyof typeof d] as string) ||
                  "Customer"}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.size" as keyof typeof d] as string) ||
                  "Size"}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.style" as keyof typeof d] as string) ||
                  "Style"}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.status" as keyof typeof d] as string) ||
                  "Status"}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {(d["manufacturer.orders.table.assigned" as keyof typeof d] as string) ||
                  "Assigned"}
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-sm font-medium">
                  {order.orderNumber}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {order.customerName}
                </td>
                <td className="px-4 py-3 text-sm">
                  {(d[
                    `sizes.${order.figurineSize}` as keyof typeof d
                  ] as string) || order.figurineSize}
                </td>
                <td className="px-4 py-3 text-sm">
                  {(d[
                    `styles.${order.style}` as keyof typeof d
                  ] as string) || order.style}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                      MFR_STATUS_COLORS[order.manufacturerStatus || ""] ||
                      "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {(d[
                      `manufacturer.status.${order.manufacturerStatus}` as keyof typeof d
                    ] as string) ||
                      order.manufacturerStatus?.replace(/_/g, " ") ||
                      "-"}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {order.assignedAt ? formatDate(order.assignedAt, loc) : "-"}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/manufacturer/orders/${order.id}`}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {(d["manufacturer.orders.view" as keyof typeof d] as string) ||
                      "View"}
                  </Link>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  {(d["manufacturer.orders.empty" as keyof typeof d] as string) ||
                    "No orders found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {((d["manufacturer.orders.showingRange" as keyof typeof d] as string) ||
              "Showing {start} to {end} of {total}")
              .replace("{start}", String(rangeStart))
              .replace("{end}", String(rangeEnd))
              .replace("{total}", String(total))}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() =>
                router.push(buildUrl({ page: String(page - 1) }))
              }
              disabled={page <= 1}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {(d["manufacturer.orders.prev" as keyof typeof d] as string) ||
                "Previous"}
            </button>
            <button
              onClick={() =>
                router.push(buildUrl({ page: String(page + 1) }))
              }
              disabled={page >= totalPages}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {(d["manufacturer.orders.next" as keyof typeof d] as string) ||
                "Next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
