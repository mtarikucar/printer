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
  // Client-side search + pagination over the loaded product list.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

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

  const unarchive = async (id: string) => {
    setLoading(`unarchive-${id}`);
    try {
      const res = await fetch(`/api/admin/products/${id}/unarchive`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Arşivden çıkarma başarısız");
        return;
      }
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

  const hardDelete = async (id: string) => {
    if (
      !window.confirm(
        d["admin.products.confirmDelete" as keyof typeof d] ||
          "Bu ürün KALICI olarak silinecek (geri alınamaz). Yalnızca hiçbir sipariş/yorum ilişkisi yoksa silinir. Emin misiniz?"
      )
    )
      return;
    setLoading(`delete-${id}`);
    try {
      const res = await fetch(`/api/admin/products/${id}?hard=1`, {
        method: "DELETE",
      });
      if (!res.ok) {
        if (res.status === 409) {
          alert(
            d["admin.products.deleteBlocked" as keyof typeof d] ||
              "Bu üründe sipariş/yorum geçmişi var, kalıcı silinemez. Bunun yerine arşivleyin."
          );
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || "Silme başarısız");
        }
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.sellerName.toLowerCase().includes(q) ||
          statusLabel(p.status).toLowerCase().includes(q)
      )
    : all;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            {d["admin.products.allTitle" as keyof typeof d] || "Tüm ürünler"} (
            {filtered.length})
          </h2>
          <div className="relative w-full sm:w-72">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder={
                d["admin.products.search" as keyof typeof d] ||
                "Ürün, satıcı veya durum ara…"
              }
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {q
              ? d["admin.products.searchEmpty" as keyof typeof d] ||
                "Aramayla eşleşen ürün yok."
              : d["admin.products.allEmpty" as keyof typeof d] ||
                "Henüz ürün yok."}
          </p>
        ) : (
          <div className="mt-4 bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[760px]">
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
                {pageItems.map((p) => (
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
                        {p.status !== "archived" ? (
                          <button
                            onClick={() => archive(p.id)}
                            disabled={loading === `archive-${p.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400"
                          >
                            {d["admin.products.archive" as keyof typeof d] ||
                              "Arşivle"}
                          </button>
                        ) : (
                          <button
                            onClick={() => unarchive(p.id)}
                            disabled={loading === `unarchive-${p.id}`}
                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 disabled:bg-gray-400"
                          >
                            {d["admin.products.unarchive" as keyof typeof d] ||
                              "Arşivden çıkar"}
                          </button>
                        )}
                        <button
                          onClick={() => hardDelete(p.id)}
                          disabled={loading === `delete-${p.id}`}
                          title="Kalıcı sil (ürünün hiçbir ilişkisi yoksa)"
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400"
                        >
                          {d["admin.products.delete" as keyof typeof d] || "Sil"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              {`${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(
                safePage * PAGE_SIZE,
                filtered.length
              )} / ${filtered.length}`}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                ‹
              </button>
              <span className="px-2 text-sm text-gray-600">
                {safePage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
