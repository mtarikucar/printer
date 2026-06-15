"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Textarea, FormField } from "@/components/ui";
import { useDictionary } from "@/lib/i18n/locale-context";
import { CategoryPicker } from "@/components/category-picker";

export function NewProductClient() {
  const d = useDictionary();
  const router = useRouter();

  const t = (key: string, fallback: string) =>
    (d[key as keyof typeof d] as string) || fallback;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceTry, setPriceTry] = useState("");
  const [material, setMaterial] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [leadTimeDays, setLeadTimeDays] = useState("7");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const priceNum = Number(priceTry.replace(",", "."));
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError(t("product.error.price", "Geçerli bir fiyat girin."));
      return;
    }
    const priceKurus = Math.round(priceNum * 100);
    const leadNum = Number(leadTimeDays) || 7;

    setSaving(true);
    try {
      const res = await fetch("/api/manufacturer/products", {
        method: "POST",
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
      router.push(`/manufacturer/products/${data.product.id}`);
    } catch {
      setError(t("product.error.generic", "Bir hata oluştu, kontrol edin."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/manufacturer/products" className="hover:text-indigo-700">
          {t("manufacturer.products.title", "Ürünlerim")}
        </Link>
        <span>/</span>
        <span className="text-gray-700">
          {t("manufacturer.products.new", "Yeni Ürün")}
        </span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        {t("manufacturer.products.new", "Yeni Ürün")}
      </h1>
      <p className="text-gray-500 text-sm -mt-2">
        {t(
          "manufacturer.products.new.hint",
          "Ürünü oluşturduktan sonra görsel ekleyip incelemeye gönderebilirsiniz."
        )}
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
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

          <FormField
            label={t("product.field.leadTime", "Üretim süresi (gün)")}
          >
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

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          <Link
            href="/manufacturer/products"
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
          >
            {t("common.cancel", "İptal")}
          </Link>
          <Button type="submit" loading={saving}>
            {t("product.create", "Oluştur ve devam et")}
          </Button>
        </div>
      </form>
    </div>
  );
}
