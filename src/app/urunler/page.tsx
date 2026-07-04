"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { SiteHeader } from "@/components/site-header";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { creativeLabPriceKurus } from "@/lib/config/prices";
import { useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";

type Product = "keychain" | "fridge_magnet" | "lamp";

const PRODUCTS: { key: Product; label: string; desc: string; emoji: string }[] = [
  { key: "keychain", label: "Anahtarlık", desc: "Fotoğraftan 3D anahtarlık", emoji: "🔑" },
  { key: "fridge_magnet", label: "Buzdolabı Magneti", desc: "Fotoğraftan kabartmalı magnet", emoji: "🧲" },
  { key: "lamp", label: "Gece Lambası", desc: "Fotoğraftan 3D baskı lamba", emoji: "💡" },
];

// idle → uploading → generating → styled (pick a variation) → approved (checkout)
type Status = "idle" | "uploading" | "generating" | "styled" | "approved" | "failed";

export default function UrunlerPage() {
  const locale = useLocale();
  const [product, setProduct] = useState<Product>("keychain");
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [variations, setVariations] = useState<string[]>([]);
  const [approvedImage, setApprovedImage] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const productMeta = PRODUCTS.find((p) => p.key === product)!;
  const priceKurus = creativeLabPriceKurus(product);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const fd = new FormData();
      fd.append("file", file);
      fd.append("turnstileToken", token);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Yükleme başarısız");
      setPhotoKey(data.key);
      setPhotoPreview(data.previewUrl);
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yükleme hatası");
      setStatus("idle");
    }
  }

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 5 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("failed");
        setError("Zaman aşımı — lütfen tekrar deneyin.");
        return;
      }
      try {
        const res = await fetch(`/api/preview/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "styled") {
          setVariations(data.styledImageUrls || []);
          setStatus("styled");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === "approved") {
          setApprovedImage(data.selectedStyledImageUrl);
          setStatus("approved");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          setError(data.errorMessage || "Üretim başarısız oldu.");
          setStatus("failed");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 3000);
  }, []);

  async function handleGenerate() {
    if (!photoKey) return;
    setStatus("generating");
    setError(null);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const res = await fetch("/api/preview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The Creative Lab products are modelled as custom orders: the product
        // is the `style`, and size/material are ignored (flat-priced). figurineSize
        // is required by the schema, so send a neutral default.
        body: JSON.stringify({
          photoKey,
          figurineSize: "orta",
          style: product,
          modifiers: [],
          turnstileToken: token,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "auth_required") {
          window.location.href = "/login?redirect=/urunler";
          return;
        }
        if (data.code === "email_not_verified") {
          throw new Error("Üretim için e-postanı doğrulaman gerekiyor.");
        }
        if (data.code === "phone_not_verified") {
          throw new Error("Üretim için telefonunu doğrulaman gerekiyor.");
        }
        if (["account_cap", "device_cap", "ip_cap"].includes(data.code)) {
          throw new Error("Ücretsiz üretim sınırına ulaştın.");
        }
        throw new Error(typeof data.error === "string" ? data.error : "Üretim başlatılamadı");
      }
      setPreviewId(data.previewId);
      startPolling(data.previewId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hata");
      setStatus("failed");
    }
  }

  // Picking a variation = approving it (no 3D build; the admin sculpts + prints).
  async function handleSelect(url: string) {
    if (!previewId || selecting) return;
    setSelecting(true);
    try {
      const res = await fetch(`/api/preview/${previewId}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return;
      setApprovedImage(url);
      setStatus("approved");
    } catch {
      // keep the picker on a network blip
    } finally {
      setSelecting(false);
    }
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus("idle");
    setPhotoKey(null);
    setPhotoPreview(null);
    setPreviewId(null);
    setVariations([]);
    setApprovedImage(null);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl text-text-primary">Fotoğraftan Ürün</h1>
          <p className="mt-2 text-text-secondary">
            Fotoğrafını yükle, tasarımını gör, beğenirsen sipariş ver — anahtarlık, magnet veya lamba.
          </p>
        </div>

        {/* Step 1-2: product + upload + generate (hidden once we have variations) */}
        {(status === "idle" || status === "uploading" || status === "generating" || status === "failed") && (
          <>
            <div className="mb-6 grid grid-cols-3 gap-3">
              {PRODUCTS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setProduct(p.key)}
                  className={`rounded-2xl border-2 bg-bg-elevated p-4 text-center transition ${
                    product === p.key
                      ? "border-green-500 ring-2 ring-green-500/30"
                      : "border-transparent hover:border-green-500/40"
                  }`}
                >
                  <div className="text-3xl">{p.emoji}</div>
                  <div className="mt-2 font-semibold text-text-primary">{p.label}</div>
                  <div className="mt-0.5 text-xs text-text-muted">{p.desc}</div>
                  <div className="mt-1 text-xs font-medium text-green-600">
                    {formatCurrency(creativeLabPriceKurus(p.key), locale)}
                  </div>
                </button>
              ))}
            </div>

            <div className="mb-6 rounded-2xl border border-border bg-bg-elevated p-6">
              <label className="block cursor-pointer text-center">
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview} alt="yüklenen" className="mx-auto max-h-56 rounded-xl object-contain" />
                ) : (
                  <div className="py-10 text-text-muted">
                    {status === "uploading" ? "Yükleniyor…" : "Fotoğraf seçmek için tıkla (PNG/JPG)"}
                  </div>
                )}
              </label>
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!photoKey || status === "generating" || status === "uploading"}
              className="w-full rounded-full bg-green-600 px-6 py-4 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
            >
              {status === "generating"
                ? "Tasarım oluşturuluyor… (~1 dk)"
                : `${productMeta.label} tasarla`}
            </button>
          </>
        )}

        {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

        {/* Step 3: pick a variation */}
        {status === "styled" && (
          <div className="mt-2">
            <h2 className="text-center font-serif text-2xl text-text-primary">Tasarımını seç</h2>
            <p className="mt-1 text-center text-sm text-text-secondary">
              Beğendiğin görsele dokun — siparişin bu tasarıma göre üretilir.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4">
              {variations.map((url) => (
                <button
                  key={url}
                  type="button"
                  disabled={selecting}
                  onClick={() => handleSelect(url)}
                  className="group overflow-hidden rounded-2xl border-2 border-transparent bg-white transition hover:border-green-500 disabled:opacity-60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="tasarım" className="aspect-square w-full object-contain" />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={reset}
              className="mt-5 block w-full text-center text-sm text-text-muted underline underline-offset-4"
            >
              Baştan başla
            </button>
          </div>
        )}

        {/* Step 4: approved image + real checkout */}
        {status === "approved" && approvedImage && (
          <div className="mt-2">
            <h2 className="text-center font-serif text-2xl text-text-primary">{productMeta.label} tasarımın hazır 🎉</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={approvedImage} alt={productMeta.label} className="mx-auto max-h-96 w-auto object-contain" />
            </div>
            <p className="mt-3 text-center text-sm text-text-secondary">
              Siparişin onaylandıktan sonra ekibimiz bu tasarımdan baskıya hazır 3D modeli üretir.
            </p>

            <div className="mt-6 rounded-2xl border border-border bg-bg-elevated p-5">
              <CheckoutForm
                orderPayload={{
                  orderType: "custom",
                  photoKey,
                  previewId,
                  style: product,
                  figurineSize: "orta",
                  material: "resin",
                  finish: "paintable_kit",
                }}
                priceKurus={priceKurus}
                submitLabel="Siparişi ver"
              />
            </div>

            <button
              type="button"
              onClick={reset}
              className="mt-5 block w-full text-center text-sm text-text-muted underline underline-offset-4"
            >
              Yeni tasarım oluştur
            </button>
          </div>
        )}

        <Turnstile ref={turnstileRef} />
      </div>
    </main>
  );
}
