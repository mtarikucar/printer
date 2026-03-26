"use client";

import { useEffect, useState, use } from "react";
import { OrderStatusTracker } from "@/components/order-status-tracker";
import { ModelViewer } from "@/components/model-viewer";
import { PublishToggle } from "@/components/publish-toggle";
import { SiteHeader } from "@/components/site-header";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";

function ReorderButton({ orderNumber: on }: { orderNumber: string }) {
  const d = useDictionary();
  const [loading, setLoading] = useState(false);

  const handleReorder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customer/orders/${on}/reorder`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || d["common.error"]);
        return;
      }
      const data = await res.json();
      if (data.whatsappUrl) {
        // Use location.href instead of window.open to avoid popup blockers on mobile
        window.location.href = data.whatsappUrl;
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
}

export default function TrackPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = use(params);
  const d = useDictionary();
  const locale = useLocale();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
