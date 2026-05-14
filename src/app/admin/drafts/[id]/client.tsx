"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface DraftView {
  id: string;
  reference: string;
  status: string;
  paymentMethod: string;
  customerName: string;
  email: string;
  phone: string | null;
  amountKurus: number;
  giftCardAmountKurus: number;
  havaleDiscountKurus: number;
  finalAmountKurus: number;
  bankTransferDeadline: string | null;
  bankTransferReceiptUploadedAt: string | null;
  hasReceipt: boolean;
  receiptOcrConfidence: "high" | "medium" | "low" | null;
  receiptOcrParsed: {
    amountKurus?: number;
    iban?: string;
    sender?: string;
    referenceFound?: boolean;
    date?: string;
  } | null;
  receiptOcrText: string | null;
  receiptOcrFailureReason: string | null;
  paytrFailureReason: string | null;
  promotedOrderId: string | null;
  createdAt: string;
}

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function DraftReviewClient({ draft }: { draft: DraftView }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const isHavale = draft.paymentMethod === "bank_transfer";
  const canMarkPaid =
    isHavale && (draft.status === "pending" || draft.status === "awaiting_review");
  const canExpire = draft.status === "pending" || draft.status === "awaiting_review";

  const markPaid = async () => {
    if (!confirm("Bu havale ödemesini onaylıyor musunuz? Sipariş hemen üretime alınacak.")) return;
    setError(null);
    setLoading("mark-paid");
    try {
      const res = await fetch(`/api/admin/orders/${draft.id}/mark-havale-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "İşlem başarısız");
        return;
      }
      router.push(`/admin/orders/${data.orderId}`);
    } catch {
      setError("Bir hata oluştu");
    } finally {
      setLoading(null);
    }
  };

  const expire = async () => {
    if (!confirm("Bu taslağı süresi dolmuş olarak işaretliyor musunuz? Hediye kartı varsa iade edilir.")) return;
    setError(null);
    setLoading("expire");
    try {
      const res = await fetch(`/api/admin/drafts/${draft.id}/expire`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "İşlem başarısız");
        return;
      }
      router.push("/admin/drafts");
    } catch {
      setError("Bir hata oluştu");
    } finally {
      setLoading(null);
    }
  };

  const parsed = draft.receiptOcrParsed;
  const confColor =
    draft.receiptOcrConfidence === "high"
      ? "bg-emerald-100 text-emerald-700"
      : draft.receiptOcrConfidence === "medium"
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/admin/drafts" className="text-sm text-indigo-600 hover:underline">
            ← Taslaklar
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">
            Taslak <span className="font-mono">{draft.reference}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date(draft.createdAt).toLocaleString("tr-TR")} · {draft.paymentMethod}
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
          {draft.status}
        </span>
      </div>

      {draft.promotedOrderId && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
          Bu taslak{" "}
          <Link
            href={`/admin/orders/${draft.promotedOrderId}`}
            className="underline font-medium"
          >
            siparişe dönüştürüldü
          </Link>
          .
        </div>
      )}

      {(draft.paytrFailureReason || draft.receiptOcrFailureReason) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-900 space-y-1">
          {draft.paytrFailureReason && <p>PayTR: {draft.paytrFailureReason}</p>}
          {draft.receiptOcrFailureReason && <p>OCR: {draft.receiptOcrFailureReason}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">
            Müşteri
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Ad</dt><dd className="text-gray-900">{draft.customerName}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">E-posta</dt><dd className="text-gray-900">{draft.email}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Telefon</dt><dd className="text-gray-900">{draft.phone ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">
            Tutar
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Sipariş</dt><dd className="text-gray-900">{formatKurus(draft.amountKurus)}</dd></div>
            {draft.giftCardAmountKurus > 0 && (
              <div className="flex justify-between"><dt className="text-gray-500">Hediye kartı</dt><dd className="text-emerald-700">-{formatKurus(draft.giftCardAmountKurus)}</dd></div>
            )}
            {draft.havaleDiscountKurus > 0 && (
              <div className="flex justify-between"><dt className="text-gray-500">Havale indirimi</dt><dd className="text-amber-700">-{formatKurus(draft.havaleDiscountKurus)}</dd></div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-100">
              <dt className="text-gray-700 font-medium">Bekleyen</dt>
              <dd className="text-gray-900 font-semibold">{formatKurus(draft.finalAmountKurus)}</dd>
            </div>
            {draft.bankTransferDeadline && (
              <div className="flex justify-between text-xs">
                <dt className="text-gray-500">Son tarih</dt>
                <dd className="text-gray-700">{new Date(draft.bankTransferDeadline).toLocaleString("tr-TR")}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      {isHavale && draft.hasReceipt && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dekont</h2>
            {draft.receiptOcrConfidence && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${confColor}`}>
                OCR: {draft.receiptOcrConfidence}
              </span>
            )}
          </div>
          <a
            href={`/api/admin/orders/${draft.id}/receipt`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline"
          >
            Dekontu görüntüle →
          </a>
          {draft.bankTransferReceiptUploadedAt && (
            <p className="text-xs text-gray-500 mt-1">
              Yüklendi: {new Date(draft.bankTransferReceiptUploadedAt).toLocaleString("tr-TR")}
            </p>
          )}
          {parsed && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Algılanan tutar</dt>
                <dd className="text-gray-900 font-medium">
                  {parsed.amountKurus !== undefined ? formatKurus(parsed.amountKurus) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Beklenen tutar</dt>
                <dd className="text-gray-900 font-medium">{formatKurus(draft.finalAmountKurus)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Referans bulundu</dt>
                <dd className={parsed.referenceFound ? "text-emerald-700" : "text-red-700"}>
                  {parsed.referenceFound ? "Evet" : "Hayır"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">IBAN</dt>
                <dd className="text-gray-900 font-mono text-xs">{parsed.iban ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Gönderen</dt>
                <dd className="text-gray-900">{parsed.sender ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Tarih</dt>
                <dd className="text-gray-900">{parsed.date ?? "—"}</dd>
              </div>
            </dl>
          )}
          {draft.receiptOcrText && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                Ham OCR metni
              </summary>
              <pre className="mt-2 text-[11px] bg-gray-50 p-3 rounded whitespace-pre-wrap">
                {draft.receiptOcrText}
              </pre>
            </details>
          )}
        </section>
      )}

      {(canMarkPaid || canExpire) && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-4">
            İşlem
          </h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Not (opsiyonel)"
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm mb-3"
          />
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-xl p-3 mb-3">{error}</div>
          )}
          <div className="flex gap-2">
            {canMarkPaid && (
              <button
                onClick={markPaid}
                disabled={loading !== null}
                className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:bg-gray-300"
              >
                {loading === "mark-paid" ? "Onaylanıyor..." : "Havaleyi onayla → sipariş oluştur"}
              </button>
            )}
            {canExpire && (
              <button
                onClick={expire}
                disabled={loading !== null}
                className="px-5 py-2 bg-red-100 text-red-700 rounded-xl text-sm font-semibold hover:bg-red-200 disabled:bg-gray-100"
              >
                {loading === "expire" ? "İşleniyor..." : "Süresi dolmuş işaretle"}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
