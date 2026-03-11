"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ModelViewer } from "@/components/model-viewer";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import { DIGITAL_PRICE_KURUS } from "@/lib/config/prices";

interface DigitalOrderData {
  id: string;
  orderNumber: string;
  status: string;
  downloadCount: number;
  glbUrl?: string;
}

export default function DigitalOrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const d = useDictionary();
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<DigitalOrderData | null>(null);
  const [sourceGlbUrl, setSourceGlbUrl] = useState<string | null>(null);
  const [giftCardCode, setGiftCardCode] = useState("");
  const [giftCard, setGiftCard] = useState<{ id: string; balanceKurus: number } | null>(null);
  const [gcError, setGcError] = useState<string | null>(null);
  const [gcApplying, setGcApplying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ orderNumber: string; autoConfirmed: boolean; whatsappUrl?: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        // Try to load as existing digital order
        const res = await fetch("/api/customer/digital-orders");
        if (res.ok) {
          const data = await res.json();
          const found = data.digitalOrders.find((o: any) => o.id === orderId);
          if (found) {
            setOrder(found);
            setLoading(false);
            return;
          }
        }
        // If not found as digital order, it might be a source order ID
        // Load GLB from the source order preview
        const previewRes = await fetch(`/api/customer/previews`);
        if (previewRes.ok) {
          const previewData = await previewRes.json();
          const preview = previewData.previews?.find((p: any) => p.order?.id === orderId);
          if (preview?.glbUrl) {
            setSourceGlbUrl(preview.glbUrl);
          }
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId]);

  const handleApplyGiftCard = async () => {
    if (!giftCardCode.trim()) return;
    setGcApplying(true);
    setGcError(null);

    try {
      const res = await fetch("/api/gift-cards/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: giftCardCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGcError(data.error);
        return;
      }
      setGiftCard({ id: data.card.id, balanceKurus: data.card.balanceKurus });
    } catch {
      setGcError(d["common.error"]);
    } finally {
      setGcApplying(false);
    }
  };

  const handleBuy = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/digital-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceOrderId: orderId,
          giftCardCode: giftCard ? giftCardCode : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(Array.isArray(data.error) ? data.error[0]?.message : data.error);
      }

      const data = await res.json();
      setSuccess({
        orderNumber: data.orderNumber,
        autoConfirmed: data.autoConfirmed || false,
        whatsappUrl: data.whatsappUrl,
      });

      if (data.whatsappUrl) {
        window.open(data.whatsappUrl, "_blank");
      }
    } catch (err: any) {
      setError(err.message || d["common.error"]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async () => {
    if (!order) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/digital-orders/${order.id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${order.orderNumber}.stl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(d["common.error"]);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  // Existing digital order — download page
  if (order) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-2xl mx-auto px-4 py-12">
          <div className="card shadow-elevated overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-green-500 to-beige-400" />
            <div className="p-8 text-center">
              <h1 className="text-2xl font-serif text-text-primary mb-2">{d["digital.title"]}</h1>
              <p className="text-sm text-text-muted mb-1">{order.orderNumber}</p>
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                order.status === "ready"
                  ? "bg-green-100 text-green-700"
                  : "bg-yellow-100 text-yellow-700"
              }`}>
                {d[`digital.status.${order.status}` as keyof typeof d] || order.status}
              </span>

              {order.status === "ready" ? (
                <div className="mt-6">
                  <button onClick={handleDownload} disabled={downloading} className="btn-primary w-full text-lg !py-3.5">
                    {downloading ? d["digital.downloading"] : d["digital.download"]}
                  </button>
                  <p className="text-xs text-text-muted mt-2">{d["digital.downloadCount"]}: {order.downloadCount}</p>
                </div>
              ) : (
                <p className="mt-6 text-text-secondary">{d["digital.notReady"]}</p>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Success screen
  if (success) {
    return (
      <main className="min-h-screen bg-bg-base">
        <SiteHeader />
        <div className="max-w-lg mx-auto px-4 py-20">
          <div className="card shadow-elevated overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-success to-green-500" />
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce-in">
                <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-serif text-text-primary mb-2">{d["digital.success.title"]}</h1>
              <p className="text-text-secondary mb-2">{d["digital.success.message"]}</p>
              <p className="text-sm font-mono text-text-muted mb-6">{success.orderNumber}</p>
              {success.whatsappUrl && (
                <a href={success.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-primary w-full inline-flex items-center justify-center gap-2">
                  {d["digital.success.openWhatsapp"]}
                </a>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Purchase screen — new digital order
  const gcDiscount = giftCard ? Math.min(giftCard.balanceKurus, DIGITAL_PRICE_KURUS) : 0;
  const remaining = DIGITAL_PRICE_KURUS - gcDiscount;
  const fullyCovered = remaining <= 0;

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-serif text-text-primary">{d["digital.title"]}</h1>
          <p className="mt-2 text-text-secondary">{d["digital.subtitle"]}</p>
        </div>

        {sourceGlbUrl && (
          <div className="card shadow-elevated overflow-hidden mb-8">
            <ModelViewer url={sourceGlbUrl} className="w-full h-80" />
          </div>
        )}

        <div className="space-y-6">
          {/* Gift Card */}
          <div className="card shadow-elevated overflow-hidden">
            <div className="p-6">
              <h3 className="text-sm font-medium text-text-secondary mb-3">{d["giftCard.hasCard"]}</h3>
              {giftCard ? (
                <div className="flex items-center justify-between bg-green-50 rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium text-green-700">{d["giftCard.applied"]}</p>
                    <p className="text-xs text-green-600">{d["giftCard.discount"]}: -{formatCurrency(gcDiscount, locale)}</p>
                  </div>
                  <button onClick={() => { setGiftCard(null); setGiftCardCode(""); }} className="text-sm text-red-500 hover:text-red-600">
                    {d["giftCard.remove"]}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={giftCardCode}
                    onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
                    placeholder={d["giftCard.enterCode"]}
                    className="input-base flex-1 font-mono"
                  />
                  <button onClick={handleApplyGiftCard} disabled={gcApplying || !giftCardCode.trim()} className="btn-secondary whitespace-nowrap">
                    {gcApplying ? d["giftCard.applying"] : d["giftCard.apply"]}
                  </button>
                </div>
              )}
              {gcError && <p className="text-sm text-error mt-2">{gcError}</p>}
            </div>
          </div>

          {/* Price Summary */}
          <div className="card shadow-elevated overflow-hidden">
            <div className="p-6">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-text-secondary">{d["digital.price"]}</span>
                <span className="font-mono font-bold text-text-primary">{formatCurrency(DIGITAL_PRICE_KURUS, locale)}</span>
              </div>
              {gcDiscount > 0 && (
                <>
                  <div className="flex justify-between items-center mb-2 text-green-600">
                    <span className="text-sm">{d["giftCard.discount"]}</span>
                    <span className="font-mono font-bold">-{formatCurrency(gcDiscount, locale)}</span>
                  </div>
                  <div className="border-t border-bg-subtle pt-2 flex justify-between items-center">
                    <span className="text-sm font-medium text-text-primary">{d["giftCard.remaining"]}</span>
                    <span className="text-xl font-mono font-bold text-green-500">
                      {fullyCovered ? d["giftCard.fullyCovered"] : formatCurrency(remaining, locale)}
                    </span>
                  </div>
                </>
              )}
              {!gcDiscount && (
                <div className="flex justify-between items-center">
                  <span />
                  <span className="text-2xl font-mono font-bold text-green-500">{formatCurrency(DIGITAL_PRICE_KURUS, locale)}</span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="bg-error-50 border-l-4 border-error-500 rounded-r-xl p-4">
              <p className="text-sm text-error-700">{error}</p>
            </div>
          )}

          <button onClick={handleBuy} disabled={submitting} className="btn-primary w-full text-lg !py-3.5">
            {submitting
              ? d["digital.submitting"]
              : fullyCovered
                ? d["digital.buyButtonDirect"]
                : d["digital.buyButton"]}
          </button>
        </div>
      </div>
    </main>
  );
}
