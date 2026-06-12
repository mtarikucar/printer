"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

export interface AdminProductImage {
  id: string;
  url: string;
  sortOrder: number;
}

export interface AdminProduct {
  id: string;
  slug: string | null;
  ownerType: "seller" | "admin";
  title: string;
  priceKurus: number;
  description: string;
  material: "resin" | "filament" | null;
  category: string | null;
  leadTimeDays: number | null;
  status: "draft" | "pending_review" | "active" | "rejected" | "archived";
  rejectionReason: string | null;
  sellerName: string;
  createdAt: string;
  submittedAt: string | null;
  primaryImageUrl: string | null;
  images: AdminProductImage[];
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  pending_review: "bg-amber-100 text-amber-700",
  active: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-400",
};

export function ProductsClient({
  pending,
  all,
  locale,
}: {
  pending: AdminProduct[];
  all: AdminProduct[];
  locale: string;
}) {
  const d = useDictionary();
  const loc = locale as Locale;
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const statusLabel = (status: string): string => {
    const key = `admin.products.status.${status}` as keyof typeof d;
    const fallback: Record<string, string> = {
      draft: "Taslak",
      pending_review: "Onay bekliyor",
      active: "Yayında",
      rejected: "Reddedildi",
      archived: "Arşivlendi",
    };
    return d[key] || fallback[status] || status;
  };

  const ownerLabel = (ownerType: string): string =>
    ownerType === "admin"
      ? d["admin.products.ownerPlatform" as keyof typeof d] || "Platform"
      : d["admin.products.ownerSeller" as keyof typeof d] || "Satıcı";

  const approve = async (id: string) => {
    setLoading(`approve-${id}`);
    try {
      const res = await fetch(`/api/admin/products/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Onaylama başarısız");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const submitReject = async (id: string) => {
    const reason = rejectReason.trim();
    if (!reason) {
      alert(
        d["admin.products.reasonRequired" as keyof typeof d] ||
          "Bir red gerekçesi girin."
      );
      return;
    }
    setLoading(`reject-${id}`);
    try {
      const res = await fetch(`/api/admin/products/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Reddetme başarısız");
        return;
      }
      setRejectingId(null);
      setRejectReason("");
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const archive = async (id: string) => {
    if (
      !window.confirm(
        d["admin.products.confirmArchive" as keyof typeof d] ||
          "Bu ürünü arşivlemek istediğinize emin misiniz?"
      )
    )
      return;
    setLoading(`archive-${id}`);
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Arşivleme başarısız");
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {d["admin.products.title" as keyof typeof d] || "Ürünler"}
          </h1>
          <p className="text-gray-500 mt-1">
            {d["admin.products.subtitle" as keyof typeof d] ||
              "Satıcı ürünlerini onaylayın ve platform ürünleri oluşturun."}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          {d["admin.products.addPlatformProduct" as keyof typeof d] ||
            "Platform ürünü ekle"}
        </Link>
      </div>

      {/* Moderation queue */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">
          {d["admin.products.pendingTitle" as keyof typeof d] ||
            "Onay bekleyen"}{" "}
          ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {d["admin.products.pendingEmpty" as keyof typeof d] ||
              "Onay bekleyen ürün yok."}
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex gap-4">
                  <div className="flex-shrink-0">
                    {p.primaryImageUrl || p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.primaryImageUrl || p.images[0]?.url}
                        alt={p.title}
                        className="w-24 h-24 rounded-lg object-cover border border-gray-100"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                        {d["admin.products.noImage" as keyof typeof d] ||
                          "Görsel yok"}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-gray-900 truncate">
                      {p.title}
                    </h3>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {formatCurrency(p.priceKurus, loc)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {p.sellerName}
                    </p>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                      {p.description}
                    </p>
                  </div>
                </div>

                {rejectingId === p.id ? (
                  <div className="mt-3">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      placeholder={
                        d["admin.products.reasonPlaceholder" as keyof typeof d] ||
                        "Red gerekçesi..."
                      }
                      className="input-base w-full text-sm"
                    />
                    <div className="flex gap-2 mt-2 justify-end">
                      <button
                        onClick={() => {
                          setRejectingId(null);
                          setRejectReason("");
                        }}
                        className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                      >
                        {d["admin.products.cancel" as keyof typeof d] || "Vazgeç"}
                      </button>
                      <button
                        onClick={() => submitReject(p.id)}
                        disabled={loading === `reject-${p.id}`}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400"
                      >
                        {d["admin.products.confirmReject" as keyof typeof d] ||
                          "Reddet"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3 justify-end">
                    <button
                      onClick={() => {
                        setRejectingId(p.id);
                        setRejectReason("");
                      }}
                      className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700"
                    >
                      {d["admin.products.reject" as keyof typeof d] || "Reddet"}
                    </button>
                    <button
                      onClick={() => approve(p.id)}
                      disabled={loading === `approve-${p.id}`}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
                    >
                      {d["admin.products.approve" as keyof typeof d] || "Onayla"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All products */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900">
          {d["admin.products.allTitle" as keyof typeof d] || "Tüm ürünler"} (
          {all.length})
        </h2>
        {all.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {d["admin.products.allEmpty" as keyof typeof d] || "Henüz ürün yok."}
          </p>
        ) : (
          <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                    {d["admin.products.colProduct" as keyof typeof d] || "Ürün"}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                    {d["admin.products.colSeller" as keyof typeof d] || "Satıcı"}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                    {d["admin.products.colOwner" as keyof typeof d] || "Sahip"}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                    {d["admin.products.colStatus" as keyof typeof d] || "Durum"}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                    {d["admin.products.colPrice" as keyof typeof d] || "Fiyat"}
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {all.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.primaryImageUrl || p.images[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.primaryImageUrl || p.images[0]?.url}
                            alt={p.title}
                            className="w-10 h-10 rounded object-cover border border-gray-100"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-100" />
                        )}
                        <span className="text-sm font-medium text-gray-900 truncate max-w-[220px]">
                          {p.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {p.sellerName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.ownerType === "admin"
                            ? "bg-indigo-100 text-indigo-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {ownerLabel(p.ownerType)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_BADGE[p.status] || "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {statusLabel(p.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {formatCurrency(p.priceKurus, loc)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end items-center">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                        >
                          {d["admin.products.edit" as keyof typeof d] ||
                            "Düzenle"}
                        </Link>
                        {p.status !== "archived" && (
                          <button
                            onClick={() => archive(p.id)}
                            disabled={loading === `archive-${p.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400"
                          >
                            {d["admin.products.archive" as keyof typeof d] ||
                              "Arşivle"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
