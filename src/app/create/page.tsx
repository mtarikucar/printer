"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ModelViewer } from "@/components/model-viewer";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";

const PhotoEditor = dynamic(
  () => import("@/components/photo-editor/photo-editor").then((m) => ({ default: m.PhotoEditor })),
  { ssr: false }
);

const ILLER = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Amasya", "Ankara", "Antalya", "Artvin",
  "Aydın", "Balıkesir", "Bilecik", "Bingöl", "Bitlis", "Bolu", "Burdur", "Bursa",
  "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Edirne", "Elazığ", "Erzincan",
  "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Isparta",
  "Mersin", "İstanbul", "İzmir", "Kars", "Kastamonu", "Kayseri", "Kırklareli", "Kırşehir",
  "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Kahramanmaraş", "Mardin", "Muğla",
  "Muş", "Nevşehir", "Niğde", "Ordu", "Rize", "Sakarya", "Samsun", "Siirt", "Sinop",
  "Sivas", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Şanlıurfa", "Uşak", "Van",
  "Yozgat", "Zonguldak", "Aksaray", "Bayburt", "Karaman", "Kırıkkale", "Batman", "Şırnak",
  "Bartın", "Ardahan", "Iğdır", "Yalova", "Karabük", "Kilis", "Osmaniye", "Düzce",
];

interface FormData {
  adres: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

// Steps: 0=Size+Photo, 1=Generating, 2=Preview, 3=Shipping+Payment
type Step = 0 | 1 | 2 | 3;

export default function CreatePage() {
  const router = useRouter();
  const d = useDictionary();
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>("orta");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<FormData>({
    adres: "",
    ilce: "",
    il: "",
    postaKodu: "",
    telefon: "",
  });

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

  // Loading stage rotation
  const [loadingStage, setLoadingStage] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorExportRef = useRef<(() => Promise<Blob | null>) | null>(null);

  const SIZES = [
    { key: "kucuk", label: d["sizes.kucuk"], price: "1.199", height: "~60mm" },
    { key: "orta", label: d["sizes.orta"], price: "1.799", height: "~80mm" },
    { key: "buyuk", label: d["sizes.buyuk"], price: "1.999", height: "~120mm" },
  ] as const;

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
      if (state.previewId) setPreviewId(state.previewId);
      if (state.previewGlbUrl) setPreviewGlbUrl(state.previewGlbUrl);
      if (state.step !== undefined) setStep(state.step as Step);
      sessionStorage.removeItem("createFlowState");
    } catch {
      // Ignore parse errors
    }
  }, []);

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
    pollRef.current = setInterval(async () => {
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
          setPreviewError(data.errorMessage);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
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
          setSubmitting(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", blob, "edited-photo.png");

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
        JSON.stringify({ photoKey: currentPhotoKey, selectedSize, step: 0 })
      );
      router.push("/login?redirect=/create");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/preview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKey: currentPhotoKey,
          figurineSize: selectedSize,
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
  };

  const handleApprove = () => {
    if (!loggedIn) {
      // Save state before redirecting to login
      sessionStorage.setItem(
        "createFlowState",
        JSON.stringify({
          photoKey,
          selectedSize,
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
          shippingAddress: form,
          previewId: previewId || undefined,
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
      setIframeUrl(data.iframeUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSizeObj = SIZES.find((s) => s.key === selectedSize);

  // PayTR iFrame
  if (iframeUrl) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="text-center mb-6 animate-fade-in-up">
            <h1 className="text-2xl font-serif text-text-primary">{d["create.payment"]}</h1>
          </div>
          <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-100">
            <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
            <iframe
              src={iframeUrl}
              className="w-full border-0"
              style={{ height: "600px" }}
              title={d["create.paymentTitle"]}
            />
          </div>
          <p className="text-center text-xs text-text-muted mt-4 animate-fade-in delay-300">
            <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            {d["create.payment.secure"]}
          </p>
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
            <div className="h-1 bg-gradient-to-r from-success to-green-500" />
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
        <div className="flex items-center justify-center gap-0 mb-10 animate-fade-in">
          {stepLabels.map((label, i) => (
            <div key={label} className="flex items-center">
              <div className="flex flex-col items-center w-14 sm:w-20">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold font-mono transition-all ${
                    i === step
                      ? "bg-green-500 text-white shadow-sm ring-4 ring-green-500/20"
                      : i < step
                        ? "bg-green-600 text-white shadow-sm"
                        : "bg-bg-muted text-text-muted"
                  }`}
                >
                  {i < step ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                <span className={`mt-2 text-xs font-medium truncate w-full text-center ${i <= step ? "text-green-500" : "text-text-muted"}`}>
                  {label}
                </span>
              </div>
              {i < stepLabels.length - 1 && (
                <div className={`w-6 sm:w-12 lg:w-16 h-0.5 mx-1 mb-5 step-connector ${
                  i < step
                    ? "bg-gradient-to-r from-green-500 to-beige-400"
                    : "bg-bg-muted"
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 0: Size + Photo */}
        {step === 0 && (
          <div className="animate-fade-in">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-serif text-text-primary animate-fade-in-up">{d["create.title"]}</h1>
              <p className="mt-2 text-text-secondary animate-fade-in-up delay-100">{d["create.subtitle"]}</p>
            </div>

            <div className="space-y-8">
              {/* Size Selection Card */}
              <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-200">
                <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
                <div className="p-6">
                  <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.sizeSelection"]}</h2>
                  <div className="grid sm:grid-cols-3 gap-4">
                    {SIZES.map((size) => (
                      <button
                        key={size.key}
                        type="button"
                        onClick={() => setSelectedSize(size.key)}
                        className={`relative card p-5 text-left transition-all ${
                          selectedSize === size.key
                            ? "border-2 border-green-500 bg-green-500/5"
                            : "border-2 border-transparent hover:border-bg-subtle"
                        }`}
                      >
                        {selectedSize === size.key && (
                          <div className="absolute top-3 right-3 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        <p className="text-lg font-bold text-text-primary">{size.label}</p>
                        <p className="text-sm text-text-muted">{size.height}</p>
                        <p className="mt-2 text-xl font-mono font-bold text-green-500">₺{size.price}</p>
                      </button>
                    ))}
                  </div>
                </div>
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
                  <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
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
                  <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
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
                <div className="flex items-center gap-2 justify-center text-sm text-amber-500 animate-fade-in-up delay-400">
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
              <div className="mt-4 flex items-center gap-2 justify-center text-sm text-amber-500 animate-fade-in-up delay-400">
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

        {/* Step 3: Shipping + Payment */}
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
                <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
                <div className="p-6">
                  <div className="grid gap-4 sm:grid-cols-2">
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
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.district"]}</label>
                      <input
                        type="text"
                        required
                        value={form.ilce}
                        onChange={(e) => updateField("ilce", e.target.value)}
                        className="input-base"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1.5">{d["create.city"]}</label>
                      <select
                        required
                        value={form.il}
                        onChange={(e) => updateField("il", e.target.value)}
                        className="input-base"
                      >
                        <option value="">{d["create.city.placeholder"]}</option>
                        {ILLER.map((il) => (
                          <option key={il} value={il}>{il}</option>
                        ))}
                      </select>
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

              {/* Order Summary Card */}
              <div className="card shadow-elevated overflow-hidden animate-fade-in-up delay-300">
                <div className="p-6 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-text-secondary">{selectedSizeObj?.label} ({selectedSizeObj?.height})</span>
                  </div>
                  <span className="text-2xl font-mono font-bold text-green-500">₺{selectedSizeObj?.price}</span>
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

              <button
                type="submit"
                disabled={submitting}
                className="btn-primary w-full text-lg !py-3.5"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {submitting ? d["create.submitting"] : d["create.submitButton"]}
              </button>

              <p className="text-center text-xs text-text-muted">
                <svg className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                {d["create.payment.secure"]}
              </p>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
