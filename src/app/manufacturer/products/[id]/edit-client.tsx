"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea, FormField } from "@/components/ui";
import { useDictionary } from "@/lib/i18n/locale-context";
import { CategoryPicker } from "@/components/category-picker";
import {
  ProductSpecEditor,
  type SpecFile,
  type SpecComponentRow,
  type SpecStepRow,
} from "@/components/products/product-spec-editor";

type ProductStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "rejected"
  | "archived";

interface EditProduct {
  id: string;
  title: string;
  description: string;
  priceKurus: number;
  material: string | null;
  categoryId: string | null;
  leadTimeDays: number | null;
  status: ProductStatus;
  rejectionReason: string | null;
}

interface ProductImage {
  id: string;
  url: string;
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

interface EditProductClientProps {
  product: EditProduct;
  initialImages: ProductImage[];
  initialFiles: SpecFile[];
  initialComponents: SpecComponentRow[];
  initialSteps: SpecStepRow[];
}

export function EditProductClient({
  product,
  initialImages,
  initialFiles,
  initialComponents,
  initialSteps,
}: EditProductClientProps) {
  const d = useDictionary();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = (key: string, fallback: string) =>
    (d[key as keyof typeof d] as string) || fallback;

  const [status, setStatus] = useState<ProductStatus>(product.status);
  const [images, setImages] = useState<ProductImage[]>(initialImages);
  const [fileCount, setFileCount] = useState(initialFiles.length);

  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [priceTry, setPriceTry] = useState(
    (product.priceKurus / 100).toString()
  );
  const [material, setMaterial] = useState(product.material ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(product.categoryId);
  const [leadTimeDays, setLeadTimeDays] = useState(
    String(product.leadTimeDays ?? 7)
  );

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const statusLabel = (s: ProductStatus) =>
    t(`product.status.${s}`, STATUS_FALLBACK[s]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaveMsg(null);

    const priceNum = Number(priceTry.replace(",", "."));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError(t("product.error.price", "Geçerli bir fiyat girin."));
      return;
    }
    const priceKurus = Math.round(priceNum * 100);
    const leadNum = Number(leadTimeDays) || 7;

    setSaving(true);
    try {
      const res = await fetch(`/api/manufacturer/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          priceKurus,
          material: material || undefined,
          categoryId: categoryId || undefined,
          leadTimeDays: leadNum,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(t("product.error.generic", "Bilgileri kontrol edin."));
        return;
      }
      if (data.product?.status) setStatus(data.product.status);
      setSaveMsg(t("product.saved", "Değişiklikler kaydedildi."));
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/manufacturer/products/${product.id}/images`,
        { method: "POST", body: form }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          t("product.error.upload", "Görsel yüklenemedi (JPEG/PNG, ≤10MB).")
        );
        return;
      }
      setImages((prev) => [...prev, data.image]);
      router.refresh();
    } catch {
      setError(t("product.error.upload", "Görsel yüklenemedi (JPEG/PNG, ≤10MB)."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    setError(null);
    try {
      const res = await fetch(
        `/api/manufacturer/products/${product.id}/images?imageId=${imageId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
        return;
      }
      setImages((prev) => prev.filter((img) => img.id !== imageId));
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    }
  };

  const handleSubmitForReview = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/manufacturer/products/${product.id}/submit`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === "no_images") {
          setError(
            t(
              "product.error.noImages",
              "İncelemeye göndermek için en az bir görsel ekleyin."
            )
          );
        } else if (data?.code === "no_files") {
          setError(
            t(
              "product.error.noFiles",
              "İncelemeye göndermek için en az bir baskı dosyası (STL/OBJ) ekleyin."
            )
          );
        } else {
          setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
        }
        return;
      }
      if (data.product?.status) setStatus(data.product.status);
      router.refresh();
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = status === "draft" || status === "rejected";
  const hasImages = images.length > 0;
  const hasFiles = fileCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/manufacturer/products" className="hover:text-indigo-700">
          {t("manufacturer.products.title", "Ürünlerim")}
        </Link>
        <span>/</span>
        <span className="text-gray-700 truncate">{title}</span>
      </div>

      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("manufacturer.products.editTitle", "Ürünü Düzenle")}
        </h1>
        <span
          className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[status]}`}
        >
          {statusLabel(status)}
        </span>
      </div>

      {status === "rejected" && product.rejectionReason && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">
          <p className="font-medium mb-1">
            {t("product.rejected.title", "Ürün reddedildi")}
          </p>
          <p>{product.rejectionReason}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}
      {saveMsg && (
        <div className="bg-emerald-50 text-emerald-700 rounded-xl p-3 text-sm">
          {saveMsg}
        </div>
      )}

      {/* Details form */}
      <form
        onSubmit={handleSave}
        className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
      >
        <FormField label={t("product.field.title", "Başlık")} required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
          />
        </FormField>

        <FormField label={t("product.field.description", "Açıklama")} required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={4000}
            required
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={t("product.field.price", "Fiyat (₺)")} required>
            <Input
              type="number"
              min={1}
              step="0.01"
              value={priceTry}
              onChange={(e) => setPriceTry(e.target.value)}
              required
            />
          </FormField>

          <FormField label={t("product.field.leadTime", "Üretim süresi (gün)")}>
            <Input
              type="number"
              min={1}
              max={90}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
            />
          </FormField>

          <FormField label={t("product.field.material", "Malzeme")}>
            <Select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            >
              <option value="">
                {t("product.material.none", "Belirtilmedi")}
              </option>
              <option value="resin">
                {t("product.material.resin", "Reçine (Resin)")}
              </option>
              <option value="filament">
                {t("product.material.filament", "Filament (FDM)")}
              </option>
            </Select>
          </FormField>

          <FormField label={t("product.field.category", "Kategori")}>
            <CategoryPicker
              value={categoryId}
              onChange={setCategoryId}
              placeholder={t("product.category.none", "Belirtilmedi")}
            />
          </FormField>
        </div>

        {status === "active" && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
            {t(
              "product.edit.activeNote",
              "Yayında olan bir ürünü düzenlerseniz tekrar incelemeye alınır."
            )}
          </p>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-gray-100">
          <Button type="submit" loading={saving}>
            {t("common.save", "Kaydet")}
          </Button>
        </div>
      </form>

      {/* Images */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          {t("product.images.title", "Görseller")}
        </h2>

        {images.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleDeleteImage(img.id)}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center hover:bg-red-600 transition-colors"
                  aria-label={t("product.images.delete", "Görseli sil")}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {t(
              "product.images.empty",
              "Henüz görsel yok. İncelemeye göndermek için en az bir görsel ekleyin."
            )}
          </p>
        )}

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleUpload}
            disabled={uploading}
            className="block text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 disabled:opacity-50"
          />
          <p className="text-xs text-gray-400 mt-1">
            {t("product.images.hint", "JPEG veya PNG, en fazla 10MB.")}
          </p>
        </div>
      </div>

      {/* Print files + bill of materials + assembly recipe */}
      <ProductSpecEditor
        apiBase="/api/manufacturer/products"
        productId={product.id}
        initialFiles={initialFiles}
        initialComponents={initialComponents}
        initialSteps={initialSteps}
        onFilesChange={setFileCount}
      />

      {/* Submit for review */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {t("product.submit.title", "İncelemeye gönder")}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {!canSubmit
              ? t(
                  "product.submit.notDraft",
                  "Yalnızca taslak veya reddedilen ürünler gönderilebilir."
                )
              : !hasImages
                ? t("product.submit.needImages", "Önce en az bir görsel ekleyin.")
                : !hasFiles
                  ? t(
                      "product.submit.needFiles",
                      "Önce en az bir baskı dosyası (STL/OBJ) ekleyin."
                    )
                  : t(
                      "product.submit.ready",
                      "Ürün onay için ekibimize gönderilecek."
                    )}
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          loading={submitting}
          disabled={!canSubmit || !hasImages || !hasFiles}
          onClick={handleSubmitForReview}
        >
          {t("manufacturer.products.submit", "İncelemeye gönder")}
        </Button>
      </div>
    </div>
  );
}
