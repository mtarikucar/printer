"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

interface Manufacturer {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  status: string;
  activeOrders: number;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending_approval: "admin.manufacturers.statusPending",
  active: "admin.manufacturers.statusActive",
  suspended: "admin.manufacturers.statusSuspended",
};

type FilterTab = "all" | "pending_approval" | "active" | "suspended";

export function ManufacturersClient({
  manufacturers,
  locale,
}: {
  manufacturers: Manufacturer[];
  locale: string;
}) {
  const d = useDictionary();
  const loc = locale as Locale;
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [loading, setLoading] = useState<string | null>(null);

  const filtered =
    filter === "all"
      ? manufacturers
      : manufacturers.filter((m) => m.status === filter);

  const performAction = async (
    id: string,
    action: "activate" | "suspend"
  ) => {
    setLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} failed`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: "all", label: d["admin.manufacturers.filterAll"] },
    { key: "pending_approval", label: d["admin.manufacturers.filterPending"] },
    { key: "active", label: d["admin.manufacturers.filterActive"] },
    { key: "suspended", label: d["admin.manufacturers.filterSuspended"] },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        {d["admin.manufacturers.title"]}
      </h1>
      <p className="text-gray-500 mt-1">
        {d["admin.manufacturers.subtitle"]}
      </p>

      {/* Filter tabs */}
      <div className="mt-6 flex gap-2">
        {tabs.map((tab) => {
          const count =
            tab.key === "all"
              ? manufacturers.length
              : manufacturers.filter((m) => m.status === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === tab.key
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="mt-8 text-center py-12 text-gray-500">
          <p className="text-lg">{d["admin.manufacturers.empty"]}</p>
        </div>
      ) : (
        <div className="mt-6 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.companyName"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.contactPerson"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.email"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.status"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.activeOrders"]}
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                  {d["admin.manufacturers.registeredAt"]}
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {m.companyName}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {m.contactPerson}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {m.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[m.status] || "bg-gray-100 text-gray-700"}`}
                    >
                      {d[STATUS_LABEL_KEY[m.status] as keyof typeof d] || m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                    {m.activeOrders}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(m.createdAt, loc)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      {(m.status === "pending_approval" ||
                        m.status === "suspended") && (
                        <button
                          onClick={() => performAction(m.id, "activate")}
                          disabled={loading === `activate-${m.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `activate-${m.id}`
                            ? d["admin.manufacturers.activating"]
                            : d["admin.manufacturers.activate"]}
                        </button>
                      )}
                      {m.status === "active" && (
                        <button
                          onClick={() => performAction(m.id, "suspend")}
                          disabled={loading === `suspend-${m.id}`}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `suspend-${m.id}`
                            ? d["admin.manufacturers.suspending"]
                            : d["admin.manufacturers.suspend"]}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
