"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";

const MeshSculptor = dynamic(
  () => import("@/components/mesh-sculptor/MeshSculptor").then((m) => m.MeshSculptor),
  { ssr: false }
);
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { MESSAGE_TEMPLATES } from "@/lib/config/message-templates";

// ─── Types ───────────────────────────────────────────────────
interface OrderData {
  id: string;
  orderNumber: string;
  email: string;
  customerName: string;
  phone: string | null;
  figurineSize: string;
  style: string;
  modifiers: string[] | null;
  shippingAddress: { adres: string; mahalle?: string; ilce: string; il: string; postaKodu: string; telefon: string } | null;
  status: string;
  amountKurus: number;
  giftCardAmountKurus: number;
  paidAt: string | null;
  shippedAt: string | null;
  trackingNumber: string | null;
  adminNotes: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: string;
}

interface Props {
  data: {
    order: OrderData;
    photos: { id: string; originalUrl: string; thumbnailUrl: string | null }[];
    latestGeneration: { id: string; provider: string; status: string; outputGlbUrl: string | null; outputStlUrl: string | null; costCents: number | null; durationMs: number | null; createdAt: string } | null;
    latestReport: { isWatertight: boolean; isVolume: boolean; vertexCount: number; faceCount: number; componentCount: number; boundingBox: any; baseAdded: boolean; repairsApplied: string[] | null } | null;
    generationAttempts: { id: string; provider: string; status: string; outputGlbUrl: string | null; outputStlUrl: string | null; errorMessage: string | null; costCents: number | null; durationMs: number | null; createdAt: string }[];
    adminActions: { id: string; action: string; adminEmail: string; notes: string | null; createdAt: string }[];
    adminMessages: { id: string; channel: string; subject: string | null; body: string; templateKey: string | null; adminEmail: string; sentAt: string }[];
    manufacturer?: { id: string; companyName: string; contactPerson: string; status: string } | null;
    manufacturerActions?: { id: string; action: string; notes: string | null; createdAt: string }[];
    manufacturerStatus?: string | null;
    assignedToManufacturerAt?: string | null;
    activeManufacturers?: { id: string; companyName: string }[];
  };
  locale: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  paid: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  generating: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  processing_mesh: "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  review: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  approved: "bg-green-50 text-green-700 ring-1 ring-green-200",
  printing: "bg-purple-50 text-purple-700 ring-1 ring-purple-200",
  shipped: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  failed_generation: "bg-red-50 text-red-700 ring-1 ring-red-200",
  failed_mesh: "bg-red-50 text-red-700 ring-1 ring-red-200",
  rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
};

const TIMELINE_STEPS = [
  "pending_payment", "paid", "generating", "processing_mesh", "review", "approved", "printing", "shipped", "delivered",
];

// ─── Step Icons ──────────────────────────────────────────────
function StepIcon({ step, className = "w-4 h-4" }: { step: string; className?: string }) {
  switch (step) {
    case "pending_payment":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>;
    case "paid":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>;
    case "generating":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
    case "processing_mesh":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
    case "review":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>;
    case "approved":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>;
    case "printing":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>;
    case "shipped":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
    case "delivered":
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
    default:
      return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
  }
}

// ─── Main Component ──────────────────────────────────────────
export function OrderDetailClient({ data, locale }: Props) {
  const { order, photos, latestGeneration, latestReport, generationAttempts, adminActions, adminMessages, manufacturer, manufacturerActions: mfgActions, manufacturerStatus, assignedToManufacturerAt, activeManufacturers } = data;
  const router = useRouter();
  const d = useDictionary();
  const loc = locale as Locale;

  const [loading, setLoading] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedManufacturerId, setSelectedManufacturerId] = useState("");

  // Edit state
  const [editing, setEditing] = useState(false);
  const [sculptorOpen, setSculptorOpen] = useState(false);
  const [editNotes, setEditNotes] = useState(order.adminNotes || "");
  const [editAddress, setEditAddress] = useState(order.shippingAddress);

  // Messaging state
  const [msgTab, setMsgTab] = useState<"email" | "whatsapp">("whatsapp");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);

  // Collapsible sections
  const [messagingOpen, setMessagingOpen] = useState(false);
  const [meshReportOpen, setMeshReportOpen] = useState(false);

  // ─── Actions ─────────────────────────────────────────────
  const performAction = async (action: string, body: Record<string, any> = {}) => {
    setLoading(action);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, notes: notes || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || `${action} ${d["admin.orderDetail.actionFailed"]}`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const saveEdit = async () => {
    setLoading("edit");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNotes: editNotes, shippingAddress: editAddress }),
      });
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || d["admin.orderDetail.actionFailed"]);
      }
    } finally {
      setLoading(null);
    }
  };

  // Template handling
  const applyTemplate = (key: string) => {
    setSelectedTemplate(key);
    if (key === "custom") {
      setMsgBody("");
      setMsgSubject("");
      return;
    }
    const tpl = MESSAGE_TEMPLATES.find(t => t.key === key);
    if (!tpl) return;
    const subjectKey = tpl.subjectKey as keyof typeof d;
    const bodyKey = tpl.bodyKey as keyof typeof d;
    let subject = subjectKey ? (d[subjectKey] || "") : "";
    let body = bodyKey ? (d[bodyKey] || "") : "";
    subject = subject.replace("{orderNumber}", order.orderNumber).replace("{customerName}", order.customerName).replace("{trackingNumber}", order.trackingNumber || "");
    body = body.replace("{orderNumber}", order.orderNumber).replace("{customerName}", order.customerName).replace("{trackingNumber}", order.trackingNumber || "");
    setMsgSubject(subject);
    setMsgBody(body);
  };

  const sendEmail = async () => {
    if (!msgBody.trim()) return;
    setMsgSending(true);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: msgSubject || undefined, body: msgBody, templateKey: selectedTemplate }),
      });
      if (res.ok) {
        setMsgSent(true);
        setMsgBody("");
        setMsgSubject("");
        setTimeout(() => setMsgSent(false), 3000);
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || d["admin.orderDetail.actionFailed"]);
      }
    } finally {
      setMsgSending(false);
    }
  };

  const openWhatsapp = async () => {
    if (!msgBody.trim() || msgSending) return;
    setMsgSending(true);
    try {
      const phone = order.phone || order.shippingAddress?.telefon || "";
      const cleanPhone = phone.replace(/\D/g, "").replace(/^0/, "90");
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msgBody)}`, "_blank");
      // Log it
      await fetch(`/api/admin/orders/${order.id}/log-whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: msgBody, templateKey: selectedTemplate }),
      });
      router.refresh();
    } finally {
      setMsgSending(false);
    }
  };

  const hasManufacturer = !!manufacturer;
  const canConfirm = order.status === "pending_payment";
  const canApprove = order.status === "review";
  const canReject = ["review", "approved", "failed_generation", "failed_mesh", "generating", "processing_mesh", "paid"].includes(order.status);
  const canRegenerate = ["review", "failed_generation", "failed_mesh", "paid", "generating", "processing_mesh"].includes(order.status);
  const canForceReview = ["paid", "generating", "processing_mesh"].includes(order.status);
  const canStartPrinting = order.status === "approved" && !hasManufacturer;
  const canShip = order.status === "printing" && !hasManufacturer;
  const canDeliver = order.status === "shipped";
  const canAssignManufacturer = order.status === "approved" && (!manufacturerStatus || manufacturerStatus === "unassigned");
  const addr = order.shippingAddress;

  const assignManufacturer = async () => {
    if (!selectedManufacturerId) return;
    setLoading("assign-manufacturer");
    try {
      const res = await fetch(`/api/admin/orders/${order.id}/assign-manufacturer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturerId: selectedManufacturerId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || d["admin.orderDetail.actionFailed"]);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  // ─── Timeline ────────────────────────────────────────────
  const isFailed = order.status.startsWith("failed") || order.status === "rejected";
  // For failed states, map to the step where it failed
  const FAILED_STEP_MAP: Record<string, string> = {
    failed_generation: "generating",
    failed_mesh: "processing_mesh",
    rejected: "review",
  };
  const effectiveStatus = isFailed ? (FAILED_STEP_MAP[order.status] || order.status) : order.status;
  const currentStepIndex = TIMELINE_STEPS.indexOf(effectiveStatus);

  // Determine primary action
  const primaryAction = canConfirm ? "confirm"
    : canApprove ? "approve"
    : canStartPrinting ? "start-printing"
    : canShip ? "ship-section"
    : canDeliver ? "deliver"
    : null;

  const hasAnyAction = canConfirm || canApprove || canReject || canRegenerate || canForceReview || canStartPrinting || canShip || canDeliver;

  // Customer initials
  const initials = order.customerName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div>
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between pb-5 mb-5 border-b border-gray-100 gap-4">
        <div className="flex items-start gap-4">
          <Link href="/admin/orders" className="mt-1.5 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 font-mono tracking-tight">
                {order.orderNumber}
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                {d[`admin.status.${order.status}` as keyof typeof d] || order.status.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{order.customerName} &middot; {order.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latestGeneration?.outputGlbUrl && (
            <a href={latestGeneration.outputGlbUrl} download className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 rounded-full text-sm font-medium text-white transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {d["admin.orderDetail.downloadGlb"]}
            </a>
          )}
          {latestGeneration?.outputStlUrl && (
            <a href={latestGeneration.outputStlUrl} download className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-full text-sm font-medium text-white transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {d["admin.orderDetail.downloadStl"]}
            </a>
          )}
        </div>
      </div>

      {/* ─── Horizontal Stepper Timeline ────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
        <div className="flex items-center justify-between overflow-x-auto">
          {TIMELINE_STEPS.map((step, i) => {
            const isActive = i < currentStepIndex;
            const isCurrent = step === effectiveStatus;
            const isFailedStep = isCurrent && isFailed;
            return (
              <div key={step} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center min-w-[72px]">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isFailedStep
                      ? "bg-red-500 text-white ring-4 ring-red-100 shadow-sm"
                      : isCurrent
                        ? "bg-blue-600 text-white ring-4 ring-blue-100 shadow-sm"
                        : isActive
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-400"
                  }`}>
                    {isFailedStep ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    ) : (
                      <StepIcon step={step} className="w-4 h-4" />
                    )}
                  </div>
                  <span className={`text-[10px] mt-1.5 text-center leading-tight whitespace-nowrap ${
                    isFailedStep ? "font-semibold text-red-600" :
                    isCurrent ? "font-semibold text-blue-700" :
                    isActive ? "text-green-700 font-medium" :
                    "text-gray-400"
                  }`}>
                    {d[`admin.status.${step}` as keyof typeof d] || step.replace(/_/g, " ")}
                  </span>
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className="flex-1 mx-1 h-0.5 min-w-[16px]">
                    <div className={`h-full rounded-full transition-colors duration-300 ${i < currentStepIndex ? "bg-green-400" : "bg-gray-200"}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* ─── Left Column (2/3) ────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">

          {/* ─── Photo + Model Card ───────────────────── */}
          {(photos[0] || latestGeneration?.outputGlbUrl) && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className={`flex flex-col ${photos[0] && latestGeneration?.outputGlbUrl ? "sm:flex-row" : ""}`}>
                {photos[0] && (
                  <div className={`p-5 ${latestGeneration?.outputGlbUrl ? "sm:w-1/2 sm:border-r sm:border-gray-100" : "w-full"}`}>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{d["admin.orderDetail.originalPhoto"]}</h3>
                    <div className="bg-gray-50 rounded-xl overflow-hidden">
                      <img src={photos[0].originalUrl} alt={d["admin.orderDetail.customerPhoto"]} className="w-full max-h-72 object-contain" />
                    </div>
                  </div>
                )}
                {latestGeneration?.outputGlbUrl && (
                  <div className={`p-5 ${photos[0] ? "sm:w-1/2" : "w-full"}`}>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{d["admin.orderDetail.modelPreview"]}</h3>
                    <ModelViewer url={latestGeneration.outputGlbUrl} className="w-full h-72 rounded-xl" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Mesh Edit Button (review only) ─────── */}
          {order.status === "review" && latestGeneration?.outputGlbUrl && (
            <button
              onClick={() => setSculptorOpen(true)}
              className="w-full flex items-center gap-4 bg-white rounded-2xl shadow-sm border border-indigo-200 p-4 hover:bg-indigo-50 transition-colors group"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 group-hover:bg-indigo-200 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-indigo-900">{d["admin.orderDetail.editMesh"] ?? "Mesh Duzenle"}</p>
                <p className="text-xs text-indigo-600 mt-0.5">3D modeli duzenlemek icin sculpt editorunu acin</p>
              </div>
              <svg className="w-5 h-5 text-indigo-400 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          )}

          {/* ─── Primary Action Panel ─────────────────── */}
          {hasAnyAction && (
            <div className="space-y-3">
              {/* Primary action card */}
              {primaryAction === "confirm" && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-green-900">{d["admin.orderDetail.confirm"]}</h3>
                      <p className="text-sm text-green-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-green-200 rounded-xl text-sm placeholder:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                      <button onClick={() => performAction("confirm")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm">
                        {loading === "confirm" ? d["admin.orderDetail.confirming"] : d["admin.orderDetail.confirm"]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {primaryAction === "approve" && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-green-900">{d["admin.orderDetail.approve"]}</h3>
                      <p className="text-sm text-green-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-green-200 rounded-xl text-sm placeholder:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                      <button onClick={() => performAction("approve")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm">
                        {loading === "approve" ? d["admin.orderDetail.approving"] : d["admin.orderDetail.approve"]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {primaryAction === "start-printing" && (
                <div className="bg-gradient-to-br from-purple-50 to-violet-50 rounded-2xl border border-purple-200 p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-purple-900">{d["admin.orderDetail.startPrint"]}</h3>
                      <p className="text-sm text-purple-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm placeholder:text-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                      <button onClick={() => performAction("start-printing")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-purple-600 text-white text-sm font-semibold rounded-xl hover:bg-purple-700 disabled:bg-gray-400 transition-colors shadow-sm">
                        {loading === "start-printing" ? d["admin.orderDetail.startingPrint"] : d["admin.orderDetail.startPrint"]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {primaryAction === "deliver" && (
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-200 p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-green-900">{d["admin.orderDetail.deliver"]}</h3>
                      <p className="text-sm text-green-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-green-200 rounded-xl text-sm placeholder:text-green-400 focus:outline-none focus:ring-2 focus:ring-green-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                      <button onClick={() => performAction("deliver")} disabled={!!loading} className="mt-3 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-400 transition-colors shadow-sm">
                        {loading === "deliver" ? d["admin.orderDetail.delivering"] : d["admin.orderDetail.deliver"]}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Ship section */}
              {primaryAction === "ship-section" && (
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-emerald-900">{d["admin.orderDetail.kargoShip"]}</h3>
                      <p className="text-sm text-emerald-700 mt-0.5">{d["admin.orderDetail.adminNote"]}</p>
                      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-3 px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm placeholder:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                      <button onClick={() => performAction("ship-kargo")} disabled={!!loading} className="mt-3 w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:bg-gray-400 transition-colors shadow-sm">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                        {loading === "ship-kargo" ? d["admin.orderDetail.kargoCreating"] : d["admin.orderDetail.kargoShip"]}
                      </button>
                      <div className="flex items-center gap-3 mt-4">
                        <div className="flex-1 border-t border-emerald-200" />
                        <span className="text-xs text-emerald-500 font-medium">{d["admin.orderDetail.orManual"]}</span>
                        <div className="flex-1 border-t border-emerald-200" />
                      </div>
                      <div className="flex gap-2 mt-3">
                        <input type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="flex-1 px-3 py-2 bg-white border border-emerald-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 transition-shadow" placeholder={d["admin.orderDetail.trackingPlaceholder"]} />
                        <button onClick={() => { if (trackingNumber.trim()) performAction("ship", { trackingNumber: trackingNumber.trim() }); }} disabled={!!loading || !trackingNumber.trim()} className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-xl hover:bg-gray-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors">
                          {loading === "ship" ? d["admin.orderDetail.shipping"] : d["admin.orderDetail.ship"]}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* No primary action but notes input needed for secondary actions */}
              {!primaryAction && hasAnyAction && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.adminNote"]}</label>
                  <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.orderDetail.addNote"]} />
                </div>
              )}

              {/* Secondary actions */}
              {(canRegenerate || canReject || canForceReview) && (
                <div className="flex items-center gap-3 flex-wrap px-1">
                  {canRegenerate && (
                    <button onClick={() => performAction("regenerate")} disabled={!!loading} className="text-sm text-blue-600 hover:text-blue-800 font-medium hover:underline transition-colors disabled:text-gray-400">
                      {loading === "regenerate" ? d["admin.orderDetail.regenerating"] : d["admin.orderDetail.regenerate"]}
                    </button>
                  )}
                  {canForceReview && (
                    <button onClick={() => performAction("force-review")} disabled={!!loading} className="text-sm text-yellow-600 hover:text-yellow-800 font-medium hover:underline transition-colors disabled:text-gray-400">
                      {loading === "force-review" ? d["admin.orderDetail.forcingReview"] : d["admin.orderDetail.forceReview"]}
                    </button>
                  )}
                  {canReject && (
                    <button onClick={() => { if (confirm(d["admin.orderDetail.rejectConfirm"])) performAction("reject", { reason: notes || d["admin.orderDetail.rejectDefault"] }); }} disabled={!!loading} className="text-sm text-red-500 hover:text-red-700 font-medium hover:underline transition-colors disabled:text-gray-400">
                      {loading === "reject" ? d["admin.orderDetail.rejecting"] : d["admin.orderDetail.reject"]}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Manufacturer Section ─────────────────── */}
          {hasManufacturer && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">{manufacturer.companyName}</h3>
                  <p className="text-xs text-gray-500">{manufacturer.contactPerson}</p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  manufacturerStatus === "printing" || manufacturerStatus === "accepted" ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200" :
                  manufacturerStatus === "printed" || manufacturerStatus === "shipped" ? "bg-green-50 text-green-700 ring-1 ring-green-200" :
                  manufacturerStatus === "assigned" ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" :
                  "bg-gray-50 text-gray-700 ring-1 ring-gray-200"
                }`}>
                  {manufacturerStatus?.replace(/_/g, " ") || "unassigned"}
                </span>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p className="text-xs text-blue-700 font-medium">{d["admin.orderDetail.managedByManufacturer"]}</p>
              </div>
              {mfgActions && mfgActions.length > 0 && (
                <div className="mt-4 space-y-0">
                  {mfgActions.map((action, i) => (
                    <div key={action.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2 h-2 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
                        {i < mfgActions.length - 1 && <div className="w-px flex-1 bg-purple-200 my-0.5" />}
                      </div>
                      <div className="pb-3 min-w-0">
                        <p className="text-xs font-medium text-gray-700 capitalize">{action.action.replace(/_/g, " ")}</p>
                        {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDateTime(action.createdAt, loc)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Manufacturer Assignment */}
          {canAssignManufacturer && activeManufacturers && activeManufacturers.length > 0 && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
              <h3 className="text-xs font-semibold text-blue-800 uppercase tracking-wider mb-3">{d["admin.orderDetail.assignManufacturer"]}</h3>
              <div className="flex gap-2">
                <select
                  value={selectedManufacturerId}
                  onChange={(e) => setSelectedManufacturerId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-white border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 transition-shadow"
                >
                  <option value="">{d["admin.orderDetail.selectManufacturer"]}</option>
                  {activeManufacturers.map((m) => (
                    <option key={m.id} value={m.id}>{m.companyName}</option>
                  ))}
                </select>
                <button
                  onClick={assignManufacturer}
                  disabled={!selectedManufacturerId || !!loading}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shadow-sm"
                >
                  {loading === "assign-manufacturer" ? d["admin.orderDetail.assigning"] : d["admin.orderDetail.assign"]}
                </button>
              </div>
            </div>
          )}

          {/* ─── Messaging Panel (Collapsible) ────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <button
              onClick={() => setMessagingOpen(!messagingOpen)}
              className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.messaging.title"]}</h3>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${messagingOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            <div className={`transition-all duration-300 ease-in-out ${messagingOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0"} overflow-hidden`}>
              <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
                {/* Tab pills */}
                <div className="flex gap-2">
                  <button onClick={() => setMsgTab("whatsapp")} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${msgTab === "whatsapp" ? "bg-green-100 text-green-700 ring-1 ring-green-200" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.51-4.484-1.375l-.3-.188-3.216.844.844-3.216-.188-.3A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
                      WhatsApp
                    </span>
                  </button>
                  <button onClick={() => setMsgTab("email")} className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${msgTab === "email" ? "bg-blue-100 text-blue-700 ring-1 ring-blue-200" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}>
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                      E-posta
                    </span>
                  </button>
                </div>
                {/* Template selector */}
                <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow">
                  {MESSAGE_TEMPLATES.map(tpl => (
                    <option key={tpl.key} value={tpl.key}>{d[tpl.labelKey as keyof typeof d] || tpl.key}</option>
                  ))}
                </select>
                {/* Subject (email only) */}
                {msgTab === "email" && (
                  <input type="text" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.messaging.subjectPlaceholder"]} />
                )}
                {/* Message body */}
                <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={4} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder={d["admin.messaging.bodyPlaceholder"]} />
                {/* Send button */}
                {msgTab === "whatsapp" ? (
                  <button onClick={openWhatsapp} disabled={!msgBody.trim()} className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-xl hover:bg-green-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shadow-sm">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                    {d["admin.messaging.openWhatsapp"]}
                  </button>
                ) : (
                  <button onClick={sendEmail} disabled={!msgBody.trim() || msgSending} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors shadow-sm">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    {msgSending ? d["admin.messaging.sending"] : msgSent ? d["admin.messaging.sent"] : d["admin.messaging.send"]}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ─── History Sections ─────────────────────── */}

          {/* Message History */}
          {adminMessages.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.messaging.history"]}</h3>
              <div className="space-y-0">
                {adminMessages.map((msg, i) => (
                  <div key={msg.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${msg.channel === "whatsapp" ? "bg-green-400" : "bg-blue-400"}`} />
                      {i < adminMessages.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-4 min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${msg.channel === "whatsapp" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>
                            {msg.channel === "whatsapp" ? d["admin.messaging.via.whatsapp"] : d["admin.messaging.via.email"]}
                          </span>
                          {msg.subject && <span className="text-sm font-medium text-gray-700 truncate">{msg.subject}</span>}
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(msg.sentAt, loc)}</span>
                      </div>
                      <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3 mt-1">{msg.body}</p>
                      <p className="text-[10px] text-gray-400 mt-1">{msg.adminEmail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Generation History */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.generationHistory"]}</h3>
            <div className="space-y-0">
              {generationAttempts.map((attempt, i) => (
                <div key={attempt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${
                      attempt.status === "succeeded" ? "bg-green-400" :
                      attempt.status === "failed" ? "bg-red-400" :
                      "bg-yellow-400"
                    }`} />
                    {i < generationAttempts.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                  </div>
                  <div className="pb-3 flex-1 min-w-0 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-gray-700 capitalize">{attempt.provider}</span>
                      <span className={`ml-2 text-xs font-medium ${attempt.status === "succeeded" ? "text-green-600" : attempt.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                        {attempt.status === "succeeded" ? d["admin.orderDetail.succeeded"] : attempt.status === "failed" ? d["admin.orderDetail.generationFailed"] : attempt.status}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 whitespace-nowrap">
                      {attempt.durationMs ? `${(attempt.durationMs / 1000).toFixed(1)}s` : ""}
                      {attempt.costCents ? ` · $${(attempt.costCents / 100).toFixed(2)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
              {generationAttempts.length === 0 && (
                <p className="text-sm text-gray-400">{d["admin.orderDetail.noAttempts"]}</p>
              )}
            </div>
          </div>

          {/* Admin Action History */}
          {adminActions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.adminActions"]}</h3>
              <div className="space-y-0">
                {adminActions.map((action, i) => (
                  <div key={action.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1 flex-shrink-0" />
                      {i < adminActions.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-3 flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-700 capitalize">{d[`admin.timeline.${action.action === "print" ? "printing" : action.action === "message_email" ? "emailSent" : action.action === "message_whatsapp" ? "whatsappSent" : action.action}` as keyof typeof d] || action.action}</span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(action.createdAt, loc)}</span>
                      </div>
                      <p className="text-[10px] text-gray-400">{action.adminEmail}</p>
                      {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manufacturer Actions (standalone, when no manufacturer card rendered above) */}
          {!hasManufacturer && mfgActions && mfgActions.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.manufacturerActions"]}</h3>
              <div className="space-y-0">
                {mfgActions.map((action, i) => (
                  <div key={action.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-400 mt-1 flex-shrink-0" />
                      {i < mfgActions.length - 1 && <div className="w-px flex-1 bg-gray-200 my-0.5" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-700 capitalize">{action.action.replace(/_/g, " ")}</span>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDateTime(action.createdAt, loc)}</span>
                      </div>
                      {action.notes && <p className="text-xs text-gray-500 mt-0.5">{action.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right Sidebar (1/3) ───────────────────────── */}
        <div className="space-y-5">

          {/* Customer Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.customerInfo"]}</h3>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{order.customerName}</p>
                <p className="text-xs text-gray-500 truncate">{order.email}</p>
                {(order.phone || addr?.telefon) && (
                  <p className="text-xs text-gray-500">{order.phone || addr?.telefon}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {(order.phone || addr?.telefon) && (
                <a href={`tel:${order.phone || addr?.telefon}`} title={d["admin.orderDetail.callCustomer"]} className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                </a>
              )}
              <a href={`mailto:${order.email}`} title={d["admin.orderDetail.emailCustomer"]} className="w-9 h-9 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded-full text-gray-600 transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              </a>
              {(order.phone || addr?.telefon) && (
                <a href={`https://wa.me/${(order.phone || addr?.telefon || "").replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" rel="noopener noreferrer" title={d["admin.orderDetail.whatsappCustomer"]} className="w-9 h-9 flex items-center justify-center bg-green-50 hover:bg-green-100 rounded-full text-green-600 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                </a>
              )}
            </div>
          </div>

          {/* Order Details Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.orderDetails"]}</h3>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors">
                  {d["admin.orderDetail.editOrder"]}
                </button>
              )}
            </div>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.size"]}</dt>
                <dd className="font-medium text-gray-900">{d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.style"]}</dt>
                <dd className="font-medium text-gray-900 capitalize">{d[`create.style.${order.style}` as keyof typeof d] || order.style}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.amount"]}</dt>
                <dd className="font-semibold text-gray-900">{formatCurrency(order.amountKurus, loc)}</dd>
              </div>
              {order.giftCardAmountKurus > 0 && (
                <>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.giftCardAmount"]}</dt>
                    <dd className="font-medium"><span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full text-xs font-semibold ring-1 ring-green-200">-{formatCurrency(order.giftCardAmountKurus, loc)}</span></dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.remaining"]}</dt>
                    <dd className="font-semibold text-gray-900">{formatCurrency(order.amountKurus - order.giftCardAmountKurus, loc)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.payment"]}</dt>
                <dd className="text-gray-700">{order.paidAt ? formatDateTime(order.paidAt, loc) : <span className="text-amber-600 font-medium">{d["admin.orderDetail.notPaid"]}</span>}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.createdAt"]}</dt>
                <dd className="text-gray-700">{formatDateTime(order.createdAt, loc)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-400">{d["admin.orderDetail.retryCount"]}</dt>
                <dd className="text-gray-700">{order.retryCount}</dd>
              </div>
              {order.trackingNumber && (
                <div className="flex justify-between items-center">
                  <dt className="text-gray-400">{d["admin.orderDetail.trackingNumber"]}</dt>
                  <dd className="font-mono text-xs text-gray-900 bg-gray-50 px-2 py-0.5 rounded">{order.trackingNumber}</dd>
                </div>
              )}
              {order.failureReason && (
                <div className="pt-3 border-t border-gray-100">
                  <dt className="text-red-600 font-medium text-xs">{d["admin.orderDetail.failureReason"]}</dt>
                  <dd className="text-red-700 mt-1 text-xs break-all bg-red-50 px-3 py-2 rounded-lg">{order.failureReason}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Shipping Address */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">{d["admin.orderDetail.shippingAddress"]}</h3>
            {editing ? (
              <div className="space-y-2">
                <input type="text" value={editAddress?.adres || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, adres: e.target.value } : null)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Adres" />
                <input type="text" value={editAddress?.mahalle || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, mahalle: e.target.value } : null)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Mahalle" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={editAddress?.ilce || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, ilce: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Ilce" />
                  <input type="text" value={editAddress?.il || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, il: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Il" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={editAddress?.postaKodu || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, postaKodu: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Posta Kodu" />
                  <input type="text" value={editAddress?.telefon || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, telefon: e.target.value } : null)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" placeholder="Telefon" />
                </div>
                {/* Admin notes */}
                <div className="pt-2">
                  <label className="block text-xs text-gray-400 mb-1">{d["admin.orderDetail.adminNote"]}</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-200 transition-shadow" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={saveEdit} disabled={loading === "edit"} className="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl hover:bg-blue-700 disabled:bg-gray-400 transition-colors shadow-sm">
                    {loading === "edit" ? d["admin.orderDetail.saving"] : d["admin.orderDetail.saveChanges"]}
                  </button>
                  <button onClick={() => { setEditing(false); setEditAddress(order.shippingAddress); setEditNotes(order.adminNotes || ""); }} className="px-4 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-200 transition-colors">
                    {d["admin.orderDetail.cancel"]}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {addr && (
                  <div className="text-sm text-gray-700 space-y-0.5">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <div>
                        {addr.mahalle && <p className="text-gray-600">{addr.mahalle}</p>}
                        <p>{addr.adres}</p>
                        <p>{addr.ilce} / {addr.il}</p>
                        <p className="text-gray-500">{addr.postaKodu}</p>
                        <p className="mt-1 text-gray-500">Tel: {addr.telefon}</p>
                      </div>
                    </div>
                  </div>
                )}
                {order.adminNotes && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs text-gray-400 font-medium">{d["admin.orderDetail.adminNote"]}</p>
                    <p className="text-sm text-gray-700 mt-1">{order.adminNotes}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mesh Report (Collapsible) */}
          {latestReport && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => setMeshReportOpen(!meshReportOpen)}
                className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
              >
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{d["admin.orderDetail.meshReport"]}</h3>
                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${meshReportOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              <div className={`transition-all duration-300 ease-in-out ${meshReportOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"} overflow-hidden`}>
                <dl className="px-5 pb-5 space-y-3 text-sm border-t border-gray-100 pt-4">
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.watertight"]}</dt>
                    <dd className="flex items-center gap-1.5">
                      {latestReport.isWatertight ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className={latestReport.isWatertight ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {latestReport.isWatertight ? d["common.yes"] : d["common.no"]}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.solidVolume"]}</dt>
                    <dd className="flex items-center gap-1.5">
                      {latestReport.isVolume ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span className={latestReport.isVolume ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        {latestReport.isVolume ? d["common.yes"] : d["common.no"]}
                      </span>
                    </dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.vertex"]}</dt>
                    <dd className="text-gray-700">{formatNumber(latestReport.vertexCount, loc)}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.face"]}</dt>
                    <dd className="text-gray-700">{formatNumber(latestReport.faceCount, loc)}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.component"]}</dt>
                    <dd className="text-gray-700">{latestReport.componentCount}</dd>
                  </div>
                  <div className="flex justify-between items-center">
                    <dt className="text-gray-400">{d["admin.orderDetail.baseAdded"]}</dt>
                    <dd className="text-gray-700">{latestReport.baseAdded ? d["common.yes"] : d["common.no"]}</dd>
                  </div>
                  {latestReport.boundingBox && typeof latestReport.boundingBox === "object" && (
                    <div className="flex justify-between items-center">
                      <dt className="text-gray-400">{d["admin.orderDetail.dimensions"]}</dt>
                      <dd className="font-mono text-xs text-gray-700 bg-gray-50 px-2 py-0.5 rounded">{latestReport.boundingBox.size?.map((v: number) => v.toFixed(1)).join(" x ")}</dd>
                    </div>
                  )}
                  {latestReport.repairsApplied && latestReport.repairsApplied.length > 0 && (
                    <div className="pt-3 border-t border-gray-100">
                      <dt className="text-gray-400 mb-2">{d["admin.orderDetail.repairsApplied"]}</dt>
                      <dd className="flex flex-wrap gap-1">
                        {latestReport.repairsApplied.map((r) => (
                          <span key={r} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-blue-200">{r}</span>
                        ))}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mesh Sculptor Overlay */}
      {sculptorOpen && latestGeneration?.outputGlbUrl && (
        <MeshSculptor
          glbUrl={latestGeneration.outputGlbUrl}
          orderId={order.id}
          generationId={latestGeneration.id}
          onClose={() => setSculptorOpen(false)}
          onSaved={() => {
            setSculptorOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
