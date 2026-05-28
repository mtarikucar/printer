"use client";

import { useState } from "react";

export interface AdminGalleryItem {
  id: string;
  orderNumber: string;
  name: string;
  figurineSize: string;
  style: string;
  category: string | null;
  tags: string[];
  slug: string | null;
  featured: boolean;
  publishedAt: string | null;
  thumbnailUrl: string | null;
}

export function AdminGalleryClient({ items: initial }: { items: AdminGalleryItem[] }) {
  const [items, setItems] = useState<AdminGalleryItem[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const featuredCount = items.filter((i) => i.featured).length;

  async function toggle(id: string, next: boolean) {
    setBusy(id);
    // Optimistic update — revert on failure.
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, featured: next } : i)));
    try {
      const res = await fetch(`/api/admin/gallery/${id}/feature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured: next }),
      });
      if (!res.ok) throw new Error("request failed");
    } catch {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, featured: !next } : i)));
      alert("Öne çıkarma güncellenemedi. Lütfen tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Galeri — Yayındakiler</h1>
          <p className="text-sm text-gray-500 mt-1">
            Yayınlanan figürinler. Yıldıza tıklayarak galerinin üstündeki
            &ldquo;Öne Çıkan Figürinler&rdquo; şeridine ekleyin veya çıkarın.
          </p>
        </div>
        <span className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
          {featuredCount} öne çıkan · {items.length} yayında
        </span>
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500">Henüz yayınlanmış figürin yok.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((it) => (
            <div
              key={it.id}
              className={`bg-white rounded-xl border overflow-hidden ${
                it.featured ? "border-amber-300 ring-1 ring-amber-200" : "border-gray-200"
              }`}
            >
              <div className="aspect-square bg-gray-100 relative">
                {it.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.thumbnailUrl}
                    alt={it.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                    görsel yok
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => toggle(it.id, !it.featured)}
                  disabled={busy === it.id}
                  title={it.featured ? "Öne çıkarmayı kaldır" : "Öne çıkar"}
                  aria-pressed={it.featured}
                  className={`absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors disabled:opacity-50 ${
                    it.featured
                      ? "bg-amber-500 text-white"
                      : "bg-black/40 text-white hover:bg-black/60"
                  }`}
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill={it.featured ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11.48 3.5l2.2 4.46 4.92.72-3.56 3.47.84 4.9L11.48 14.8 7.08 17.55l.84-4.9L4.36 9.18l4.92-.72 2.2-4.96z"
                    />
                  </svg>
                </button>
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-gray-900 truncate">{it.name}</p>
                <p className="font-mono text-[11px] text-gray-400 mt-0.5">{it.orderNumber}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {it.figurineSize}
                  </span>
                  {it.category && (
                    <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      {it.category}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
