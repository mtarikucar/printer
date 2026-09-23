"use client";

import { Suspense, lazy, type JSX } from "react";
import type { PresentedPart } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteModal } from "./modal-shell";

/**
 * Parçanın 3B önizlemesi (küçük resme tıklayınca açılır).
 *
 * `ModelViewer` TEMBEL yüklenir: three.js + drei paketi çalışma alanının ilk
 * yüküne girmemeli — yirmi parçalık bir teklifte müşteri hiçbir modeli
 * açmadan da fiyatını görebilmeli. Modal kapalıyken bu dal hiç
 * değerlendirilmez.
 *
 * Paylaşım görünümünde `previewGlbUrl` YOKTUR (imzalı dosya bağlantısı
 * paylaşılmaz); o hâlde küçük resim büyütülerek gösterilir — boş bir kutu
 * yerine elde olan.
 */
const ModelViewer = lazy(() =>
  import("@/components/model-viewer").then((m) => ({ default: m.ModelViewer }))
);

export function QuotePartViewerModal({
  part,
  onClose,
}: {
  /** null = modal kapalı. */
  part: PresentedPart | null;
  onClose: () => void;
}): JSX.Element | null {
  const d = useDictionary();
  if (!part) return null;

  return (
    <QuoteModal open onClose={onClose} title={part.name} widthClass="max-w-3xl">
      <div className="p-4">
        {part.previewGlbUrl ? (
          <Suspense
            fallback={
              <div className="h-[420px] w-full animate-pulse rounded-xl bg-bg-muted" />
            }
          >
            <ModelViewer
              url={part.previewGlbUrl}
              dimensionsMm={part.dimensionsMm}
              className="h-[420px] w-full overflow-hidden rounded-xl"
            />
          </Suspense>
        ) : part.thumbnailUrl ? (
          <div className="h-[420px] w-full overflow-hidden rounded-xl bg-bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={part.thumbnailUrl}
              alt={part.name}
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex h-[420px] w-full items-center justify-center rounded-xl bg-bg-muted text-sm text-text-muted">
            {d["instantQuote.part.analyzing"]}
          </div>
        )}
        <p className="mt-3 font-mono text-xs text-text-secondary">{part.fileName}</p>
      </div>
    </QuoteModal>
  );
}
