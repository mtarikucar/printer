"use client";

import { useRef, useState, type JSX } from "react";
import { UploadProgressBar } from "@/components/ui/UploadProgressBar";
import { STEP_MAX_BYTES } from "@/lib/config/quote-step";
import type { QuoteSourceFormat } from "@/lib/config/quote-types";
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

/**
 * Biçim → uzantı(lar). `Record<QuoteSourceFormat, …>` bilerek: beşinci bir
 * biçim eklendiğinde `tsc` bu tabloyu sayar, liste sessizce eksik kalmaz.
 *
 * STEP'in İKİ uzantısı, TEK biçim anahtarı var (`.stp`, DOS'tan kalma
 * kısaltma; aynı ISO 10303 dosyası — uçtaki kapı da öyle okuyor,
 * `quote-model-validation.ts`).
 */
const FORMAT_EXTENSIONS: Record<QuoteSourceFormat, readonly string[]> = {
  stl: ["stl"],
  obj: ["obj"],
  "3mf": ["3mf"],
  step: ["step", "stp"],
};

/**
 * Kabul edilen uzantılar. Liste SABİT DEĞİL, `catalog.acceptedFormats`ten
 * türer: `quote_step_enabled` kapalıyken `"step"` o listede yoktur, yani
 * müşteriye `.step` seçtirip sonra uçta 400 vermemiz imkânsızdır.
 */
export function acceptedExtensions(formats: readonly QuoteSourceFormat[]): string[] {
  return formats.flatMap((format) => [...FORMAT_EXTENSIONS[format]]);
}

/** `<input accept>` dizesi (".stl,.obj,.3mf"). */
export function acceptedAccept(formats: readonly QuoteSourceFormat[]): string {
  return acceptedExtensions(formats)
    .map((extension) => `.${extension}`)
    .join(",");
}

/** Biçim → müşteriye gösterilen ad. */
const FORMAT_LABELS: Record<QuoteSourceFormat, string> = {
  stl: "STL",
  obj: "OBJ",
  "3mf": "3MF",
  step: "STEP",
};

/**
 * "STL, OBJ, 3MF ve STEP" — biçim listesinin CÜMLE hâli.
 *
 * Neden sabit bir cümle DEĞİL: kabul edilen liste bayrağa bağlıdır
 * (`catalog.acceptedFormats`). "yalnız STL, OBJ, 3MF ve STEP dosyaları
 * yüklenebilir" cümlesini sabit yazmak, `quote_step_enabled` kapalıyken
 * müşteriye STEP'i REDDEDEN cümlenin içinde STEP'in kabul edildiğini
 * söylerdi. Liste tek yerden türer, cümle de onu okur.
 *
 * Bağlaç KALIPTAN gelir (`{rest} ve {last}` / `{rest} and {last}`): bağlaç
 * dile aittir ve sözlükte durur, burada değil. "ve" ile "veya" ayrı
 * kalıplardır — ret cümlesi "ve", ipucu cümlesi "veya" der.
 */
export function formatNames(
  formats: readonly QuoteSourceFormat[],
  pattern: string
): string {
  const names = formats.map((format) => FORMAT_LABELS[format]);
  const last = names[names.length - 1] ?? "";
  if (names.length < 2) return last;
  return fill(pattern, { rest: names.slice(0, -1).join(", "), last });
}

/**
 * Uçtaki red KODU → müşteri cümlesi; eşleme yoksa `null`.
 *
 * Uçlar `{error, code}` döner (global kısıt) ve istemci bugün ucun cümlesini
 * birebir gösteriyor. Bir red müşteriye NE YAPACAĞINI söylüyorsa o cümle
 * sözlüğe aittir (tr + en kuralı): STEP'in ISO 10303 kabuğu eksikse müşteriyi
 * AP203/AP214 ihracatına yönlendiren cümle buradan gelir ve iki yükleme yeri
 * (çalışma alanı + açılış sayfası) onu aynı yerden okur.
 *
 * Eşlenmeyen kod `null` döner — tablo ucun kod kümesini ÇOĞALTMAK zorunda
 * değildir; yeni bir kod sessizce ucun cümlesiyle gösterilir.
 */
export function uploadCodeMessage(
  code: string | null | undefined,
  file: string,
  d: Dictionary
): string | null {
  if (code === "step_not_iso") {
    return fill(d["instantQuote.upload.stepInvalid"], { file });
  }
  return null;
}

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
  opts: {
    maxFileBytes: number;
    maxParts: number;
    currentCount: number;
    /** `catalog.acceptedFormats` — bayrak kapalıyken `"step"` içermez. */
    acceptedFormats: readonly QuoteSourceFormat[];
    d: Dictionary;
  }
): QuoteFileCheck {
  const { d, maxFileBytes, maxParts, currentCount, acceptedFormats } = opts;
  const maxMb = megabytes(maxFileBytes);
  const allowed = new Set(acceptedExtensions(acceptedFormats));
  const accepted: File[] = [];
  const errors: string[] = [];
  let room = Math.max(0, maxParts - currentCount);

  for (const file of files) {
    const extension = extensionOf(file.name);
    if (!allowed.has(extension)) {
      // Cümledeki liste KABUL EDİLEN listedir: bayrak kapalıyken reddin
      // içinde STEP'i anmak, reddettiğimiz biçimi kabul ediyoruz demek olurdu.
      errors.push(
        fill(d["instantQuote.upload.invalidFormat"], {
          file: file.name,
          formats: formatNames(acceptedFormats, d["instantQuote.upload.formatListAnd"]),
        })
      );
      continue;
    }
    // STEP'in tavanı genel tavandan AYRI ve daha düşük (16 MiB): aynı bayt
    // sayısı STEP'te mesh'ten kat kat fazla geometri taşır. Sıra önemli —
    // STEP tavanı genel tavanın altında olduğu için önce o sorulur, yoksa
    // müşteri yanlış rakamı okurdu.
    if (FORMAT_EXTENSIONS.step.includes(extension) && file.size > STEP_MAX_BYTES) {
      errors.push(
        fill(d["instantQuote.upload.stepTooLarge"], {
          file: file.name,
          maxMb: megabytes(STEP_MAX_BYTES),
        })
      );
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
  acceptedFormats,
  uploads,
  errors,
  disabled,
  onFiles,
}: {
  maxFileBytes: number;
  /**
   * `catalog.acceptedFormats` — sabit DEĞİL, bayrağa bağlı. Dosya seçicinin
   * `accept` dizesi DE alanın altındaki ipucu cümlesi DE bu tek prop'tan
   * türer: ikisini ayrı ayrı geçirmek, seçicinin süzdüğü liste ile müşteriye
   * söylenen listenin ayrışabileceği yerdi.
   */
  acceptedFormats: readonly QuoteSourceFormat[];
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
          accept={acceptedAccept(acceptedFormats)}
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
          {fill(d["instantQuote.upload.hint"], {
            formats: formatNames(acceptedFormats, d["instantQuote.upload.formatListOr"]),
            maxMb: megabytes(maxFileBytes),
          })}
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
