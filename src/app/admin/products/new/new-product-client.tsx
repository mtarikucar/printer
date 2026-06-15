"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Button, Input, Select, Textarea, FormField } from "@/components/ui";
import { CategoryPicker } from "@/components/category-picker";

export function NewProductClient({ locale: _locale }: { locale: string }) {
  void _locale;
  const d = useDictionary();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priceTry, setPriceTry] = useState("");
  const [material, setMaterial] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [leadTimeDays, setLeadTimeDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error ||
            d["admin.products.createFailed" as keyof typeof d] ||
            "Ürün oluşturulamadı."
        );
        return;
      }
      router.push(`/admin/products/${data.product.id}`);
    } finally {
      setSubmitting(false);
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
      <h1 className="text-2xl font-bold text-gray-900 mt-2">
        {d["admin.products.newTitle" as keyof typeof d] ||
          "Platform ürünü oluştur"}
      </h1>
      <p className="text-gray-500 mt-1">
        {d["admin.products.newSubtitle" as keyof typeof d] ||
          "Oluşturulan ürün doğrudan yayına alınır. Sonrasında görsel ekleyebilirsiniz."}
      </p>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-5">
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
          label={
            d["admin.products.fieldPrice" as keyof typeof d] || "Fiyat (₺)"
          }
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
          <Button type="submit" loading={submitting}>
            {d["admin.products.createCta" as keyof typeof d] ||
              "Oluştur ve görsel ekle"}
          </Button>
          <Button href="/admin/products" variant="secondary">
            {d["admin.products.cancel" as keyof typeof d] || "Vazgeç"}
          </Button>
        </div>
      </form>
    </div>
  );
}
