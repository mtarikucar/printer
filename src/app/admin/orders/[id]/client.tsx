"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ModelViewer } from "@/components/model-viewer";
import { useDictionary } from "@/lib/i18n/locale-context";

export function OrderDetailClient({
  glbUrl,
  stlUrl,
  orderId,
  orderStatus,
}: {
  glbUrl?: string | null;
  stlUrl?: string | null;
  orderId: string;
  orderStatus: string;
}) {
  const router = useRouter();
  const d = useDictionary();
  const [loading, setLoading] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [notes, setNotes] = useState("");

  const performAction = async (
    action: string,
    body: Record<string, any> = {}
  ) => {
    setLoading(action);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/${action}`, {
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

  const canConfirm = orderStatus === "pending_payment";
  const canApprove = orderStatus === "review";
  const canReject = ["review", "approved", "failed_generation", "failed_mesh"].includes(orderStatus);
  const canRegenerate = ["review", "failed_generation", "failed_mesh"].includes(orderStatus);
  const canShip = orderStatus === "printing";

  return (
    <div>
      {glbUrl && (
        <ModelViewer url={glbUrl} className="w-full h-80 bg-gray-900 rounded-lg" />
      )}

      {stlUrl && (
        <a
          href={stlUrl}
          download
          className="mt-3 inline-block text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          {d["admin.orderDetail.downloadStl"]}
        </a>
      )}

      {/* Admin Actions */}
      {(canConfirm || canApprove || canReject || canRegenerate || canShip) && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {d["admin.orderDetail.adminNote"]}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
              placeholder={d["admin.orderDetail.addNote"]}
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            {canConfirm && (
              <button
                onClick={() => performAction("confirm")}
                disabled={!!loading}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                {loading === "confirm" ? d["admin.orderDetail.confirming"] : d["admin.orderDetail.confirm"]}
              </button>
            )}
            {canApprove && (
              <button
                onClick={() => performAction("approve")}
                disabled={!!loading}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                {loading === "approve" ? d["admin.orderDetail.approving"] : d["admin.orderDetail.approve"]}
              </button>
            )}
            {canRegenerate && (
              <button
                onClick={() => performAction("regenerate")}
                disabled={!!loading}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading === "regenerate" ? d["admin.orderDetail.regenerating"] : d["admin.orderDetail.regenerate"]}
              </button>
            )}
            {canReject && (
              <button
                onClick={() => {
                  if (confirm(d["admin.orderDetail.rejectConfirm"])) {
                    performAction("reject", { reason: notes || d["admin.orderDetail.rejectDefault"] });
                  }
                }}
                disabled={!!loading}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400"
              >
                {loading === "reject" ? d["admin.orderDetail.rejecting"] : d["admin.orderDetail.reject"]}
              </button>
            )}
          </div>

          {canShip && (
            <div className="space-y-3">
              {/* Yurtici Kargo button */}
              <button
                onClick={() => performAction("ship-kargo")}
                disabled={!!loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-gray-400 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
                {loading === "ship-kargo"
                  ? d["admin.orderDetail.kargoCreating"]
                  : d["admin.orderDetail.kargoShip"]}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">{d["admin.orderDetail.orManual"]}</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              {/* Manual tracking input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder={d["admin.orderDetail.trackingPlaceholder"]}
                />
                <button
                  onClick={() => {
                    if (trackingNumber.trim()) {
                      performAction("ship", { trackingNumber: trackingNumber.trim() });
                    }
                  }}
                  disabled={!!loading || !trackingNumber.trim()}
                  className="px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 disabled:bg-gray-400"
                >
                  {loading === "ship" ? d["admin.orderDetail.shipping"] : d["admin.orderDetail.ship"]}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
