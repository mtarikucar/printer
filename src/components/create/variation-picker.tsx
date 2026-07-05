"use client";

import { useState } from "react";

/**
 * 2D variation chooser (image-first create flow). Shows the stylized 2D
 * * variations generated; the customer picks one before we spend a 3D build
 * credit. Presentational — labels are passed in so it stays i18n-agnostic.
 */
export function VariationPicker({
  urls,
  onSelect,
  onRegenerate,
  canRegenerate,
  busy,
  title,
  subtitle,
  regenerateLabel,
}: {
  urls: string[];
  onSelect: (url: string) => void;
  onRegenerate: () => void;
  canRegenerate: boolean;
  busy: boolean;
  title: string;
  subtitle: string;
  regenerateLabel: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="animate-fade-in mx-auto w-full max-w-2xl">
      <div className="mb-4 text-center sm:mb-6">
        <h2 className="font-serif text-xl text-text-primary sm:text-2xl">{title}</h2>
        <p className="mt-1 text-sm text-text-secondary sm:text-base">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {urls.map((url) => {
          const isPicked = picked === url;
          return (
            <button
              key={url}
              type="button"
              disabled={busy}
              onClick={() => {
                setPicked(url);
                onSelect(url);
              }}
              className={`group relative overflow-hidden rounded-2xl border-2 bg-bg-elevated shadow-card transition disabled:cursor-not-allowed disabled:opacity-60 ${
                isPicked
                  ? "border-green-500 ring-2 ring-green-500/40"
                  : "border-transparent hover:border-green-500/60 hover:shadow-elevated"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="variation"
                className="aspect-square w-full object-cover"
              />
              {isPicked && busy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={onRegenerate}
          disabled={!canRegenerate || busy}
          className="text-sm text-text-muted underline underline-offset-4 transition hover:text-text-primary disabled:opacity-40"
        >
          {regenerateLabel}
        </button>
      </div>
    </div>
  );
}
