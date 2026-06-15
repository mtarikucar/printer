"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

type ProductStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "rejected"
  | "archived";

interface ProductListItem {
  id: string;
  title: string;
  priceKurus: number;
  status: ProductStatus;
  category: string | null;
  material: string | null;
  imageCount: number;
  primaryImageUrl: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<ProductStatus, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-400",
};

const STATUS_FALLBACK: Record<ProductStatus, string> = {
  draft: "Taslak",
  pending_review: "İncelemede",
  active: "Yayında",
  rejected: "Reddedildi",
  archived: "Arşivlendi",
};

interface ProductsClientProps {
  products: ProductListItem[];
  locale: string;
}

export function ProductsClient({ products, locale }: ProductsClientProps) {
  const d = useDictionary();
  const router = useRouter();
  const loc = locale as Locale;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = (key: string, fallback: string) =>
    (d[key as keyof typeof d] as string) || fallback;

  const statusLabel = (s: ProductStatus) =>
    t(`product.status.${s}`, STATUS_FALLBACK[s]);

  const handleSubmit = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturer/products/${id}/submit`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === "no_images") {
          setError(
            t(
              "product.error.noImages",
              "İncelemeye göndermek için en az bir görsel ekleyin."
            )
          );
        } else {
          setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
        }
        return;
      }
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setBusyId(null);
    }
  };

  const handleUnarchive = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturer/products/${id}/unarchive`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
        return;
      }
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (id: string) => {
    if (
      !window.confirm(
        t("product.archive.confirm", "Bu ürünü arşivlemek istediğinize emin misiniz?")
      )
    )
      return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/manufacturer/products/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
        return;
      }
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t("manufacturer.products.title", "Ürünlerim")}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            {t(
              "manufacturer.products.subtitle",
              "Mağaza ürünlerinizi oluşturun ve yönetin."
            )}
          </p>
        </div>
        <Link
          href="/manufacturer/products/new"
          className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {t("manufacturer.products.new", "Yeni Ürün")}
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {t("manufacturer.products.table.product", "Ürün")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {t("manufacturer.products.table.price", "Fiyat")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">
                {t("manufacturer.products.table.status", "Durum")}
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.primaryImageUrl}
                          alt={p.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/manufacturer/products/${p.id}`}
                        className="text-sm font-medium text-gray-900 hover:text-indigo-700 truncate block"
                      >
                        {p.title}
                      </Link>
                      <span className="text-xs text-gray-400">
                        {p.imageCount}{" "}
                        {t("manufacturer.products.imagesShort", "görsel")}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {formatCurrency(p.priceKurus, loc)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status]}`}
                  >
                    {statusLabel(p.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/manufacturer/products/${p.id}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {t("manufacturer.products.edit", "Düzenle")}
                    </Link>
                    {(p.status === "draft" || p.status === "rejected") && (
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => handleSubmit(p.id)}
                        className="text-sm text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                      >
                        {t("manufacturer.products.submit", "İncelemeye gönder")}
                      </button>
                    )}
                    {p.status !== "archived" ? (
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => handleArchive(p.id)}
                        className="text-sm text-gray-500 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        {t("manufacturer.products.archive", "Arşivle")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === p.id}
                        onClick={() => handleUnarchive(p.id)}
                        className="text-sm text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-50"
                      >
                        {t("manufacturer.products.unarchive", "Arşivden çıkar")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-500">
                  {t(
                    "manufacturer.products.empty",
                    "Henüz ürün eklemediniz. Başlamak için “Yeni Ürün”e tıklayın."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
