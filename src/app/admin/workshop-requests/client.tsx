"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  WORKSHOP_STATUSES,
  workshopStatusMeta,
  venueTypeLabel,
  workshopTypeLabel,
} from "@/lib/workshop/constants";

interface WorkshopRequestRow {
  id: string;
  reference: string;
  contactName: string;
  organizationName: string | null;
  city: string;
  district: string;
  participantCount: number;
  venueType: string;
  workshopType: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
}

type Tab = "all" | string;

function StatusBadge({ status }: { status: string }) {
  const meta = workshopStatusMeta(status);
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

export function WorkshopRequestsClient({
  requests,
}: {
  requests: WorkshopRequestRow[];
}) {
  const [tab, setTab] = useState<Tab>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const s of WORKSHOP_STATUSES) c[s.value] = 0;
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  const filtered = useMemo(
    () => (tab === "all" ? requests : requests.filter((r) => r.status === tab)),
    [requests, tab]
  );

  const tabs: { value: Tab; label: string }[] = [
    { value: "all", label: "Tümü" },
    ...WORKSHOP_STATUSES.map((s) => ({ value: s.value, label: s.label })),
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Atölye talepleri</h1>
        <p className="text-sm text-gray-500 mt-1">
          Mekânında atölye düzenlemek isteyenlerden gelen talepler.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t.value
                ? "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t.label}
            <span
              className={`ml-1.5 ${
                tab === t.value ? "text-gray-300" : "text-gray-400"
              }`}
            >
              {counts[t.value] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          Bu durumda talep yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Referans</th>
                <th className="px-4 py-3 font-medium">Talep eden</th>
                <th className="px-4 py-3 font-medium">Konum</th>
                <th className="px-4 py-3 font-medium">Etkinlik</th>
                <th className="px-4 py-3 font-medium">Kişi</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Tarih</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-indigo-600">
                    {r.reference}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {r.contactName}
                    </div>
                    {r.organizationName && (
                      <div className="text-xs text-gray-500">
                        {r.organizationName}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.city} / {r.district}
                    <div className="text-xs text-gray-400">
                      {venueTypeLabel(r.venueType)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {workshopTypeLabel(r.workshopType)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.participantCount}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString("tr-TR")}
                    {r.scheduledAt && (
                      <div className="text-green-600 mt-0.5">
                        📅 {new Date(r.scheduledAt).toLocaleDateString("tr-TR")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/workshop-requests/${r.id}`}
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Detay →
                    </Link>
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
