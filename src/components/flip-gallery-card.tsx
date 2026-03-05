"use client";

import Image from "next/image";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { GalleryItem } from "@/components/gallery-card";

export function FlipGalleryCard({
  item,
  onClick,
}: {
  item: GalleryItem;
  onClick: () => void;
}) {
  const d = useDictionary();

  const sizeLabel =
    d[`sizes.${item.figurineSize}` as keyof typeof d] || item.figurineSize;

  const hasModel = !!item.glbUrl;

  return (
    <button
      onClick={onClick}
      className="group card overflow-hidden text-left w-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-bg-base"
    >
      <div className="aspect-square relative overflow-hidden">
        {hasModel ? (
          /* Flip container — only when GLB exists */
          <div className="flip-card w-full h-full">
            {/* Front face: photo */}
            <div className="flip-card-front bg-bg-elevated">
              {item.thumbnailUrl ? (
                <Image
                  src={item.thumbnailUrl}
                  alt={item.publicDisplayName || d["gallery.anonymous"]}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-muted">
                  <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              {/* Size badge */}
              <span className="absolute top-3 right-3 bg-bg-elevated/90 text-green-500 text-xs font-medium px-2.5 py-1 rounded-full border border-bg-subtle z-10">
                {sizeLabel}
              </span>
              {/* Mobile: small 3D badge (hover doesn't work on mobile) */}
              <span className="md:hidden absolute top-3 left-3 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10">
                3D
              </span>
            </div>

            {/* Back face: green gradient + 3D icon */}
            <div className="flip-card-back bg-gradient-to-br from-green-500 to-green-700 flex flex-col items-center justify-center gap-3">
              <svg className="w-16 h-16 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
              </svg>
              <span className="text-white font-semibold text-sm">
                {d["landing.gallery.viewModel3D"]}
              </span>
            </div>
          </div>
        ) : (
          /* No GLB: regular card (no flip) */
          <div className="bg-bg-elevated w-full h-full relative">
            {item.thumbnailUrl ? (
              <Image
                src={item.thumbnailUrl}
                alt={item.publicDisplayName || d["gallery.anonymous"]}
                fill
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
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
            {/* Size badge */}
            <span className="absolute top-3 right-3 bg-bg-elevated/90 text-green-500 text-xs font-medium px-2.5 py-1 rounded-full border border-bg-subtle">
              {sizeLabel}
            </span>
          </div>
        )}
      </div>
      <div className="p-4">
        <p className="text-sm font-medium text-text-primary truncate">
          {item.publicDisplayName || d["gallery.anonymous"]}
        </p>
      </div>
    </button>
  );
}
