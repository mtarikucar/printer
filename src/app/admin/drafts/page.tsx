export const dynamic = "force-dynamic";

import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts } from "@/lib/db/schema";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Beklemede", cls: "bg-amber-100 text-amber-700" },
  awaiting_review: { label: "İnceleme bekliyor", cls: "bg-orange-100 text-orange-700" },
  confirmed: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-700" },
  expired: { label: "Süresi doldu", cls: "bg-gray-100 text-gray-600" },
  failed: { label: "Başarısız", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "İptal", cls: "bg-gray-100 text-gray-600" },
};

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: "Yüksek", cls: "bg-emerald-100 text-emerald-700" },
  medium: { label: "Orta", cls: "bg-amber-100 text-amber-700" },
  low: { label: "Düşük", cls: "bg-red-100 text-red-700" },
};

function formatKurus(kurus: number): string {
  return `₺${(kurus / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function AdminDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.status ?? "review";

  const statusSet =
    filter === "review"
      ? ["awaiting_review", "pending"]
      : filter === "all"
      ? ["pending", "awaiting_review", "confirmed", "expired", "failed", "cancelled"]
      : [filter];

  const drafts = await db.query.orderDrafts.findMany({
    where: inArray(
      orderDrafts.status,
      statusSet as ("pending" | "awaiting_review" | "confirmed" | "expired" | "failed" | "cancelled")[]
    ),
    orderBy: [desc(orderDrafts.updatedAt)],
    limit: 100,
  });

  // Only havale drafts make sense in the review tab.
  const visible = filter === "review"
    ? drafts.filter((d) => d.paymentMethod === "bank_transfer" && d.bankTransferReceiptKey)
    : drafts;

  const tabs: { key: string; label: string }[] = [
    { key: "review", label: "Manuel inceleme" },
    { key: "pending", label: "Beklemede" },
    { key: "confirmed", label: "Onaylanmış" },
    { key: "expired", label: "Süresi dolan" },
    { key: "failed", label: "Başarısız" },
    { key: "all", label: "Tümü" },
  ];

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Ödeme Taslakları</h1>
        <p className="text-sm text-gray-500 mt-1">
          Henüz ödemesi tamamlanmamış sipariş niyetleri. Havale dekontlarının manuel kontrolü için kullanın.
        </p>
      </div>

      <div className="flex gap-2 mb-4 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/admin/drafts?status=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              filter === t.key
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-500">
          Bu filtrede taslak yok.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-3">Ref.</th>
                <th className="text-left px-4 py-3">Müşteri</th>
                <th className="text-left px-4 py-3">Yöntem</th>
                <th className="text-left px-4 py-3">Tutar</th>
                <th className="text-left px-4 py-3">Durum</th>
                <th className="text-left px-4 py-3">OCR</th>
                <th className="text-left px-4 py-3">Yüklendi</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((d) => {
                const status = STATUS_BADGE[d.status] ?? { label: d.status, cls: "bg-gray-100" };
                const confidence = d.receiptOcrConfidence
                  ? CONFIDENCE_BADGE[d.receiptOcrConfidence]
                  : null;
                const finalAmount = d.amountKurus - d.giftCardAmountKurus - d.havaleDiscountKurus;
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{d.reference}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{d.customerName}</div>
                      <div className="text-xs text-gray-500">{d.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {d.paymentMethod === "card" ? "Kart" : d.paymentMethod === "bank_transfer" ? "Havale" : "Hediye Kartı"}
                    </td>
                    <td className="px-4 py-3 font-medium">{formatKurus(finalAmount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.cls}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {confidence ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${confidence.cls}`}>
                          {confidence.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {d.bankTransferReceiptUploadedAt
                        ? new Date(d.bankTransferReceiptUploadedAt).toLocaleString("tr-TR")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/drafts/${d.id}`}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                      >
                        İncele →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
