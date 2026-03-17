"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ModelViewer } from "@/components/model-viewer";
import { SiteHeader } from "@/components/site-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { useDictionary } from "@/lib/i18n/locale-context";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { PRICES_KURUS } from "@/lib/config/prices";

const PhotoEditor = dynamic(
  () => import("@/components/photo-editor/photo-editor").then((m) => ({ default: m.PhotoEditor })),
  { ssr: false }
);

interface FormData {
  adres: string;
  mahalle: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

// Steps: 0=Size+Photo, 1=Generating, 2=Preview, 3=Shipping+Payment
type Step = 0 | 1 | 2 | 3;

export default function CreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const d = useDictionary();
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>("orta");
  const [selectedStyle, setSelectedStyle] = useState<string>("realistic");
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [orderSubmitted, setOrderSubmitted] = useState(false);
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormData>({
    adres: "",
    mahalle: "",
    ilce: "",
    il: "",
    postaKodu: "",
    telefon: "",
  });
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [neighborhoodOptions, setNeighborhoodOptions] = useState<string[]>([]);
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);

  // Preview state
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [previewGlbUrl, setPreviewGlbUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Revision state
  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionSending, setRevisionSending] = useState(false);
  const [revisionSent, setRevisionSent] = useState(false);

  // Gift card state
  const [gcCode, setGcCode] = useState("");
  const [gcApplying, setGcApplying] = useState(false);
  const [gcError, setGcError] = useState<string | null>(null);
  const [gcApplied, setGcApplied] = useState<{ id: string; code: string; balanceKurus: number } | null>(null);

  // Loading stage rotation
  const [loadingStage, setLoadingStage] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorExportRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);

  const SIZES = [
    { key: "kucuk", label: d["sizes.kucuk"], price: "999", height: "~60mm" },
    { key: "orta", label: d["sizes.orta"], price: "1.399", height: "~80mm" },
    { key: "buyuk", label: d["sizes.buyuk"], price: "1.799", height: "~120mm" },
  ] as const;

  const STYLES = [
    { key: "realistic", label: d["create.style.realistic"], desc: d["create.style.realistic.desc"], img: "/examples/realistic.png" },
    { key: "disney",    label: d["create.style.disney"],    desc: d["create.style.disney.desc"],    img: "/examples/disney.png" },
    { key: "anime",     label: d["create.style.anime"],     desc: d["create.style.anime.desc"],     img: "/examples/anime.png" },
    { key: "chibi",     label: d["create.style.chibi"],     desc: d["create.style.chibi.desc"],     img: "/examples/chibi.png" },
  ] as const;

  const MODIFIERS = [
    { key: "pixel_art", label: d["create.modifier.pixel_art"], desc: d["create.modifier.pixel_art.desc"], img: "/examples/pixel-realistic.png" },
  ] as const;

  const getStyleImg = (styleKey: string) => {
    if (selectedModifiers.includes("pixel_art")) {
      return `/examples/pixel-${styleKey}.png`;
    }
    return `/examples/${styleKey}.png`;
  };

  const toggleModifier = (key: string) => {
    setSelectedModifiers((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );
  };

  const stepLabels = [d["create.step1"], d["create.step2"], d["create.step3"], d["create.step4"]];

  const loadingStages = [
    d["create.loading.stage1"],
    d["create.loading.stage2"],
    d["create.loading.stage3"],
    d["create.loading.stage4"],
  ];

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        setLoggedIn(res.ok);
      })
      .catch(() => setLoggedIn(false));
  }, []);

  // Restore state from sessionStorage after login redirect
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("createFlowState");
      if (!saved) return;
      const state = JSON.parse(saved);
      if (state.photoKey) setPhotoKey(state.photoKey);
      if (state.selectedSize) setSelectedSize(state.selectedSize);
      if (state.selectedStyle) setSelectedStyle(state.selectedStyle);
      if (state.selectedModifiers) setSelectedModifiers(state.selectedModifiers);
      if (state.previewId) setPreviewId(state.previewId);
      if (state.previewGlbUrl) setPreviewGlbUrl(state.previewGlbUrl);
      if (state.step !== undefined) setStep(state.step as Step);
      sessionStorage.removeItem("createFlowState");
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Restore from ?previewId= query param (e.g. from account page)
  useEffect(() => {
    const qPreviewId = searchParams.get("previewId");
    if (!qPreviewId) return;
    fetch(`/api/preview/${qPreviewId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPreviewId(qPreviewId);
        if (data.photoKey) setPhotoKey(data.photoKey);
        if (data.status === "ready" || data.status === "approved") {
          setPreviewGlbUrl(data.glbUrl);
          setStep(2);
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // Loading stage cycle
  useEffect(() => {
    if (step !== 1 || previewError) return;
    setLoadingStage(0);
    const interval = setInterval(() => {
      setLoadingStage((prev) => (prev + 1) % 4);
    }, 18000);
    return () => clearInterval(interval);
  }, [step, previewError]);

  // Poll for preview status
  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    pollRef.current = setInterval(async () => {
      // Timeout — stop polling and show error
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPreviewError(d["create.preview.timedOut"]);
        return;
      }

      try {
        const res = await fetch(`/api/preview/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setPreviewStatus(data.status);

        if (data.status === "ready") {
          setPreviewGlbUrl(data.glbUrl);
          setStep(2);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === "failed") {
          setPreviewError(data.errorMessage || d["create.preview.timedOut"]);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  }, [d]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    if (field === "il") {
      setForm((prev) => ({ ...prev, il: value, ilce: "", mahalle: "" }));
      setDistrictOptions(value ? DISTRICTS[value] ?? [] : []);
      setNeighborhoodOptions([]);
    } else if (field === "ilce") {
      setForm((prev) => ({ ...prev, ilce: value, mahalle: "" }));
      setNeighborhoodOptions([]);
      if (value && form.il) {
        setNeighborhoodLoading(true);
        fetch(`/api/address/neighborhoods?il=${encodeURIComponent(form.il)}&ilce=${encodeURIComponent(value)}`)
          .then((res) => res.json())
          .then((data) => setNeighborhoodOptions(data.neighborhoods ?? []))
          .catch(() => setNeighborhoodOptions([]))
          .finally(() => setNeighborhoodLoading(false));
      }
    } else {
      setForm((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleGeneratePreview = async () => {
    let currentPhotoKey = photoKey;

    // If editor is active, auto-export and upload first
    if (isEditing && selectedFile && !currentPhotoKey) {
      setSubmitting(true);
      setError(null);

      try {
        const blob = await editorExportRef.current?.();
        if (!blob) {
          setError(d["create.photoRequired"]);
          setSubmitting(false);
          return;
        }

        const uploadToken = await turnstileRef.current?.getToken() ?? "";
        const formData = new FormData();
        formData.append("file", blob, "edited-photo.png");
        formData.append("turnstileToken", uploadToken);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || d["upload.failed"]);
        }

        const { key } = await res.json();
        setPhotoKey(key);
        setIsEditing(false);
        setSelectedFile(null);
        currentPhotoKey = key;
      } catch (err: any) {
        setError(err.message || d["upload.failed"]);
        setSubmitting(false);
        return;
      }
    }

    if (!currentPhotoKey) {
      setError(d["create.photoRequired"]);
      return;
    }

    if (loggedIn === false) {
      sessionStorage.setItem(
        "createFlowState",
        JSON.stringify({ photoKey: currentPhotoKey, selectedSize, selectedStyle, selectedModifiers, step: 0 })
      );
      router.push("/login?redirect=/create");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const generateToken = await turnstileRef.current?.getToken() ?? "";
      const res = await fetch("/api/preview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKey: currentPhotoKey,
          figurineSize: selectedSize,
          style: selectedStyle,
          modifiers: selectedModifiers,
          turnstileToken: generateToken,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          Array.isArray(data.error)
            ? data.error[0]?.message
            : data.error || d["create.orderFailed"]
        );
      }

      const data = await res.json();
      setPreviewId(data.previewId);
      setPreviewStatus("generating");
      setStep(1);
      startPolling(data.previewId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetryPreview = () => {
    setStep(0);
    setPreviewId(null);
    setPreviewStatus(null);
    setPreviewGlbUrl(null);
    setPreviewError(null);
    setPhotoKey(null);
    setSelectedFile(null);
    setIsEditing(false);
  };

  const handleApprove = () => {
    if (!loggedIn) {
      // Save state before redirecting to login
      sessionStorage.setItem(
        "createFlowState",
        JSON.stringify({
          photoKey,
          selectedSize,
          selectedStyle,
          selectedModifiers,
          previewId,
          previewGlbUrl,
          step: 2,
        })
      );
      router.push("/login?redirect=/create");
      return;
    }
    setStep(3);
  };

  const handleRevisionSubmit = async () => {
    if (!previewId || !revisionNote.trim()) return;
    setRevisionSending(true);

    try {
      const res = await fetch(`/api/preview/${previewId}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: revisionNote }),
      });

      if (res.ok) {
        setRevisionSent(true);
      }
    } catch {
      // Ignore
    } finally {
      setRevisionSending(false);
    }
  };

  const handleApplyGiftCard = async () => {
    if (!gcCode.trim()) return;
    setGcApplying(true);
    setGcError(null);

    try {
      const res = await fetch("/api/gift-cards/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: gcCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGcError(data.error);
        return;
      }
      setGcApplied({ id: data.card.id, code: gcCode, balanceKurus: data.card.balanceKurus });
    } catch {
      setGcError(d["common.error"]);
    } finally {
      setGcApplying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoKey) {
      setError(d["create.photoRequired"]);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKey,
          figurineSize: selectedSize,
          style: selectedStyle,
          modifiers: selectedModifiers,
          shippingAddress: form,
          previewId: previewId || undefined,
          giftCardCode: gcApplied?.code || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          Array.isArray(data.error)
            ? data.error[0]?.message
            : data.error || d["create.orderFailed"]
        );
      }

      const data = await res.json();
      sessionStorage.removeItem("createFlowState");
      setSubmittedOrderNumber(data.orderNumber);

      if (data.autoConfirmed) {
        // Gift card fully covered — no WhatsApp needed
        setOrderSubmitted(true);
        setWhatsappUrl(null);
      } else {
        setWhatsappUrl(data.whatsappUrl);
        setOrderSubmitted(true);
        window.open(data.whatsappUrl, "_blank");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSizeObj = SIZES.find((s) => s.key === selectedSize);

  // Order submitted — success screen
  if (orderSubmitted) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-lg mx-auto px-4 py-20">
          <div className="card shadow-elevated overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
                <svg className="w-10 h-10 text-green-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </div>
              <h1 className="text-2xl font-serif text-text-primary mb-2 animate-fade-in-up delay-200">
                {d["create.orderSubmitted.title"]}
              </h1>
              <p className="text-text-secondary mb-2 animate-fade-in-up delay-300">
                {d["create.orderSubmitted.message"]}
              </p>
              {submittedOrderNumber && (
                <p className="text-sm font-mono text-text-muted mb-6 animate-fade-in-up delay-300">
                  {submittedOrderNumber}
                </p>
              )}
              <div className="space-y-3 animate-fade-in-up delay-400">
                {whatsappUrl ? (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary w-full inline-flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                    {d["create.orderSubmitted.resend"]}
                  </a>
                ) : null}
                <button
                  onClick={() => router.push(`/track/${submittedOrderNumber}`)}
                  className={whatsappUrl ? "btn-secondary w-full" : "btn-primary w-full"}
                >
                  {d["create.orderSubmitted.track"]}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Revision sent screen
  if (revisionSent) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-lg mx-auto px-4 py-20">
          <div className="card shadow-elevated overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-success-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
                <svg className="w-10 h-10 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-serif text-text-primary mb-2 animate-fade-in-up delay-200">{d["create.revision.sent"]}</h1>
              <p className="text-text-secondary mb-2 animate-fade-in-up delay-300">{d["create.revision.sentMessage"]}</p>
              <p className="text-sm text-text-muted mb-8 animate-fade-in-up delay-300">{d["create.revision.sent.next"]}</p>
              <button
                onClick={() => router.push("/")}
                className="btn-primary animate-fade-in-up delay-400"
              >
                {d["create.revision.backHome"]}
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Step Indicator */}
        <div className="mb-10 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-muted">
              {d[`create.step${step}.eyebrow` as keyof typeof d]}
            </span>
            <span className="text-xs text-text-muted">
              {stepLabels[step]}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-muted">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-500"
              style={{ width: `${((step + 1) / 4) * 100}%` }}
            />
          </div>
        </div>

        {/* Step 0: Size + Photo */}
        {step === 0 && (
          <div className="animate-fade-in">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-serif text-text-primary animate-fade-in-up">{d["create.title"]}</h1>
              <p className="mt-2 text-text-secondary animate-fade-in-up delay-100">{d["create.subtitle"]}</p>
            </div>

            <div className="space-y-8">
              {/* Size Selection */}
              <div className="animate-fade-in-up delay-200">
                <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.sizeSelection"]}</h2>
                <div className="flex gap-2">
                  {SIZES.map((size) => (
                    <button
                      key={size.key}
                      type="button"
                      onClick={() => setSelectedSize(size.key)}
                      className={`flex-1 py-3 px-4 text-center rounded-xl transition-all ${
                        selectedSize === size.key
                          ? "bg-green-500 text-white"
                          : "bg-bg-surface border border-bg-subtle hover:border-green-500/30"
                      }`}
                    >
                      <p className={`text-sm font-semibold ${selectedSize === size.key ? "text-white" : "text-text-primary"}`}>{size.label} {size.height}</p>
                      <p className={`text-base font-mono font-bold mt-0.5 ${selectedSize === size.key ? "text-white" : "text-green-500"}`}>₺{size.price}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Style Selection */}
              <div className="animate-fade-in-up delay-250">
                <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.styleSelection"]}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {STYLES.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSelectedStyle(s.key)}
                      className={`text-center rounded-xl transition-all overflow-hidden ${
                        selectedStyle === s.key
                          ? "ring-2 ring-green-500 bg-green-500/10"
                          : "bg-bg-surface border border-bg-subtle hover:border-green-500/30"
                      }`}
                    >
                      <div className="aspect-square overflow-hidden">
                        <img src={getStyleImg(s.key)} alt={s.label} className="w-full h-full object-cover" />
                      </div>
                      <div className="py-2 px-2">
                        <p className={`text-sm font-semibold ${selectedStyle === s.key ? "text-green-500" : "text-text-primary"}`}>{s.label}</p>
                        <p className={`text-xs mt-0.5 ${selectedStyle === s.key ? "text-green-500/80" : "text-text-muted"}`}>{s.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Style Modifiers */}
              <div className="animate-fade-in-up delay-250">
                <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.modifiers"]}</h2>
                <div className="flex flex-wrap gap-2">
                  {MODIFIERS.map((m) => {
                    const active = selectedModifiers.includes(m.key);
                    return (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => toggleModifier(m.key)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                          active
                            ? "bg-green-500 text-white"
                            : "bg-bg-surface border border-bg-subtle hover:border-green-500/30 text-text-primary"
                        }`}
                      >
                        <img src={m.img} alt={m.label} className="w-6 h-6 rounded object-cover" />
                        <span>{m.label}</span>
                        {active && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
                {selectedModifiers.length > 0 && (
                  <p className="text-xs text-text-muted mt-2">
                    {MODIFIERS.filter((m) => selectedModifiers.includes(m.key)).map((m) => m.desc).join(" · ")}
                  </p>
                )}
              </div>

              {/* Photo Upload / Editor Card */}
              {isEditing && selectedFile ? (
                <div className="animate-fade-in-up delay-300">
                  <PhotoEditor
                    file={selectedFile}
                    exportRef={editorExportRef}
                    onCancel={() => {
                      setIsEditing(false);
                      setSelectedFile(null);
                    }}
                  />
                </div>
              ) : photoKey && !selectedFile ? (
                <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-300">
                  <div className="p-6">
                    <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.upload.title"]}</h2>
                    <div className="relative aspect-square max-w-xs mx-auto rounded-lg overflow-hidden bg-bg-muted">
                      <img
                        src={`/api/files/${photoKey}`}
                        alt="Uploaded photo"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        onClick={() => { setPhotoKey(null); }}
                        className="btn-secondary"
                      >
                        {d["create.changePhoto"]}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-300">
                  <div className="p-6">
                    <h2 className="text-lg font-serif text-text-primary mb-1">{d["create.upload.title"]}</h2>
                    <p className="text-sm text-text-muted mb-4">{d["create.upload.subtitle"]}</p>
                    <UploadDropzone
                      onUploadComplete={(key, _previewUrl) => {
                        setPhotoKey(key);
                        setError(null);
                      }}
                      onError={setError}
                      onFileSelected={(file) => {
                        setSelectedFile(file);
                        setIsEditing(true);
                        setPhotoKey(null);
                        setError(null);
                      }}
                    />
                  </div>
                </div>
              )}

              {error && (
                <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-error-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-error-700">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={submitting || (!photoKey && !selectedFile) || loggedIn === null}
                className="btn-primary w-full text-lg !py-3.5 animate-fade-in-up delay-400"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
                {submitting ? d["common.loading"] : d["create.generatePreview"]}
              </button>

              {loggedIn === false && photoKey && (
                <div className="flex items-center gap-2 justify-center text-sm text-amber-400 animate-fade-in-up delay-400">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {d["create.loginRequired"]}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 1: Generating (Loading) */}
        {step === 1 && (
          <div className="animate-fade-in flex flex-col items-center justify-center py-8">
            <div className="card shadow-elevated overflow-hidden max-w-md mx-auto w-full">
              {previewError ? (
                /* Failed state */
                <div className="p-8 text-center">
                  <div className="w-20 h-20 bg-error-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-serif text-text-primary mb-2">{d["create.preview.failed"]}</h2>
                  <p className="text-text-secondary mb-6">{d["create.preview.failedMessage"]}</p>
                  <button onClick={handleRetryPreview} className="btn-primary">
                    {d["create.preview.retry"]}
                  </button>
                </div>
              ) : (
                /* Loading state */
                <>
                  <div className="h-1.5 bg-bg-muted overflow-hidden">
                    <div className="loading-progress-bar" />
                  </div>
                  <div className="p-8 text-center">
                    {/* Floating icon */}
                    <div className="relative w-28 h-28 mx-auto mb-8">
                      <div className="absolute inset-0 rounded-full bg-green-500/20 animate-pulse-ring" />
                      <div className="absolute inset-0 rounded-full bg-green-500/10 animate-pulse-ring" style={{ animationDelay: "0.5s" }} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-bg-elevated rounded-2xl shadow-elevated p-4 animate-float">
                          <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    <h2 className="text-2xl font-serif text-text-primary mb-2">{d["create.preview.generating"]}</h2>
                    <p className="text-text-muted mb-6">{d["create.preview.estimatedTime"]}</p>

                    <div className="w-64 mx-auto mb-6">
                      <div className="h-1.5 bg-bg-muted rounded-full overflow-hidden">
                        <div className="loading-progress-bar" />
                      </div>
                    </div>

                    <p className="text-sm text-text-muted">{loadingStages[loadingStage]}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Step 2: 3D Preview */}
        {step === 2 && previewGlbUrl && (
          <div className="animate-fade-in">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-serif text-text-primary animate-fade-in-up">{d["create.preview.wow"]}</h2>
              <p className="text-text-secondary mt-1 animate-fade-in-up delay-100">{d["create.preview.wow.sub"]}</p>
            </div>

            {/* Context pills */}
            <div className="flex flex-wrap justify-center gap-3 mb-6 animate-fade-in-up delay-200">
              <span className="trust-pill">
                {d["create.preview.sizeLabel"]}: {selectedSizeObj?.label} ({selectedSizeObj?.height})
              </span>
              <span className="trust-pill">
                {d["create.preview.priceLabel"]}: <span className="font-mono">₺{selectedSizeObj?.price}</span>
              </span>
            </div>

            <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-200">
              <ModelViewer url={previewGlbUrl} previewMode />
            </div>

            <div className="mt-8 flex flex-col sm:flex-row gap-4 animate-fade-in-up delay-300">
              <button
                onClick={handleApprove}
                className="btn-primary flex-1 text-lg !py-3.5"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {d["create.preview.approve"]}
              </button>
              <button
                onClick={() => setRevisionModalOpen(true)}
                className="btn-amber flex-1 text-lg !py-3.5"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {d["create.preview.requestRevision"]}
              </button>
            </div>

            {loggedIn === false && (
              <div className="mt-4 flex items-center gap-2 justify-center text-sm text-amber-400 animate-fade-in-up delay-400">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {d["create.loginRequired"]}
              </div>
            )}

            {/* Revision Modal */}
            {revisionModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop bg-black/50 backdrop-blur-sm">
                <div className="card p-6 w-full max-w-lg animate-scale-in">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-serif text-text-primary">{d["create.revision.title"]}</h3>
                    <button
                      onClick={() => setRevisionModalOpen(false)}
                      className="text-text-muted hover:text-text-primary"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-sm text-text-secondary mb-4">{d["create.revision.description"]}</p>
                  <textarea
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    placeholder={d["create.revision.placeholder"]}
                    maxLength={1000}
                    rows={4}
                    className="input-base resize-none"
                  />
                  <div className="flex justify-between items-center mt-2 mb-4">
                    <span />
                    <span className="text-xs text-text-muted">{revisionNote.length}/1000</span>
                  </div>
                  <button
                    onClick={handleRevisionSubmit}
                    disabled={revisionSending || !revisionNote.trim()}
                    className="btn-primary w-full"
                  >
                    {revisionSending ? d["create.revision.sending"] : d["create.revision.send"]}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Shipping + Order */}
        {step === 3 && (
          <div className="animate-fade-in">
            {/* Back button */}
            <button
              type="button"
              onClick={() => setStep(2)}
              className="group inline-flex items-center gap-1.5 text-sm font-medium text-text-muted hover:text-green-500 mb-6 transition-colors"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {d["create.step3.back"]}
            </button>

            <div className="text-center mb-8">
              <h1 className="text-3xl font-serif text-text-primary animate-fade-in-up">{d["create.shippingAddress"]}</h1>
              <p className="mt-2 text-text-secondary animate-fade-in-up delay-100">{d["create.shippingNote"]}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Form Card */}
              <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-200">
                <div className="p-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.city"]}</label>
                      <select
                        required
                        value={form.il}
                        onChange={(e) => updateField("il", e.target.value)}
                        className="input-base"
                      >
                        <option value="">{d["create.city.placeholder"]}</option>
                        {PROVINCES.map((il) => (
                          <option key={il} value={il}>{il}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.district"]}</label>
                      {form.il ? (
                        <select
                          required
                          value={form.ilce}
                          onChange={(e) => updateField("ilce", e.target.value)}
                          className="input-base"
                        >
                          <option value="">{d["create.district.placeholder"]}</option>
                          {districtOptions.map((district) => (
                            <option key={district} value={district}>{district}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="input-base opacity-60 cursor-not-allowed text-text-muted">
                          {d["create.district.selectCity"]}
                        </div>
                      )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.neighborhood"]}</label>
                      <SearchableSelect
                        options={neighborhoodOptions}
                        value={form.mahalle}
                        onChange={(val) => setForm((prev) => ({ ...prev, mahalle: val }))}
                        placeholder={d["create.neighborhood.placeholder"]}
                        disabled={!form.ilce}
                        disabledPlaceholder={d["create.neighborhood.selectDistrict"]}
                        loading={neighborhoodLoading}
                        loadingText={d["create.neighborhood.loading"]}
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.address"]}</label>
                      <input
                        type="text"
                        required
                        value={form.adres}
                        onChange={(e) => updateField("adres", e.target.value)}
                        className="input-base"
                        placeholder={d["create.address.placeholder"]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.postalCode"]}</label>
                      <input
                        type="text"
                        required
                        maxLength={5}
                        value={form.postaKodu}
                        onChange={(e) => updateField("postaKodu", e.target.value)}
                        className="input-base"
                        placeholder={d["create.postalCode.placeholder"]}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["common.phone"]}</label>
                      <input
                        type="tel"
                        required
                        value={form.telefon}
                        onChange={(e) => updateField("telefon", e.target.value)}
                        className="input-base"
                        placeholder={d["create.phone.placeholder"]}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Gift Card */}
              <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-250">
                <div className="p-6">
                  <h3 className="text-sm font-medium text-text-secondary mb-3">{d["giftCard.hasCard"]}</h3>
                  {gcApplied ? (
                    <div className="flex items-center justify-between bg-green-500/10 rounded-lg p-3">
                      <div>
                        <p className="text-sm font-medium text-green-400">{d["giftCard.applied"]}</p>
                        <p className="text-xs text-green-400 font-mono">{gcApplied.code}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setGcApplied(null); setGcCode(""); }}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        {d["giftCard.remove"]}
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={gcCode}
                        onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                        placeholder={d["giftCard.enterCode"]}
                        className="input-base flex-1 font-mono"
                      />
                      <button type="button" onClick={handleApplyGiftCard} disabled={gcApplying || !gcCode.trim()} className="btn-secondary whitespace-nowrap">
                        {gcApplying ? d["giftCard.applying"] : d["giftCard.apply"]}
                      </button>
                    </div>
                  )}
                  {gcError && <p className="text-sm text-error mt-2">{gcError}</p>}
                </div>
              </div>

              {/* Order Summary Card */}
              <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-300">
                <div className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-text-secondary">{selectedSizeObj?.label} ({selectedSizeObj?.height})</span>
                    <span className="font-mono font-bold text-text-primary">₺{selectedSizeObj?.price}</span>
                  </div>
                  {gcApplied && (() => {
                    const total = PRICES_KURUS[selectedSize] || 0;
                    const gcDiscount = Math.min(gcApplied.balanceKurus, total);
                    const remaining = total - gcDiscount;
                    return (
                      <>
                        <div className="flex items-center justify-between mb-2 text-green-400">
                          <span className="text-sm">{d["giftCard.discount"]}</span>
                          <span className="font-mono font-bold">-₺{(gcDiscount / 100).toLocaleString("tr-TR")}</span>
                        </div>
                        <div className="border-t border-bg-subtle pt-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-text-primary">{d["giftCard.remaining"]}</span>
                          <span className="text-xl font-mono font-bold text-green-500">
                            {remaining <= 0 ? d["giftCard.fullyCovered"] : `₺${(remaining / 100).toLocaleString("tr-TR")}`}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                  {!gcApplied && (
                    <div className="flex items-center justify-between">
                      <span />
                      <span className="text-2xl font-mono font-bold text-green-500">₺{selectedSizeObj?.price}</span>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-error-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-error-700">{error}</p>
                </div>
              )}

              {(() => {
                const total = PRICES_KURUS[selectedSize] || 0;
                const isFullyCovered = gcApplied && gcApplied.balanceKurus >= total;
                return (
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full text-lg !py-3.5"
                  >
                    {!isFullyCovered && (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                    )}
                    {submitting ? d["create.submitting"] : isFullyCovered ? d["giftCard.fullyCovered"] : d["create.submitButton"]}
                  </button>
                );
              })()}
            </form>
          </div>
        )}
      </div>
      <Turnstile ref={turnstileRef} />
    </main>
  );
}
