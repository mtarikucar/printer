export const dynamic = "force-dynamic";

import Link from "next/link";
import { listPendingGalleryReviews } from "@/lib/services/gallery-review";

/**
 * Admin gallery-moderation queue. Lists every order whose customer has
 * opted in to gallery publication and is waiting for review.
 *
 * Layout deliberately follows the existing /admin/drafts list — same card
 * styling, same admin-sidebar context (set in src/app/admin/layout.tsx).
 */
export default async function AdminGalleryQueuePage() {
  const items = await listPendingGalleryReviews(200);

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Galeri Yayın Kuyruğu</h1>
          <p className="text-sm text-gray-500 mt-1">
            Müşteri figürinlerini galeride yayınlama talepleri. Her birini
            önizleyin, kategori/etiket düzenleyin, onaylayın veya hediye
            çeki ile birlikte onaylayın.
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
          {items.length} bekliyor
        </span>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Bekleyen başvuru yok.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((it) => (
            <Link
              key={it.id}
              href={`/admin/gallery-queue/${it.id}`}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-indigo-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="font-mono text-sm text-indigo-600">{it.orderNumber}</span>
                <span className="text-xs text-gray-400">
                  {new Date(it.createdAt).toLocaleDateString("tr-TR")}
                </span>
              </div>
              <p className="text-sm text-gray-900 mb-2">
                {it.publicDisplayName || it.customerName}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {it.figurineSize}
                </span>
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                  {it.style}
                </span>
                {it.galleryCategory && (
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                    {it.galleryCategory}
                  </span>
                )}
                {it.galleryTags?.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
