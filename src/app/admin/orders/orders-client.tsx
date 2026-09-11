"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { sizeDisplay } from "@/lib/config/sizes";
import { isRefunded } from "@/lib/config/order-status-policy";

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-blue-100 text-blue-700",
  awaiting_model: "bg-indigo-50 text-indigo-700",
  generating: "bg-indigo-100 text-indigo-700",
  processing_mesh: "bg-indigo-100 text-indigo-700",
  review: "bg-yellow-100 text-yellow-700",
  awaiting_customer_approval: "bg-cyan-100 text-cyan-800",
  approved: "bg-green-100 text-green-700",
  printing: "bg-purple-100 text-purple-700",
  quality_check: "bg-orange-100 text-orange-700",
  painting: "bg-fuchsia-100 text-fuchsia-700",
  shipped: "bg-emerald-100 text-emerald-700",
  delivered: "bg-emerald-100 text-emerald-700",
  failed_generation: "bg-red-100 text-red-700",
  failed_mesh: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

// `unassigned` is not a status bucket. It is paid work with no manufacturer on
// it: approved custom/upload orders, and paid marketplace orders (platform
// products live at `paid` until someone, or the auto-assigner, places them).
// Both would otherwise hide inside the crowded "in progress" bucket.
// `refunded` holds every refunded order. A refunded order keeps its status but
// is frozen (no forward action is allowed), so the work buckets leave it out.
// `refunded_open` is the part of it that is not closed yet (not rejected or
// delivered) and still has to be settled with its partner; the dashboard's
// "İade edildi (açık)" card opens it.
const BUCKET_ORDER = [
  "all",
  "needsAction",
  "unassigned",
  "painting",
  "inProgress",
  "completed",
  "problems",
  "refunded",
  "refunded_open",
] as const;

const BUCKET_LABELS: Partial<Record<(typeof BUCKET_ORDER)[number], string>> = {
  unassigned: "Üretici bekliyor",
  painting: "Boyama",
  refunded: "İade edildi",
  refunded_open: "İade edildi (açık)",
};

// Painter-side state, kept short enough for a table cell. The manufacturing
// queue shows the same chips for orders that are with a painter.
export const PAINTER_BADGE: Record<string, { label: string; cls: string }> = {
  assigned: { label: "Boyacı kabul bekliyor", cls: "bg-amber-100 text-amber-800" },
  accepted: { label: "Boyacıda", cls: "bg-fuchsia-100 text-fuchsia-800" },
  painting: { label: "Boyanıyor", cls: "bg-fuchsia-100 text-fuchsia-800" },
  painted: { label: "Boyandı", cls: "bg-fuchsia-100 text-fuchsia-800" },
  qc_pending: { label: "Boyacı QC", cls: "bg-yellow-100 text-yellow-800" },
  qc_rejected: { label: "Boyacı QC ret", cls: "bg-red-100 text-red-700" },
  qc_approved: { label: "Boyacı QC onaylı", cls: "bg-green-100 text-green-700" },
  shipped: { label: "Boyacı kargoladı", cls: "bg-emerald-100 text-emerald-700" },
};

// Exact statuses for the power-user dropdown: every order_status value, in
// lifecycle order. `pending_payment` is not one (it exists on drafts and gift
// cards only). Offering it made Postgres reject the filter and 500 the page.
const EXACT_STATUSES = [
  "paid",
  "awaiting_model",
  "generating",
  "processing_mesh",
  "review",
  "awaiting_customer_approval",
  "approved",
  "printing",
  "quality_check",
  "painting",
  "shipped",
  "delivered",
  "failed_generation",
  "failed_mesh",
  "rejected",
];

type BulkAction = "approve" | "start-printing";

interface BulkResult {
  tone: "ok" | "warn" | "error";
  text: string;
}

// What the bulk-action route requires, in words, for the "atlandı" line. It
// mirrors the route's guarded UPDATE: the status the action starts from, not
// refunded, and for printing no manufacturer on the order. The route answers
// with counts only, so the line names the rule rather than a per-order reason.
const BULK_ACTION_COPY: Record<BulkAction, { done: string; rule: string }> = {
  approve: {
    done: "onaylandı",
    rule: "yalnız incelemedeki ve iade edilmemiş siparişler onaylanabilir",
  },
  "start-printing": {
    done: "baskıya alındı",
    rule: "baskı yalnız onaylı, üreticisi olmayan ve iade edilmemiş siparişlerde başlatılabilir",
  },
};

function bulkSummary(action: BulkAction, processed: number, skipped: number): BulkResult {
  const copy = BULK_ACTION_COPY[action];
  const done =
    processed > 0 ? `${processed} sipariş ${copy.done}.` : "Hiçbir sipariş işlenmedi.";
  if (skipped === 0) return { tone: "ok", text: done };
  return { tone: "warn", text: `${done} ${skipped} sipariş atlandı: ${copy.rule}.` };
}

const BULK_RESULT_TONE: Record<BulkResult["tone"], string> = {
  ok: "border-green-200 bg-green-50 text-green-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
};

interface OrdersClientProps {
  orders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    email: string;
    figurineSize: string | null;
    style: string;
    status: string;
    paymentStatus: string;
    needsPainting: boolean;
    painterStatus: string | null;
    isBulk: boolean;
    quantity: number;
    amountKurus: number;
    createdAt: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
  filters: { status?: string; bucket?: string; q?: string; dateFrom?: string; dateTo?: string };
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
  // Outcome of the last bulk action, shown inline above the table.
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the selection, and the last bulk result (it is about the old list),
  // when orders change (filter/page navigation)
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkResult(null);
  }, [page, filters.status, filters.bucket, filters.q, filters.dateFrom, filters.dateTo]);

  const totalPages = Math.ceil(total / pageSize);
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  // Build URL from params
  const buildUrl = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const params = new URLSearchParams();
      const merged = {
        status: filters.status,
        bucket: filters.bucket,
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
    async (action: BulkAction) => {
      const picked = orders.filter((o) => selectedIds.has(o.id));
      // Refunded orders are frozen: never send one into a forward bulk action,
      // even when it still sits at review/approved and got ticked. They still
      // count as skipped below, so processed + skipped = the selection.
      const orderIds = picked.filter((o) => !isRefunded(o)).map((o) => o.id);
      const skippedHere = picked.length - orderIds.length;
      if (orderIds.length === 0) return;
      setBulkLoading(true);
      setBulkResult(null);
      try {
        const res = await fetch("/api/admin/orders/bulk-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderIds,
            action,
          }),
        });
        if (!res.ok) {
          // The route's own error text is English, so it is not shown.
          setBulkResult({
            tone: "error",
            text: "Toplu işlem yapılamadı. Sayfayı yenileyip tekrar deneyin.",
          });
          return;
        }
        // The route skips, without failing, every order its guarded UPDATE
        // does not match: one refunded or moved on after this page loaded, or
        // (printing) one a manufacturer took. The counts used to be ignored,
        // so such a skip was silent.
        const body = (await res.json().catch(() => ({}))) as {
          processed?: unknown;
          skipped?: unknown;
        };
        if (typeof body.processed === "number" && typeof body.skipped === "number") {
          setBulkResult(bulkSummary(action, body.processed, body.skipped + skippedHere));
        } else {
          setBulkResult({
            tone: "warn",
            text: "İşlem gönderildi ama sonuç okunamadı. Listeden siparişlerin durumunu kontrol edin.",
          });
        }
        setSelectedIds(new Set());
        router.refresh();
      } catch {
        setBulkResult({
          tone: "error",
          text: "Sunucuya ulaşılamadı. Siparişlerin son durumunu görmek için sayfayı yenileyin.",
        });
      } finally {
        setBulkLoading(false);
      }
    },
    [orders, selectedIds, router]
  );

  // Check if selected orders can be bulk-actioned (a refunded one never can)
  const selectedOrders = orders.filter(
    (o) => selectedIds.has(o.id) && !isRefunded(o)
  );
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

      {/* Status buckets + exact-status dropdown */}
      <div className="flex gap-2 flex-wrap items-center">
        {BUCKET_ORDER.map((b) => {
          const active =
            (b === "all" && !filters.bucket && !filters.status) ||
            (b !== "all" && filters.bucket === b && !filters.status);
          return (
            <Link
              key={b}
              href={buildUrl({
                bucket: b === "all" ? undefined : b,
                status: undefined,
                page: "1",
              })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {BUCKET_LABELS[b] ?? d[`admin.orders.bucket.${b}` as keyof typeof d]}
            </Link>
          );
        })}

        {/* Exact-status filter for power users (mutually exclusive with buckets) */}
        <select
          value={filters.status ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            router.push(buildUrl({ status: v || undefined, bucket: undefined, page: "1" }));
          }}
          className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="">{d["admin.orders.exactStatus"]}</option>
          {EXACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {d[`admin.status.${s}` as keyof typeof d] || s}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-gray-900 text-white px-4 py-2.5 rounded-xl">
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

      {/* Result of the last bulk action. Inline rather than alert(): it
          stays visible after the list refreshes and says what was skipped. */}
      {bulkResult && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${BULK_RESULT_TONE[bulkResult.tone]}`}
        >
          <p>{bulkResult.text}</p>
          <button
            type="button"
            onClick={() => setBulkResult(null)}
            className="shrink-0 text-xs font-medium underline"
          >
            Kapat
          </button>
        </div>
      )}

      {/* Orders table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[760px]">
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
                  {order.isBulk && (
                    <span
                      className="ml-2 inline-block rounded bg-orange-100 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-orange-700"
                      title={`Toplu üretim — ${order.quantity} adet`}
                    >
                      Toplu · {order.quantity}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">
                    {order.customerName}
                  </p>
                  <p className="text-xs text-gray-500">{order.email}</p>
                </td>
                <td className="px-4 py-3 text-sm">
                  {sizeDisplay(order.figurineSize, d, { short: true }) || "—"}
                </td>
                <td className="px-4 py-3 text-sm">
                  {d[
                    `create.style.${order.style}` as keyof typeof d
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
                  {/* A refunded order keeps its status, so the status chip
                      alone would read as live work. */}
                  {isRefunded(order) && (
                    <span className="ml-1 inline-block rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                      İade edildi
                    </span>
                  )}
                  {/* Painter state is a parallel track: the order status says
                      "painting" for every stage of it, so without this the desk
                      can't tell "waiting for the painter to accept" from
                      "painted, awaiting QC". */}
                  {order.needsPainting && (
                    <span
                      className={`ml-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        PAINTER_BADGE[order.painterStatus ?? ""]?.cls ??
                        "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {PAINTER_BADGE[order.painterStatus ?? ""]?.label ??
                        "Boyacı atanmadı"}
                    </span>
                  )}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            {/* The dictionary (tr and en) names these {from} and {to}; the
                client replaced {start} and {end}, so the raw placeholders
                showed. */}
            {(d["admin.orders.showingRange"] as string)
              .replace("{from}", String(rangeStart))
              .replace("{to}", String(rangeEnd))
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
