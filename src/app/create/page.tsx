"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ModelViewer } from "@/components/model-viewer";
import { SiteHeader } from "@/components/site-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { track } from "@/lib/analytics/client";
import { useDictionary } from "@/lib/i18n/locale-context";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { Button, Card, Input, Select, Textarea, FormField } from "@/components/ui";
import {
  figurinePriceKurus,
  finishSurchargeKurus,
  objectPriceKurus,
  objectFinishSurchargeKurus,
  UPSELL_PRICES_KURUS,
} from "@/lib/config/prices";
import { calculateHavaleDiscount } from "@/lib/config/payment";
import { PhoneInput, phoneInputToE164, e164ToPhoneInput } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { CreatePathSelector } from "@/components/create/path-selector";
import { UploadModelFlow } from "@/components/create/upload-model-flow";
import { DesignToProductFlow } from "@/components/create/design-to-product-flow";
import { DESIGN_TEMPLATES, priceKindForStyle, getTemplate } from "@/lib/create/design-templates";
import { ExtraPhotos, type ExtraPhoto } from "@/components/create/extra-photos";

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
}

// Steps: 0=Size+Photo, 1=Generating, 2=Preview, 3=Shipping+Payment
type Step = 0 | 1 | 2 | 3;

function CustomCreateFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const d = useDictionary();
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  // Signed URL companion to photoKey. Uploaded path returns one ready-signed;
  // restored sessionStorage paths fetch one lazily. Keeping the signed URL in
  // state (instead of building it inline as `/api/files/${photoKey}`) means
  // the preview image survives a future flip of FILES_REQUIRE_SIGNATURE=1.
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  // Extra reference photos for multi-image-to-3d (object/realistic only). The
  // primary photo lives in photoKey; these are additional angles (max 3 → 4
  // total). `multiAck` is the realistic-only compatibility acknowledgment.
  const [extraPhotos, setExtraPhotos] = useState<ExtraPhoto[]>([]);
  const [multiAck, setMultiAck] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>("orta");
  const [selectedMaterial, setSelectedMaterial] = useState<string>("resin");
  const [selectedFinish, setSelectedFinish] = useState<string>("paintable_kit");
  const [selectedStyle, setSelectedStyle] = useState<string>("storybook");
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
  });
  const [districtOptions, setDistrictOptions] = useState<string[]>([]);
  const [neighborhoodOptions, setNeighborhoodOptions] = useState<string[]>([]);
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);
  const [telefonCountry, setTelefonCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [telefonNational, setTelefonNational] = useState("");

  // Saved address book (Q5). Loaded when the customer reaches the shipping
  // step. Selecting one fully prefills the form (incl. dropdown options) and
  // skips the city/district cascade resets.
  type SavedAddress = {
    id: string;
    label: string;
    fullName: string;
    phone: string;
    adres: string;
    mahalle: string | null;
    ilce: string;
    il: string;
    postaKodu: string;
    isDefault: boolean;
  };
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [savedAddressLoadedFor, setSavedAddressLoadedFor] = useState<
    string | null
  >(null);

  // Preview state
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [previewGlbUrl, setPreviewGlbUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Funnel: custom "product" viewed = the AI preview is ready (step 2).
  const viewItemFired = useRef(false);
  useEffect(() => {
    if (step === 2 && !viewItemFired.current) {
      viewItemFired.current = true;
      track("view_item", { itemName: "custom-figurine" });
    }
  }, [step]);

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

  // Payment method state
  const [paymentMethod, setPaymentMethod] = useState<"card" | "bank_transfer">("card");

  // Checkout upsells (Q10). Three optional add-ons with stable keys; prices
  // come from the single source (UPSELL_PRICES_KURUS) so the UI can never
  // drift from what the server charges.
  const UPSELLS = [
    { key: "extra_paint" as const, priceKurus: UPSELL_PRICES_KURUS.extra_paint },
    { key: "gift_wrap" as const, priceKurus: UPSELL_PRICES_KURUS.gift_wrap },
    { key: "rush_shipping" as const, priceKurus: UPSELL_PRICES_KURUS.rush_shipping },
    { key: "digital_files" as const, priceKurus: UPSELL_PRICES_KURUS.digital_files },
  ];
  const [selectedUpsells, setSelectedUpsells] = useState<string[]>([]);
  const toggleUpsell = (key: string) => {
    setSelectedUpsells((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };
  const upsellTotalKurus = selectedUpsells.reduce(
    (acc, key) => acc + (UPSELLS.find((u) => u.key === key)?.priceKurus ?? 0),
    0
  );

  // Q6: guest checkout fields. Only shown + sent when the visitor is NOT
  // logged in. Logged-in customers continue to derive email + name from
  // their JWT/session.
  const [guestEmail, setGuestEmail] = useState("");
  const [guestName, setGuestName] = useState("");
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Loading stage rotation
  const [loadingStage, setLoadingStage] = useState(0);
  // Elapsed seconds since the preview job started. Drives the deterministic
  // progress bar + mm:ss display on the generating step. Reset on step change.
  const [elapsedSec, setElapsedSec] = useState(0);
  const PREVIEW_TARGET_SECONDS = 300; // 5-minute polling budget (matches /api/preview poll loop)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorExportRef = useRef<(() => Promise<Blob | null>) | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);

  const SIZES = [
    { key: "kucuk", label: d["sizes.kucuk"], height: "~60mm" },
    { key: "orta", label: d["sizes.orta"], height: "~80mm" },
    { key: "buyuk", label: d["sizes.buyuk"], height: "~120mm" },
  ] as const;

  // Production materials. Resin = premium; filament (FDM) is cheaper. The price
  // varies by (size, material) — see figurinePriceKurus (single source).
  const MATERIALS = [
    { key: "resin", label: d["material.resin"], desc: d["material.resin.desc"] },
    { key: "filament", label: d["material.filament"], desc: d["material.filament.desc"] },
  ] as const;

  // Object/design (style="object") and character figurines have separate price
  // tables + finish sets (Faz 1). These helpers pick the right one; the server
  // re-derives the trusted amount on submit via itemPriceKurus.
  const isObjectStyle = priceKindForStyle(selectedStyle) === "object";
  // Multi-image fusion is offered only for non-stylized templates (object +
  // realistic). Stylized templates restyle each photo independently via FLUX,
  // so extra angles add nothing — the multi-upload UI is hidden there.
  const isMultiCapable = getTemplate(selectedStyle)?.stylize === false;
  // The realistic template requires the customer to confirm photo compatibility
  // before generating from multiple photos; object does not (geometry-only).
  const needsCompatAck =
    selectedStyle === "realistic" && extraPhotos.length > 0;
  const baseKurus = (sz: string, mat: string) =>
    isObjectStyle ? objectPriceKurus(sz, mat) : figurinePriceKurus(sz, mat);
  const finishKurus = (f: string) =>
    isObjectStyle ? objectFinishSurchargeKurus(f) : finishSurchargeKurus(f);

  // Live price label for a (size, material), Turkish-grouped ("1.399").
  const priceLabel = (sizeKey: string, materialKey: string) =>
    Math.round(baseKurus(sizeKey, materialKey) / 100).toLocaleString("tr-TR");

  // Finish/package tiers (Faz 1.1). surchargeKurus is derived from the single
  // source FINISH_SURCHARGES_KURUS via finishSurchargeKurus; the server
  // re-derives the trusted amount on submit. collector_raw is cheaper (raw
  // print, no paint kit) so its surcharge is negative.
  const FINISHES = (
    isObjectStyle
      ? [
          { key: "raw", label: d["create.finish.raw"], desc: d["create.finish.raw.desc"] },
          { key: "smoothed", label: d["create.finish.smoothed"], desc: d["create.finish.smoothed.desc"] },
          { key: "painted", label: d["create.finish.painted"], desc: d["create.finish.painted.desc"] },
        ]
      : [
          { key: "paintable_kit", label: d["create.finish.paintable_kit"], desc: d["create.finish.paintable_kit.desc"] },
          { key: "hand_painted", label: d["create.finish.hand_painted"], desc: d["create.finish.hand_painted.desc"] },
          { key: "luxe_display", label: d["create.finish.luxe_display"], desc: d["create.finish.luxe_display.desc"] },
          { key: "collector_raw", label: d["create.finish.collector_raw"], desc: d["create.finish.collector_raw.desc"] },
        ]
  ).map((f) => ({ ...f, surchargeKurus: finishKurus(f.key) }));

  // Design templates ("Hazır Tasarım Desenleri") come from the single registry
  // (src/lib/create/design-templates.ts) — add a template there + one preview
  // image and it shows up here automatically, no edits needed in this file.
  const STYLES = DESIGN_TEMPLATES.filter((t) => t.enabled)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((t) => ({
      key: t.slug,
      label: d[t.labelKey as keyof typeof d],
      desc: d[t.descKey as keyof typeof d],
      img: t.preview,
    }));

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

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  // Phone verification (Phase 6 — only active when the flag is on server-side).
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [phoneVerifyRequired, setPhoneVerifyRequired] = useState(false);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStage, setOtpStage] = useState<"phone" | "code">("phone");
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json().catch(() => null);
          setLoggedIn(true);
          if (data?.user?.id) setCurrentUserId(data.user.id);
          setEmailVerified(data?.user?.emailVerified ?? null);
          setPhoneVerified(data?.user?.phoneVerified ?? null);
          setPhoneVerifyRequired(!!data?.user?.phoneVerificationRequired);
        } else {
          setLoggedIn(false);
        }
      })
      .catch(() => setLoggedIn(false));
  }, []);

  const sendOtp = async () => {
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: otpPhone }),
      });
      if (res.ok) {
        setOtpStage("code");
        setOtpMsg(d["create.otp.sent"]);
      } else {
        setOtpMsg(d["create.otp.sendFailed"]);
      }
    } catch {
      setOtpMsg(d["create.otp.sendFailed"]);
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otpCode }),
      });
      if (res.ok) {
        setPhoneVerified(true);
      } else {
        setOtpMsg(d["create.otp.invalid"]);
      }
    } catch {
      setOtpMsg(d["create.otp.invalid"]);
    } finally {
      setOtpBusy(false);
    }
  };

  const needsPhoneVerify =
    loggedIn === true && phoneVerifyRequired && phoneVerified === false;

  const resendVerification = async () => {
    setResendState("sending");
    try {
      await fetch("/api/auth/resend-verification", { method: "POST" });
      setResendState("sent");
    } catch {
      setResendState("idle");
    }
  };

  // `?style=<slug>` (or `?path=object`) prefills the design template.
  // Prefill the style selector when the slug is one we support. We only
  // apply the prefill on initial mount so a customer who lands here and
  // then changes the style isn't fighting the URL param.
  const styleQueryAppliedRef = useRef(false);
  useEffect(() => {
    if (styleQueryAppliedRef.current) return;
    // ?path=object enters this flow with the object style preselected, so the
    // homepage / nav / path-selector can all use the uniform ?path= scheme.
    const styleParam =
      searchParams.get("style") ??
      (searchParams.get("path") === "object" ? "object" : null);
    if (!styleParam) return;
    if (["realistic", "storybook", "anime", "chibi", "object"].includes(styleParam)) {
      setSelectedStyle(styleParam);
      styleQueryAppliedRef.current = true;
    }
  }, [searchParams]);

  // Keep the selected finish valid for the active flow: object/design use
  // raw/smoothed/painted; figurines use the 4 packages (Faz 1).
  useEffect(() => {
    const objectFinishes = ["raw", "smoothed", "painted"];
    const figureFinishes = ["paintable_kit", "hand_painted", "luxe_display", "collector_raw"];
    if (selectedStyle === "object" && !objectFinishes.includes(selectedFinish)) {
      setSelectedFinish("smoothed");
    } else if (selectedStyle !== "object" && !figureFinishes.includes(selectedFinish)) {
      setSelectedFinish("paintable_kit");
    }
  }, [selectedStyle, selectedFinish]);

  // Drop any extra reference photos + the compatibility ack when switching to a
  // stylized template (which doesn't support multi-image fusion). Switching
  // between object↔realistic keeps them (both are multi-capable).
  useEffect(() => {
    if (!isMultiCapable) {
      setExtraPhotos([]);
      setMultiAck(false);
    }
  }, [isMultiCapable]);

  // Restore state from sessionStorage AFTER the auth check resolves. Gate on
  // `loggedIn` (tri-state: null while loading, then true/false). We must not
  // gate on `currentUserId` because anonymous flows never set it — that would
  // permanently skip restore for logged-out users, breaking the legitimate
  // "anonymous save → reload page" path.
  //
  // Cross-user safety: a saved state tagged with userId X is only accepted by
  // the same userId X. Anonymous saves (userId: null) are accepted by any
  // anonymous viewer.
  useEffect(() => {
    if (loggedIn === null) return; // Wait for auth check to complete.
    try {
      const saved = sessionStorage.getItem("createFlowState");
      if (!saved) return;
      const state = JSON.parse(saved);
      const savedFor = state.userId ?? null;
      const currentFor = currentUserId ?? null;
      // Reject if the save was for a different logged-in user, OR if the save
      // was for some user but the current viewer is anonymous.
      if (savedFor !== null && savedFor !== currentFor) {
        sessionStorage.removeItem("createFlowState");
        return;
      }
      if (state.photoKey) setPhotoKey(state.photoKey);
      if (state.photoPreviewUrl) setPhotoPreviewUrl(state.photoPreviewUrl);
      if (Array.isArray(state.extraPhotos)) setExtraPhotos(state.extraPhotos);
      if (state.selectedSize) setSelectedSize(state.selectedSize);
      if (state.selectedMaterial) setSelectedMaterial(state.selectedMaterial);
      if (state.selectedStyle) setSelectedStyle(state.selectedStyle);
      if (state.selectedModifiers) setSelectedModifiers(state.selectedModifiers);
      if (state.previewId) setPreviewId(state.previewId);
      if (state.previewGlbUrl) setPreviewGlbUrl(state.previewGlbUrl);
      if (state.step !== undefined) setStep(state.step as Step);
      sessionStorage.removeItem("createFlowState");
    } catch {
      // Ignore parse errors
    }
  }, [loggedIn, currentUserId]);

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

  // Restore from ?fromOrder= query param — "modify and reorder" flow from the
  // track page. Pulls the prior order's photoKey + size + style + modifiers
  // and prefills the form. Customer lands on step 0 with everything filled
  // in and can change anything before submitting.
  useEffect(() => {
    const qFromOrder = searchParams.get("fromOrder");
    if (!qFromOrder) return;
    fetch(`/api/customer/orders/${qFromOrder}/snapshot`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.photoKey) setPhotoKey(data.photoKey);
        if (data.photoPreviewUrl) setPhotoPreviewUrl(data.photoPreviewUrl);
        if (data.figurineSize) setSelectedSize(data.figurineSize);
        if (data.material) setSelectedMaterial(data.material);
        if (data.style) setSelectedStyle(data.style);
        if (Array.isArray(data.modifiers)) setSelectedModifiers(data.modifiers);
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

  // Elapsed-time ticker for the generating step. Drives the deterministic
  // progress bar so the customer sees actual progression instead of an
  // indeterminate-looking infinite shimmer.
  useEffect(() => {
    if (step !== 1 || previewError) {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSec(0);
    const interval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
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

  // Fetch saved addresses lazily — only once the customer is logged in AND
  // has actually reached the shipping step. Cached per user id so re-mounting
  // step 3 doesn't trigger duplicate fetches.
  useEffect(() => {
    if (step !== 3) return;
    if (!loggedIn || !currentUserId) return;
    if (savedAddressLoadedFor === currentUserId) return;
    fetch("/api/customer/addresses")
      .then((r) => (r.ok ? r.json() : { addresses: [] }))
      .then((data) => {
        setSavedAddresses(data.addresses ?? []);
        setSavedAddressLoadedFor(currentUserId);
      })
      .catch(() => setSavedAddressLoadedFor(currentUserId));
  }, [step, loggedIn, currentUserId, savedAddressLoadedFor]);

  const applySavedAddress = (id: string) => {
    const addr = savedAddresses.find((a) => a.id === id);
    if (!addr) return;
    const phoneSeed = e164ToPhoneInput(addr.phone);
    setTelefonCountry(phoneSeed.country);
    setTelefonNational(phoneSeed.nationalNumber);
    setForm({
      adres: addr.adres,
      mahalle: addr.mahalle ?? "",
      ilce: addr.ilce,
      il: addr.il,
      postaKodu: addr.postaKodu,
    });
    // Repopulate the cascading dropdowns so the selected city/district are
    // valid options against the static + remote lists.
    setDistrictOptions(DISTRICTS[addr.il] ?? []);
    if (addr.mahalle) {
      setNeighborhoodOptions([addr.mahalle]);
    } else {
      setNeighborhoodOptions([]);
    }
    setNeighborhoodLoading(true);
    fetch(
      `/api/address/neighborhoods?il=${encodeURIComponent(
        addr.il
      )}&ilce=${encodeURIComponent(addr.ilce)}`
    )
      .then((r) => r.json())
      .then((data) => setNeighborhoodOptions(data.neighborhoods ?? []))
      .catch(() => {})
      .finally(() => setNeighborhoodLoading(false));
  };

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

        const { key, previewUrl: signedPreviewUrl } = await res.json();
        setPhotoKey(key);
        if (signedPreviewUrl) setPhotoPreviewUrl(signedPreviewUrl);
        // Funnel: strong intent signal — visitor uploaded a photo to generate from.
        track("photo_upload", {});
        setIsEditing(false);
        setSelectedFile(null);
        currentPhotoKey = key;
      } catch (err: unknown) {
        setError((err instanceof Error ? err.message : "unknown") || d["upload.failed"]);
        setSubmitting(false);
        return;
      }
    }

    if (!currentPhotoKey) {
      setError(d["create.photoRequired"]);
      return;
    }

    // Generation now REQUIRES login (each Meshy/Tripo call costs money). If the
    // visitor isn't logged in, stash the in-progress selection so it survives
    // the login round-trip (the restore effect reads `createFlowState`), then
    // send them to /login. Ordering the physical product still allows guests —
    // only the generate step is gated.
    if (loggedIn === false) {
      try {
        sessionStorage.setItem(
          "createFlowState",
          JSON.stringify({
            userId: null,
            photoKey: currentPhotoKey,
            photoPreviewUrl,
            extraPhotos,
            selectedSize,
            selectedMaterial,
            selectedStyle,
            selectedModifiers,
            step: 0,
          })
        );
      } catch {
        // sessionStorage unavailable — proceed to login anyway.
      }
      router.push("/login?redirect=/create");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const generateToken = await turnstileRef.current?.getToken() ?? "";
      // Bundle extra reference photos into a multi-image fusion set (primary
      // first). Only for multi-capable templates; undefined → single-image.
      const extraKeys = isMultiCapable ? extraPhotos.map((p) => p.key) : [];
      const photoKeys =
        extraKeys.length > 0 ? [currentPhotoKey, ...extraKeys] : undefined;
      const res = await fetch("/api/preview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKey: currentPhotoKey,
          photoKeys,
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
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "unknown"));
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
    // Clear previewId from URL to prevent useEffect from restoring stale preview
    router.replace("/create");
  };

  const handleApprove = () => {
    if (loggedIn === null) return; // Auth check still loading
    // Q6: guest checkout — allow logged-out customers to proceed to step 3
    // where they enter email + name alongside the shipping form.
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

    const telefonE164 = phoneInputToE164(telefonCountry, telefonNational);
    if (!telefonE164) {
      setError("Geçerli bir telefon numarası girin");
      return;
    }
    const submitForm = { ...form, telefon: telefonE164 };

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photoKey,
          figurineSize: selectedSize,
          material: selectedMaterial,
          finish: selectedFinish,
          style: selectedStyle,
          modifiers: selectedModifiers,
          shippingAddress: submitForm,
          previewId: previewId || undefined,
          giftCardCode: gcApplied?.code || undefined,
          paymentMethod,
          upsells: selectedUpsells,
          guestEmail: !loggedIn ? guestEmail.trim() : undefined,
          guestName: !loggedIn ? guestName.trim() : undefined,
          marketingConsent: !loggedIn ? marketingConsent : undefined,
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
      const reference = data.reference ?? data.orderNumber;
      setSubmittedOrderNumber(reference);

      if (data.autoConfirmed) {
        // Gift card fully covered — order confirmed instantly
        setOrderSubmitted(true);
        return;
      }

      if (data.paymentMethod === "card" && data.iframeUrl) {
        // Redirect to PayTR secure checkout
        window.location.href = data.iframeUrl;
        return;
      }

      if (data.paymentMethod === "bank_transfer") {
        // Dedicated havale page handles IBAN display + dekont upload
        router.push(data.redirectUrl ?? `/havale/${reference}`);
        return;
      }

      setOrderSubmitted(true);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "unknown"));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSizeObj = SIZES.find((s) => s.key === selectedSize);
  const selectedMaterialObj = MATERIALS.find((m) => m.key === selectedMaterial);
  const selectedFinishObj = FINISHES.find((f) => f.key === selectedFinish);

  // Order submitted — success screen
  if (orderSubmitted) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-lg mx-auto px-4 py-20">
          <Card elevated className="overflow-hidden">
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
                <Button
                  onClick={() => router.push(`/track/${submittedOrderNumber}`)}
                  fullWidth
                >
                  {d["create.orderSubmitted.track"]}
                </Button>
              </div>
            </div>
          </Card>
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
          <Card elevated className="overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-success-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
                <svg className="w-10 h-10 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-serif text-text-primary mb-2 animate-fade-in-up delay-200">{d["create.revision.sent"]}</h1>
              <p className="text-text-secondary mb-2 animate-fade-in-up delay-300">{d["create.revision.sentMessage"]}</p>
              <p className="text-sm text-text-muted mb-8 animate-fade-in-up delay-300">{d["create.revision.sent.next"]}</p>
              <Button
                onClick={() => router.push("/")}
                className="animate-fade-in-up delay-400"
              >
                {d["create.revision.backHome"]}
              </Button>
            </div>
          </Card>
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
              <h1 className="text-3xl font-serif text-text-primary animate-fade-in-up">
                {isObjectStyle ? d["create.title.object"] : d["create.title"]}
              </h1>
              <p className="mt-2 text-text-secondary animate-fade-in-up delay-100">
                {isObjectStyle ? d["create.subtitle.object"] : d["create.subtitle"]}
              </p>
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
                      <p className={`text-base font-mono font-bold mt-0.5 ${selectedSize === size.key ? "text-white" : "text-green-500"}`}>₺{priceLabel(size.key, selectedMaterial)}</p>
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

              {/* Material Selection */}
              <div className="animate-fade-in-up delay-250">
                <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.materialSelection"]}</h2>
                <div className="flex gap-2">
                  {MATERIALS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSelectedMaterial(m.key)}
                      className={`flex-1 py-3 px-4 text-left rounded-xl transition-all ${
                        selectedMaterial === m.key
                          ? "bg-green-500 text-white"
                          : "bg-bg-surface border border-bg-subtle hover:border-green-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${selectedMaterial === m.key ? "text-white" : "text-text-primary"}`}>{m.label}</span>
                        <span className={`text-base font-mono font-bold ${selectedMaterial === m.key ? "text-white" : "text-green-500"}`}>₺{priceLabel(selectedSize, m.key)}</span>
                      </div>
                      <p className={`text-xs mt-0.5 ${selectedMaterial === m.key ? "text-white/80" : "text-text-muted"}`}>{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Finish / Package Selection */}
              <div className="animate-fade-in-up delay-250">
                <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.finishSelection"]}</h2>
                <div className="flex flex-col gap-2">
                  {FINISHES.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setSelectedFinish(f.key)}
                      className={`w-full py-3 px-4 text-left rounded-xl transition-all ${
                        selectedFinish === f.key
                          ? "bg-green-500 text-white"
                          : "bg-bg-surface border border-bg-subtle hover:border-green-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-sm font-semibold ${selectedFinish === f.key ? "text-white" : "text-text-primary"}`}>{f.label}</span>
                        <span className={`text-sm font-mono font-bold ${selectedFinish === f.key ? "text-white" : "text-green-500"}`}>
                          {f.surchargeKurus > 0
                            ? `+₺${(f.surchargeKurus / 100).toLocaleString("tr-TR")}`
                            : f.surchargeKurus < 0
                              ? `-₺${(Math.abs(f.surchargeKurus) / 100).toLocaleString("tr-TR")}`
                              : d["create.finish.included"]}
                        </span>
                      </div>
                      <p className={`text-xs mt-0.5 ${selectedFinish === f.key ? "text-white/80" : "text-text-muted"}`}>{f.desc}</p>
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
                <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-300">
                  <h2 className="text-lg font-serif text-text-primary mb-4">{d["create.upload.title"]}</h2>
                  <div className="relative aspect-square max-w-xs mx-auto rounded-lg overflow-hidden bg-bg-muted">
                    <img
                      src={photoPreviewUrl ?? undefined}
                      alt="Uploaded photo"
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="mt-4 flex justify-center">
                    <Button
                      type="button"
                      onClick={() => { setPhotoKey(null); }}
                      variant="secondary"
                    >
                      {d["create.changePhoto"]}
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-300">
                  <h2 className="text-lg font-serif text-text-primary mb-1">{d["create.upload.title"]}</h2>
                  <p className="text-sm text-text-muted mb-4">{d["create.upload.subtitle"]}</p>
                  <UploadDropzone
                    objectMode={selectedStyle === "object"}
                    onUploadComplete={(key, previewUrl) => {
                      setPhotoKey(key);
                      // `previewUrl` is the server-signed URL from /api/upload
                      // (not a blob:). Persisting it lets the photo card
                      // survive a login-redirect roundtrip AND a future
                      // FILES_REQUIRE_SIGNATURE=1 flip in prod.
                      setPhotoPreviewUrl(previewUrl ?? null);
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
                </Card>
              )}

              {/* Extra reference photos (multi-image-to-3d) — object/realistic
                  only, shown once a primary photo is engaged. Optional. */}
              {isMultiCapable && (photoKey || selectedFile) && (
                <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-300">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <h2 className="text-lg font-serif text-text-primary">{d["create.multiPhoto.title"]}</h2>
                    <span className="text-xs uppercase tracking-wide text-text-muted">{d["create.multiPhoto.optional"]}</span>
                  </div>
                  <p className="text-sm text-text-muted mb-4">{d["create.multiPhoto.subtitle"]}</p>
                  <ExtraPhotos
                    photos={extraPhotos}
                    onChange={setExtraPhotos}
                    max={3}
                    onError={setError}
                  />
                  {needsCompatAck && (
                    <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-50/60 px-4 py-3">
                      <div className="flex items-start gap-2">
                        <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.73 4a2 2 0 00-3.46 0L3.33 16a2 2 0 001.74 3z" />
                        </svg>
                        <div className="text-sm text-amber-800">
                          <p className="font-semibold">{d["create.multiPhoto.compat.title"]}</p>
                          <p className="mt-0.5">{d["create.multiPhoto.compat.body"]}</p>
                        </div>
                      </div>
                      <label className="mt-3 flex items-start gap-2 text-sm text-amber-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={multiAck}
                          onChange={(e) => setMultiAck(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 text-green-600 focus:ring-green-500"
                        />
                        <span>{d["create.multiPhoto.compat.ack"]}</span>
                      </label>
                    </div>
                  )}
                </Card>
              )}

              {error && (
                <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-error-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-error-700">{error}</p>
                </div>
              )}

              {loggedIn === true && emailVerified === false && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-50/60 px-4 py-3 animate-fade-in-up">
                  <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div className="text-sm text-amber-800">
                    <p>{d["create.verifyEmailNotice"]}</p>
                    <button
                      type="button"
                      onClick={resendVerification}
                      disabled={resendState !== "idle"}
                      className="mt-1 font-medium underline underline-offset-2 disabled:opacity-60"
                    >
                      {resendState === "sent"
                        ? d["create.verifyEmailResent"]
                        : resendState === "sending"
                          ? d["common.loading"]
                          : d["create.verifyEmailResend"]}
                    </button>
                  </div>
                </div>
              )}

              {needsPhoneVerify && (
                <div className="mb-3 rounded-xl border border-indigo-300/40 bg-indigo-50/60 px-4 py-3 animate-fade-in-up">
                  <p className="mb-2 text-sm text-indigo-900">{d["create.otp.notice"]}</p>
                  {otpStage === "phone" ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="tel"
                        inputMode="tel"
                        value={otpPhone}
                        onChange={(e) => setOtpPhone(e.target.value)}
                        placeholder="05XX XXX XX XX"
                        className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={sendOtp}
                        disabled={otpBusy || otpPhone.trim().length < 5}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                      >
                        {d["create.otp.send"]}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        placeholder="••••••"
                        className="min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm tracking-widest"
                      />
                      <button
                        type="button"
                        onClick={verifyOtp}
                        disabled={otpBusy || otpCode.trim().length < 4}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                      >
                        {d["create.otp.verify"]}
                      </button>
                    </div>
                  )}
                  {otpMsg && <p className="mt-2 text-xs text-indigo-700">{otpMsg}</p>}
                </div>
              )}

              <Button
                type="button"
                onClick={handleGeneratePreview}
                disabled={
                  (!photoKey && !selectedFile) ||
                  loggedIn === null ||
                  (loggedIn === true && emailVerified === false) ||
                  needsPhoneVerify ||
                  (needsCompatAck && !multiAck)
                }
                loading={submitting}
                size="lg"
                fullWidth
                className="animate-fade-in-up delay-400"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                </svg>
                {submitting ? d["common.loading"] : d["create.generatePreview"]}
              </Button>

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
            <Card elevated className="overflow-hidden max-w-md mx-auto w-full">
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
                  <Button onClick={handleRetryPreview}>
                    {d["create.preview.retry"]}
                  </Button>
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

                    {/* Deterministic progress + mm:ss elapsed.
                        Caps at 95% — the remaining 5% is "model handoff"
                        and the actual completion flips us to step 2 anyway,
                        so showing 100% before that is misleading. */}
                    <div className="w-64 mx-auto mb-3">
                      <div className="h-1.5 bg-bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-800 transition-all duration-1000 ease-linear"
                          style={{
                            width: `${Math.min(95, (elapsedSec / PREVIEW_TARGET_SECONDS) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <p className="text-xs font-mono text-text-muted mb-2">
                      {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, "0")}
                      <span className="opacity-50"> / ~5:00</span>
                    </p>

                    <p className="text-sm text-text-muted">
                      {elapsedSec >= 270
                        ? d["create.preview.almostReady"]
                        : loadingStages[loadingStage]}
                    </p>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {/* Step 2: 3D Preview */}
        {step === 2 && previewGlbUrl && (
          <div className="animate-fade-in pb-6">
            <div className="text-center mb-4 sm:mb-6">
              <h2 className="text-xl sm:text-2xl font-serif text-text-primary animate-fade-in-up">{d["create.preview.wow"]}</h2>
              <p className="text-text-secondary mt-1 text-sm sm:text-base animate-fade-in-up delay-100">{d["create.preview.wow.sub"]}</p>
            </div>

            {/* Context pills */}
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 mb-4 sm:mb-6 animate-fade-in-up delay-200">
              <span className="trust-pill">
                {d["create.preview.sizeLabel"]}: {selectedSizeObj?.label} ({selectedSizeObj?.height})
              </span>
              <span className="trust-pill">{selectedMaterialObj?.label}</span>
              <span className="trust-pill">
                {d["create.preview.priceLabel"]}: <span className="font-mono">₺{priceLabel(selectedSize, selectedMaterial)}</span>
              </span>
            </div>

            <Card elevated className="overflow-hidden animate-fade-in-up delay-200">
              <ModelViewer url={previewGlbUrl} previewMode />
            </Card>

            <div className="mt-4 sm:mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4 animate-fade-in-up delay-300">
              <Button
                onClick={handleApprove}
                size="lg"
                className="flex-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {d["create.preview.approve"]}
              </Button>
              <Button
                onClick={() => setRevisionModalOpen(true)}
                variant="amber"
                size="lg"
                className="flex-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {d["create.preview.requestRevision"]}
              </Button>
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
                <Card padding="md" className="w-full max-w-lg animate-scale-in">
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
                  <Textarea
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                    placeholder={d["create.revision.placeholder"]}
                    maxLength={1000}
                    rows={4}
                    className="resize-none"
                  />
                  <div className="flex justify-between items-center mt-2 mb-4">
                    <span />
                    <span className="text-xs text-text-muted">{revisionNote.length}/1000</span>
                  </div>
                  <Button
                    onClick={handleRevisionSubmit}
                    disabled={!revisionNote.trim()}
                    loading={revisionSending}
                    fullWidth
                  >
                    {revisionSending ? d["create.revision.sending"] : d["create.revision.send"]}
                  </Button>
                </Card>
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
              {/* Guest checkout (Q6) — captures the buyer's email + name
                  without forcing a login. Post-purchase email lets them
                  claim the account via a 30-day token. Logged-in customers
                  don't see this card. */}
              {!loggedIn && (
                <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-100">
                  <h3 className="text-sm font-medium text-text-secondary mb-1">
                    {d["create.guest.title"]}
                  </h3>
                  <p className="text-xs text-text-muted mb-4">
                    {d["create.guest.subtitle"]}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label={d["create.guest.fullName"]} required>
                      <Input
                        type="text"
                        required
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        autoComplete="name"
                        minLength={2}
                        maxLength={120}
                      />
                    </FormField>
                    <FormField label={d["create.guest.email"]} required>
                      <Input
                        type="email"
                        required
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </FormField>
                  </div>
                  <label className="flex items-start gap-2.5 text-xs text-text-muted mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={marketingConsent}
                      onChange={(e) => setMarketingConsent(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-bg-subtle text-green-500 focus:ring-green-500"
                    />
                    <span>
                      {d["register.marketingConsent"]}{" "}
                      <Link href="/ticari-ileti" className="text-green-500 hover:text-green-400">
                        {d["register.marketingConsentLink"]}
                      </Link>
                    </span>
                  </label>
                  <p className="text-xs text-text-muted mt-3">
                    <Link href="/login?redirect=/create" className="underline">
                      {d["create.guest.alreadyHaveAccount"]}
                    </Link>
                  </p>
                </Card>
              )}

              {/* Saved address dropdown (Q5) — only shown when the logged-in
                  customer already has saved addresses; new customers see the
                  empty form unchanged. */}
              {savedAddresses.length > 0 && (
                <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-150">
                  <FormField label={d["create.savedAddresses.label"]}>
                    <Select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) applySavedAddress(e.target.value);
                      }}
                    >
                      <option value="">
                        {d["create.savedAddresses.placeholder"]}
                      </option>
                      {savedAddresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} — {a.ilce}, {a.il}
                          {a.isDefault
                            ? ` (${d["account.addresses.default"]})`
                            : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <p className="text-xs text-text-muted mt-2">
                    {d["create.savedAddresses.hint"]}
                  </p>
                </Card>
              )}

              {/* Form Card */}
              <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-200">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={d["create.city"]} required>
                    <Select
                      required
                      value={form.il}
                      onChange={(e) => updateField("il", e.target.value)}
                    >
                      <option value="">{d["create.city.placeholder"]}</option>
                      {PROVINCES.map((il) => (
                        <option key={il} value={il}>{il}</option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label={d["create.district"]} required>
                    {form.il ? (
                      <Select
                        required
                        value={form.ilce}
                        onChange={(e) => updateField("ilce", e.target.value)}
                      >
                        <option value="">{d["create.district.placeholder"]}</option>
                        {districtOptions.map((district) => (
                          <option key={district} value={district}>{district}</option>
                        ))}
                      </Select>
                    ) : (
                      <div className="input-base opacity-60 cursor-not-allowed text-text-muted">
                        {d["create.district.selectCity"]}
                      </div>
                    )}
                  </FormField>
                  <FormField
                    label={d["create.neighborhood"]}
                    required
                    className="sm:col-span-2"
                  >
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
                  </FormField>
                  <FormField
                    label={d["create.address"]}
                    required
                    className="sm:col-span-2"
                  >
                    <Input
                      type="text"
                      required
                      value={form.adres}
                      onChange={(e) => updateField("adres", e.target.value)}
                      placeholder={d["create.address.placeholder"]}
                    />
                  </FormField>
                  <FormField label={d["create.postalCode"]} required>
                    <Input
                      type="text"
                      required
                      maxLength={5}
                      value={form.postaKodu}
                      onChange={(e) => updateField("postaKodu", e.target.value)}
                      placeholder={d["create.postalCode.placeholder"]}
                    />
                  </FormField>
                  <FormField label={d["common.phone"]} required>
                    <PhoneInput
                      required
                      country={telefonCountry}
                      nationalNumber={telefonNational}
                      onCountryChange={setTelefonCountry}
                      onNationalNumberChange={setTelefonNational}
                    />
                  </FormField>
                </div>
              </Card>

              {/* Upsells (Q10) — opt-in add-ons for AOV lift. Each row shows
                  the kuruş price computed from the same constants the server
                  validates against. */}
              <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-225">
                <h3 className="text-sm font-medium text-text-secondary mb-3">
                  {d["create.upsells.title"]}
                </h3>
                <p className="text-xs text-text-muted mb-4">
                  {d["create.upsells.subtitle"]}
                </p>
                <div className="space-y-2">
                  {UPSELLS.map((u) => {
                    const checked = selectedUpsells.includes(u.key);
                    return (
                      <label
                        key={u.key}
                        className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                          checked
                            ? "bg-green-500/10 border-green-500/30"
                            : "bg-bg-surface border-bg-subtle hover:bg-bg-elevated"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUpsell(u.key)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-text-primary">
                              {d[`upsell.${u.key}.label` as keyof typeof d]}
                            </span>
                            <span className="text-sm text-text-secondary shrink-0">
                              +₺{(u.priceKurus / 100).toFixed(2)}
                            </span>
                          </div>
                          <p className="text-xs text-text-muted mt-0.5">
                            {d[`upsell.${u.key}.description` as keyof typeof d]}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {upsellTotalKurus > 0 && (
                  <p className="text-xs text-text-muted mt-3 text-right">
                    {d["create.upsells.added"]} +₺
                    {(upsellTotalKurus / 100).toFixed(2)}
                  </p>
                )}
              </Card>

              {/* Gift Card */}
              <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-250">
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
                    <Input
                      type="text"
                      value={gcCode}
                      onChange={(e) => setGcCode(e.target.value.toUpperCase())}
                      placeholder={d["giftCard.enterCode"]}
                      className="flex-1 font-mono"
                    />
                    <Button
                      type="button"
                      onClick={handleApplyGiftCard}
                      disabled={!gcCode.trim()}
                      loading={gcApplying}
                      variant="secondary"
                      className="whitespace-nowrap"
                    >
                      {gcApplying ? d["giftCard.applying"] : d["giftCard.apply"]}
                    </Button>
                  </div>
                )}
                {gcError && <p className="text-sm text-error mt-2">{gcError}</p>}
              </Card>

              {/* Payment Method Selector */}
              {(() => {
                const total = baseKurus(selectedSize, selectedMaterial) + finishKurus(selectedFinish) + upsellTotalKurus;
                const gcDiscount = gcApplied ? Math.min(gcApplied.balanceKurus, total) : 0;
                const remaining = total - gcDiscount;
                const isFullyCovered = remaining <= 0;
                if (isFullyCovered) return null;
                return (
                  <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-275">
                    <h3 className="text-sm font-medium text-text-secondary mb-3">{d["payment.method.title"]}</h3>
                    <div className="space-y-2">
                        <label
                          className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition ${
                            paymentMethod === "card"
                              ? "border-green-500 bg-green-500/5"
                              : "border-bg-subtle hover:border-green-400/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value="card"
                            checked={paymentMethod === "card"}
                            onChange={() => setPaymentMethod("card")}
                            className="mt-1 accent-green-500"
                          />
                          <div className="flex-1">
                            <p className="font-medium text-text-primary">{d["payment.method.card"]}</p>
                            <p className="text-xs text-text-secondary mt-1">{d["payment.method.card.desc"]}</p>
                          </div>
                        </label>
                        <label
                          className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition ${
                            paymentMethod === "bank_transfer"
                              ? "border-green-500 bg-green-500/5"
                              : "border-bg-subtle hover:border-green-400/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value="bank_transfer"
                            checked={paymentMethod === "bank_transfer"}
                            onChange={() => setPaymentMethod("bank_transfer")}
                            className="mt-1 accent-green-500"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-text-primary">{d["payment.method.bankTransfer"]}</p>
                              <span className="inline-flex items-center text-xs font-semibold text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full">
                                {d["payment.method.bankTransferBadge"]}
                              </span>
                            </div>
                            <p className="text-xs text-text-secondary mt-1">{d["payment.method.bankTransfer.desc"]}</p>
                          </div>
                        </label>
                    </div>
                  </Card>
                );
              })()}

              {/* Order Summary Card */}
              <Card elevated padding="md" className="overflow-hidden animate-fade-in-up delay-300">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-text-secondary">{selectedSizeObj?.label} ({selectedSizeObj?.height}) · {selectedMaterialObj?.label}</span>
                    <span className="font-mono font-bold text-text-primary">₺{priceLabel(selectedSize, selectedMaterial)}</span>
                  </div>
                  {selectedFinishObj && selectedFinishObj.surchargeKurus !== 0 && (
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-text-secondary">{selectedFinishObj.label}</span>
                      <span className="font-mono font-bold text-text-primary">
                        {selectedFinishObj.surchargeKurus > 0 ? "+" : "-"}₺{(Math.abs(selectedFinishObj.surchargeKurus) / 100).toLocaleString("tr-TR")}
                      </span>
                    </div>
                  )}
                  {(() => {
                    const total = baseKurus(selectedSize, selectedMaterial) + finishKurus(selectedFinish) + upsellTotalKurus;
                    const gcDiscount = gcApplied ? Math.min(gcApplied.balanceKurus, total) : 0;
                    const afterGc = total - gcDiscount;
                    const havaleDiscount =
                      paymentMethod === "bank_transfer" && afterGc > 0
                        ? calculateHavaleDiscount(afterGc)
                        : 0;
                    const finalTotal = afterGc - havaleDiscount;
                    const isFullyCovered = afterGc <= 0;
                    return (
                      <>
                        {gcApplied && (
                          <div className="flex items-center justify-between mb-2 text-green-400">
                            <span className="text-sm">{d["giftCard.discount"]}</span>
                            <span className="font-mono font-bold">-₺{(gcDiscount / 100).toLocaleString("tr-TR")}</span>
                          </div>
                        )}
                        {havaleDiscount > 0 && (
                          <div className="flex items-center justify-between mb-2 text-green-400">
                            <span className="text-sm">{d["payment.havaleDiscount"]}</span>
                            <span className="font-mono font-bold">-₺{(havaleDiscount / 100).toLocaleString("tr-TR")}</span>
                          </div>
                        )}
                        <div className="border-t border-bg-subtle pt-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-text-primary">{d["payment.total"]}</span>
                          <span className="text-xl font-mono font-bold text-green-500">
                            {isFullyCovered
                              ? d["giftCard.fullyCovered"]
                              : `₺${(finalTotal / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </span>
                        </div>
                      </>
                    );
                  })()}
              </Card>

              {error && (
                <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-error-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-error-700">{error}</p>
                </div>
              )}

              {(() => {
                const total = baseKurus(selectedSize, selectedMaterial) + finishKurus(selectedFinish) + upsellTotalKurus;
                const isFullyCovered = gcApplied && gcApplied.balanceKurus >= total;
                const showLock = !isFullyCovered;
                return (
                  <Button
                    type="submit"
                    loading={submitting}
                    size="lg"
                    fullWidth
                    className="inline-flex items-center justify-center gap-2"
                  >
                    {showLock && (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 11c-1.105 0-2 .9-2 2v3a2 2 0 002 2 2 2 0 002-2v-3c0-1.1-.895-2-2-2zm6-2V8a6 6 0 10-12 0v1a3 3 0 00-3 3v8a3 3 0 003 3h12a3 3 0 003-3v-8a3 3 0 00-3-3zm-9-1a3 3 0 016 0v1H9V8z"
                        />
                      </svg>
                    )}
                    {submitting ? d["create.submitting"] : isFullyCovered ? d["giftCard.fullyCovered"] : d["create.submitButton"]}
                  </Button>
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

// /create routes by ?path=: a cold landing shows the production-path selector;
// upload & design open their (coming-soon) flows; figure/object — or an
// in-progress preview/order — open the photo→3D custom flow above.
function CreateRouter() {
  const searchParams = useSearchParams();
  const path = searchParams.get("path");
  if (path === "upload") return <UploadModelFlow />;
  if (path === "design") return <DesignToProductFlow />;
  const hasContext =
    !!path ||
    !!searchParams.get("style") ||
    !!searchParams.get("previewId") ||
    !!searchParams.get("fromOrder");
  if (!hasContext) return <CreatePathSelector />;
  return <CustomCreateFlow />;
}

export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-bg-base">
          <SiteHeader />
        </main>
      }
    >
      <CreateRouter />
    </Suspense>
  );
}
