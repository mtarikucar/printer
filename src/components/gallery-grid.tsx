"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { GalleryCard, type GalleryItem } from "@/components/gallery-card";
import { GalleryModal } from "@/components/gallery-modal";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Card, Input } from "@/components/ui";

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
  initialFeatured = [],
}: {
  initialItems: GalleryItem[];
  initialCursor: string | null;
  initialFeatured?: GalleryItem[];
}) {
  const d = useDictionary();
  const [items, setItems] = useState<GalleryItem[]>(initialItems);
  const [, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeStyle, setActiveStyle] = useState("all");
  const [activeCategory, setActiveCategory] = useState("all");
  // Q9: keyword search. We debounce client-side so each keystroke doesn't
  // fire a request; the active value used by the API is `debouncedQ`.
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const filtersRef = useRef({ style: "all", category: "all", q: "" });
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<string | null>(initialCursor);
  const abortRef = useRef<AbortController | null>(null);
  const fetchingRef = useRef(false);

  // Fetch items (used for both filter changes and infinite scroll)
  const fetchItems = useCallback(
    async (
      filters: { style: string; category: string; q: string },
      cursorVal: string | null,
      append: boolean
    ) => {
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
        if (filters.q) params.set("q", filters.q);
        if (cursorVal) params.set("cursor", cursorVal);

        const res = await fetch(`/api/gallery?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) {
          setError(true);
          return;
        }

        const data = await res.json();
        setError(false);
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setCursor(data.nextCursor);
        cursorRef.current = data.nextCursor;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // expected on filter change
        setError(true);
      } finally {
        fetchingRef.current = false;
        setLoading(false);
      }
    },
    []
  );

  const applyFilters = useCallback(
    (style: string, category: string, q: string) => {
      setActiveStyle(style);
      setActiveCategory(category);
      filtersRef.current = { style, category, q };
      setItems([]);
      setCursor(null);
      cursorRef.current = null;
      fetchItems({ style, category, q }, null, false);
    },
    [fetchItems]
  );

  const retry = useCallback(() => {
    setError(false);
    fetchItems(filtersRef.current, null, false);
  }, [fetchItems]);

  // Debounce keyword input — refire applyFilters 300ms after typing stops.
  // We skip the initial mount (empty query == initial state already loaded).
  const initialMountRef = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      return;
    }
    applyFilters(activeStyle, activeCategory, debouncedQ);
    // intentionally omit activeStyle/activeCategory: they trigger via their
    // own onSelect handlers which already call applyFilters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

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

  // The curated "featured" rail only makes sense on the default, unfiltered
  // view — once the visitor filters/searches, the grid takes over.
  const isDefaultView =
    activeStyle === "all" && activeCategory === "all" && !query.trim();
  const showFeatured = isDefaultView && initialFeatured.length > 0;
  const isEmpty = items.length === 0 && !loading;

  return (
    <>
      {showFeatured && (
        <FeaturedRail items={initialFeatured} onSelect={setSelectedItem} d={d} />
      )}

      <SearchBar value={query} onChange={setQuery} d={d} />
      <FilterTabs
        items={STYLE_FILTERS}
        active={activeStyle}
        onSelect={(s) => applyFilters(s, activeCategory, debouncedQ)}
        color="accent"
        label={d["gallery.filter.styleLabel"] || "Stil"}
        d={d}
      />
      <FilterTabs
        items={CATEGORY_FILTERS}
        active={activeCategory}
        onSelect={(c) => applyFilters(activeStyle, c, debouncedQ)}
        color="ink"
        label={d["gallery.filter.categoryLabel"] || "Kategori"}
        d={d}
      />

      {isEmpty ? (
        error ? (
          <ErrorState onRetry={retry} d={d} />
        ) : (
          <EmptyState d={d} />
        )
      ) : (
        <>
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
            <div className="flex justify-center py-8" role="status" aria-live="polite">
              <svg className="animate-spin w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="sr-only">{d["gallery.loading"]}</span>
            </div>
          )}

          {/* Inline error while paginating an already-populated grid */}
          {error && !loading && (
            <div className="flex justify-center py-6">
              <Button variant="secondary" onClick={retry}>
                {d["gallery.retry"] || "Tekrar dene"}
              </Button>
            </div>
          )}
        </>
      )}

      {selectedItem && (
        <GalleryModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </>
  );
}

// ─── Featured Rail ───────────────────────────────────────────

function FeaturedRail({
  items,
  onSelect,
  d,
}: {
  items: GalleryItem[];
  onSelect: (item: GalleryItem) => void;
  d: Record<string, string>;
}) {
  return (
    <section className="mb-10" aria-labelledby="gallery-featured-heading">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.9 6.1 6.7.9-4.9 4.7 1.2 6.6L12 18.3 6.1 21.3l1.2-6.6L2.4 9l6.7-.9L12 2z" />
        </svg>
        <h2 id="gallery-featured-heading" className="text-lg font-semibold text-text-primary">
          {d["gallery.featured"]}
        </h2>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-3 -mx-4 px-4 snap-x [scrollbar-width:thin]">
        {items.map((item) => (
          <div key={item.id} className="snap-start shrink-0 w-52 sm:w-60">
            <GalleryCard item={item} onClick={() => onSelect(item)} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Search Bar ──────────────────────────────────────────────

function SearchBar({
  value,
  onChange,
  d,
}: {
  value: string;
  onChange: (v: string) => void;
  d: Record<string, string>;
}) {
  return (
    <div className="mb-4 relative">
      <svg
        className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={d["gallery.search.placeholder"] || "Search…"}
        aria-label={d["gallery.search.placeholder"] || "Search"}
        className="pl-9"
        maxLength={60}
      />
    </div>
  );
}

// ─── Filter Tabs ─────────────────────────────────────────────

function FilterTabs({
  items,
  active,
  onSelect,
  color,
  label,
  d,
}: {
  items: readonly { key: string; labelKey: string }[];
  active: string;
  onSelect: (key: string) => void;
  color: "accent" | "ink";
  label?: string;
  d: Record<string, string>;
}) {
  const activeClass =
    color === "accent"
      ? "bg-green-600 text-white border-green-600"
      : "bg-ink text-white border-ink";
  const hoverClass =
    color === "accent"
      ? "hover:border-green-500 hover:text-green-600"
      : "hover:border-ink hover:text-text-primary";

  return (
    <div className="flex gap-2 flex-wrap mb-3" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.key)}
          aria-pressed={active === item.key}
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

// ─── Empty / Error states ────────────────────────────────────

function EmptyState({ d }: { d: Record<string, string> }) {
  return (
    <Card padding="lg" className="text-center mt-8 !p-12">
      <svg className="w-20 h-20 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <p className="mt-6 text-lg font-medium text-text-secondary">{d["gallery.empty"]}</p>
      <Button href="/create" className="mt-6 inline-flex">
        {d["gallery.createYourOwn"]}
      </Button>
    </Card>
  );
}

function ErrorState({ onRetry, d }: { onRetry: () => void; d: Record<string, string> }) {
  return (
    <Card padding="lg" className="text-center mt-8 !p-12">
      <svg className="w-16 h-16 text-text-muted mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
      </svg>
      <p className="mt-6 text-lg font-medium text-text-secondary">
        {d["gallery.error"] || "Galeri yüklenemedi."}
      </p>
      <Button onClick={onRetry} variant="secondary" className="mt-6 inline-flex">
        {d["gallery.retry"] || "Tekrar dene"}
      </Button>
    </Card>
  );
}
