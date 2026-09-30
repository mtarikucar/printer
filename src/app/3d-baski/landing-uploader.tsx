"use client";

import { useRef, useState, type JSX } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { track } from "@/lib/analytics/client";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { UploadProgressBar } from "@/components/ui/UploadProgressBar";
import {
  acceptedAccept,
  formatNames,
  megabytes,
  uploadCodeMessage,
  validateQuoteFiles,
  type QuoteUploadState,
} from "@/components/quote/dropzone";
import { fill } from "@/components/quote/format";
import type { QuoteSourceFormat } from "@/lib/config/quote-types";
import { useDictionary } from "@/lib/i18n/locale-context";
import { QuoteApiError, addQuotePart, createQuote } from "@/lib/quote/client-api";
import { uploadLargeFile } from "@/lib/upload-large-file";
import { UploadError } from "@/lib/upload-with-progress";

/**
 * Açılış sayfasının yükleyicisi: dosya bırakıldığı anda TEKLİFİ AÇAR ve
 * çalışma alanına götürür.
 *
 * Neden teklif burada açılıyor: müşteri hesapsız gelir; dosyayı sahneleyip
 * "şimdi giriş yapın" demek, Xometry'nin de kaçındığı bir duvar. `POST
 * /api/quotes` anonim çerezle teklifi açar, parçalar teklife eklenir, fiyat
 * kapısı çalışma alanında devreye girer.
 *
 * Seçilen BÜTÜN dosyalar burada yüklenir, sonra yönlendirilir: yarısı burada
 * yarısı orada bir akış, çalışma alanına vardığında eksik parça gösterirdi
 * (uçuştaki yüklemeler sayfa değişince iptal olur).
 *
 * Teklif bir kez açılır ve `quoteRef` ile saklanır: yükleme yarıda kalıp
 * müşteri yeniden denediğinde her denemede yeni bir boş teklif açılmaz.
 */
export function LandingUploader({
  maxFileBytes,
  maxPartsPerQuote,
  acceptedFormats,
}: {
  maxFileBytes: number;
  maxPartsPerQuote: number;
  /**
   * Müşteriye NE seçtirileceği: `quote_step_enabled` kapalıyken `"step"` bu
   * listede YOKTUR. Sayfa bunu bayraktan türetir (`page.tsx`), bileşen bayrak
   * OKUMAZ — açılış sayfası istemcide çalışır ve bayrak sunucu tarafı bir
   * ayardır.
   */
  acceptedFormats: QuoteSourceFormat[];
}): JSX.Element {
  const d = useDictionary();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileRef>(null);
  const quoteRef = useRef<{ id: string; number: string } | null>(null);

  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<QuoteUploadState[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);

  const addError = (message: string) =>
    setErrors((prev) => (prev.includes(message) ? prev : [...prev, message]));

  async function handleFiles(files: File[]): Promise<void> {
    if (busy || files.length === 0) return;
    if (!terms) {
      // Onay kutusu ödeme değil YÜKLEME koşuludur (tasarım hakkı, yasaklı
      // ürün, üreticiyle paylaşım): uç onaysız gövdeyi zaten 400 ile reddeder.
      setErrors(["Devam etmek için yükleme koşullarını onaylayın."]);
      return;
    }

    const { accepted, errors: rejected } = validateQuoteFiles(files, {
      maxFileBytes,
      maxParts: maxPartsPerQuote,
      currentCount: 0,
      acceptedFormats,
      d,
    });
    setErrors(rejected);
    if (accepted.length === 0) return;

    setBusy(true);
    try {
      let quote = quoteRef.current;
      if (!quote) {
        const token = (await turnstileRef.current?.getToken()) ?? "";
        const created = await createQuote({ termsAccepted: true, turnstileToken: token });
        quote = { id: created.id, number: created.number };
        quoteRef.current = quote;
      }

      let uploaded = 0;
      for (const file of accepted) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setUploads((prev) => [...prev, { id, fileName: file.name, progress: null }]);
        try {
          const staged = await uploadLargeFile(file, {
            expectedSize: true,
            onProgress: (progress) =>
              setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, progress } : u))),
          });
          await addQuotePart(quote.id, {
            uploadId: staged.uploadId,
            fileName: staged.fileName,
          });
          uploaded += 1;
          track("quote_upload");
        } catch (e) {
          // Ucun KODU sözlükte bir cümleye karşılık geliyorsa o cümle gider
          // (STEP'in ISO kabuğu → AP203/AP214 yönlendirmesi); yoksa ucun
          // kendi cümlesi olduğu gibi gösterilir.
          const mapped =
            e instanceof QuoteApiError ? uploadCodeMessage(e.code, file.name, d) : null;
          addError(
            mapped ??
              (e instanceof QuoteApiError || e instanceof UploadError
                ? e.message
                : fill(d["instantQuote.upload.failed"], { file: file.name }))
          );
        } finally {
          setUploads((prev) => prev.filter((u) => u.id !== id));
        }
      }

      // Tek parça bile girdiyse çalışma alanı gösterilir: müşteri orada
      // eksik dosyayı yeniden ekleyebilir, boş bir ekranla baş başa kalmaz.
      if (uploaded > 0) {
        router.push(`/teklif/${encodeURIComponent(quote.number)}`);
        return;
      }
    } catch (e) {
      addError(e instanceof QuoteApiError ? e.message : d["common.error"]);
    }
    setBusy(false);
  }

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    void handleFiles(Array.from(list));
  };

  return (
    <div className="rounded-2xl border border-border-default bg-bg-elevated p-6 shadow-elevated">
      <div
        onDragOver={(e) => {
          if (busy) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (busy) return;
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          over ? "border-[var(--color-accent)] bg-accent-soft" : "border-border-default"
        } ${busy ? "opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptedAccept(acceptedFormats)}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-base font-medium text-text-primary">
          {d["instantQuote.upload.drop"]}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {fill(d["instantQuote.upload.hint"], {
            formats: formatNames(acceptedFormats, d["instantQuote.upload.formatListOr"]),
            maxMb: megabytes(maxFileBytes),
          })}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="btn-primary mt-5 !px-5 !py-2.5 text-sm"
        >
          {busy ? d["instantQuote.upload.uploading"] : d["instantQuote.upload.browse"]}
        </button>
      </div>

      {uploads.map((upload) => (
        <div key={upload.id} className="mt-3 rounded-xl border border-border-default px-3 py-2">
          <p className="mb-1 truncate font-mono text-[11px] text-text-secondary">
            {upload.fileName}
          </p>
          <UploadProgressBar
            progress={upload.progress}
            processingLabel={d["instantQuote.upload.processing"]}
          />
        </div>
      ))}

      <label className="mt-5 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-text-secondary">
        <input
          type="checkbox"
          checked={terms}
          disabled={busy}
          onChange={(e) => {
            setTerms(e.target.checked);
            if (e.target.checked) setErrors([]);
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
        />
        <span>{d["instantQuote.terms.accept"]}</span>
      </label>

      {errors.map((message) => (
        <p
          key={message}
          className="mt-2 rounded-lg border border-error/40 bg-error-50 px-3 py-2 text-xs text-error-700"
        >
          {message}
        </p>
      ))}

      <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
        Hesap açmadan yükleyebilirsiniz; fiyatı görmek için hesap gerekir.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Gizlilik Politikası
        </Link>
      </p>

      <Turnstile ref={turnstileRef} />
    </div>
  );
}
