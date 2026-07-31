"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes, type UploadProgress } from "@/lib/upload-with-progress";

/**
 * Progress for a single upload. Shows the real percentage while bytes are on
 * the wire, then switches to an indeterminate "processing" state, because the
 * server keeps working after the last byte (model analysis, image conversion)
 * and a bar frozen at 100% reads as a hang.
 */
export function UploadProgressBar({
  progress,
  onCancel,
  processingLabel = "Sunucuda işleniyor…",
  className = "",
}: {
  progress: UploadProgress | null;
  onCancel?: () => void;
  processingLabel?: string;
  className?: string;
}) {
  // Warn before the hard stall timeout fires, so a proxy silently refusing the
  // body is visible within seconds rather than looking like a slow connection.
  const [stalledSeconds, setStalledSeconds] = useState(0);
  const lastLoaded = useRef(-1);
  // Seeded inside the effect, never during render: Date.now() is impure and a
  // re-render would silently reset the stall clock.
  const lastMove = useRef<number | null>(null);

  useEffect(() => {
    if (!progress || progress.phase !== "uploading") {
      lastLoaded.current = -1;
      lastMove.current = null;
      setStalledSeconds(0);
      return;
    }
    if (lastMove.current === null || progress.loadedBytes > lastLoaded.current) {
      lastLoaded.current = progress.loadedBytes;
      lastMove.current = Date.now();
      setStalledSeconds(0);
    }
    const t = setInterval(() => {
      const since = lastMove.current;
      if (since === null) return;
      setStalledSeconds(Math.floor((Date.now() - since) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [progress]);

  if (!progress) return null;
  const isProcessing = progress.phase === "processing";
  const isStalling = !isProcessing && stalledSeconds >= 8;

  return (
    <div className={`w-full ${className}`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-gray-700">
          {isProcessing ? processingLabel : `Yükleniyor… %${progress.percent}`}
        </span>
        <span className="flex items-center gap-2 text-gray-500">
          {!isProcessing && progress.totalBytes > 0 && (
            <span className="tabular-nums">
              {formatBytes(progress.loadedBytes)} / {formatBytes(progress.totalBytes)}
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="font-medium text-gray-400 underline-offset-2 hover:text-red-600 hover:underline"
            >
              İptal
            </button>
          )}
        </span>
      </div>
      {isStalling && (
        <p className="mb-1 text-xs text-amber-700">
          {stalledSeconds} saniyedir veri gitmiyor. Bağlantınız çok yavaş olabilir
          ya da sunucu bu boyuttaki dosyayı kabul etmiyor olabilir.
        </p>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        {isProcessing ? (
          // Indeterminate: the server is busy and there is nothing to measure.
          <div className="h-full w-1/3 animate-[upload-slide_1.1s_ease-in-out_infinite] rounded-full bg-indigo-500" />
        ) : (
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${
              isStalling ? "bg-amber-500" : "bg-indigo-500"
            }`}
            style={{ width: `${Math.max(progress.percent, 1)}%` }}
          />
        )}
      </div>
      <style>{`
        @keyframes upload-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
