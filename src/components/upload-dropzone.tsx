"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useDictionary } from "@/lib/i18n/locale-context";

interface UploadDropzoneProps {
  onUploadComplete: (key: string, previewUrl: string) => void;
  onError?: (error: string) => void;
  onFileSelected?: (file: File) => void;
}

export function UploadDropzone({
  onUploadComplete,
  onError,
  onFileSelected,
}: UploadDropzoneProps) {
  const d = useDictionary();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      if (!["image/jpeg", "image/png"].includes(file.type)) {
        onError?.(d["upload.invalidFormat"]);
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        onError?.(d["upload.fileTooLarge"]);
        return;
      }

      // If onFileSelected is provided, hand off the file without uploading
      if (onFileSelected) {
        onFileSelected(file);
        return;
      }

      // Show preview
      const previewUrl = URL.createObjectURL(file);
      setPreview(previewUrl);
      setUploading(true);
      setProgress(10);

      try {
        const formData = new FormData();
        formData.append("file", file);

        setProgress(30);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || d["upload.failed"]);
        }

        const { key } = await res.json();
        setProgress(100);

        onUploadComplete(key, previewUrl);
      } catch (error: any) {
        onError?.(error.message || d["upload.failed"]);
        setPreview(null);
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete, onError, onFileSelected, d]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"] },
    maxFiles: 1,
    disabled: uploading,
  });

  if (preview) {
    return (
      <div className="relative card rounded-2xl overflow-hidden">
        <img
          src={preview}
          alt={d["upload.preview"]}
          className="w-full max-h-80 object-contain bg-bg-elevated"
        />
        {uploading && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-center">
              <div className="w-48 h-2.5 bg-bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-800 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-white mt-2 text-sm">{d["upload.uploading"]}</p>
            </div>
          </div>
        )}
        {!uploading && (
          <button
            onClick={() => setPreview(null)}
            className="absolute top-3 right-3 bg-bg-elevated text-text-muted hover:text-text-primary rounded-full px-3 py-1.5 text-sm font-medium shadow-md hover:shadow-lg transition-all flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`card cursor-pointer transition-all border-2 border-dashed overflow-hidden ${
        isDragActive
          ? "border-green-500/50 bg-green-500/5"
          : "border-bg-subtle hover:border-green-500/50 hover:bg-bg-elevated"
      }`}
    >
      {/* Accent bar */}
      <div className="h-1 bg-gradient-to-r from-green-500 to-green-800 rounded-t-2xl opacity-60" />

      <input {...getInputProps()} />
      <div className="p-8 space-y-5">
        {/* Icon */}
        <div className="mx-auto bg-bg-elevated w-20 h-20 rounded-2xl flex items-center justify-center border border-bg-subtle">
          <svg
            className="h-10 w-10 text-green-500 animate-float"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-lg font-medium text-text-primary">
            {isDragActive ? d["upload.dropHere"] : d["upload.dragOrClick"]}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {d["upload.hint"]}
          </p>
        </div>
        {/* Tip bullets */}
        <div className="flex flex-wrap justify-center gap-2">
          <span className="trust-pill">
            <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {d["upload.tipBullet1"]}
          </span>
          <span className="trust-pill">
            <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {d["upload.tipBullet2"]}
          </span>
          <span className="trust-pill">
            <svg className="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {d["upload.tipBullet3"]}
          </span>
        </div>
      </div>
    </div>
  );
}
