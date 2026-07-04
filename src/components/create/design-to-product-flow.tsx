"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { SiteHeader } from "@/components/site-header";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { objectPriceKurus } from "@/lib/config/prices";
import { UPLOAD_MAX_SIZE_BYTES } from "@/lib/config/upload";

// Faz 2: 2D design/logo → stylized object IMAGE. Reuses the "object" style
// engine end-to-end: upload → /api/preview/generate (style="object") → poll →
// auto-approve the first fal.ai variation → show the image, then hand the
// approved preview off to the proven /create checkout via ?previewId= (no new
// schema / order path). The admin sculpts the 3D after payment.
export function DesignToProductFlow() {
  const d = useDictionary();
  const locale = useLocale();
  const router = useRouter();
  const turnstileRef = useRef<TurnstileRef>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tri-state: null while the auth check is in flight, then true/false.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Generation requires login (each Meshy/Tripo call costs money). Resolve auth
  // up front so handleGenerate can gate guests into the login round-trip instead
  // of letting them hit a bare 401.
  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json().catch(() => null);
          setLoggedIn(true);
          if (data?.user?.id) setCurrentUserId(data.user.id);
        } else {
          setLoggedIn(false);
        }
      })
      .catch(() => setLoggedIn(false));
  }, []);

  // Restore an in-progress design after the login round-trip. Gated on the auth
  // check resolving (loggedIn !== null). Cross-user safety: an anonymous save
  // (userId:null) is accepted by any viewer; a save tagged with a user id is
  // only accepted by that same user.
  useEffect(() => {
    if (loggedIn === null) return;
    try {
      const saved = sessionStorage.getItem("designFlowState");
      if (!saved) return;
      const state = JSON.parse(saved);
      const savedFor = state.userId ?? null;
      const currentFor = currentUserId ?? null;
      if (savedFor !== null && savedFor !== currentFor) {
        sessionStorage.removeItem("designFlowState");
        return;
      }
      if (state.photoKey) setPhotoKey(state.photoKey);
      if (state.photoPreview) setPhotoPreview(state.photoPreview);
      sessionStorage.removeItem("designFlowState");
    } catch {
      // Ignore parse errors
    }
  }, [loggedIn, currentUserId]);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/") || file.size > UPLOAD_MAX_SIZE_BYTES) {
      setError(d["design.errGeneric"]);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const fd = new FormData();
      fd.append("file", file);
      fd.append("turnstileToken", token);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "upload");
      }
      const { key, previewUrl } = await res.json();
      setPhotoKey(key);
      setPhotoPreview(previewUrl ?? null);
    } catch {
      setError(d["design.errGeneric"]);
    } finally {
      setUploading(false);
    }
  };

  const startPolling = useCallback(
    (id: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > 5 * 60 * 1000) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(d["design.errGeneric"]);
          setStep(0);
          return;
        }
        try {
          const res = await fetch(`/api/preview/${id}`);
          if (!res.ok) return;
          const data = await res.json();
          if (data.status === "styled") {
            // This simplified flow has no variation picker — auto-approve the
            // first fal.ai image and show it.
            if (pollRef.current) clearInterval(pollRef.current);
            const first = data.styledImageUrls?.[0];
            if (!first) {
              setError(d["design.errGeneric"]);
              setStep(0);
              return;
            }
            try {
              await fetch(`/api/preview/${id}/select`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: first }),
              });
            } catch {
              // non-fatal — the image still shows; select can be retried at checkout
            }
            setImageUrl(first);
            setStep(2);
          } else if (data.status === "approved") {
            setImageUrl(data.selectedStyledImageUrl);
            setStep(2);
            if (pollRef.current) clearInterval(pollRef.current);
          } else if (data.status === "failed") {
            setError(data.errorMessage || d["design.errGeneric"]);
            setStep(0);
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          // ignore transient polling errors
        }
      }, 3000);
    },
    [d]
  );

  const handleGenerate = async () => {
    if (!photoKey) return;
    // Stash the uploaded design so it survives the login round-trip (the restore
    // effect reads `designFlowState`), then send the guest to /login with a
    // path-carrying redirect so they return to THIS flow — not the bare
    // path-selector — and can continue with one click.
    if (loggedIn === false) {
      try {
        sessionStorage.setItem(
          "designFlowState",
          JSON.stringify({ userId: null, photoKey, photoPreview })
        );
      } catch {
        // sessionStorage unavailable — proceed to login anyway.
      }
      router.push(`/login?redirect=${encodeURIComponent("/create?path=design")}`);
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const res = await fetch("/api/preview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // object style + a neutral size; the object engine ignores size for
        // generation and the user re-picks size/material at checkout.
        body: JSON.stringify({
          photoKey,
          figurineSize: "orta",
          style: "object",
          modifiers: [],
          turnstileToken: token,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(
          Array.isArray(e.error) ? e.error[0]?.message : e.error || "generate"
        );
      }
      const data = await res.json();
      setPreviewId(data.previewId);
      setStep(1);
      startPolling(data.previewId);
    } catch (err) {
      setError(err instanceof Error ? err.message : d["design.errGeneric"]);
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep(0);
    setPhotoKey(null);
    setPhotoPreview(null);
    setPreviewId(null);
    setImageUrl(null);
    setError(null);
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
            {d["design.title"]}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-text-secondary">{d["design.sub"]}</p>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-error/30 bg-error-50 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        {/* Step 0 — upload + generate */}
        {step === 0 && (
          <div className="mt-8">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {photoPreview ? (
              <div className="card overflow-hidden p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt=""
                  className="mx-auto max-h-72 w-auto rounded-lg object-contain"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="mt-4 w-full rounded-full border border-border-default bg-white py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated disabled:opacity-60"
                >
                  {d["design.change"]}
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="card flex w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-border-default py-16 text-center transition-colors hover:border-green-500/50 hover:bg-bg-elevated disabled:opacity-60"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-50 text-green-600 ring-1 ring-green-500/15">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                </span>
                <span className="font-medium text-text-primary">
                  {uploading ? "…" : d["design.upload"]}
                </span>
                <span className="text-xs text-text-muted">{d["design.uploadHint"]}</span>
              </button>
            )}

            <p className="mt-4 text-center text-xs text-text-muted">{d["design.note"]}</p>

            <button
              onClick={handleGenerate}
              disabled={!photoKey || uploading || generating || loggedIn === null}
              className="mt-6 w-full rounded-full bg-green-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "…" : d["design.generate"]}
            </button>
          </div>
        )}

        {/* Step 1 — generating */}
        {step === 1 && (
          <div className="mt-12 flex flex-col items-center gap-5 py-10 text-center">
            <span className="h-12 w-12 animate-spin rounded-full border-4 border-green-500/20 border-t-green-500" />
            <p className="max-w-sm text-text-secondary">{d["design.generating"]}</p>
          </div>
        )}

        {/* Step 2 — preview + checkout */}
        {step === 2 && imageUrl && (
          <div className="mt-8">
            <h2 className="text-center font-serif text-2xl text-text-primary">
              {d["design.previewTitle"]}
            </h2>
            <p className="mt-2 text-center text-sm text-text-secondary">
              {d["design.previewSub"]}
            </p>
            <div className="card mt-6 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={d["design.previewTitle"]}
                className="w-full h-auto object-contain bg-white"
              />
            </div>
            <p className="mt-4 text-center text-sm text-text-secondary">
              {d["design.fromPrice"]}{" "}
              <span className="font-semibold text-text-primary">
                {formatCurrency(objectPriceKurus("orta", "resin"), locale)}
              </span>
              <span className="mt-1 block text-xs text-text-muted">{d["design.priceNote"]}</span>
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => previewId && router.push(`/create?previewId=${previewId}`)}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-green-600 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-green-700"
              >
                {d["design.toCheckout"]}
              </button>
              <button
                onClick={reset}
                className="inline-flex items-center justify-center rounded-full border border-border-default bg-white px-7 py-3 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-elevated"
              >
                {d["design.regen"]}
              </button>
            </div>
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
