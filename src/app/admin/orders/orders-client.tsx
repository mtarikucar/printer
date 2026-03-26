"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

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

const STATUSES = [
  "all",
  "pending_payment",
  "paid",
  "generating",
  "processing_mesh",
  "review",
  "approved",
  "printing",
  "shipped",
  "delivered",
  "failed_generation",
  "failed_mesh",
  "rejected",
];

interface OrdersClientProps {
  orders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    email: string;
    figurineSize: string;
    style: string;
    status: string;
    amountKurus: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  filters: { status?: string; q?: string; dateFrom?: string; dateTo?: string };
  locale: string;
}

export function OrdersClient({
  orders,
  total,
  page,
  pageSize,
  filters,
  locale,
}: OrdersClientProps) {
  const router = useRouter();
  const d = useDictionary();
  const [searchValue, setSearchValue] = useState(filters.q || "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear selection when orders change (filter/page navigation)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, filters.status, filters.q, filters.dateFrom, filters.dateTo]);

  const totalPages = Math.ceil(total / pageSize);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  // Build URL from params
  const buildUrl = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const params = new URLSearchParams();
      const merged = {
        status: filters.status,
        q: filters.q,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        page: String(page),
        ...overrides,
      };

      for (const [key, value] of Object.entries(merged)) {
        if (value && value !== "1" && key === "page") {
          params.set(key, value);
        } else if (value && key !== "page") {
          params.set(key, value);
        }
      }

      // Always include page if > 1
      if (merged.page && merged.page !== "1") {
        params.set("page", merged.page);
      }

      const qs = params.toString();
      return `/admin/orders${qs ? `?${qs}` : ""}`;
    },
    [filters, page]
  );

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const url = buildUrl({
          q: value || undefined,
          page: "1",
        });
        router.push(url);
      }, 500);
    },
    [buildUrl, router]
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Date filter handlers
  const handleDateFromChange = useCallback(
    (value: string) => {
      router.push(buildUrl({ dateFrom: value || undefined, page: "1" }));
    },
    [buildUrl, router]
  );

  const handleDateToChange = useCallback(
    (value: string) => {
      router.push(buildUrl({ dateTo: value || undefined, page: "1" }));
    },
    [buildUrl, router]
  );

  // Selection handlers
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === orders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map((o) => o.id)));
    }
  }, [orders, selectedIds.size]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Bulk actions
  const performBulkAction = useCallback(
    async (action: "approve" | "start-printing") => {
      if (selectedIds.size === 0) return;
      setBulkLoading(true);
      try {
        const res = await fetch("/api/admin/orders/bulk-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds: Array.from(selectedIds),
            action,
          }),
        });
        if (res.ok) {
          setSelectedIds(new Set());
          router.refresh();
        }
      } finally {
        setBulkLoading(false);
      }
    },
    [selectedIds, router]
  );

  // Check if selected orders can be bulk-actioned
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const canBulkApprove = selectedOrders.some((o) => o.status === "review");
  const canBulkPrint = selectedOrders.some((o) => o.status === "approved");

  return (
    <div className="mt-4 space-y-4">
      {/* Search and date filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={d["admin.orders.searchPlaceholder"]}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {d["admin.orders.dateFrom"]}
            </label>
            <input
              type="date"
              defaultValue={filters.dateFrom || ""}
              onChange={(e) => handleDateFromChange(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {d["admin.orders.dateTo"]}
            </label>
            <input
              type="date"
              defaultValue={filters.dateTo || ""}
              onChange={(e) => handleDateToChange(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>
        </div>
      </div>

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
              (s === "all" && !filters.status) || s === filters.status
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            {s === "all"
              ? d["admin.orders.all"]
              : d[`admin.status.${s}` as keyof typeof d] || s}
          </Link>
        ))}
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-gray-900 text-white px-4 py-2.5 rounded-xl">
          <span className="text-sm font-medium">
            {selectedIds.size} {d["admin.orders.selected"]}
          </span>
          <div className="flex-1" />
          {canBulkApprove && (
            <button
              onClick={() => performBulkAction("approve")}
              disabled={bulkLoading}
              className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-500 transition-colors"
            >
              {d["admin.orders.bulkApprove"]}
            </button>
          )}
          {canBulkPrint && (
            <button
              onClick={() => performBulkAction("start-printing")}
              disabled={bulkLoading}
              className="px-3 py-1.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:bg-gray-500 transition-colors"
            >
              {d["admin.orders.bulkStartPrint"]}
            </button>
          )}
        </div>
      )}

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={
                    orders.length > 0 && selectedIds.size === orders.length
                  }
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.order"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.customer"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.size"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.style"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.status"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.amount"]}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {d["admin.orders.table.date"]}
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-sm font-medium">
                  {order.orderNumber}
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {order.customerName}
                  </p>
                  <p className="text-xs text-gray-500">{order.email}</p>
                </td>
                <td className="px-4 py-3 text-sm">
                  {d[
                    `sizes.${order.figurineSize}` as keyof typeof d
                  ] || order.figurineSize}
                </td>
                <td className="px-4 py-3 text-sm">
                  {d[
                    `styles.${order.style}` as keyof typeof d
                  ] || order.style}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}
                  >
                    {d[
                      `admin.status.${order.status}` as keyof typeof d
                    ] || order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {formatCurrency(order.amountKurus, locale as Locale)}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {formatDate(order.createdAt, locale as Locale)}
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
            {orders.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  {d["admin.orders.empty"]}
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
            {(d["admin.orders.showingRange"] as string)
              .replace("{start}", String(rangeStart))
              .replace("{end}", String(rangeEnd))
              .replace("{total}", String(total))}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(buildUrl({ page: String(page - 1) }))}
              disabled={page <= 1}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {d["admin.orders.prev"]}
            </button>
            <button
              onClick={() => router.push(buildUrl({ page: String(page + 1) }))}
              disabled={page >= totalPages}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {d["admin.orders.next"]}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
