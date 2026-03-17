"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";
import type { GalleryItem } from "@/components/gallery-card";

export function GalleryModal({
  item,
  onClose,
}: {
  item: GalleryItem;
  onClose: () => void;
}) {
  const d = useDictionary();
  const locale = useLocale();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const sizeLabel =
    d[`sizes.${item.figurineSize}` as keyof typeof d] || item.figurineSize;

  const hasBoth = !!item.thumbnailUrl && !!item.glbUrl;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`relative card shadow-elevated w-full mx-4 overflow-hidden h-[90vh] flex flex-col animate-scale-in ${hasBoth ? "max-w-4xl" : "max-w-2xl"}`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-bg-elevated/80 backdrop-blur-sm rounded-full text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {hasBoth ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <BeforeAfterSlider
              before={
                <div className="w-full h-full bg-bg-elevated">
                  <img
                    src={item.thumbnailUrl!}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>
              }
              after={
                <ModelViewer url={item.glbUrl!} className="w-full h-full" />
              }
              beforeLabel={d["gallery.modal.originalPhoto"]}
              afterLabel={d["gallery.modal.yourFigurine"]}
            />
          </div>
        ) : (
          /* Single view: 3D or photo fallback */
          <div className="flex-1 min-h-0 overflow-hidden">
            {item.glbUrl ? (
              <ModelViewer
                url={item.glbUrl}
                className="w-full h-full rounded-t-2xl"
              />
            ) : item.thumbnailUrl ? (
              <div className="w-full h-full bg-bg-elevated relative">
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            ) : null}
          </div>
        )}

        {/* Info */}
        <div className="p-6 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                {item.publicDisplayName || d["gallery.anonymous"]}
              </h3>
              <div className="flex items-center gap-3 mt-1 text-sm text-text-muted">
                <span className="bg-bg-elevated text-green-500 px-2 py-0.5 rounded-full text-xs font-medium border border-bg-subtle">
                  {sizeLabel}
                </span>
                {item.publishedAt && (
                  <>
                    <span>&middot;</span>
                    <span>{formatDateLong(item.publishedAt, locale)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <Link
            href="/create"
            className="btn-primary w-full mt-5 !block text-center"
          >
            {d["gallery.createYourOwn"]}
          </Link>
        </div>
      </div>
    </div>
  );
}
