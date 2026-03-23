"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
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
    latestGeneration: { id: string; provider: string; status: string; outputGlbUrl: string | null; costCents: number | null; durationMs: number | null; createdAt: string } | null;
    latestReport: { isWatertight: boolean; isVolume: boolean; vertexCount: number; faceCount: number; componentCount: number; boundingBox: any; baseAdded: boolean; repairsApplied: string[] | null } | null;
    generationAttempts: { id: string; provider: string; status: string; outputGlbUrl: string | null; errorMessage: string | null; costCents: number | null; durationMs: number | null; createdAt: string }[];
    adminActions: { id: string; action: string; adminEmail: string; notes: string | null; createdAt: string }[];
    adminMessages: { id: string; channel: string; subject: string | null; body: string; templateKey: string | null; adminEmail: string; sentAt: string }[];
  };
  locale: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-700",
  paid: "bg-blue-100 text-blue-700",
  generating: "bg-indigo-100 text-indigo-700",
  processing_mesh: "bg-indigo-100 text-indigo-700",
  review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  printing: "bg-purple-100 text-purple-700",
  shipped: "bg-emerald-100 text-emerald-700",
  delivered: "bg-emerald-100 text-emerald-700",
  failed_generation: "bg-red-100 text-red-700",
  failed_mesh: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

const TIMELINE_STEPS = [
  "pending_payment", "paid", "generating", "processing_mesh", "review", "approved", "printing", "shipped", "delivered",
];

// ─── Main Component ──────────────────────────────────────────
export function OrderDetailClient({ data, locale }: Props) {
  const { order, photos, latestGeneration, latestReport, generationAttempts, adminActions, adminMessages } = data;
  const router = useRouter();
  const d = useDictionary();
  const loc = locale as Locale;

  const [loading, setLoading] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState(order.adminNotes || "");
  const [editAddress, setEditAddress] = useState(order.shippingAddress);

  // Messaging state
  const [msgTab, setMsgTab] = useState<"email" | "whatsapp">("whatsapp");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [msgSending, setMsgSending] = useState(false);
  const [msgSent, setMsgSent] = useState(false);

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
      }
    } finally {
      setMsgSending(false);
    }
  };

  const openWhatsapp = async () => {
    if (!msgBody.trim()) return;
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
  };

  const canConfirm = order.status === "pending_payment";
  const canApprove = order.status === "review";
  const canReject = ["review", "approved", "failed_generation", "failed_mesh", "generating", "processing_mesh", "paid"].includes(order.status);
  const canRegenerate = ["review", "failed_generation", "failed_mesh", "paid", "generating", "processing_mesh"].includes(order.status);
  const canForceReview = ["paid", "generating", "processing_mesh"].includes(order.status);
  const canStartPrinting = order.status === "approved";
  const canShip = order.status === "printing";
  const canDeliver = order.status === "shipped";
  const addr = order.shippingAddress;

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

  return (
    <div>
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/admin/orders" className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">
              {d["admin.orderDetail.order"]} {order.orderNumber}
            </h1>
            <span className={`px-3 py-1 rounded-lg text-sm font-medium ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
              {d[`admin.status.${order.status}` as keyof typeof d] || order.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-gray-500 mt-1 ml-8">{order.customerName} &middot; {order.email}</p>
        </div>
        {latestGeneration?.outputGlbUrl && (
          <a href={latestGeneration.outputGlbUrl} download className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            {d["admin.orderDetail.downloadGlb"]}
          </a>
        )}
      </div>

      {/* ─── Timeline ───────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">{d["admin.orderDetail.timeline"]}</h2>
        <div className="flex items-center gap-0 overflow-x-auto">
          {TIMELINE_STEPS.map((step, i) => {
            const isActive = i < currentStepIndex;
            const isCurrent = step === effectiveStatus;
            return (
              <div key={step} className="flex items-center">
                <div className="flex flex-col items-center min-w-[80px]">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    isCurrent && isFailed ? "bg-red-500 text-white ring-4 ring-red-100" :
                    isCurrent ? "bg-blue-600 text-white ring-4 ring-blue-100" :
                    isActive ? "bg-green-500 text-white" :
                    "bg-gray-200 text-gray-500"
                  }`}>
                    {isActive && !isCurrent ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`text-[10px] mt-1 text-center leading-tight ${isCurrent && isFailed ? "font-semibold text-red-700" : isCurrent ? "font-semibold text-blue-700" : "text-gray-500"}`}>
                    {d[`admin.status.${step}` as keyof typeof d] || step.replace(/_/g, " ")}
                  </span>
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`h-0.5 w-6 flex-shrink-0 ${i < currentStepIndex ? "bg-green-500" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* ─── Left Column (2/3) ────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Photo + Model */}
          <div className="grid sm:grid-cols-2 gap-4">
            {photos[0] && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.originalPhoto"]}</h2>
                <img src={photos[0].originalUrl} alt={d["admin.orderDetail.customerPhoto"]} className="w-full max-h-64 object-contain rounded-lg" />
              </div>
            )}
            {latestGeneration?.outputGlbUrl && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.modelPreview"]}</h2>
                <ModelViewer url={latestGeneration.outputGlbUrl} className="w-full h-64 bg-gray-900 rounded-lg" />
              </div>
            )}
          </div>

          {/* ─── Actions ──────────────────────────────── */}
          {(canConfirm || canApprove || canReject || canRegenerate || canForceReview || canStartPrinting || canShip || canDeliver) && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{d["admin.orderDetail.adminNote"]}</label>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder={d["admin.orderDetail.addNote"]} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {canConfirm && (
                  <button onClick={() => performAction("confirm")} disabled={!!loading} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400">
                    {loading === "confirm" ? d["admin.orderDetail.confirming"] : d["admin.orderDetail.confirm"]}
                  </button>
                )}
                {canApprove && (
                  <button onClick={() => performAction("approve")} disabled={!!loading} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400">
                    {loading === "approve" ? d["admin.orderDetail.approving"] : d["admin.orderDetail.approve"]}
                  </button>
                )}
                {canForceReview && (
                  <button onClick={() => performAction("force-review")} disabled={!!loading} className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-lg hover:bg-yellow-700 disabled:bg-gray-400">
                    {loading === "force-review" ? d["admin.orderDetail.forcingReview"] : d["admin.orderDetail.forceReview"]}
                  </button>
                )}
                {canStartPrinting && (
                  <button onClick={() => performAction("start-printing")} disabled={!!loading} className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:bg-gray-400">
                    {loading === "start-printing" ? d["admin.orderDetail.startingPrint"] : d["admin.orderDetail.startPrint"]}
                  </button>
                )}
                {canDeliver && (
                  <button onClick={() => performAction("deliver")} disabled={!!loading} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400">
                    {loading === "deliver" ? d["admin.orderDetail.delivering"] : d["admin.orderDetail.deliver"]}
                  </button>
                )}
                {canRegenerate && (
                  <button onClick={() => performAction("regenerate")} disabled={!!loading} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
                    {loading === "regenerate" ? d["admin.orderDetail.regenerating"] : d["admin.orderDetail.regenerate"]}
                  </button>
                )}
                {canReject && (
                  <button onClick={() => { if (confirm(d["admin.orderDetail.rejectConfirm"])) performAction("reject", { reason: notes || d["admin.orderDetail.rejectDefault"] }); }} disabled={!!loading} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400">
                    {loading === "reject" ? d["admin.orderDetail.rejecting"] : d["admin.orderDetail.reject"]}
                  </button>
                )}
              </div>
              {canShip && (
                <div className="space-y-3 pt-2 border-t border-gray-100">
                  <button onClick={() => performAction("ship-kargo")} disabled={!!loading} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                    {loading === "ship-kargo" ? d["admin.orderDetail.kargoCreating"] : d["admin.orderDetail.kargoShip"]}
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="text-xs text-gray-400">{d["admin.orderDetail.orManual"]}</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                  <div className="flex gap-2">
                    <input type="text" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={d["admin.orderDetail.trackingPlaceholder"]} />
                    <button onClick={() => { if (trackingNumber.trim()) performAction("ship", { trackingNumber: trackingNumber.trim() }); }} disabled={!!loading || !trackingNumber.trim()} className="px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 disabled:bg-gray-400">
                      {loading === "ship" ? d["admin.orderDetail.shipping"] : d["admin.orderDetail.ship"]}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── Messaging Panel ─────────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.messaging.title"]}</h2>
            {/* Tab switcher */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => setMsgTab("whatsapp")} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${msgTab === "whatsapp" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18c-1.66 0-3.203-.51-4.484-1.375l-.3-.188-3.216.844.844-3.216-.188-.3A7.963 7.963 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z"/></svg>
                  WhatsApp
                </span>
              </button>
              <button onClick={() => setMsgTab("email")} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${msgTab === "email" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  E-posta
                </span>
              </button>
            </div>
            {/* Template selector */}
            <select value={selectedTemplate} onChange={(e) => applyTemplate(e.target.value)} className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {MESSAGE_TEMPLATES.map(tpl => (
                <option key={tpl.key} value={tpl.key}>{d[tpl.labelKey as keyof typeof d] || tpl.key}</option>
              ))}
            </select>
            {/* Subject (email only) */}
            {msgTab === "email" && (
              <input type="text" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)} className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder={d["admin.messaging.subjectPlaceholder"]} />
            )}
            {/* Message body */}
            <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)} rows={4} className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none" placeholder={d["admin.messaging.bodyPlaceholder"]} />
            {/* Send button */}
            <div className="flex gap-2">
              {msgTab === "whatsapp" ? (
                <button onClick={openWhatsapp} disabled={!msgBody.trim()} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                  {d["admin.messaging.openWhatsapp"]}
                </button>
              ) : (
                <button onClick={sendEmail} disabled={!msgBody.trim() || msgSending} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                  {msgSending ? d["admin.messaging.sending"] : msgSent ? d["admin.messaging.sent"] : d["admin.messaging.send"]}
                </button>
              )}
            </div>
          </div>

          {/* ─── Message History ──────────────────────── */}
          {adminMessages.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.messaging.history"]}</h2>
              <div className="space-y-3">
                {adminMessages.map(msg => (
                  <div key={msg.id} className="border-b border-gray-100 pb-3 last:border-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${msg.channel === "whatsapp" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                          {msg.channel === "whatsapp" ? d["admin.messaging.via.whatsapp"] : d["admin.messaging.via.email"]}
                        </span>
                        {msg.subject && <span className="text-sm font-medium text-gray-700">{msg.subject}</span>}
                      </div>
                      <span className="text-xs text-gray-500">{formatDateTime(msg.sentAt, loc)}</span>
                    </div>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{msg.body}</p>
                    <p className="text-xs text-gray-400 mt-1">{msg.adminEmail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Generation History ──────────────────── */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.generationHistory"]}</h2>
            <div className="space-y-2">
              {generationAttempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between text-sm border-b border-gray-100 pb-2 last:border-0">
                  <div>
                    <span className="font-medium capitalize">{attempt.provider}</span>
                    <span className={`ml-2 text-xs ${attempt.status === "succeeded" ? "text-green-600" : attempt.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>
                      {attempt.status === "succeeded" ? d["admin.orderDetail.succeeded"] : attempt.status === "failed" ? d["admin.orderDetail.generationFailed"] : attempt.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {attempt.durationMs ? `${(attempt.durationMs / 1000).toFixed(1)}s` : ""}
                    {attempt.costCents ? ` · $${(attempt.costCents / 100).toFixed(2)}` : ""}
                  </div>
                </div>
              ))}
              {generationAttempts.length === 0 && (
                <p className="text-sm text-gray-500">{d["admin.orderDetail.noAttempts"]}</p>
              )}
            </div>
          </div>

          {/* ─── Admin Action History ────────────────── */}
          {adminActions.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.adminActions"]}</h2>
              <div className="space-y-2">
                {adminActions.map((action) => (
                  <div key={action.id} className="text-sm border-b border-gray-100 pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize">{d[`admin.timeline.${action.action === "print" ? "printing" : action.action === "message_email" ? "emailSent" : action.action === "message_whatsapp" ? "whatsappSent" : action.action}` as keyof typeof d] || action.action}</span>
                      <span className="text-xs text-gray-500">{formatDateTime(action.createdAt, loc)}</span>
                    </div>
                    <p className="text-xs text-gray-500">{action.adminEmail}</p>
                    {action.notes && <p className="text-xs text-gray-600 mt-1">{action.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Right Column (1/3) ───────────────────────── */}
        <div className="space-y-6">
          {/* Customer Info Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.customerInfo"]}</h2>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
              <p className="text-sm text-gray-600">{order.email}</p>
              {(order.phone || addr?.telefon) && (
                <p className="text-sm text-gray-600">{order.phone || addr?.telefon}</p>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              {(order.phone || addr?.telefon) && (
                <a href={`tel:${order.phone || addr?.telefon}`} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  {d["admin.orderDetail.callCustomer"]}
                </a>
              )}
              <a href={`mailto:${order.email}`} className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-700 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                {d["admin.orderDetail.emailCustomer"]}
              </a>
              {(order.phone || addr?.telefon) && (
                <a href={`https://wa.me/${(order.phone || addr?.telefon || "").replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" className="flex items-center gap-1 px-3 py-1.5 bg-green-50 hover:bg-green-100 rounded-lg text-xs font-medium text-green-700 transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                  {d["admin.orderDetail.whatsappCustomer"]}
                </a>
              )}
            </div>
          </div>

          {/* Order Details */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase">{d["admin.orderDetail.orderDetails"]}</h2>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  {d["admin.orderDetail.editOrder"]}
                </button>
              )}
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.size"]}</dt>
                <dd className="font-medium">{d[`sizes.${order.figurineSize}` as keyof typeof d] || order.figurineSize}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.style"]}</dt>
                <dd className="font-medium capitalize">{d[`create.style.${order.style}` as keyof typeof d] || order.style}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.amount"]}</dt>
                <dd className="font-medium">{formatCurrency(order.amountKurus, loc)}</dd>
              </div>
              {order.giftCardAmountKurus > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{d["admin.orderDetail.giftCardAmount"]}</dt>
                    <dd className="text-green-600">-{formatCurrency(order.giftCardAmountKurus, loc)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{d["admin.orderDetail.remaining"]}</dt>
                    <dd className="font-medium">{formatCurrency(order.amountKurus - order.giftCardAmountKurus, loc)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.payment"]}</dt>
                <dd>{order.paidAt ? formatDateTime(order.paidAt, loc) : d["admin.orderDetail.notPaid"]}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.createdAt"]}</dt>
                <dd>{formatDateTime(order.createdAt, loc)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">{d["admin.orderDetail.retryCount"]}</dt>
                <dd>{order.retryCount}</dd>
              </div>
              {order.trackingNumber && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.trackingNumber"]}</dt>
                  <dd className="font-mono">{order.trackingNumber}</dd>
                </div>
              )}
              {order.failureReason && (
                <div className="pt-2 border-t">
                  <dt className="text-red-600 font-medium">{d["admin.orderDetail.failureReason"]}</dt>
                  <dd className="text-red-700 mt-1 text-xs break-all">{order.failureReason}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Shipping Address (with edit) */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.shippingAddress"]}</h2>
            {editing ? (
              <div className="space-y-2">
                <input type="text" value={editAddress?.adres || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, adres: e.target.value } : null)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Adres" />
                <input type="text" value={editAddress?.mahalle || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, mahalle: e.target.value } : null)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Mahalle" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={editAddress?.ilce || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, ilce: e.target.value } : null)} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Ilce" />
                  <input type="text" value={editAddress?.il || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, il: e.target.value } : null)} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Il" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={editAddress?.postaKodu || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, postaKodu: e.target.value } : null)} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Posta Kodu" />
                  <input type="text" value={editAddress?.telefon || ""} onChange={(e) => setEditAddress(prev => prev ? { ...prev, telefon: e.target.value } : null)} className="px-2 py-1 border border-gray-300 rounded text-sm" placeholder="Telefon" />
                </div>
                {/* Admin notes */}
                <div className="pt-2">
                  <label className="block text-xs text-gray-500 mb-1">{d["admin.orderDetail.adminNote"]}</label>
                  <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="w-full px-2 py-1 border border-gray-300 rounded text-sm resize-none" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={saveEdit} disabled={loading === "edit"} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
                    {loading === "edit" ? d["admin.orderDetail.saving"] : d["admin.orderDetail.saveChanges"]}
                  </button>
                  <button onClick={() => { setEditing(false); setEditAddress(order.shippingAddress); setEditNotes(order.adminNotes || ""); }} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200">
                    {d["admin.orderDetail.cancel"]}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {addr && (
                  <div className="text-sm text-gray-700">
                    {addr.mahalle && <p>{addr.mahalle}</p>}
                    <p>{addr.adres}</p>
                    <p>{addr.ilce} / {addr.il}</p>
                    <p>{addr.postaKodu}</p>
                    <p className="mt-1">Tel: {addr.telefon}</p>
                  </div>
                )}
                {order.adminNotes && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 font-medium">{d["admin.orderDetail.adminNote"]}</p>
                    <p className="text-sm text-gray-700 mt-1">{order.adminNotes}</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mesh Report */}
          {latestReport && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase mb-3">{d["admin.orderDetail.meshReport"]}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.watertight"]}</dt>
                  <dd className={latestReport.isWatertight ? "text-green-600" : "text-red-600"}>
                    {latestReport.isWatertight ? d["common.yes"] : d["common.no"]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.solidVolume"]}</dt>
                  <dd className={latestReport.isVolume ? "text-green-600" : "text-red-600"}>
                    {latestReport.isVolume ? d["common.yes"] : d["common.no"]}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.vertex"]}</dt>
                  <dd>{formatNumber(latestReport.vertexCount, loc)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.face"]}</dt>
                  <dd>{formatNumber(latestReport.faceCount, loc)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.component"]}</dt>
                  <dd>{latestReport.componentCount}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{d["admin.orderDetail.baseAdded"]}</dt>
                  <dd>{latestReport.baseAdded ? d["common.yes"] : d["common.no"]}</dd>
                </div>
                {latestReport.boundingBox && typeof latestReport.boundingBox === "object" && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">{d["admin.orderDetail.dimensions"]}</dt>
                    <dd className="font-mono text-xs">{latestReport.boundingBox.size?.map((v: number) => v.toFixed(1)).join(" x ")}</dd>
                  </div>
                )}
                {latestReport.repairsApplied && latestReport.repairsApplied.length > 0 && (
                  <div className="pt-2 border-t">
                    <dt className="text-gray-500 mb-1">{d["admin.orderDetail.repairsApplied"]}</dt>
                    <dd className="flex flex-wrap gap-1">
                      {latestReport.repairsApplied.map((r) => (
                        <span key={r} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">{r}</span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
