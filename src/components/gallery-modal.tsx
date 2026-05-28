"use client";

import { useEffect, useRef } from "react";
import { ModelViewer } from "@/components/model-viewer";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";
import { Button } from "@/components/ui";
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
  const dialogRef = useRef<HTMLDivElement>(null);

  // Accessibility: focus the dialog on open, trap Tab within it, restore
  // focus to the trigger on close, and close on Escape.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && dialog) {
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const sizeLabel =
    d[`sizes.${item.figurineSize}` as keyof typeof d] || item.figurineSize;

  const title = item.publicDisplayName || d["gallery.anonymous"];
  const hasBoth = !!item.thumbnailUrl && !!item.glbUrl;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative card shadow-elevated w-full overflow-hidden max-h-[90vh] flex flex-col animate-scale-in focus:outline-none ${hasBoth ? "max-w-4xl" : "max-w-2xl"}`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label={d["common.close"] || "Kapat"}
          className="absolute top-4 right-4 z-10 p-2 bg-bg-elevated/80 backdrop-blur-sm rounded-full text-text-muted hover:text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
                    alt={d["gallery.modal.originalPhoto"]}
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
                  alt={title}
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
                {title}
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

          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {item.tags.map((tag: string) => (
                <span key={tag} className="text-xs text-text-muted bg-bg-elevated px-2 py-0.5 rounded-full border border-bg-subtle">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <Button href="/create" className="flex-1 !block text-center">
              {d["gallery.createYourOwn"]}
            </Button>
            {item.slug && (
              <Button
                href={`/gallery/${item.slug}`}
                variant="secondary"
                title={d["gallery.permalink"]}
                className="!block text-center"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
