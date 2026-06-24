"use client";

import { useRef, useState } from "react";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { ModelViewer } from "@/components/model-viewer";
import { WhatsAppButton } from "@/components/whatsapp/whatsapp-button";

type Product = "keychain" | "fridge_magnet" | "lamp";

const PRODUCTS: { key: Product; label: string; desc: string; emoji: string }[] = [
  { key: "keychain", label: "Anahtarlık", desc: "Fotoğraftan 3D anahtarlık", emoji: "🔑" },
  { key: "fridge_magnet", label: "Buzdolabı Magneti", desc: "Fotoğraftan kabartmalı magnet", emoji: "🧲" },
  { key: "lamp", label: "Gece Lambası", desc: "Fotoğraftan 3D baskı lamba", emoji: "💡" },
];

type Status = "idle" | "uploading" | "generating" | "ready" | "failed";

export default function UrunlerPage() {
  const [product, setProduct] = useState<Product>("keychain");
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const productLabel = PRODUCTS.find((p) => p.key === product)!.label;

  async function handleFile(file: File) {
    setStatus("uploading");
    setError(null);
    setGlbUrl(null);
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

  async function handleGenerate() {
    if (!photoKey) return;
    setStatus("generating");
    setError(null);
    setGlbUrl(null);
    try {
      const res = await fetch("/api/creative-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product, photoKey }),
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
        if (data.code === "account_cap") {
          throw new Error("Ücretsiz üretim sınırına ulaştın.");
        }
        throw new Error(typeof data.error === "string" ? data.error : "Üretim başlatılamadı");
      }
      startPolling(data.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hata");
      setStatus("failed");
    }
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > 6 * 60 * 1000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setStatus("failed");
        setError("Zaman aşımı — lütfen tekrar deneyin.");
        return;
      }
      try {
        const res = await fetch(`/api/creative-lab/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "ready") {
          setGlbUrl(data.glbUrl ?? null);
          setStatus("ready");
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
  }

  const waMessage = `Merhaba, fotoğraftan ${productLabel} siparişi vermek istiyorum.`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="font-serif text-3xl text-text-primary">Fotoğraftan Ürün</h1>
        <p className="mt-2 text-text-secondary">
          Fotoğrafını yükle, anında 3D anahtarlık, magnet veya lamba oluştur.
        </p>
      </div>

      {/* Product selector */}
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
          </button>
        ))}
      </div>

      {/* Upload */}
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

      {/* Action / status */}
      {status !== "ready" && (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!photoKey || status === "generating" || status === "uploading"}
          className="w-full rounded-full bg-green-600 px-6 py-4 font-semibold text-white transition hover:bg-green-700 disabled:opacity-40"
        >
          {status === "generating" ? "Oluşturuluyor… (~1-2 dk)" : `${productLabel} oluştur`}
        </button>
      )}

      {error && <p className="mt-3 text-center text-sm text-error">{error}</p>}

      {/* Result */}
      {status === "ready" && (
        <div className="mt-6 text-center">
          <h2 className="font-serif text-2xl text-text-primary">{productLabel} hazır! 🎉</h2>
          {glbUrl ? (
            <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-bg-elevated">
              <ModelViewer url={glbUrl} previewMode />
            </div>
          ) : (
            <p className="mt-2 text-text-secondary">
              Modeliniz hazırlandı. Sipariş için WhatsApp&apos;tan bize ulaşın.
            </p>
          )}
          <div className="mt-5 flex flex-col items-center gap-3">
            <WhatsAppButton message={waMessage} label="WhatsApp ile sipariş ver" className="w-full sm:w-auto" />
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setGlbUrl(null);
                setPhotoKey(null);
                setPhotoPreview(null);
              }}
              className="text-sm text-text-muted underline underline-offset-4"
            >
              Yeni ürün oluştur
            </button>
          </div>
        </div>
      )}

      <Turnstile ref={turnstileRef} />
    </div>
  );
}
