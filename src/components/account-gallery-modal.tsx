"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { AccountPreview } from "@/components/account-gallery-card";

export function AccountGalleryModal({
  preview,
  onClose,
}: {
  preview: AccountPreview;
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
    d[`sizes.${preview.figurineSize}` as keyof typeof d] || preview.figurineSize;

  const hasBoth = !!preview.photoUrl && !!preview.glbUrl;
  const hasOrder = !!preview.order;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative card shadow-elevated w-full mx-4 overflow-hidden max-h-[90vh] flex flex-col animate-scale-in ${
          hasBoth ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-bg-elevated/80 backdrop-blur-sm rounded-full text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {hasBoth ? (
          <div className="flex flex-col md:flex-row">
            {/* Original Photo */}
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2">
                <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
                  {d["gallery.modal.originalPhoto"]}
                </span>
              </div>
              <div className="relative h-64 sm:h-80 md:h-96 bg-bg-elevated">
                <img
                  src={preview.photoUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            </div>

            {/* Arrow divider */}
            <div className="flex items-center justify-center py-2 md:py-0 md:px-2">
              <svg
                className="w-6 h-6 text-green-500 rotate-90 md:rotate-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </div>

            {/* 3D Figurine */}
            <div className="flex-1 flex flex-col">
              <div className="px-4 pt-4 pb-2 md:pt-4">
                <span className="text-xs font-medium text-green-500 uppercase tracking-wider">
                  {d["gallery.modal.yourFigurine"]}
                </span>
              </div>
              <ModelViewer
                url={preview.glbUrl!}
                className="w-full h-64 sm:h-80 md:h-96"
              />
            </div>
          </div>
        ) : (
          <>
            {preview.glbUrl ? (
              <ModelViewer
                url={preview.glbUrl}
                className="w-full h-80 sm:h-96 rounded-t-2xl"
              />
            ) : preview.photoUrl ? (
              <div className="w-full h-80 sm:h-96 bg-bg-elevated relative">
                <img
                  src={preview.photoUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            ) : null}
          </>
        )}

        {/* Info panel */}
        <div className="p-6">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-3 text-sm text-text-muted flex-wrap">
                <span className="bg-bg-elevated text-green-500 px-2.5 py-0.5 rounded-full text-xs font-medium border border-bg-subtle">
                  {sizeLabel}
                </span>
                <span>&middot;</span>
                <span>{formatDate(preview.createdAt, locale)}</span>
                {hasOrder && (
                  <>
                    <span>&middot;</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-bg-elevated text-green-500 border border-bg-subtle">
                      {preview.order!.orderNumber}
                    </span>
                    <span>&middot;</span>
                    <span className="font-mono">
                      {formatCurrency(preview.order!.amountKurus, locale)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-5">
            {hasOrder ? (
              <>
                <Link
                  href={`/track/${preview.order!.orderNumber}`}
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.trackOrder"]}
                </Link>
                <Link
                  href="/create"
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.createAnother"]}
                </Link>
              </>
            ) : preview.glbUrl ? (
              <>
                <Link
                  href={`/create?previewId=${preview.id}`}
                  className="btn-primary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.orderThis"]}
                </Link>
                <Link
                  href="/create"
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.createAnother"]}
                </Link>
              </>
            ) : (
              <Link
                href="/create"
                className="btn-primary flex-1 !block text-center text-sm"
              >
                {d["account.gallery.createAnother"]}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
