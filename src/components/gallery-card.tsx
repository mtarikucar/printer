"use client";

import { useDictionary } from "@/lib/i18n/locale-context";

export interface GalleryItem {
  id: string;
  publicDisplayName: string | null;
  figurineSize: string;
  style: string;
  category: string | null;
  tags: string[];
  publishedAt: string | null;
  glbUrl: string | null;
  thumbnailUrl: string | null;
}

const STYLE_BADGE_COLORS: Record<string, string> = {
  disney: "bg-purple-100 text-purple-700 border-purple-200",
  anime: "bg-pink-100 text-pink-700 border-pink-200",
  chibi: "bg-orange-100 text-orange-700 border-orange-200",
  realistic: "bg-gray-100 text-gray-600 border-gray-200",
};

const STYLE_LABELS: Record<string, string> = {
  disney: "Disney",
  anime: "Anime",
  chibi: "Chibi",
  realistic: "Realistic",
};

export function GalleryCard({
  item,
  onClick,
}: {
  item: GalleryItem;
  onClick: () => void;
}) {
  const d = useDictionary();

  const sizeLabel =
    d[`sizes.${item.figurineSize}` as keyof typeof d] || item.figurineSize;

  return (
    <button
      onClick={onClick}
      className="group card overflow-hidden text-left w-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-bg-base"
    >
      <div className="aspect-square bg-bg-elevated relative overflow-hidden">
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.publicDisplayName || d["gallery.anonymous"]}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <span className="flex items-center gap-2 text-white text-sm font-medium bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {d["gallery.viewModel"]}
          </span>
        </div>
        {/* Badges */}
        <div className="absolute top-3 right-3 flex gap-1.5">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${STYLE_BADGE_COLORS[item.style] || "bg-gray-100 text-gray-600 border-gray-200"}`}>
            {STYLE_LABELS[item.style] || item.style}
          </span>
          <span className="bg-bg-elevated/90 text-green-500 text-xs font-medium px-2 py-0.5 rounded-full border border-bg-subtle">
            {sizeLabel}
          </span>
        </div>
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-text-primary truncate">
          {item.publicDisplayName || d["gallery.anonymous"]}
        </p>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
