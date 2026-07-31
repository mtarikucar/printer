"use client";

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
  if (!progress) return null;
  const isProcessing = progress.phase === "processing";

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
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        {isProcessing ? (
          // Indeterminate: the server is busy and there is nothing to measure.
          <div className="h-full w-1/3 animate-[upload-slide_1.1s_ease-in-out_infinite] rounded-full bg-indigo-500" />
        ) : (
          <div
            className="h-full rounded-full bg-indigo-500 transition-[width] duration-150"
            style={{ width: `${progress.percent}%` }}
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
