"use client";

import Link from "next/link";

interface VenueRow {
  id: string;
  name: string;
  contactName: string;
  contactPhone: string;
  city: string;
  district: string;
  status: string;
  createdAt: string;
}

// Aynı pill deseni: admin/workshop-requests/client.tsx'teki StatusBadge ile
// birebir aynı Tailwind sınıf konvansiyonu (rounded-full px-2 py-0.5 text-xs
// font-medium + renk çifti). Mekan durumu ayrı bir alan (text, enum değil).
const VENUE_STATUS: Record<string, { label: string; badge: string }> = {
  active: { label: "Aktif", badge: "bg-green-100 text-green-700" },
  paused: { label: "Duraklatıldı", badge: "bg-amber-100 text-amber-700" },
  archived: { label: "Arşivlendi", badge: "bg-gray-200 text-gray-600" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = VENUE_STATUS[status] ?? { label: status, badge: "bg-gray-100 text-gray-700" };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

export function WorkshopsClient({ venues }: { venues: VenueRow[] }) {
  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Atölyeler</h1>
        <p className="text-sm text-gray-500 mt-1">
          Kalıcı atölye mekanları ve her mekanda açılan seanslar.
        </p>
      </div>

      {venues.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          Henüz kayıtlı mekan yok. Bir atölye talebini onaylayıp mekana
          dönüştürün.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Mekan</th>
                <th className="px-4 py-3 font-medium">İletişim</th>
                <th className="px-4 py-3 font-medium">Konum</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Tarih</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {venues.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {v.name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {v.contactName}
                    <div className="text-xs text-gray-400">{v.contactPhone}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {v.city} / {v.district}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(v.createdAt).toLocaleDateString("tr-TR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/workshops/${v.id}`}
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
