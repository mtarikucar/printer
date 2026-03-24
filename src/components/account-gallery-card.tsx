"use client";

import { useDictionary } from "@/lib/i18n/locale-context";

export interface AccountPreview {
  id: string;
  status: string;
  photoUrl: string;
  glbUrl: string | null;
  figurineSize: string;
  createdAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    amountKurus: number;
    isPublic: boolean;
  } | null;
}

export function AccountGalleryCard({
  preview,
  onClick,
}: {
  preview: AccountPreview;
  onClick: () => void;
}) {
  const d = useDictionary();

  const sizeLabel =
    d[`sizes.${preview.figurineSize}` as keyof typeof d] || preview.figurineSize;

  const isGenerating = preview.status === "generating";
  const isFailed = preview.status === "failed";
  const isReady = preview.status === "ready" || preview.status === "approved";
  const hasOrder = !!preview.order;

  return (
    <button
      onClick={onClick}
      className="group card overflow-hidden text-left w-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-bg-base"
    >
      <div className="aspect-square bg-bg-elevated relative overflow-hidden">
        {preview.photoUrl ? (
          <img
            src={preview.photoUrl}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ${
              isReady && !isGenerating ? "group-hover:scale-105" : ""
            } ${isFailed ? "opacity-40" : ""}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <svg
              className="w-12 h-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
        )}

        {/* Status overlays */}
        {isGenerating ? (
          <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
            <div className="w-8 h-8 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-white text-xs font-medium px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm">
              {d["account.gallery.generating"]}
            </span>
          </div>
        ) : isFailed ? (
          <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-2">
            <svg
              className="w-8 h-8 text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <span className="text-amber-400 text-xs font-medium px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm">
              {d["account.gallery.failed"]}
            </span>
          </div>
        ) : isReady ? (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <span className="flex items-center gap-2 text-white text-sm font-medium bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
              {d["gallery.viewModel"]}
            </span>
          </div>
        ) : null}

        {/* Size badge */}
        <span className="absolute top-3 right-3 bg-bg-elevated/90 text-green-500 text-xs font-medium px-2.5 py-1 rounded-full border border-bg-subtle">
          {sizeLabel}
        </span>

        {/* Order & published badges */}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {hasOrder && (
            <span className="bg-green-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              {preview.order!.orderNumber}
            </span>
          )}
          {preview.order?.isPublic && (
            <span className="bg-blue-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5" title={d["account.gallery.published"] ?? "Published"}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
          )}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-bg-elevated border border-bg-subtle text-text-muted">
            {hasOrder
              ? d[`status.${preview.order!.status}` as keyof typeof d] || preview.order!.status
              : preview.status === "ready" || preview.status === "approved"
                ? d["account.gallery.readyToOrder"]
                : d[`account.gallery.${preview.status}` as keyof typeof d] || preview.status}
          </span>
        </div>
      </div>
    </button>
  );
}
