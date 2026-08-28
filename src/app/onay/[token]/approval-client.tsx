"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import type { ApprovalView } from "@/lib/services/model-approval";

type Choice = "approved" | "revision" | "cancelled";

/**
 * The customer's print-approval gate.
 *
 * Three buttons, not two. The distance-selling contract (md. 117) says an order
 * may be cancelled free of charge before the preview is approved and production
 * starts — and this page IS that window. Leaving the cancel button out would
 * turn a contractual right into a support ticket.
 */
export function ApprovalClient({ token, view }: { token: string; view: ApprovalView }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: Choice) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/onay/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note: decision === "revision" ? note : undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      setDone(decision);
    } catch {
      setError("Kaydedemedik. Lütfen birkaç saniye sonra tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  if (view.decided && !done) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Bu model için kararınızı almıştık</h1>
        <p className="mt-3 text-text-secondary">
          {view.orderNumber} numaralı siparişiniz için tekrar bir işlem yapmanıza gerek yok.
        </p>
        <Link href={`/track/${view.orderNumber}`} className="mt-6 inline-block underline">
          Siparişimi takip et
        </Link>
      </main>
    );
  }

  if (done) {
    const message =
      done === "approved"
        ? "Onayınızı aldık — figürünüz baskıya giriyor."
        : done === "revision"
          ? "Değişiklik talebinizi aldık. Ekibimiz sizinle iletişime geçecek."
          : "Siparişiniz iptal talebine alındı. İadeniz için sizinle iletişime geçeceğiz.";
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Teşekkürler!</h1>
        <p className="mt-3 text-text-secondary">{message}</p>
        <Link href={`/track/${view.orderNumber}`} className="mt-6 inline-block underline">
          Siparişimi takip et
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">
        {view.customerName}, figürünüzün 3D modeli hazır
      </h1>
      <p className="mt-2 text-text-secondary">
        Baskıya başlamadan önce onayınızı istiyoruz. Sipariş no: <strong>{view.orderNumber}</strong>
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-surface">
        {view.turntableUrl ? (
          <video
            src={view.turntableUrl}
            autoPlay
            loop
            muted
            playsInline
            controls
            className="w-full"
          />
        ) : (
          <p className="p-8 text-center text-text-secondary">
            Önizleme videosu hazırlanıyor. Birkaç dakika sonra tekrar bakabilirsiniz.
          </p>
        )}
      </div>

      <div className="mt-8 space-y-3">
        <Button
          onClick={() => submit("approved")}
          disabled={busy}
          className="w-full"
        >
          Onaylıyorum, baskıya başlansın
        </Button>

        <button
          type="button"
          onClick={() => setChoice(choice === "revision" ? null : "revision")}
          className="w-full rounded-lg border border-border px-4 py-3 text-sm hover:bg-surface-hover"
        >
          Değişiklik istiyorum
        </button>

        {choice === "revision" && (
          <div className="rounded-lg border border-border p-4">
            <label className="block text-sm font-medium">Neyi değiştirelim?</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={800}
              className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="Örn. saç kısmı fotoğraftaki gibi değil"
            />
            <p className="mt-2 text-xs text-text-secondary">
              Bir kez ücretsiz revizyon hakkınız var.
            </p>
            <Button
              onClick={() => submit("revision")}
              disabled={busy || note.trim().length < 3}
              className="mt-3 w-full"
            >
              Değişiklik talebini gönder
            </Button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setChoice(choice === "cancelled" ? null : "cancelled")}
          className="w-full rounded-lg px-4 py-3 text-sm text-text-secondary underline"
        >
          Vazgeç ve siparişi iptal et
        </button>

        {choice === "cancelled" && (
          <div className="rounded-lg border border-danger/40 p-4">
            <p className="text-sm">
              Üretim henüz başlamadığı için siparişinizi ücretsiz iptal edebilirsiniz. Ödemeniz
              iade edilir.
            </p>
            <Button
              variant="secondary"
              onClick={() => submit("cancelled")}
              disabled={busy}
              className="mt-3 w-full"
            >
              Evet, iptal et
            </Button>
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <p className="mt-8 text-xs text-text-secondary">
        Üretim, siz onaylayana kadar başlamaz.
      </p>
    </main>
  );
}
