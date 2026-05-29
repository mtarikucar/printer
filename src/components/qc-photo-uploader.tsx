"use client";

import { useRef, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

interface QcPhoto {
  id: string;
  url: string;
}

const MAX_PHOTOS = 6;

// Authenticated, multi-file QC photo uploader for the manufacturer order detail.
// Posts to /api/manufacturer/orders/[id]/qc-photos (no Turnstile — the session
// is the auth). Self-manages its photo list and reports the count up so the
// parent can enable/disable the "Submit for review" button.
export function QcPhotoUploader({
  orderId,
  initialPhotos,
  disabled = false,
  onCountChange,
}: {
  orderId: string;
  initialPhotos: QcPhoto[];
  disabled?: boolean;
  onCountChange?: (count: number) => void;
}) {
  const d = useDictionary();
  const [photos, setPhotos] = useState<QcPhoto[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (next: QcPhoto[]) => {
    setPhotos(next);
    onCountChange?.(next.length);
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const form = new FormData();
    for (const f of Array.from(fileList).slice(0, remaining)) {
      form.append("files", f);
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/manufacturer/orders/${orderId}/qc-photos`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || d["manufacturer.orderDetail.qcUploadFailed"]);
        return;
      }
      const data = await res.json();
      update([...photos, ...((data.photos as QcPhoto[]) || [])]);
    } catch {
      setError(d["manufacturer.orderDetail.qcUploadFailed"]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removePhoto = async (photoId: string) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/manufacturer/orders/${orderId}/qc-photos?photoId=${encodeURIComponent(photoId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || d["common.error"]);
        return;
      }
      update(photos.filter((p) => p.id !== photoId));
    } catch {
      setError(d["common.error"]);
    }
  };

  const atMax = photos.length >= MAX_PHOTOS;

  return (
    <div className="w-full">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {photos.map((p) => (
            <div key={p.id} className="relative group">
              <img
                src={p.url}
                alt=""
                className="w-full h-24 object-cover rounded-lg border border-gray-200"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-xs leading-none hover:bg-red-600 transition-colors"
                  aria-label={d["manufacturer.orderDetail.qcRemove"]}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-2 text-left">{error}</p>}

      {!disabled && !atMax && (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full px-4 py-3 border-2 border-dashed border-amber-300 rounded-xl text-sm font-medium text-amber-700 hover:border-amber-400 hover:bg-amber-50 transition-colors disabled:opacity-50"
          >
            {uploading
              ? d["manufacturer.orderDetail.qcSubmitting"]
              : `${d["manufacturer.orderDetail.qcUpload"]} (${photos.length}/${MAX_PHOTOS})`}
          </button>
          <p className="text-xs text-amber-700/50 mt-1 text-center">
            {d["manufacturer.orderDetail.qcMaxPhotos"]}
          </p>
        </div>
      )}
    </div>
  );
}
