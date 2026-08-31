"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  CONSUMER_REQUEST_TYPES,
  CONSUMER_REQUEST_LABELS,
  CONSUMER_REQUEST_HINTS,
  CONSUMER_REQUEST_MESSAGE_MIN,
  CONSUMER_REQUEST_MESSAGE_MAX,
  type ConsumerRequestType,
} from "@/lib/config/consumer-requests";

/**
 * Tüketici talep formu — MSY m.12/A'nın "kesintisiz iletilebilir ve takip
 * edilebilir sistem" şartının müşteri yüzü.
 *
 * Sipariş takip sayfasında durur çünkü orası misafir siparişleri dâhil her
 * tüketicinin ulaşabildiği tek yer; hesap şartı koymak "kesintisiz" ibaresini
 * ihlal ederdi. Kimlik kanıtı sipariş numarası + siparişteki e-postadır —
 * takip sayfasının kendisiyle aynı model.
 *
 * Beş türün hiçbiri gizlenmez. Cayma bildirimi kişiye özel üründe sonuç
 * doğurmaz, ama tüketicinin BİLDİRME hakkı vardır; talebi değerlendirmek
 * satıcının işidir, formun peşinen reddetmesi değil.
 */
export function ConsumerRequestForm({ orderNumber }: { orderNumber: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ConsumerRequestType>("delivery_complaint");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/consumer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, contactEmail: email, type, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Talep gönderilemedi.");
      setReference(data.reference);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (reference) {
    return (
      <Card padding="md" className="space-y-3">
        <h2 className="text-lg font-serif text-text-primary">Talebiniz alındı</h2>
        <p className="text-sm text-text-secondary">
          Talep referansınız: <strong className="text-text-primary">{reference}</strong>
        </p>
        <p className="text-xs text-text-muted">
          Bu referansı saklayın — talebinizin durumunu bu numarayla takip
          edebilirsiniz. Talebiniz satıcıya iletilmiştir ve e-posta adresinize
          dönüş yapılacaktır.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="md" className="space-y-4">
      <div>
        <h2 className="text-lg font-serif text-text-primary mb-1">
          Talep ve şikâyet
        </h2>
        <p className="text-sm text-text-secondary">
          Cayma, fesih, bedel iadesi, işlem kayıtları veya teslimatla ilgili
          taleplerinizi buradan iletebilirsiniz.
        </p>
      </div>

      {!open ? (
        <Button type="button" variant="secondary" size="sm" className="!px-6 inline-flex" onClick={() => setOpen(true)}>
          Talep oluştur
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Talep türü
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ConsumerRequestType)}
              className="input-base"
            >
              {CONSUMER_REQUEST_TYPES.map((k) => (
                <option key={k} value={k}>
                  {CONSUMER_REQUEST_LABELS[k]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-muted">{CONSUMER_REQUEST_HINTS[type]}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Siparişteki e-posta adresiniz
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
              placeholder="ornek@eposta.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Talebiniz
            </label>
            <textarea
              required
              rows={4}
              minLength={CONSUMER_REQUEST_MESSAGE_MIN}
              maxLength={CONSUMER_REQUEST_MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input-base"
              placeholder="Talebinizi kısaca açıklayın."
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" loading={submitting} size="sm" className="!px-6 inline-flex">
              Gönder
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="!px-6 inline-flex"
              onClick={() => setOpen(false)}
            >
              Vazgeç
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
