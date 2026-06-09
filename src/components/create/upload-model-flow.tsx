"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { SiteHeader } from "@/components/site-header";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { UPLOAD_MODEL_MAX_SIZE_BYTES } from "@/lib/config/upload";
import { CheckoutForm } from "@/components/checkout/checkout-form";

const HEIGHTS = [40, 60, 80, 120, 160];
const MATERIALS = ["resin", "filament"] as const;

interface UploadResult {
  id: string;
  status: string;
  priceKurus: number | null;
  needsQuote: boolean;
  glbPreviewUrl: string | null;
  printRisk: string[] | null;
}

// Faz 3 — upload your own STL/OBJ → print. Validates + processes geometry
// server-side (/api/upload/model), then shows a 3D preview + an auto price or a
// "needs quote" path. v1 ends at a print request (quote-bridge); the priced
// uploadedModel feeds the order pipeline once an admin confirms.
export function UploadModelFlow() {
  const d = useDictionary();
  const locale = useLocale();
  const turnstileRef = useRef<TurnstileRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [height, setHeight] = useState(80);
  const [material, setMaterial] = useState<(typeof MATERIALS)[number]>("resin");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const pickFile = (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop();
    if ((ext !== "stl" && ext !== "obj") || file.size > UPLOAD_MODEL_MAX_SIZE_BYTES) {
      setError(d["upload.errGeneric"]);
      return;
    }
    setError(null);
    setPendingFile(file);
    setFileName(file.name);
  };

  const handleSubmit = async () => {
    if (!pendingFile) return;
    setStep(1);
    setError(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const fd = new FormData();
      fd.append("file", pendingFile);
      fd.append("targetHeightMm", String(height));
      fd.append("material", material);
      fd.append("turnstileToken", token);
      const res = await fetch("/api/upload/model", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "upload");
      }
      const data: UploadResult = await res.json();
      setResult(data);
      setStep(2);
    } catch {
      setError(d["upload.errGeneric"]);
      setStep(0);
    }
  };

  const reset = () => {
    setStep(0);
    setPendingFile(null);
    setFileName(null);
    setResult(null);
    setError(null);
    setCheckoutOpen(false);
  };

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <section className="mx-auto max-w-3xl px-5 py-12 md:py-16">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
            {d["landing.market.produce.eyebrow"]}
          </p>
          <h1
            className="mt-3 text-3xl text-text-primary md:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {d["upload.title"]}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">{d["upload.sub"]}</p>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-error/30 bg-error-50 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Step 0 — file + options */}
        {step === 0 && (
          <div className="mt-8 space-y-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".stl,.obj"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="card flex w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-border-default py-14 text-center transition-colors hover:border-green-500/50 hover:bg-bg-elevated"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-green-500/15">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </span>
              <span className="font-medium text-text-primary">
                {fileName ?? d["upload.dropzone"]}
              </span>
              <span className="text-xs text-text-muted">{d["upload.dropzoneHint"]}</span>
            </button>

            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">{d["upload.height"]}</p>
              <div className="flex flex-wrap gap-2">
                {HEIGHTS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHeight(h)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      height === h
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-border-default text-text-secondary hover:bg-bg-elevated"
                    }`}
                  >
                    {h}mm
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">{d["upload.material"]}</p>
              <div className="flex gap-2">
                {MATERIALS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMaterial(m)}
                    className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
                      material === m
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-border-default text-text-secondary hover:bg-bg-elevated"
                    }`}
                  >
                    {d[`material.${m}` as keyof typeof d]}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-text-muted">{d["upload.note"]}</p>

            <button
              onClick={handleSubmit}
              disabled={!pendingFile}
              className="w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {d["upload.submit"]}
            </button>
          </div>
        )}

        {/* Step 1 — processing */}
        {step === 1 && (
          <div className="mt-12 flex flex-col items-center gap-5 py-10 text-center">
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-green-500/20 border-t-green-500" />
            <p className="max-w-sm text-text-secondary">{d["upload.processing"]}</p>
          </div>
        )}

        {/* Step 2 — result */}
        {step === 2 && result && (
          <div className="mt-8">
            <h2 className="text-center font-serif text-2xl text-text-primary">
              {d["upload.resultTitle"]}
            </h2>
            {result.glbPreviewUrl && (
              <div className="card mt-6 overflow-hidden">
                <ModelViewer url={result.glbPreviewUrl} previewMode />
              </div>
            )}

            {result.printRisk && result.printRisk.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {result.printRisk.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700"
                  >
                    {d[`upload.risk.${r}` as keyof typeof d] || r}
                  </span>
                ))}
              </div>
            )}

            <div className="card mt-6 p-6">
              {result.needsQuote || result.priceKurus == null ? (
                <div className="text-center">
                  <p className="font-serif text-lg text-text-primary">{d["upload.needsQuote"]}</p>
                  <p className="mt-2 text-sm text-text-secondary">{d["upload.needsQuoteSub"]}</p>
                  <button
                    onClick={() => setStep(3)}
                    className="mt-6 w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                  >
                    {d["upload.requestCta"]}
                  </button>
                </div>
              ) : checkoutOpen ? (
                <CheckoutForm
                  orderPayload={{ orderType: "upload", uploadedModelId: result.id }}
                  priceKurus={result.priceKurus}
                  submitLabel={d["upload.placeOrder"]}
                />
              ) : (
                <div className="text-center">
                  <p className="text-sm text-text-muted">{d["upload.price"]}</p>
                  <p className="mt-1 text-3xl font-semibold text-text-primary">
                    {formatCurrency(result.priceKurus, locale)}
                  </p>
                  <button
                    onClick={() => setCheckoutOpen(true)}
                    className="mt-6 w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
                  >
                    {d["upload.placeOrder"]}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3 — request received */}
        {step === 3 && (
          <div className="mt-12 flex flex-col items-center gap-4 py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600 ring-1 ring-green-500/20">
              <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </span>
            <h2 className="font-serif text-2xl text-text-primary">{d["upload.requestDoneTitle"]}</h2>
            <p className="max-w-md text-text-secondary">{d["upload.requestDoneSub"]}</p>
            <button
              onClick={reset}
              className="mt-2 rounded-full border border-border-default bg-white px-6 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
            >
              {d["upload.another"]}
            </button>
          </div>
        )}

        <div className="mt-10 text-center">
          <Link href="/create" className="text-sm text-text-muted transition-colors hover:text-text-primary">
            ← {d["create.soon.back"]}
          </Link>
        </div>
      </section>
      <Turnstile ref={turnstileRef} />
    </main>
  );
}
