"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, Input, Select, FormField } from "@/components/ui";
import { toWhatsAppDigits } from "@/lib/config/contact";

interface LineItem {
  description: string;
  unitPriceTry: string;
  quantity: string;
}

interface CreateResult {
  reference: string;
  payUrl: string;
  amountKurus: number;
}

const emptyLine = (): LineItem => ({ description: "", unitPriceTry: "", quantity: "1" });

export function NewOrderClient({ locale: _locale }: { locale: string }) {
  void _locale;

  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [mahalle, setMahalle] = useState("");
  const [adres, setAdres] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLine()]);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "bank_transfer">("card");
  // Reference photos the customer sent over WhatsApp (max 4).
  const [photos, setPhotos] = useState<{ key: string; previewUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const MAX_PHOTOS = 4;

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`En fazla ${MAX_PHOTOS} fotoğraf ekleyebilirsiniz.`);
      return;
    }
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/admin/orders/upload-photo", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Fotoğraf yüklenemedi.");
          continue;
        }
        setPhotos((prev) =>
          prev.length < MAX_PHOTOS
            ? [...prev, { key: data.key, previewUrl: data.previewUrl }]
            : prev
        );
      }
    } finally {
      setUploading(false);
    }
  };
  const removePhoto = (key: string) =>
    setPhotos((prev) => prev.filter((p) => p.key !== key));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const totalTry = useMemo(() => {
    return lineItems.reduce((sum, li) => {
      const price = parseFloat(li.unitPriceTry.replace(",", "."));
      const qty = parseInt(li.quantity, 10);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
      return sum + price * qty;
    }, 0);
  }, [lineItems]);

  const updateLine = (idx: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLineItems((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number) =>
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedLines = lineItems.map((li) => ({
      description: li.description.trim(),
      unitPriceTry: parseFloat(li.unitPriceTry.replace(",", ".")),
      quantity: parseInt(li.quantity, 10),
    }));
    if (
      parsedLines.some(
        (l) =>
          !l.description ||
          !Number.isFinite(l.unitPriceTry) ||
          l.unitPriceTry <= 0 ||
          !Number.isFinite(l.quantity) ||
          l.quantity < 1
      )
    ) {
      setError("Her kalem için açıklama, geçerli fiyat ve adet girin.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/orders/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          email,
          shippingAddress: { adres, mahalle, ilce, il, postaKodu, telefon: phone },
          lineItems: parsedLines,
          paymentMethod,
          photoKeys: photos.map((p) => p.key),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sipariş oluşturulamadı.");
        return;
      }
      setResult(data as CreateResult);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const waMsg = `Merhaba ${customerName || ""}! Siparişiniz hazır. Ödeme bağlantınız: ${result.payUrl}`;
    const waUrl = `https://wa.me/${toWhatsAppDigits(phone)}?text=${encodeURIComponent(waMsg)}`;
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold text-gray-900">Sipariş oluşturuldu</h1>
        <p className="text-gray-500 mt-1">
          Sipariş No: <span className="font-mono text-green-600">{result.reference}</span>{" "}
          · Tutar: ₺{(result.amountKurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
        </p>

        <div className="mt-5 rounded-lg border border-gray-200 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Ödeme bağlantısı
          </p>
          <p className="mt-1 break-all font-mono text-sm text-gray-900">{result.payUrl}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(result.payUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Kopyalandı ✓" : "Bağlantıyı kopyala"}
            </Button>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1ebe5d]"
            >
              WhatsApp&apos;tan müşteriye gönder
            </a>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            type="button"
            onClick={() => {
              setResult(null);
              setLineItems([emptyLine()]);
              setPhotos([]);
              setCustomerName("");
              setEmail("");
              setPhone("");
              setIl("");
              setIlce("");
              setMahalle("");
              setAdres("");
              setPostaKodu("");
            }}
          >
            Yeni sipariş oluştur
          </Button>
          <Button href="/admin/orders" variant="secondary">
            Siparişlere dön
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link href="/admin/orders" className="text-sm text-gray-500 hover:text-gray-700">
        ← Siparişlere dön
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">WhatsApp siparişi oluştur</h1>
      <p className="mt-1 text-gray-500">
        Müşteri adına sipariş oluşturun ve ödeme bağlantısını WhatsApp&apos;tan gönderin.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Ad Soyad" required>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          </FormField>
          <FormField label="E-posta" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Telefon" required>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="İl" required>
            <Input value={il} onChange={(e) => setIl(e.target.value)} required />
          </FormField>
          <FormField label="İlçe" required>
            <Input value={ilce} onChange={(e) => setIlce(e.target.value)} required />
          </FormField>
          <FormField label="Mahalle">
            <Input value={mahalle} onChange={(e) => setMahalle(e.target.value)} />
          </FormField>
          <FormField label="Posta Kodu">
            <Input value={postaKodu} onChange={(e) => setPostaKodu(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Adres" required>
          <Input value={adres} onChange={(e) => setAdres(e.target.value)} required />
        </FormField>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Kalemler</span>
            <button
              type="button"
              onClick={addLine}
              className="text-sm font-medium text-green-600 hover:text-green-700"
            >
              + Kalem ekle
            </button>
          </div>
          <div className="space-y-2">
            {lineItems.map((li, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  placeholder="Açıklama (örn. 15cm özel figür)"
                  value={li.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  className="flex-1"
                />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="₺ birim"
                  value={li.unitPriceTry}
                  onChange={(e) => updateLine(idx, { unitPriceTry: e.target.value })}
                  className="w-28"
                />
                <Input
                  type="number"
                  min="1"
                  placeholder="Adet"
                  value={li.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  className="w-20"
                />
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="px-2 text-gray-400 hover:text-red-600"
                  aria-label="Kalemi sil"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-right text-sm font-semibold text-gray-900">
            Toplam: ₺{totalTry.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium text-gray-700">
              Fotoğraflar{" "}
              <span className="text-gray-400">(opsiyonel · en fazla {MAX_PHOTOS})</span>
            </label>
            {photos.length < MAX_PHOTOS && (
              <label className="cursor-pointer rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800">
                {uploading ? "Yükleniyor…" : "+ Fotoğraf ekle"}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  multiple
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    void uploadPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
          <p className="mb-2 text-xs text-gray-500">
            Müşterinin WhatsApp&apos;tan gönderdiği görseller. JPG/PNG, her biri en fazla 20MB.
          </p>
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {photos.map((p) => (
                <div
                  key={p.key}
                  className="relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(p.key)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs leading-none text-white hover:bg-black/80"
                    aria-label="Fotoğrafı kaldır"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <FormField label="Ödeme yöntemi" required>
          <Select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as "card" | "bank_transfer")}
          >
            <option value="card">Kart (PayTR)</option>
            <option value="bank_transfer">Havale / EFT</option>
          </Select>
        </FormField>

        <div className="flex gap-3">
          <Button type="submit" loading={submitting}>
            Sipariş oluştur ve bağlantı al
          </Button>
          <Button href="/admin/orders" variant="secondary">
            Vazgeç
          </Button>
        </div>
      </form>
    </div>
  );
}
