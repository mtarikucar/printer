"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface BulkProductGroup {
  productId: string;
  title: string;
  imageUrl: string | null;
  totalUnits: number;
  unassignedUnits: number;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    units: number;
    createdAt: string;
    manufacturerName: string | null;
    unassigned: boolean;
  }>;
  byManufacturer: Array<{ name: string; units: number }>;
}

interface Props {
  groups: BulkProductGroup[];
  manufacturers: Array<{
    id: string;
    companyName: string;
    acceptingOrders: boolean;
  }>;
}

export function BulkOrdersClient({ groups, manufacturers }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const assignAll = async (group: BulkProductGroup) => {
    const manufacturerId = picked[group.productId];
    if (!manufacturerId) return;
    const orderIds = [
      ...new Set(group.orders.filter((o) => o.unassigned).map((o) => o.orderId)),
    ];
    if (orderIds.length === 0) return;

    setBusy(group.productId);
    setMessage(null);
    try {
      const r = await fetch("/api/admin/bulk-orders/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturerId, orderIds }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage(d.error || "Atama başarısız");
        return;
      }
      // A partial result is normal (someone else may have grabbed an order in
      // the meantime) — say so instead of silently showing a smaller number.
      const skipped = (d.skipped ?? []).length;
      setMessage(
        skipped > 0
          ? `${d.assignedCount} sipariş atandı, ${skipped} tanesi atlandı (araya başka bir atama girmiş olabilir).`
          : `${d.assignedCount} sipariş atandı.`
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (groups.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-10 text-center text-gray-500">
        Açık toplu sipariş yok.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {message && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {message}
        </div>
      )}

      {groups.map((g) => {
        const unassignedOrders = g.orders.filter((o) => o.unassigned);
        const isOpen = expanded === g.productId;
        return (
          <div
            key={g.productId}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
          >
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {g.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">{g.title}</p>
                <p className="mt-0.5 text-sm text-gray-600">
                  <strong>{g.totalUnits} adet</strong> · {g.orders.length} sipariş
                  {g.unassignedUnits > 0 && (
                    <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700">
                      {g.unassignedUnits} adet üretici bekliyor
                    </span>
                  )}
                </p>
                {g.byManufacturer.length > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {g.byManufacturer
                      .map((m) => `${m.name}: ${m.units} adet`)
                      .join(" · ")}
                  </p>
                )}
              </div>

              {unassignedOrders.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={picked[g.productId] ?? ""}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [g.productId]: e.target.value }))
                    }
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Üretici seç…</option>
                    {manufacturers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.companyName}
                        {m.acceptingOrders ? "" : " (sipariş almıyor)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => assignAll(g)}
                    disabled={!picked[g.productId] || busy === g.productId}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {busy === g.productId
                      ? "Atanıyor…"
                      : `${unassignedOrders.length} siparişi ata`}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : g.productId)}
                className="text-sm text-gray-500 hover:text-gray-900"
              >
                {isOpen ? "Gizle" : "Siparişler"}
              </button>
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1">Sipariş</th>
                      <th className="py-1">Adet</th>
                      <th className="py-1">Üretici</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* One order can appear twice here — two variant lines of
                        the same product — so the row key needs the index, not
                        just orderId+units (those can be identical). */}
                    {g.orders.map((o, i) => (
                      <tr key={`${o.orderId}-${i}`} className="border-t border-gray-200">
                        <td className="py-1.5">
                          <Link
                            href={`/admin/orders/${o.orderId}`}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {o.orderNumber}
                          </Link>
                        </td>
                        <td className="py-1.5">{o.units}</td>
                        <td className="py-1.5">
                          {o.manufacturerName ?? (
                            <span className="text-orange-700">Atanmadı</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
