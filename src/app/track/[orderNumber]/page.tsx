"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import { OrderStatusTracker } from "@/components/order-status-tracker";
import { ModelViewer } from "@/components/model-viewer";
import { PublishToggle } from "@/components/publish-toggle";
import { SiteHeader } from "@/components/site-header";
import { BankTransferInstructions } from "@/components/bank-transfer-instructions";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";

function ReorderButton({ orderNumber: on }: { orderNumber: string }) {
  const d = useDictionary();
  const [loading, setLoading] = useState(false);

  const handleReorder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer/orders/${on}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: "card" }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || d["common.error"]);
        return;
      }
      const data = await res.json();
      if (data.iframeUrl) {
        window.location.href = data.iframeUrl;
      } else if (data.paymentMethod === "bank_transfer" && data.orderNumber) {
        window.location.href = `/track/${data.orderNumber}?payment=bank_transfer`;
      }
    } catch {
      alert(d["common.error"]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleReorder}
      disabled={loading}
      className="btn-primary text-sm !py-2 !px-6"
    >
      {loading ? d["track.reordering"] : d["track.reorder"]}
    </button>
  );
}

const PUBLISH_ELIGIBLE_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
];

interface BankTransferInfo {
  bank: {
    bankName: string;
    accountHolder: string;
    iban: string;
    branch: string;
  };
  finalAmountKurus: number;
  deadline: string | null;
  receiptUploadedAt: string | null;
  receiptUrl: string | null;
}

interface BankTransferHistory {
  finalAmountKurus: number;
  paidAt: string | null;
  receiptUrl: string | null;
}

interface OrderData {
  orderNumber: string;
  status: string;
  customerName: string;
  trackingNumber: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  createdAt: string;
  isPublic: boolean;
  publicDisplayName: string | null;
  glbUrl: string | null;
  paymentMethod: "card" | "bank_transfer" | "gift_card_full" | null;
  paymentStatus: "pending" | "awaiting_transfer" | "succeeded" | "failed" | "expired";
  failureReason: string | null;
  bankTransfer: BankTransferInfo | null;
  bankTransferHistory: BankTransferHistory | null;
}

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function TrackPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = use(params);
  const d = useDictionary();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const paymentParam = searchParams.get("payment");

  const handleRetryPayment = async () => {
    setRetrying(true);
    try {
      const res = await fetch(
        `/api/customer/orders/${orderNumber}/retry-payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod: "card" }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || d["common.error"]);
        return;
      }
      if (data.iframeUrl) {
        window.location.href = data.iframeUrl;
      }
    } catch {
      alert(d["common.error"]);
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    let isInitialLoad = true;

    async function fetchOrder() {
      try {
        const res = await fetch(`/api/track/${orderNumber}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error(d["track.orderNotFound"]);
          throw new Error(d["track.orderLoadFailed"]);
        }
        setOrder(await res.json());
        setError(null);
      } catch (err: any) {
        // Only show error on initial load; silently ignore transient polling failures
        if (isInitialLoad) {
          setError(err.message);
        }
      } finally {
        if (isInitialLoad) {
          setLoading(false);
          isInitialLoad = false;
        }
      }
    }
    fetchOrder();
    const interval = setInterval(fetchOrder, 30000);
    return () => clearInterval(interval);
  }, [orderNumber, d]);

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />

      <div className="max-w-3xl mx-auto px-4 py-12">
        {loading ? (
          <div className="text-center py-12 animate-fade-in">
            <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-text-secondary">{d["track.loading"]}</p>
          </div>
        ) : error ? (
          <div className="text-center py-12 animate-fade-in-up">
            <div className="w-16 h-16 bg-bg-elevated rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="mt-4 text-2xl font-serif text-text-primary">{d["track.notFound"]}</h1>
            <p className="mt-2 text-text-secondary">{error}</p>
            <a href="/" className="btn-primary mt-6 inline-flex">
              {d["common.backHome"]}
            </a>
          </div>
        ) : order ? (
          <div className="space-y-6 animate-fade-in-up">
            {/* Post-PayTR redirect toast */}
            {paymentParam === "success" && order.paymentStatus !== "succeeded" && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3">
                <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-900">{d["payment.processing"]}</p>
                  <p className="text-blue-700">{d["track.paymentSuccessPending"]}</p>
                </div>
              </div>
            )}
            {paymentParam === "success" && order.paymentStatus === "succeeded" && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-green-600 mt-0.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <p className="text-sm font-medium text-green-900">{d["track.paymentSuccess"]}</p>
              </div>
            )}
            {paymentParam === "failed" && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-600 mt-0.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div className="text-sm flex-1">
                  <p className="font-semibold text-red-900">{d["track.paymentFailed"]}</p>
                  <p className="text-red-700">{d["track.paymentFailedDesc"]}</p>
                </div>
              </div>
            )}

            {/* Order info card */}
            <div className="card p-6 sm:p-8">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h1 className="text-2xl font-serif text-text-primary">
                    {d["track.order"]}{" "}
                    <span className="font-mono text-green-500">{order.orderNumber}</span>
                  </h1>
                  <p className="text-text-secondary mt-1">
                    {d["track.greeting"].replace("{name}", order.customerName)}
                  </p>
                </div>
              </div>
              {order.paidAt && (
                <p className="mt-3 text-sm text-text-muted">
                  {d["track.orderDate"]}{" "}
                  {formatDateLong(order.paidAt, locale)}
                </p>
              )}
            </div>

            {/* Retry payment for failed card orders */}
            {order.status === "pending_payment" &&
              order.paymentMethod === "card" &&
              (order.paymentStatus === "failed" || order.paymentStatus === "pending") && (
                <div className="card p-6 border-l-4 border-amber-500">
                  <h2 className="text-lg font-serif text-text-primary mb-2">
                    {d["track.retryPayment.title"]}
                  </h2>
                  <p className="text-sm text-text-secondary mb-4">
                    {d["track.retryPayment.desc"]}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryPayment}
                    disabled={retrying}
                    className="btn-primary !py-2 !px-6 text-sm"
                  >
                    {retrying ? d["payment.processing"] : d["track.retryPayment.button"]}
                  </button>
                </div>
              )}

            {/* Failure / rejected banner */}
            {(order.status === "rejected" || order.paymentStatus === "expired") &&
              order.failureReason && (
                <div className="card p-6 border-l-4 border-red-500">
                  <h2 className="text-lg font-serif text-text-primary mb-2">
                    {d["track.cancelled.title"]}
                  </h2>
                  <p className="text-sm text-text-secondary">{order.failureReason}</p>
                </div>
              )}

            {/* Bank transfer instructions (awaiting transfer) */}
            {order.bankTransfer && (
              <BankTransferInstructions
                orderNumber={order.orderNumber}
                bank={order.bankTransfer.bank}
                finalAmountKurus={order.bankTransfer.finalAmountKurus}
                deadline={order.bankTransfer.deadline}
                receiptUploadedAt={order.bankTransfer.receiptUploadedAt}
                receiptUrl={order.bankTransfer.receiptUrl}
              />
            )}

            {/* Bank transfer history (after successful payment) */}
            {order.bankTransferHistory && (
              <div className="card p-6">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                    <svg
                      className="w-5 h-5 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-base font-medium text-text-primary">
                      {d["track.bankTransferPaid.title"]}
                    </h2>
                    <p className="text-sm text-text-secondary mt-1">
                      {formatKurus(order.bankTransferHistory.finalAmountKurus)}
                      {order.bankTransferHistory.paidAt
                        ? ` · ${formatDateLong(order.bankTransferHistory.paidAt, locale)}`
                        : ""}
                    </p>
                    {order.bankTransferHistory.receiptUrl && (
                      <a
                        href={order.bankTransferHistory.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-600 hover:text-green-800 underline mt-1 inline-block"
                      >
                        {d["track.bankTransferPaid.viewReceipt"]}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Status tracker card */}
            <div className="card shadow-elevated p-6 sm:p-8">
              <OrderStatusTracker
                status={order.status}
                trackingNumber={order.trackingNumber}
              />
            </div>

            {/* 3D model viewer */}
            {order.glbUrl && (
              <div className="card overflow-hidden">
                <ModelViewer
                  url={order.glbUrl}
                  className="w-full h-72 sm:h-96"
                />
              </div>
            )}

            {/* Reorder button */}
            {order.status !== "pending_payment" && order.status !== "rejected" && (
              <div className="card p-6">
                <h2 className="text-lg font-serif text-text-primary mb-2">{d["track.reorder"]}</h2>
                <p className="text-sm text-text-secondary mb-4">{d["track.reorderDesc"]}</p>
                <ReorderButton orderNumber={order.orderNumber} />
              </div>
            )}

            {/* Publish toggle */}
            {PUBLISH_ELIGIBLE_STATUSES.includes(order.status) && order.glbUrl && (
              <PublishToggle
                orderNumber={order.orderNumber}
                initialIsPublic={order.isPublic}
                initialDisplayName={order.publicDisplayName}
                initialPublishedAt={null}
              />
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
