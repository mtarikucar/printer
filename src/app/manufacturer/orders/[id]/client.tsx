"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { QcPhotoUploader } from "@/components/qc-photo-uploader";
import { ProductionPanel } from "@/components/products/production-panel";
import { OrderChat } from "@/components/order-chat";
import { SendToPainterPanel } from "@/components/manufacturer/send-to-painter-panel";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";
import { formatPhoneDisplay } from "@/lib/phone";

// ─── Types ───────────────────────────────────────────────────

interface OrderData {
  id: string;
  orderNumber: string;
  orderType: "custom" | "marketplace" | "upload";
  customerName: string;
  phone: string | null;
  figurineSize: string | null;
  material: string;
  style: string;
  modifiers: string[] | null;
  status: string;
  manufacturerStatus: string | null;
  needsPainting: boolean;
  painterStatus: string | null;
  qcRound: number;
  quantity: number;
  productTitleSnapshot: string | null;
  customerNote: string | null;
  shippingAddress: {
    adres: string;
    mahalle?: string;
    ilce: string;
    il: string;
    postaKodu: string;
    telefon: string;
  } | null;
  assignedToManufacturerAt: string | null;
  manufacturerAcceptedAt: string | null;
  manufacturerPrintedAt: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  createdAt: string;
}

interface Props {
  data: {
    order: OrderData;
    photos: { id: string; originalUrl: string }[];
    qcPhotos: { id: string; url: string }[];
    qcRejectReason: string | null;
    marketplaceProduct: {
      title: string;
      description: string;
      images: string[];
    } | null;
    productSpecs: {
      productId: string;
      title: string;
      quantity: number;
      selectedOptions: { groupName: string; choiceName: string }[];
      selectedAddons: { name: string }[];
      itemImageUrl: string | null;
      files: {
        id: string;
        partName: string | null;
        fileName: string;
        sourceFormat: string;
        quantity: number;
        glbUrl: string | null;
      }[];
      components: {
        name: string;
        quantity: number;
        unit: string | null;
        notes: string | null;
      }[];
      steps: { instruction: string; imageUrl: string | null }[];
    }[];
    glbUrl: string | null;
    stlUrl: string | null;
    objUrl: string | null;
    actions: {
      id: string;
      action: string;
      notes: string | null;
      createdAt: string;
    }[];
  };
  locale: string;
}

const MFR_STATUS_COLORS: Record<string, string> = {
  assigned: "bg-blue-100 text-blue-700",
  accepted: "bg-indigo-100 text-indigo-700",
  printing: "bg-purple-100 text-purple-700",
  printed: "bg-amber-100 text-amber-700",
  qc_pending: "bg-amber-100 text-amber-700",
  qc_rejected: "bg-red-100 text-red-700",
  qc_approved: "bg-emerald-100 text-emerald-700",
  shipped: "bg-emerald-100 text-emerald-700",
};

const ACTION_ICONS: Record<string, string> = {
  accept: "M5 13l4 4L19 7",
  start_printing: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z",
  finish_printing: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  submit_qc: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
  ship: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
};

const ACTION_DOT_COLORS: Record<string, string> = {
  accept: "bg-indigo-500",
  start_printing: "bg-purple-500",
  finish_printing: "bg-amber-500",
  submit_qc: "bg-amber-500",
  ship: "bg-emerald-500",
};

const TIMELINE_STEPS = ["assigned", "accepted", "printing", "printed", "qc_pending", "shipped"];

// Step icons as SVG path data
const STEP_ICONS: Record<string, { d: string; viewBox?: string }> = {
  assigned: { d: "M19 14l-7 7m0 0l-7-7m7 7V3" },
  accepted: { d: "M5 13l4 4L19 7" },
  printing: { d: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z" },
  printed: { d: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" },
  qc_pending: { d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  shipped: { d: "M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" },
};

// Status icons for the badge
const STATUS_ICONS: Record<string, string> = {
  assigned: "M19 14l-7 7m0 0l-7-7m7 7V3",
  accepted: "M5 13l4 4L19 7",
  printing: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z",
  printed: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
  qc_pending: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  qc_rejected: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  qc_approved: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  shipped: "M5 13l4 4L19 7",
};

// ─── Main Component ──────────────────────────────────────────

export function ManufacturerOrderDetailClient({ data, locale }: Props) {
  const { order, photos, qcPhotos, qcRejectReason, marketplaceProduct, productSpecs, glbUrl, stlUrl, objUrl, actions } = data;
  const isMarketplace = order.orderType === "marketplace";
  const router = useRouter();
  const d = useDictionary();
  const loc = locale as Locale;

  const [loading, setLoading] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"photo" | "model">("photo");
  const [addressCopied, setAddressCopied] = useState(false);
  const [qcPhotoCount, setQcPhotoCount] = useState(qcPhotos.length);
  const [shipCarrier, setShipCarrier] = useState("yurtici");

  // ─── Actions ─────────────────────────────────────────────
  const performAction = async (
    action: string,
    body: Record<string, any> = {}
  ) => {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/manufacturer/orders/${order.id}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        setError(
          data.error ||
            (d[
              "manufacturer.orderDetail.actionFailed" as keyof typeof d
            ] as string) ||
            "Action failed"
        );
        return;
      }
      router.refresh();
    } catch {
      setError(
        (d["common.error" as keyof typeof d] as string) ||
          "An error occurred"
      );
    } finally {
      setLoading(null);
    }
  };

  const canAccept = order.manufacturerStatus === "assigned";
  const canStartPrinting = order.manufacturerStatus === "accepted";
  const canFinishPrinting = order.manufacturerStatus === "printing";
  const canSubmitQc =
    order.manufacturerStatus === "printed" ||
    order.manufacturerStatus === "qc_rejected";
  const isQcPending = order.manufacturerStatus === "qc_pending";
  const canShip = order.manufacturerStatus === "qc_approved";
  const isShipped = order.manufacturerStatus === "shipped";
  const canCancel = [
    "accepted",
    "printing",
    "printed",
    "qc_pending",
    "qc_rejected",
    "qc_approved",
  ].includes(order.manufacturerStatus || "");

  const addr = order.shippingAddress;

  // Timeline
  // qc_rejected / qc_approved both render at the QC step on the timeline.
  const timelineStatus =
    order.manufacturerStatus === "qc_rejected" ||
    order.manufacturerStatus === "qc_approved"
      ? "qc_pending"
      : order.manufacturerStatus || "";
  const currentStepIndex = TIMELINE_STEPS.indexOf(timelineStatus);

  const copyAddress = () => {
    if (!addr) return;
    const parts = [
      order.customerName,
      addr.adres,
      addr.mahalle,
      `${addr.ilce}, ${addr.il}`,
      addr.postaKodu,
      addr.telefon,
    ].filter(Boolean);
    navigator.clipboard.writeText(parts.join("\n"));
    setAddressCopied(true);
    setTimeout(() => setAddressCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* ─── Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
        <div className="space-y-2">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/manufacturer/orders"
              className="text-gray-400 hover:text-indigo-600 transition-colors"
            >
              {(d["manufacturer.orderDetail.orders" as keyof typeof d] as string) ||
                "Orders"}
            </Link>
            <svg className="w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-600 font-medium">{order.orderNumber}</span>
          </div>
          {/* Order number + badge */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-3xl font-bold text-gray-900 font-mono tracking-tight">
              {order.orderNumber}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                MFR_STATUS_COLORS[order.manufacturerStatus || ""] ||
                "bg-gray-100 text-gray-700"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d={STATUS_ICONS[order.manufacturerStatus || ""] || "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"}
                />
              </svg>
              {(d[
                `manufacturer.status.${order.manufacturerStatus}` as keyof typeof d
              ] as string) ||
                order.manufacturerStatus?.replace(/_/g, " ") ||
                "-"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {glbUrl && (
            <a
              href={`/api/manufacturer/orders/${order.id}/download-glb`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-full text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition-all hover:shadow-md hover:shadow-indigo-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {(d["manufacturer.orderDetail.downloadGlb" as keyof typeof d] as string) ||
                "Download GLB"}
            </a>
          )}
          {stlUrl && (
            <a
              href={`/api/manufacturer/orders/${order.id}/download-stl`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-full text-sm font-semibold text-white shadow-sm shadow-emerald-200 transition-all hover:shadow-md hover:shadow-emerald-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {(d["manufacturer.orderDetail.downloadStl" as keyof typeof d] as string) ||
                "Download STL"}
            </a>
          )}
          {objUrl && (
            <a
              href={`/api/manufacturer/orders/${order.id}/download-obj`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-600 hover:bg-slate-700 rounded-full text-sm font-semibold text-white shadow-sm shadow-slate-200 transition-all hover:shadow-md hover:shadow-slate-200"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              {(d["manufacturer.orderDetail.downloadObj" as keyof typeof d] as string) ||
                "Download OBJ"}
            </a>
          )}
          {order.orderType === "upload" && (
            <a
              href={`/api/manufacturer/orders/${order.id}/download-upload`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 rounded-full text-sm font-semibold text-white shadow-sm shadow-emerald-200 transition-all hover:shadow-md hover:shadow-emerald-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Modeli indir
            </a>
          )}
        </div>
      </div>

      {/* ─── Horizontal Timeline Stepper ──────────────────── */}
      <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5 mb-5">
        <div className="flex items-center justify-between relative">
          {/* Background line */}
          <div className="absolute top-5 left-[10%] right-[10%] h-0.5 bg-gray-200" />
          {/* Filled gradient line */}
          {currentStepIndex > 0 && (
            <div
              className="absolute top-5 left-[10%] h-0.5 bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all duration-500"
              style={{
                width: `${(currentStepIndex / (TIMELINE_STEPS.length - 1)) * 80}%`,
              }}
            />
          )}
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i < currentStepIndex;
            const isCurrent = i === currentStepIndex;
            const stepIcon = STEP_ICONS[step];
            return (
              <div key={step} className="flex flex-col items-center relative z-10 flex-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isCurrent
                      ? "bg-indigo-600 text-white ring-[3px] ring-indigo-200 shadow-lg shadow-indigo-200"
                      : isCompleted
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-400 border-2 border-gray-200"
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isCurrent ? 2 : 1.5} d={stepIcon.d} />
                    </svg>
                  )}
                </div>
                <span
                  className={`text-[11px] mt-2 text-center leading-tight ${
                    isCurrent
                      ? "font-bold text-indigo-700"
                      : isCompleted
                        ? "font-medium text-indigo-600"
                        : "font-medium text-gray-400"
                  }`}
                >
                  {(d[
                    `manufacturer.status.${step}` as keyof typeof d
                  ] as string) ||
                    step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Main Content ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column (2/3) */}
        <div className="lg:col-span-2 space-y-5">
          {/* ─── Marketplace product card ──────────────── */}
          {isMarketplace && marketplaceProduct && (
            <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {(d["manufacturer.orderDetail.marketplaceBadge" as keyof typeof d] as string) ||
                    "Pazaryeri ürünü"}
                </span>
                {order.quantity > 1 && (
                  <span className="text-xs font-medium text-gray-500">
                    × {order.quantity}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                {marketplaceProduct.title}
              </h3>
              {marketplaceProduct.images.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                  {marketplaceProduct.images.map((url) => (
                    <img
                      key={url}
                      src={url}
                      alt={marketplaceProduct.title}
                      className="w-full h-40 object-cover rounded-xl border border-gray-100"
                    />
                  ))}
                </div>
              )}
              <p className="mt-3 text-sm text-gray-600 whitespace-pre-line">
                {marketplaceProduct.description}
              </p>
              <p className="mt-3 text-xs text-gray-500">
                {(d["manufacturer.orderDetail.marketplaceHint" as keyof typeof d] as string) ||
                  "Listelediğiniz ürünü basıp kargolayın."}
              </p>
            </div>
          )}

          {/* ─── Production files + BOM + recipe (one panel per product) ── */}
          {isMarketplace &&
            productSpecs.map((ps) => (
              <div key={ps.productId} className="space-y-3">
                {(ps.selectedOptions.length > 0 ||
                  ps.selectedAddons.length > 0 ||
                  ps.itemImageUrl) && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-900">
                      Müşteri seçimleri
                    </p>
                    <div className="mt-2 flex gap-4">
                      {ps.itemImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={ps.itemImageUrl}
                          alt=""
                          className="h-24 w-24 shrink-0 rounded-lg border border-amber-200 object-cover"
                        />
                      )}
                      <ul className="space-y-1 text-sm text-amber-900">
                        {ps.selectedOptions.map((o, i) => (
                          <li key={`o${i}`}>
                            <span className="text-amber-700">{o.groupName}:</span>{" "}
                            <span className="font-medium">{o.choiceName}</span>
                          </li>
                        ))}
                        {ps.selectedAddons.map((a, i) => (
                          <li key={`a${i}`}>
                            + <span className="font-medium">{a.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                <ProductionPanel
                  orderId={order.id}
                  title={
                    productSpecs.length > 1 || !marketplaceProduct
                      ? ps.title
                      : undefined
                  }
                  quantity={ps.quantity}
                  files={ps.files}
                  components={ps.components}
                  steps={ps.steps}
                />
              </div>
            ))}

          {/* ─── Photo + Model Hero Card (Tabbed) ──────── */}
          {!isMarketplace && (photos.length > 0 || glbUrl) && (
            <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
              {/* Tab pills */}
              <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
                {photos.length > 0 && (
                  <button
                    onClick={() => setActiveTab("photo")}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeTab === "photo"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {(d["manufacturer.orderDetail.customerPhoto" as keyof typeof d] as string) || "Photo"}
                    </span>
                  </button>
                )}
                {glbUrl && (
                  <button
                    onClick={() => setActiveTab("model")}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      activeTab === "model"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      {(d["manufacturer.orderDetail.model3d" as keyof typeof d] as string) || "3D Model"}
                    </span>
                  </button>
                )}
              </div>

              {/* Photo tab content */}
              {activeTab === "photo" && photos.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {photos.map((photo) => (
                    <img
                      key={photo.id}
                      src={photo.originalUrl}
                      alt="Customer photo"
                      className="w-full h-72 object-cover rounded-xl border border-gray-100"
                    />
                  ))}
                </div>
              )}

              {/* Model tab content */}
              {activeTab === "model" && glbUrl && (
                <ModelViewer url={glbUrl} className="w-full h-80 rounded-xl" />
              )}
            </div>
          )}

          {/* ─── Contextual Action Card ────────────────── */}
          {canAccept && (
            <div className="rounded-2xl shadow-sm border border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100/50 p-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-indigo-900 mb-1">
                  {(d["manufacturer.orderDetail.newOrderAssigned" as keyof typeof d] as string) ||
                    "New Order Assigned"}
                </h3>
                <p className="text-sm text-indigo-700/70 mb-6 max-w-sm">
                  {(d["manufacturer.orderDetail.acceptDescription" as keyof typeof d] as string) ||
                    "Review the order details and accept to begin manufacturing."}
                </p>
                {error && (
                  <div className="mb-4 w-full bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                )}
                <button
                  onClick={() => performAction("accept")}
                  disabled={loading === "accept"}
                  className="w-full max-w-xs px-6 py-3.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:bg-indigo-400 transition-all shadow-sm shadow-indigo-200 hover:shadow-md hover:shadow-indigo-200 flex items-center justify-center gap-2"
                >
                  {loading === "accept" && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {loading === "accept"
                    ? (d["manufacturer.orderDetail.processing" as keyof typeof d] as string) ||
                      "Processing..."
                    : (d["manufacturer.orderDetail.acceptOrder" as keyof typeof d] as string) ||
                      "Accept Order"}
                </button>

                {/* N12: decline path. Reveals a small textarea + confirm
                    button so a misclick can't accidentally storm-reassign. */}
                <DeclineBlock
                  loading={loading === "decline"}
                  onDecline={(reason) =>
                    performAction("decline", reason ? { reason } : {})
                  }
                  d={d}
                />
              </div>
            </div>
          )}

          {canStartPrinting && (
            <div className="rounded-2xl shadow-sm border border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100/50 p-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-purple-100 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-purple-900 mb-1">
                  {(d["manufacturer.orderDetail.readyToPrint" as keyof typeof d] as string) ||
                    "Ready to Print"}
                </h3>
                <p className="text-sm text-purple-700/70 mb-6 max-w-sm">
                  {(d["manufacturer.orderDetail.printDescription" as keyof typeof d] as string) ||
                    "Start the 3D printing process for this figurine."}
                </p>
                {error && (
                  <div className="mb-4 w-full bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                )}
                <button
                  onClick={() => performAction("start-printing")}
                  disabled={loading === "start-printing"}
                  className="w-full max-w-xs px-6 py-3.5 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 disabled:bg-purple-400 transition-all shadow-sm shadow-purple-200 hover:shadow-md hover:shadow-purple-200 flex items-center justify-center gap-2"
                >
                  {loading === "start-printing" && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {loading === "start-printing"
                    ? (d["manufacturer.orderDetail.processing" as keyof typeof d] as string) ||
                      "Processing..."
                    : (d["manufacturer.orderDetail.startPrinting" as keyof typeof d] as string) ||
                      "Start Printing"}
                </button>
              </div>
            </div>
          )}

          {canFinishPrinting && (
            <div className="rounded-2xl shadow-sm border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/50 p-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-amber-900 mb-1">
                  {(d["manufacturer.orderDetail.printingInProgress" as keyof typeof d] as string) ||
                    "Printing in Progress"}
                </h3>
                <p className="text-sm text-amber-700/70 mb-6 max-w-sm">
                  {(d["manufacturer.orderDetail.printedDescription" as keyof typeof d] as string) ||
                    "Mark as printed once the figurine is complete."}
                </p>
                {error && (
                  <div className="mb-4 w-full bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                )}
                <button
                  onClick={() => performAction("finish-printing")}
                  disabled={loading === "finish-printing"}
                  className="w-full max-w-xs px-6 py-3.5 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 disabled:bg-amber-400 transition-all shadow-sm shadow-amber-200 hover:shadow-md hover:shadow-amber-200 flex items-center justify-center gap-2"
                >
                  {loading === "finish-printing" && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {loading === "finish-printing"
                    ? (d["manufacturer.orderDetail.processing" as keyof typeof d] as string) ||
                      "Processing..."
                    : (d["manufacturer.orderDetail.markPrinted" as keyof typeof d] as string) ||
                      "Mark as Printed"}
                </button>
              </div>
            </div>
          )}

          {canSubmitQc && (
            <div className="rounded-2xl shadow-sm border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/50 p-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-amber-900 mb-1">
                  {order.manufacturerStatus === "qc_rejected"
                    ? d["manufacturer.orderDetail.qcRejectedTitle"]
                    : d["manufacturer.orderDetail.qcTitle"]}
                </h3>
                <p className="text-sm text-amber-700/70 mb-4 max-w-sm">
                  {order.manufacturerStatus === "qc_rejected"
                    ? d["manufacturer.orderDetail.qcRejectedDescription"]
                    : d["manufacturer.orderDetail.qcDescription"]}
                </p>

                {order.manufacturerStatus === "qc_rejected" && qcRejectReason && (
                  <div className="mb-4 w-full max-w-sm bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm text-left">
                    <span className="font-semibold">
                      {d["manufacturer.orderDetail.qcRejectedReason"]}:
                    </span>{" "}
                    {qcRejectReason}
                  </div>
                )}

                {error && (
                  <div className="mb-4 w-full max-w-sm bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                    {error}
                  </div>
                )}

                <div className="w-full max-w-sm">
                  <QcPhotoUploader
                    orderId={order.id}
                    initialPhotos={qcPhotos}
                    onCountChange={setQcPhotoCount}
                  />
                  <button
                    onClick={() => performAction("submit-qc")}
                    disabled={loading === "submit-qc" || qcPhotoCount < 1}
                    className="mt-3 w-full px-6 py-3.5 bg-amber-600 text-white font-semibold rounded-xl hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                  >
                    {loading === "submit-qc" && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {loading === "submit-qc"
                      ? d["manufacturer.orderDetail.qcSubmitting"]
                      : d["manufacturer.orderDetail.qcSubmit"]}
                  </button>
                  {qcPhotoCount < 1 && (
                    <p className="text-xs text-amber-700/60 mt-2">
                      {d["manufacturer.orderDetail.qcNeedPhoto"]}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {isQcPending && (
            <div className="rounded-2xl shadow-sm border border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/30 p-5">
              <div className="flex flex-col items-center text-center py-6">
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-amber-900 mb-1">
                  {d["manufacturer.orderDetail.qcPendingTitle"]}
                </h3>
                <p className="text-sm text-amber-700/70 mb-4 max-w-sm">
                  {d["manufacturer.orderDetail.qcPendingDescription"]}
                </p>
                {qcPhotos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 w-full max-w-sm">
                    {qcPhotos.map((p) => (
                      <img
                        key={p.id}
                        src={p.url}
                        alt=""
                        className="w-full h-20 object-cover rounded-lg border border-amber-200"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Painting orders: hand off to a painter instead of shipping. */}
          {canShip &&
            order.needsPainting &&
            (!order.painterStatus || order.painterStatus === "unassigned") && (
              <SendToPainterPanel orderId={order.id} />
            )}

          {order.needsPainting &&
            order.painterStatus &&
            order.painterStatus !== "unassigned" && (
              <div className="rounded-2xl border border-purple-200 bg-purple-50/50 p-5 text-sm text-purple-900">
                Bu sipariş boyacıya gönderildi (durum:{" "}
                <span className="font-medium">{order.painterStatus}</span>). Boyacı
                boyayıp müşteriye kargolayacak.
              </div>
            )}

          {canShip && !order.needsPainting && (
            <div className="rounded-2xl shadow-sm border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 p-5">
              <div className="flex flex-col items-center text-center py-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-emerald-900 mb-1">
                  {(d["manufacturer.orderDetail.readyToShip" as keyof typeof d] as string) ||
                    "Ready to Ship"}
                </h3>
                <p className="text-sm text-emerald-700/70 mb-5 max-w-sm">
                  {(d["manufacturer.orderDetail.shipDescription" as keyof typeof d] as string) ||
                    "Enter the tracking number and ship to customer."}
                </p>
                {error && (
                  <div className="mb-4 w-full bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {error}
                  </div>
                )}
                <div className="w-full max-w-sm space-y-3">
                  <select
                    value={shipCarrier}
                    onChange={(e) => setShipCarrier(e.target.value)}
                    className="w-full px-4 py-3 border border-emerald-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {["yurtici", "aras", "mng", "ptt", "surat", "other"].map((c) => (
                      <option key={c} value={c}>
                        {d[`carrier.${c}` as keyof typeof d] as string}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder={
                      (d["manufacturer.orderDetail.trackingPlaceholder" as keyof typeof d] as string) ||
                      "Enter tracking number"
                    }
                    className="w-full px-4 py-3 border border-emerald-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent placeholder:text-emerald-400/60"
                  />
                  <button
                    onClick={() =>
                      performAction("ship", { trackingNumber, carrier: shipCarrier })
                    }
                    disabled={
                      loading === "ship" || !trackingNumber.trim()
                    }
                    className="w-full px-6 py-3.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed transition-all shadow-sm shadow-emerald-200 hover:shadow-md hover:shadow-emerald-200 flex items-center justify-center gap-2"
                  >
                    {loading === "ship" && (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {loading === "ship"
                      ? (d["manufacturer.orderDetail.processing" as keyof typeof d] as string) ||
                        "Processing..."
                      : (d["manufacturer.orderDetail.shipOrder" as keyof typeof d] as string) ||
                        "Ship Order"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isShipped && (
            <div className="rounded-2xl shadow-sm border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/30 p-5">
              <div className="flex flex-col items-center text-center py-6">
                <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-emerald-900 mb-1">
                  {(d["manufacturer.orderDetail.orderShipped" as keyof typeof d] as string) ||
                    "Order Shipped!"}
                </h3>
                {order.trackingNumber && (
                  <div className="mt-3 px-4 py-2 bg-white rounded-lg border border-emerald-200">
                    <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">
                      {(d["manufacturer.orderDetail.trackingLabel" as keyof typeof d] as string) || "Tracking"}
                    </span>
                    <p className="text-sm font-mono font-semibold text-emerald-900 mt-0.5">
                      {order.trackingNumber}
                    </p>
                  </div>
                )}
                {order.shippedAt && (
                  <p className="text-xs text-emerald-600 mt-3">
                    {formatDateTime(order.shippedAt, loc)}
                  </p>
                )}
              </div>
            </div>
          )}

          {!canAccept &&
            !canStartPrinting &&
            !canFinishPrinting &&
            !canSubmitQc &&
            !isQcPending &&
            !canShip &&
            !isShipped && (
              <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
                <p className="text-sm text-gray-400 text-center py-4">
                  {(d["manufacturer.orderDetail.noActions" as keyof typeof d] as string) ||
                    "No actions available."}
                </p>
              </div>
            )}
          {/* Chat with admin */}
          <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {d["manufacturer.orderDetail.chatTitle"]}
            </h2>
            <OrderChat basePath={`/api/manufacturer/orders/${order.id}/messages`} orderId={order.id} />
          </div>

          {/* Cancel-after-accept (returns to admin queue; counts as a strike) */}
          {canCancel && (
            <div className="text-center">
              <CancelBlock
                loading={loading === "cancel"}
                onCancel={(reason) => performAction("cancel", reason ? { reason } : {})}
                d={d}
              />
            </div>
          )}
        </div>

        {/* ─── Right Sidebar (1/3) ────────────────────── */}
        <div className="space-y-5">
          {/* Customer special-instructions note (read-only) */}
          {order.customerNote && (
            <div className="rounded-2xl shadow-sm border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                {d["manufacturer.orderDetail.customerNote"]}
              </h2>
              <p className="text-sm text-amber-900 whitespace-pre-wrap">{order.customerNote}</p>
            </div>
          )}
          {/* Order Info Card */}
          <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {(d["manufacturer.orderDetail.orderInfo" as keyof typeof d] as string) ||
                "Order Info"}
            </h2>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-medium text-gray-400">
                  {(d["manufacturer.orderDetail.orderNumber" as keyof typeof d] as string) ||
                    "Order Number"}
                </dt>
                <dd className="text-sm font-mono font-bold text-gray-900 mt-0.5">
                  {order.orderNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-400">
                  {(d["manufacturer.orderDetail.figurineSize" as keyof typeof d] as string) ||
                    "Figurine Size"}
                </dt>
                <dd className="text-sm text-gray-900 mt-0.5 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  {(d[
                    `sizes.${order.figurineSize}` as keyof typeof d
                  ] as string) || order.figurineSize}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-400">
                  {(d["manufacturer.orderDetail.material" as keyof typeof d] as string) ||
                    "Malzeme"}
                </dt>
                <dd className="text-sm font-semibold text-gray-900 mt-0.5 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  {(d[`material.${order.material}` as keyof typeof d] as string) || order.material}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-400">
                  {(d["manufacturer.orderDetail.style" as keyof typeof d] as string) ||
                    "Style"}
                </dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {(d[
                    `create.style.${order.style}` as keyof typeof d
                  ] as string) || order.style}
                </dd>
              </div>
              {order.modifiers && order.modifiers.length > 0 && (
                <div>
                  <dt className="text-xs font-medium text-gray-400 mb-1.5">
                    {(d["manufacturer.orderDetail.modifiers" as keyof typeof d] as string) ||
                      "Modifiers"}
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {order.modifiers.map((mod) => (
                      <span
                        key={mod}
                        className="inline-block px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full"
                      >
                        {(d[
                          `modifiers.${mod}` as keyof typeof d
                        ] as string) || mod}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
              {order.assignedToManufacturerAt && (
                <div>
                  <dt className="text-xs font-medium text-gray-400">
                    {(d["manufacturer.orderDetail.assignedDate" as keyof typeof d] as string) ||
                      "Assigned"}
                  </dt>
                  <dd className="text-sm text-gray-900 mt-0.5">
                    {formatDateTime(order.assignedToManufacturerAt, loc)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Shipping Address Card */}
          {addr && (
            <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {(d["manufacturer.orderDetail.shippingAddress" as keyof typeof d] as string) ||
                    "Shipping Address"}
                </h2>
                <button
                  onClick={copyAddress}
                  className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-indigo-600 transition-colors"
                >
                  {addressCopied ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-emerald-500">
                        {(d["manufacturer.orderDetail.copied" as keyof typeof d] as string) || "Copied"}
                      </span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {(d["manufacturer.orderDetail.copy" as keyof typeof d] as string) || "Copy"}
                    </>
                  )}
                </button>
              </div>
              <div className="text-sm text-gray-600 space-y-1.5">
                <p className="font-semibold text-gray-900 text-base">
                  {order.customerName}
                </p>
                {addr.telefon && (
                  <a href={`tel:${addr.telefon}`} className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {formatPhoneDisplay(addr.telefon)}
                  </a>
                )}
                <div className="pt-1 border-t border-gray-100 mt-2 space-y-0.5">
                  <p>{addr.adres}</p>
                  {addr.mahalle && <p>{addr.mahalle}</p>}
                  <p>{addr.ilce}, {addr.il}</p>
                  <p className="font-medium">{addr.postaKodu}</p>
                </div>
              </div>
            </div>
          )}

          {/* Action History Card */}
          <div className="rounded-2xl shadow-sm border border-gray-100 bg-white p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
              {(d["manufacturer.orderDetail.actionHistory" as keyof typeof d] as string) ||
                "Action History"}
            </h2>
            {actions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                {(d["manufacturer.orderDetail.noHistory" as keyof typeof d] as string) ||
                  "No actions yet."}
              </p>
            ) : (
              <div className="relative">
                {actions.map((action, i) => (
                  <div key={action.id} className="flex gap-3 relative">
                    {/* Dot + line */}
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${
                          ACTION_DOT_COLORS[action.action] || "bg-gray-400"
                        }`}
                      />
                      {i < actions.length - 1 && (
                        <div className="w-px flex-1 bg-gray-200 my-1" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="pb-4 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight">
                        {(d[
                          `manufacturer.action.${action.action}` as keyof typeof d
                        ] as string) ||
                          action.action.replace(/_/g, " ")}
                      </p>
                      {action.notes && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {action.notes}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {formatDateTime(action.createdAt, loc)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// N12: collapsible decline block. Two-step UX (link → form) means the
// destructive action can't be triggered by a single misclick. The textarea
// is optional; the reason is logged on the manufacturer_actions row so
// admins can audit decline patterns later.
function DeclineBlock({
  loading,
  onDecline,
  d,
}: {
  loading: boolean;
  onDecline: (reason: string) => void;
  d: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-text-muted hover:text-red-600 transition-colors"
      >
        {d["manufacturer.orderDetail.declineLink"] ||
          "Sipariş için uygun değilim — reddet"}
      </button>
    );
  }
  return (
    <div className="mt-4 w-full max-w-xs bg-white border border-red-200 rounded-xl p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={
          d["manufacturer.orderDetail.declineReasonPlaceholder"] ||
          "Sebebiniz (opsiyonel)…"
        }
        rows={2}
        maxLength={500}
        className="w-full text-sm bg-bg-base border border-bg-subtle rounded-lg p-2 mb-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className="flex-1 px-3 py-1.5 text-xs text-text-secondary border border-bg-subtle rounded-lg hover:bg-bg-elevated"
          disabled={loading}
        >
          {d["common.cancel"] || "Cancel"}
        </button>
        <button
          type="button"
          onClick={() => onDecline(reason.trim())}
          disabled={loading}
          className="flex-1 px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:bg-red-400"
        >
          {loading
            ? d["manufacturer.orderDetail.processing"] || "…"
            : d["manufacturer.orderDetail.confirmDecline"] || "Reddet"}
        </button>
      </div>
    </div>
  );
}

// Cancel-after-accept block. Two-step (link → confirm) so a misclick can't drop
// an in-progress order back to the admin queue.
function CancelBlock({
  loading,
  onCancel,
  d,
}: {
  loading: boolean;
  onCancel: (reason: string) => void;
  d: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-red-600 transition-colors"
      >
        {d["manufacturer.orderDetail.cancelLink"]}
      </button>
    );
  }
  return (
    <div className="mt-2 w-full max-w-sm mx-auto bg-white border border-red-200 rounded-xl p-3 text-left">
      <p className="text-xs text-red-700 mb-2">
        {d["manufacturer.orderDetail.cancelConfirm"]}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={d["manufacturer.orderDetail.cancelReason"]}
        rows={2}
        maxLength={500}
        className="w-full text-sm bg-gray-50 border border-gray-200 rounded-lg p-2 mb-2"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
          className="flex-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          disabled={loading}
        >
          {d["common.cancel"] || "Vazgeç"}
        </button>
        <button
          type="button"
          onClick={() => onCancel(reason.trim())}
          disabled={loading}
          className="flex-1 px-3 py-1.5 text-xs text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:bg-red-400"
        >
          {loading
            ? d["manufacturer.orderDetail.processing"] || "…"
            : d["manufacturer.orderDetail.cancel"]}
        </button>
      </div>
    </div>
  );
}
