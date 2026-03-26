"use client";

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

interface ManufacturerDashboardClientProps {
  status: string;
  companyName: string;
  metrics: {
    totalOrders: number;
    newAssignments: number;
    accepted: number;
    currentlyPrinting: number;
    printed: number;
    shippedThisMonth: number;
  } | null;
  recentOrders: {
    id: string;
    orderNumber: string;
    customerName: string;
    figurineSize: string;
    style: string;
    manufacturerStatus: string | null;
    assignedAt: string | null;
  }[];
  locale: string;
}

export function ManufacturerDashboardClient({
  status,
  companyName,
  metrics,
  recentOrders,
  locale,
}: ManufacturerDashboardClientProps) {
  const d = useDictionary();
  const loc = locale as Locale;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        {(d["manufacturer.dashboard.title" as keyof typeof d] as string) ||
          "Dashboard"}
      </h1>
      <p className="text-gray-500 mt-1">
        {(d["manufacturer.dashboard.welcome" as keyof typeof d] as string) ||
          "Welcome"},{" "}
        {companyName}
      </p>

      {/* Pending approval banner */}
      {status === "pending_approval" && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-amber-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-amber-900">
                {(d["manufacturer.dashboard.pendingTitle" as keyof typeof d] as string) ||
                  "Account Pending Approval"}
              </h2>
              <p className="text-sm text-amber-700 mt-1">
                {(d["manufacturer.dashboard.pendingMessage" as keyof typeof d] as string) ||
                  "Your manufacturer account is currently under review. You will be able to receive and manage orders once an administrator approves your account."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Suspended banner */}
      {status === "suspended" && (
        <div className="mt-6 bg-red-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-red-900">
                {(d["manufacturer.dashboard.suspendedTitle" as keyof typeof d] as string) ||
                  "Account Suspended"}
              </h2>
              <p className="text-sm text-red-700 mt-1">
                {(d["manufacturer.dashboard.suspendedMessage" as keyof typeof d] as string) ||
                  "Your account has been suspended. Please contact the administrator for more information."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Metric cards - only show for active manufacturers */}
      {metrics && (
        <>
          <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                label:
                  (d["manufacturer.dashboard.totalOrders" as keyof typeof d] as string) ||
                  "Total Orders",
                value: metrics.totalOrders,
                color: "bg-blue-500",
              },
              {
                label:
                  (d["manufacturer.dashboard.newAssignments" as keyof typeof d] as string) ||
                  "New Assignments",
                value: metrics.newAssignments,
                color: "bg-indigo-500",
              },
              {
                label:
                  (d["manufacturer.dashboard.accepted" as keyof typeof d] as string) ||
                  "Accepted",
                value: metrics.accepted,
                color: "bg-cyan-500",
              },
              {
                label:
                  (d["manufacturer.dashboard.currentlyPrinting" as keyof typeof d] as string) ||
                  "Currently Printing",
                value: metrics.currentlyPrinting,
                color: "bg-purple-500",
              },
              {
                label:
                  (d["manufacturer.dashboard.printed" as keyof typeof d] as string) ||
                  "Printed",
                value: metrics.printed,
                color: "bg-amber-500",
              },
              {
                label:
                  (d["manufacturer.dashboard.shippedThisMonth" as keyof typeof d] as string) ||
                  "Shipped This Month",
                value: metrics.shippedThisMonth,
                color: "bg-emerald-500",
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

          {/* Recent orders */}
          <div className="mt-8 bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {(d["manufacturer.dashboard.recentOrders" as keyof typeof d] as string) ||
                  "Recent Orders"}
              </h2>
              <Link
                href="/manufacturer/orders"
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                {(d["manufacturer.dashboard.viewAll" as keyof typeof d] as string) ||
                  "View All"}
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                {(d["manufacturer.dashboard.noOrders" as keyof typeof d] as string) ||
                  "No orders yet."}
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
                        {(d["manufacturer.dashboard.size" as keyof typeof d] as string) ||
                          "Size"}
                      </th>
                      <th className="text-left py-2 pr-3 font-medium text-gray-500">
                        {(d["manufacturer.dashboard.style" as keyof typeof d] as string) ||
                          "Style"}
                      </th>
                      <th className="text-left py-2 pr-3 font-medium text-gray-500">
                        {(d["manufacturer.dashboard.status" as keyof typeof d] as string) ||
                          "Status"}
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        {(d["manufacturer.dashboard.assigned" as keyof typeof d] as string) ||
                          "Assigned"}
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
                            href={`/manufacturer/orders/${order.id}`}
                            className="text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {(d[
                            `sizes.${order.figurineSize}` as keyof typeof d
                          ] as string) || order.figurineSize}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">
                          {(d[
                            `styles.${order.style}` as keyof typeof d
                          ] as string) || order.style}
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              MFR_STATUS_COLORS[
                                order.manufacturerStatus || ""
                              ] || "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {(d[
                              `manufacturer.status.${order.manufacturerStatus}` as keyof typeof d
                            ] as string) ||
                              order.manufacturerStatus?.replace(/_/g, " ") ||
                              "-"}
                          </span>
                        </td>
                        <td className="py-2 text-right text-gray-500">
                          {order.assignedAt
                            ? formatDate(order.assignedAt, loc)
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
