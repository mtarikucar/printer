"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Input, Select, Textarea, FormField } from "@/components/ui";
import { CategoryPicker } from "@/components/category-picker";
import {
  ProductSpecEditor,
  type SpecFile,
  type SpecComponentRow,
  type SpecStepRow,
} from "@/components/products/product-spec-editor";

export interface EditableImage {
  id: string;
  url: string;
  sortOrder: number;
}

export interface EditableProduct {
  id: string;
  ownerType: "seller" | "admin";
  title: string;
  description: string;
  priceKurus: number;
  material: "resin" | "filament" | null;
  categoryId: string | null;
  leadTimeDays: number | null;
  status: "draft" | "pending_review" | "active" | "rejected" | "archived";
  rejectionReason: string | null;
  sellerName: string;
  images: EditableImage[];
}

export function EditProductClient({
  product,
  locale: _locale,
  initialFiles,
  initialComponents,
  initialSteps,
}: {
  product: EditableProduct;
  locale: string;
  initialFiles: SpecFile[];
  initialComponents: SpecComponentRow[];
  initialSteps: SpecStepRow[];
}) {
  void _locale;
  const d = useDictionary();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description);
  const [priceTry, setPriceTry] = useState((product.priceKurus / 100).toString());
  const [material, setMaterial] = useState(product.material ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(product.categoryId);
  const [leadTimeDays, setLeadTimeDays] = useState(
    (product.leadTimeDays ?? 7).toString()
  );

  const [images, setImages] = useState<EditableImage[]>(product.images);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const price = parseFloat(priceTry.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0) {
      setError(
        d["admin.products.priceInvalid" as keyof typeof d] ||
          "Geçerli bir fiyat girin."
      );
      return;
    }
    const priceKurus = Math.round(price * 100);
    const lead = parseInt(leadTimeDays, 10);

    const body: Record<string, unknown> = {
      title,
      description,
      priceKurus,
    };
    if (material) body.material = material;
    if (categoryId) body.categoryId = categoryId;
    if (Number.isFinite(lead)) body.leadTimeDays = lead;

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ||
            d["admin.products.saveFailed" as keyof typeof d] ||
            "Kaydedilemedi."
        );
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/admin/products/${product.id}/images`, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ||
            d["admin.products.uploadFailed" as keyof typeof d] ||
            "Görsel yüklenemedi."
        );
        return;
      }
      setImages((prev) => [
        ...prev,
        {
          id: data.image.id,
          url: data.image.url,
          sortOrder: prev.length,
        },
      ]);
      router.refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteImage = async (imageId: string) => {
    setError(null);
    const res = await fetch(
      `/api/admin/products/${product.id}/images?imageId=${imageId}`,
      { method: "DELETE" }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error ||
          d["admin.products.deleteImageFailed" as keyof typeof d] ||
          "Görsel silinemedi."
      );
      return;
    }
    setImages((prev) => prev.filter((img) => img.id !== imageId));
    router.refresh();
  };

  const unarchive = async () => {
    setArchiving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}/unarchive`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Arşivden çıkarma başarısız");
        return;
      }
      router.refresh();
    } finally {
      setArchiving(false);
    }
  };

  const archive = async () => {
    if (
      !window.confirm(
        d["admin.products.confirmArchive" as keyof typeof d] ||
          "Bu ürünü arşivlemek istediğinize emin misiniz?"
      )
    )
      return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Arşivleme başarısız");
        return;
      }
      router.push("/admin/products");
      router.refresh();
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div>
      <Link
        href="/admin/products"
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        ← {d["admin.products.backToList" as keyof typeof d] || "Ürünlere dön"}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {d["admin.products.editTitle" as keyof typeof d] || "Ürünü düzenle"}
          </h1>
          <p className="text-gray-500 mt-1">{product.sellerName}</p>
        </div>
        {product.status !== "archived" ? (
          <button
            onClick={archive}
            disabled={archiving}
            className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400"
          >
            {d["admin.products.archive" as keyof typeof d] || "Arşivle"}
          </button>
        ) : (
          <button
            onClick={unarchive}
            disabled={archiving}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:bg-gray-400"
          >
            {d["admin.products.unarchive" as keyof typeof d] ||
              "Arşivden çıkar"}
          </button>
        )}
      </div>

      {product.status === "rejected" && product.rejectionReason && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <span className="font-medium">
            {d["admin.products.rejectionReason" as keyof typeof d] ||
              "Red gerekçesi"}
            :{" "}
          </span>
          {product.rejectionReason}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mt-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          {d["admin.products.savedNotice" as keyof typeof d] || "Kaydedildi."}
        </div>
      )}

      {/* Images */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900">
          {d["admin.products.imagesTitle" as keyof typeof d] || "Görseller"}
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {images.map((img) => (
            <div key={img.id} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                className="w-28 h-28 rounded-lg object-cover border border-gray-200"
              />
              <button
                onClick={() => deleteImage(img.id)}
                title={
                  d["admin.products.deleteImage" as keyof typeof d] ||
                  "Görseli sil"
                }
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-600 text-white text-sm leading-none flex items-center justify-center shadow hover:bg-red-700"
              >
                ×
              </button>
            </div>
          ))}
          {images.length === 0 && (
            <p className="text-sm text-gray-500">
              {d["admin.products.noImages" as keyof typeof d] ||
                "Henüz görsel yok."}
            </p>
          )}
        </div>
        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadImage(file);
            }}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && (
            <span className="ml-2 text-xs text-gray-500">
              {d["admin.products.uploading" as keyof typeof d] ||
                "Yükleniyor..."}
            </span>
          )}
        </div>
      </section>

      {/* Form */}
      <form onSubmit={save} className="mt-8 space-y-5">
        <FormField
          label={d["admin.products.fieldTitle" as keyof typeof d] || "Başlık"}
          required
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={3}
            maxLength={120}
          />
        </FormField>

        <FormField
          label={
            d["admin.products.fieldDescription" as keyof typeof d] || "Açıklama"
          }
          required
        >
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            minLength={10}
            maxLength={4000}
            rows={5}
          />
        </FormField>

        <FormField
          label={d["admin.products.fieldPrice" as keyof typeof d] || "Fiyat (₺)"}
          required
        >
          <Input
            type="number"
            step="0.01"
            min="1"
            value={priceTry}
            onChange={(e) => setPriceTry(e.target.value)}
            required
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            label={
              d["admin.products.fieldMaterial" as keyof typeof d] || "Malzeme"
            }
          >
            <Select
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            >
              <option value="">
                {d["admin.products.optionNone" as keyof typeof d] || "—"}
              </option>
              <option value="resin">Reçine</option>
              <option value="filament">Filament</option>
            </Select>
          </FormField>

          <FormField
            label={
              d["admin.products.fieldCategory" as keyof typeof d] || "Kategori"
            }
          >
            <CategoryPicker
              value={categoryId}
              onChange={setCategoryId}
              placeholder={d["admin.products.optionNone" as keyof typeof d] || "—"}
            />
          </FormField>
        </div>

        <FormField
          label={
            d["admin.products.fieldLeadTime" as keyof typeof d] ||
            "Üretim süresi (gün)"
          }
        >
          <Input
            type="number"
            min="1"
            max="90"
            value={leadTimeDays}
            onChange={(e) => setLeadTimeDays(e.target.value)}
          />
        </FormField>

        <div className="flex gap-3">
          <Button type="submit" loading={saving}>
            {d["admin.products.save" as keyof typeof d] || "Kaydet"}
          </Button>
          <Button href="/admin/products" variant="secondary">
            {d["admin.products.cancel" as keyof typeof d] || "Vazgeç"}
          </Button>
        </div>
      </form>

      {/* Print files + bill of materials + assembly recipe */}
      <div className="mt-8">
        <ProductSpecEditor
          apiBase="/api/admin/products"
          productId={product.id}
          initialFiles={initialFiles}
          initialComponents={initialComponents}
          initialSteps={initialSteps}
        />
      </div>
    </div>
  );
}
