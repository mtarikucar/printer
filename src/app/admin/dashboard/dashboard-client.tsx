"use client";

import Link from "next/link";
import { useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

interface DashboardClientProps {
  metrics: {
    total: number;
    todayOrders: number;
    pendingReview: number;
    approved: number;
    printing: number;
    shipped: number;
    delivered: number;
    failed: number;
    needsAttention: number;
    revenueKurus: number;
    todayRevenueKurus: number;
    giftCardsCreated: number;
    activeManufacturers: number;
    unassignedOrders: number;
    inProduction: number;
    pendingManufacturerApproval: number;
  };
  revenueTrend: { date: string; amount: number }[];
  recentOrders: {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    createdAt: string;
    amountKurus: number;
  }[];
  attentionOrders: {
    id: string;
    orderNumber: string;
    customerName: string;
    status: string;
    reason: string;
  }[];
  locale: string;
}

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

const REASON_COLORS: Record<string, string> = {
  reviewOverdue: "text-yellow-700 bg-yellow-50",
  paymentOverdue: "text-amber-700 bg-amber-50",
  failedOrder: "text-red-700 bg-red-50",
};

export function DashboardClient({
  metrics,
  revenueTrend,
  recentOrders,
  attentionOrders,
  locale,
}: DashboardClientProps) {
  const d = useDictionary();
  const loc = locale as Locale;

  const cards = [
    {
      label: d["admin.dashboard.totalOrders"],
      value: metrics.total,
      color: "bg-blue-500",
    },
    {
      label: d["admin.dashboard.todayOrders"],
      value: metrics.todayOrders,
      color: "bg-cyan-500",
    },
    {
      label: d["admin.dashboard.pendingReview"],
      value: metrics.pendingReview,
      color: "bg-yellow-500",
    },
    {
      label: d["admin.dashboard.approved"],
      value: metrics.approved,
      color: "bg-green-500",
    },
    {
      label: d["admin.dashboard.printing"],
      value: metrics.printing,
      color: "bg-purple-500",
    },
    {
      label: d["admin.dashboard.shipped"],
      value: metrics.shipped,
      color: "bg-emerald-500",
    },
    {
      label: d["admin.dashboard.delivered"],
      value: metrics.delivered,
      color: "bg-emerald-500",
    },
    {
      label: d["admin.dashboard.failedRejected"],
      value: metrics.failed,
      color: "bg-red-500",
    },
    {
      label: d["admin.dashboard.needsAttention"],
      value: metrics.needsAttention,
      color: "bg-orange-500",
    },
    {
      label: d["admin.dashboard.giftCardsCreated"],
      value: metrics.giftCardsCreated,
      color: "bg-pink-500",
    },
  ];

  const maxRevenue = Math.max(...revenueTrend.map((r) => r.amount), 1);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        {d["admin.dashboard.title"]}
      </h1>
      <p className="text-gray-500 mt-1">{d["admin.dashboard.subtitle"]}</p>

      {/* Metric cards */}
      <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-xl border border-gray-200 p-4"
          >
            <div className={`w-3 h-3 rounded-full ${card.color} mb-3`} />
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-sm text-gray-500">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Manufacturing metrics */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Manufacturing</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: d["admin.dashboard.activeManufacturers"],
              value: metrics.activeManufacturers,
              color: "bg-blue-500",
            },
            {
              label: d["admin.dashboard.unassignedOrders"],
              value: metrics.unassignedOrders,
              color: "bg-amber-500",
            },
            {
              label: d["admin.dashboard.inProduction"],
              value: metrics.inProduction,
              color: "bg-purple-500",
            },
            {
              label: d["admin.dashboard.pendingManufacturerApproval"],
              value: metrics.pendingManufacturerApproval,
              color: "bg-yellow-500",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className={`w-3 h-3 rounded-full ${card.color} mb-3`} />
              <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm text-gray-500">{card.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue summary */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {d["admin.dashboard.revenue"]}
          </h2>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {formatCurrency(metrics.revenueKurus, loc)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {d["admin.dashboard.revenueSubtitle"]}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900">
            {d["admin.dashboard.todayRevenue"]}
          </h2>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {formatCurrency(metrics.todayRevenueKurus, loc)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {formatDate(new Date().toISOString(), loc)}
          </p>
        </div>
      </div>

      {/* Revenue trend chart */}
      <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {d["admin.dashboard.revenueTrend"]}
        </h2>
        {revenueTrend.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            No revenue data yet.
          </p>
        ) : (
          <div className="flex items-end gap-1 h-48">
            {revenueTrend.map((day, i) => {
              const heightPct = (day.amount / maxRevenue) * 100;
              const dateObj = new Date(day.date);
              const showLabel =
                i === 0 ||
                i === revenueTrend.length - 1 ||
                i % 5 === 0;
              return (
                <RevenueBar
                  key={day.date}
                  heightPct={heightPct}
                  date={dateObj}
                  amount={day.amount}
                  showLabel={showLabel}
                  locale={loc}
                  barCount={revenueTrend.length}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Recent orders & attention alerts side by side */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent orders */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {d["admin.dashboard.recentOrders"]}
            </h2>
            <Link
              href="/admin/orders"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              {d["admin.dashboard.viewAll"]}
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No orders yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 font-medium text-gray-500">
                      #
                    </th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500">
                      Customer
                    </th>
                    <th className="text-left py-2 pr-3 font-medium text-gray-500">
                      Status
                    </th>
                    <th className="text-right py-2 pr-3 font-medium text-gray-500">
                      Amount
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          {order.orderNumber}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-gray-700 truncate max-w-[120px]">
                        {order.customerName}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}
                        >
                          {order.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {formatCurrency(order.amountKurus, loc)}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {formatDate(order.createdAt, loc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Attention alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {d["admin.dashboard.attentionAlerts"]}
          </h2>
          {attentionOrders.length === 0 ? (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-sm text-gray-500">
                {d["admin.dashboard.noAlerts"]}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {attentionOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/admin/orders/${order.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {order.orderNumber}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}
                      >
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">
                      {order.customerName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 ml-3 text-xs font-medium px-2 py-1 rounded-md ${REASON_COLORS[order.reason] || "text-gray-700 bg-gray-50"}`}
                  >
                    {d[
                      `admin.dashboard.${order.reason}` as keyof typeof d
                    ] || order.reason}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RevenueBar({
  heightPct,
  date,
  amount,
  showLabel,
  locale,
  barCount,
}: {
  heightPct: number;
  date: Date;
  amount: number;
  showLabel: boolean;
  locale: Locale;
  barCount: number;
}) {
  const [hovered, setHovered] = useState(false);

  const day = date.getDate();
  const month = date.getMonth() + 1;
  const label = `${day}/${month}`;

  return (
    <div
      className="relative flex flex-col items-center flex-1"
      style={{ minWidth: barCount > 20 ? 0 : 12 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Tooltip */}
      {hovered && (
        <div className="absolute bottom-full mb-2 z-10 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap pointer-events-none shadow-lg">
          <div className="font-medium">{formatDate(date.toISOString(), locale)}</div>
          <div>{formatCurrency(amount, locale)}</div>
          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
        </div>
      )}

      {/* Bar */}
      <div className="w-full flex items-end h-40">
        <div
          className="w-full bg-blue-500 hover:bg-blue-600 rounded-t transition-colors"
          style={{
            height: `${Math.max(heightPct, 2)}%`,
          }}
        />
      </div>

      {/* Label */}
      {showLabel && (
        <span className="text-[10px] text-gray-400 mt-1 leading-none">
          {label}
        </span>
      )}
    </div>
  );
}
