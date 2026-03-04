"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { GalleryCard, type GalleryItem } from "@/components/gallery-card";
import { GalleryModal } from "@/components/gallery-modal";
import { useDictionary } from "@/lib/i18n/locale-context";

export function GalleryGrid({
  initialItems,
  initialCursor,
}: {
  initialItems: GalleryItem[];
  initialCursor: string | null;
}) {
  const d = useDictionary();
  const [items, setItems] = useState<GalleryItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gallery?cursor=${encodeURIComponent(cursor)}`);
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => [...prev, ...data.items]);
        setCursor(data.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  if (items.length === 0) {
    return (
      <div className="card p-12 text-center">
        <svg className="w-20 h-20 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="mt-6 text-lg font-medium text-text-secondary">{d["gallery.empty"]}</p>
        <Link
          href="/create"
          className="btn-primary mt-6 inline-flex"
        >
          {d["gallery.createYourOwn"]}
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Masonry layout */}
      <div className="columns-2 md:columns-3 lg:columns-4 gap-4 sm:gap-6 [&>*]:mb-4 sm:[&>*]:mb-6">
        {items.map((item) => (
          <div key={item.id} className="break-inside-avoid">
            <GalleryCard
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          </div>
        ))}
      </div>

      {cursor && (
        <div className="mt-10 text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="btn-secondary"
          >
            {loading && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? d["gallery.loading"] : d["gallery.loadMore"]}
          </button>
        </div>
      )}

      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </>
  );
}
