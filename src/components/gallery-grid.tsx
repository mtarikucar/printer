"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import { GalleryCard, type GalleryItem } from "@/components/gallery-card";
import { GalleryModal } from "@/components/gallery-modal";
import { useDictionary } from "@/lib/i18n/locale-context";

const STYLE_FILTERS = [
  { key: "all", labelKey: "gallery.filter.all" },
  { key: "object", labelKey: "gallery.filter.object" },
  { key: "disney", labelKey: "gallery.filter.disney" },
  { key: "anime", labelKey: "gallery.filter.anime" },
  { key: "chibi", labelKey: "gallery.filter.chibi" },
] as const;

const CATEGORY_FILTERS = [
  { key: "all", labelKey: "gallery.filter.all" },
  { key: "character", labelKey: "gallery.category.character" },
  { key: "couple", labelKey: "gallery.category.couple" },
  { key: "family", labelKey: "gallery.category.family" },
  { key: "pet", labelKey: "gallery.category.pet" },
  { key: "fantasy", labelKey: "gallery.category.fantasy" },
  { key: "funny", labelKey: "gallery.category.funny" },
  { key: "custom", labelKey: "gallery.category.custom" },
] as const;

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
  const [activeStyle, setActiveStyle] = useState("all");
  const [activeCategory, setActiveCategory] = useState("all");
  const filtersRef = useRef({ style: "all", category: "all" });
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | null>(initialCursor);
  const abortRef = useRef<AbortController | null>(null);
  const fetchingRef = useRef(false);

  // Fetch items (used for both filter changes and infinite scroll)
  const fetchItems = useCallback(
    async (filters: { style: string; category: string }, cursorVal: string | null, append: boolean) => {
      // For infinite scroll, skip if already fetching
      if (append && fetchingRef.current) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      fetchingRef.current = true;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.style !== "all") params.set("style", filters.style);
        if (filters.category !== "all") params.set("category", filters.category);
        if (cursorVal) params.set("cursor", cursorVal);

        const res = await fetch(`/api/gallery?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) return;

        const data = await res.json();
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        cursorRef.current = data.nextCursor;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // expected on filter change
      } finally {
        fetchingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  const applyFilters = useCallback(
    (style: string, category: string) => {
      setActiveStyle(style);
      setActiveCategory(category);
      filtersRef.current = { style, category };
      setItems([]);
      setCursor(null);
      cursorRef.current = null;
      fetchItems({ style, category }, null, false);
    },
    [fetchItems]
  );

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && cursorRef.current && !fetchingRef.current) {
          fetchItems(filtersRef.current, cursorRef.current, true);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchItems]);

  // Empty state
  if (items.length === 0 && !loading) {
    return (
      <>
        <FilterTabs
          items={STYLE_FILTERS}
          active={activeStyle}
          onSelect={(s) => applyFilters(s, activeCategory)}
          color="green"
          d={d}
        />
        <FilterTabs
          items={CATEGORY_FILTERS}
          active={activeCategory}
          onSelect={(c) => applyFilters(activeStyle, c)}
          color="blue"
          d={d}
        />
        <div className="card p-12 text-center mt-8">
          <svg className="w-20 h-20 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="mt-6 text-lg font-medium text-text-secondary">{d["gallery.empty"]}</p>
          <Link href="/create" className="btn-primary mt-6 inline-flex">
            {d["gallery.createYourOwn"]}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Filter tabs */}
      <FilterTabs
        items={STYLE_FILTERS}
        active={activeStyle}
        onSelect={(s) => applyFilters(s, activeCategory)}
        color="green"
        d={d}
      />
      <FilterTabs
        items={CATEGORY_FILTERS}
        active={activeCategory}
        onSelect={(c) => applyFilters(activeStyle, c)}
        color="blue"
        d={d}
      />

      {/* Masonry layout */}
      <div className="columns-2 md:columns-3 lg:columns-4 gap-4 sm:gap-6 [&>*]:mb-4 sm:[&>*]:mb-6 mt-8">
        {items.map((item) => (
          <div key={item.id} className="break-inside-avoid">
            <GalleryCard item={item} onClick={() => setSelectedItem(item)} />
          </div>
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />

      {/* Loading indicator */}
      {loading && (
        <div className="flex justify-center py-8">
          <svg className="animate-spin w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {selectedItem && (
        <GalleryModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </>
  );
}

// ─── Filter Tabs ─────────────────────────────────────────────

function FilterTabs({
  items,
  active,
  onSelect,
  color,
  d,
}: {
  items: readonly { key: string; labelKey: string }[];
  active: string;
  onSelect: (key: string) => void;
  color: "green" | "blue";
  d: Record<string, string>;
}) {
  const activeClass = color === "green"
    ? "bg-green-600 text-white border-green-600"
    : "bg-blue-600 text-white border-blue-600";
  const hoverClass = color === "green"
    ? "hover:border-green-500 hover:text-green-600"
    : "hover:border-blue-500 hover:text-blue-600";

  return (
    <div className="flex gap-2 flex-wrap mb-3">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          className={`px-3 py-1.5 text-sm font-medium rounded-full border transition-colors ${
            active === item.key
              ? activeClass
              : `bg-bg-elevated text-text-secondary border-bg-subtle ${hoverClass}`
          }`}
        >
          {d[item.labelKey as keyof typeof d] || item.key}
        </button>
      ))}
    </div>
  );
}
