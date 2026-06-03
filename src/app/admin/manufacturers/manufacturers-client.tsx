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
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  requiresManualTaxReview: boolean;
  status: string;
  activeOrders: number;
  createdAt: string;
  rejectionReason: string | null;
  printerPhotoUploadedAt: string | null;
  printerPhotoUrl: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  pending_approval: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  suspended: "bg-red-100 text-red-700",
  conditionally_approved: "bg-blue-100 text-blue-700",
  rejected: "bg-gray-200 text-gray-600",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending_approval: "admin.manufacturers.statusPending",
  active: "admin.manufacturers.statusActive",
  suspended: "admin.manufacturers.statusSuspended",
  conditionally_approved: "admin.manufacturers.statusConditional",
  rejected: "admin.manufacturers.statusRejected",
};

type FilterTab =
  | "all"
  | "pending_approval"
  | "conditionally_approved"
  | "rejected"
  | "manual_review"
  | "active"
  | "suspended";

function matchesFilter(m: Manufacturer, filter: FilterTab): boolean {
  if (filter === "all") return true;
  if (filter === "manual_review") {
    return m.requiresManualTaxReview && m.status !== "suspended";
  }
  return m.status === filter;
}

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

  const filtered = manufacturers.filter((m) => matchesFilter(m, filter));

  const performAction = async (
    id: string,
    action: "activate" | "suspend" | "conditionally-approve" | "approve" | "reject"
  ) => {
    let body: string | undefined;
    if (action === "reject") {
      const input = window.prompt(d["admin.manufacturers.rejectPrompt"]);
      const reason = input && input.trim() ? input.trim() : undefined;
      body = JSON.stringify({ reason });
    }
    setLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
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
    { key: "conditionally_approved", label: d["admin.manufacturers.filterConditional"] },
    { key: "rejected", label: d["admin.manufacturers.filterRejected"] },
    {
      key: "manual_review",
      label: d["admin.manufacturers.filterManualReview"],
    },
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
          const count = manufacturers.filter((m) =>
            matchesFilter(m, tab.key)
          ).length;
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
                  {d["admin.manufacturers.colTaxId"]}
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
                    {m.status === "rejected" && m.rejectionReason ? (
                      <p className="mt-1 text-xs text-gray-500 max-w-[200px] truncate" title={m.rejectionReason}>
                        {m.rejectionReason}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {m.taxId && m.taxIdType ? (
                      <span className="font-mono text-gray-700">
                        {m.taxIdType.toUpperCase()}: {m.taxId}
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        {d["admin.manufacturers.badgeManualReview"]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-center">
                    {m.activeOrders}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(m.createdAt, loc)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end items-center">
                      {m.status === "pending_approval" && (
                        <>
                          <button
                            onClick={() => performAction(m.id, "conditionally-approve")}
                            disabled={loading === `conditionally-approve-${m.id}`}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.conditionallyApprove"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "conditionally_approved" && (
                        <>
                          {m.printerPhotoUrl ? (
                            <a
                              href={m.printerPhotoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                            >
                              {d["admin.manufacturers.viewPrinterPhoto"]}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">{d["admin.manufacturers.awaitingPhoto"]}</span>
                          )}
                          <button
                            onClick={() => performAction(m.id, "approve")}
                            disabled={!m.printerPhotoUploadedAt || loading === `approve-${m.id}`}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            {d["admin.manufacturers.approve"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "suspended" && (
                        <button
                          onClick={() => performAction(m.id, "activate")}
                          disabled={loading === `activate-${m.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `activate-${m.id}` ? d["admin.manufacturers.activating"] : d["admin.manufacturers.activate"]}
                        </button>
                      )}
                      {m.status === "active" && (
                        <button
                          onClick={() => performAction(m.id, "suspend")}
                          disabled={loading === `suspend-${m.id}`}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `suspend-${m.id}` ? d["admin.manufacturers.suspending"] : d["admin.manufacturers.suspend"]}
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
