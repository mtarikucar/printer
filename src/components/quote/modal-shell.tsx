"use client";

import { useEffect, type JSX, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Teklif yüzeyinin ortak modal kabuğu (3B görüntüleyici, özellik paneli ve
 * 3.2b'nin paylaş / hedef fiyat diyalogları).
 *
 * `price-gate-modal.tsx`'in kabuğuyla aynı davranış — Escape kapatır, gövde
 * kaydırması kilitlenir, dışarı tıklamak kapatır — ama o modal KENDİ
 * kabuğunu taşımaya devam ediyor: fiyat kapısı tek başına (3.1) test
 * edilmiş bir yüzey ve kabuğunu buraya taşımak o testleri bu dosyaya
 * bağlardı.
 */
export function QuoteModal({
  open,
  onClose,
  title,
  children,
  widthClass = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClass?: string;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const d = useDictionary();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card
        padding="none"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92vh] w-full ${widthClass} flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-default px-5 py-3.5">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={d["instantQuote.modal.close"]}
            className="rounded-full p-2 text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </Card>
    </div>
  );
}
