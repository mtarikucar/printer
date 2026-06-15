"use client";

import { useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { UPLOAD_MAX_SIZE_BYTES } from "@/lib/config/upload";

export interface ExtraPhoto {
  key: string;
  url: string;
}

interface ExtraPhotosProps {
  photos: ExtraPhoto[];
  onChange: (photos: ExtraPhoto[]) => void;
  /** Max number of EXTRA photos (beyond the primary). */
  max: number;
  onError?: (message: string) => void;
}

/**
 * Compact multi-photo adder for the "extra reference photos" used by
 * multi-image-to-3d. Each picked image is uploaded straight to /api/upload
 * (no crop editor — these are auxiliary angles) and shown as a removable
 * thumbnail. The primary photo is managed separately by the main upload flow.
 */
export function ExtraPhotos({ photos, onChange, max, onError }: ExtraPhotosProps) {
  const d = useDictionary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const remaining = max - photos.length;

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, Math.max(0, remaining));
    setUploading(true);
    const next = [...photos];
    for (const file of files) {
      if (!["image/jpeg", "image/png"].includes(file.type)) {
        onError?.(d["upload.invalidFormat"]);
        continue;
      }
      if (file.size > UPLOAD_MAX_SIZE_BYTES) {
        onError?.(d["upload.fileTooLarge"]);
        continue;
      }
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || d["upload.failed"]);
        }
        const { key, previewUrl } = await res.json();
        next.push({ key, url: previewUrl });
      } catch (err) {
        onError?.(err instanceof Error ? err.message : d["upload.failed"]);
      }
    }
    onChange(next);
    setUploading(false);
    // Reset the input so re-picking the same file fires onChange again.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex flex-wrap gap-3">
        {photos.map((p, i) => (
          <div
            key={p.key}
            className="relative w-20 h-20 rounded-xl overflow-hidden border border-bg-subtle bg-bg-muted"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`reference ${i + 2}`} className="w-full h-full object-cover" />
            <button
              type="button"
              aria-label={d["create.multiPhoto.remove"]}
              onClick={() => onChange(photos.filter((x) => x.key !== p.key))}
              className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-black/80"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 rounded-xl border-2 border-dashed border-bg-subtle hover:border-green-500/50 hover:bg-bg-elevated flex flex-col items-center justify-center gap-1 text-text-muted transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <span className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            ) : (
              <>
                <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-[11px] leading-none">{d["create.multiPhoto.add"]}</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
