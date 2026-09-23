"use client";

import { useRef, useState, type JSX } from "react";
import { UploadProgressBar } from "@/components/ui/UploadProgressBar";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { useDictionary } from "@/lib/i18n/locale-context";
import type { UploadProgress } from "@/lib/upload-with-progress";
import { fill } from "./format";

/**
 * Teklife model bırakma alanı.
 *
 * Doğrulama İKİ KERE yapılır ve bu bilerek böyledir: burada (uzantı, boyut,
 * parça tavanı) müşteriye SANİYESİNDE Türkçe bir cümle söylemek için, uçta
 * ise gerçekten geçerli olan kural olduğu için. Tarayıcı kontrolü bir kolaylık,
 * güvenlik sınırı değil.
 */

export const QUOTE_UPLOAD_EXTENSIONS = ["stl", "obj", "3mf"] as const;
export const QUOTE_UPLOAD_ACCEPT = ".stl,.obj,.3mf";

export interface QuoteFileCheck {
  accepted: File[];
  /** Müşteriye gösterilecek Türkçe cümleler (dosya adıyla). */
  errors: string[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

export function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Seçilen dosyaları eler. Parça tavanı AŞILDIĞINDA kalan dosyalar sessizce
 * atılmaz: tavanı aşan her dosya için değil, tavan için TEK cümle yazılır ve
 * sığan dosyalar yüklenmeye devam eder.
 */
export function validateQuoteFiles(
  files: File[],
  opts: { maxFileBytes: number; maxParts: number; currentCount: number; d: Dictionary }
): QuoteFileCheck {
  const { d, maxFileBytes, maxParts, currentCount } = opts;
  const maxMb = megabytes(maxFileBytes);
  const accepted: File[] = [];
  const errors: string[] = [];
  let room = Math.max(0, maxParts - currentCount);

  for (const file of files) {
    if (!(QUOTE_UPLOAD_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
      errors.push(fill(d["instantQuote.upload.invalidFormat"], { file: file.name }));
      continue;
    }
    if (file.size > maxFileBytes) {
      errors.push(fill(d["instantQuote.upload.tooLarge"], { file: file.name, maxMb }));
      continue;
    }
    if (room === 0) {
      const message = fill(d["instantQuote.upload.tooManyParts"], { max: maxParts });
      if (!errors.includes(message)) errors.push(message);
      continue;
    }
    room -= 1;
    accepted.push(file);
  }
  return { accepted, errors };
}

export interface QuoteUploadState {
  /** Tarayıcı içi kimlik; dosya adı benzersiz değil. */
  id: string;
  fileName: string;
  progress: UploadProgress | null;
}

export function QuoteDropzone({
  maxFileBytes,
  uploads,
  errors,
  disabled,
  onFiles,
}: {
  maxFileBytes: number;
  uploads: QuoteUploadState[];
  errors: string[];
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}): JSX.Element {
  const d = useDictionary();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors ${
          over
            ? "border-[var(--color-accent)] bg-accent-soft"
            : "border-border-default bg-bg-surface"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={QUOTE_UPLOAD_ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-sm font-medium text-text-primary">
          {d["instantQuote.upload.cta"]}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {fill(d["instantQuote.upload.hint"], { maxMb: megabytes(maxFileBytes) })}
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="btn-secondary mt-3 !px-4 !py-2 text-xs"
        >
          {d["instantQuote.upload.browse"]}
        </button>
      </div>

      {uploads.map((upload) => (
        <div key={upload.id} className="rounded-xl border border-border-default px-3 py-2">
          <p className="mb-1 truncate font-mono text-[11px] text-text-secondary">
            {upload.fileName}
          </p>
          <UploadProgressBar
            progress={upload.progress}
            processingLabel={d["instantQuote.upload.processing"]}
          />
        </div>
      ))}

      {errors.map((message) => (
        <p
          key={message}
          className="rounded-lg border border-error/40 bg-error-50 px-3 py-2 text-xs text-error-700"
        >
          {message}
        </p>
      ))}
    </div>
  );
}
