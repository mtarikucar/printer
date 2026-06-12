export const dynamic = "force-dynamic";

import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * Admin QC queue — orders whose manufacturer has uploaded finished-product
 * photos and submitted them for review (manufacturerStatus = 'qc_pending').
 * Each card links to the order detail where the admin approves/rejects.
 * Mirrors /admin/gallery-queue styling + the admin-sidebar layout.
 */
export default async function AdminQcQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const items = await db.query.orders.findMany({
    where: eq(orders.manufacturerStatus, "qc_pending"),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      figurineSize: true,
      style: true,
      qcRound: true,
      updatedAt: true,
    },
    with: {
      manufacturer: { columns: { companyName: true } },
      qcPhotos: { columns: { round: true } },
    },
    orderBy: [desc(orders.updatedAt)],
    limit: 200,
  });

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{d["admin.qcQueue.title"]}</h1>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">{d["admin.qcQueue.empty"]}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((it) => {
            const photoCount = it.qcPhotos.filter((p) => p.round === it.qcRound).length;
            return (
              <Link
                key={it.id}
                href={`/admin/orders/${it.id}`}
                className="bg-white rounded-xl border border-gray-200 p-5 hover:border-amber-400 hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="font-mono text-sm text-amber-600">{it.orderNumber}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(it.updatedAt).toLocaleDateString(
                      locale === "tr" ? "tr-TR" : "en-US"
                    )}
                  </span>
                </div>
                <p className="text-sm text-gray-900 mb-1">{it.customerName}</p>
                {it.manufacturer && (
                  <p className="text-xs text-gray-500 mb-2">{it.manufacturer.companyName}</p>
                )}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {it.figurineSize}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {it.style}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {photoCount} {d["admin.qcQueue.photos"]}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
