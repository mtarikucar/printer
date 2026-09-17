"use client";

import { useCallback, useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Card } from "@/components/ui";
import { DISPUTE_CATEGORY_LABELS_TR } from "@/lib/config/dispute-resolution";

const CATEGORIES = Object.keys(DISPUTE_CATEGORY_LABELS_TR) as Array<keyof typeof DISPUTE_CATEGORY_LABELS_TR>;
const money = (value: number) => (value / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });

interface DisputeState {
  canOpen: boolean;
  dispute: { status: string; resolution: string | null; resolvedAt: string | null; refund: { cashKurus: number; giftKurus: number } | null } | null;
}

// Customer-facing "report a problem" flow. Owner-gated by the dispute GET
// (401/404 → renders nothing). Shows the existing dispute's status if one exists.
export function OrderDispute({ orderNumber }: { orderNumber: string }) {
  const d = useDictionary();
  const base = `/api/customer/orders/${encodeURIComponent(orderNumber)}/dispute`;
  const [state, setState] = useState<DisputeState | null | false>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("not_as_described");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setReadError(null);
    try {
      const r = await fetch(base, { cache: "no-store" });
      if (r.status === 401 || r.status === 404) { setState(false); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Anlaşmazlık kaydınız şu anda okunamıyor.");
      if (typeof data.canOpen !== "boolean" || !(data.dispute === null || typeof data.dispute?.status === "string")) throw new Error("Anlaşmazlık yanıtı doğrulanamadı.");
      setState(data as DisputeState);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Anlaşmazlık kaydınız şu anda okunamıyor.");
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  if (readError) return <Card padding="md"><p role="alert" className="text-sm text-red-700">{readError}</p><button type="button" onClick={load} className="mt-2 text-sm underline">Kaydı yeniden yükle</button></Card>;
  if (!state) return null;

  const submit = async () => {
    if (description.trim().length < 5) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description }),
      });
      const body = await res.json();
      if (!res.ok || body.ok !== true) throw new Error(body.error || "Anlaşmazlık kaydı doğrulanamadı. Aynı açıklamayla tekrar deneyin.");
      setOpen(false);
      setDescription("");
      await load();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Anlaşmazlık kaydı doğrulanamadı. Aynı açıklamayla tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  };

  if (state.dispute) {
    const key =
      state.dispute.status === "open"
        ? "track.dispute.open"
        : state.dispute.status === "resolved"
          ? "track.dispute.resolved"
          : "track.dispute.rejected";
    return (
      <Card padding="md">
        <p className="font-medium text-text-primary mb-1">{d["track.dispute.title"]}</p>
        <p className="text-sm text-text-secondary">{d[key as keyof typeof d]}</p>
        {state.dispute.resolution && (
          <p className="text-sm text-text-muted mt-1">{state.dispute.resolution}</p>
        )}
        {state.dispute.status !== "open" && <>
          <p className="mt-2 text-xs text-text-muted">{state.dispute.resolvedAt ? `Karar tarihi: ${new Date(state.dispute.resolvedAt).toLocaleString("tr-TR")}` : "Eski kayıtta karar tarihi bulunmuyor."}</p>
          {state.dispute.refund ? <p className="mt-2 text-sm text-text-secondary">Bu kararla kaydedilen iade: nakit {money(state.dispute.refund.cashKurus)} · hediye kartı {money(state.dispute.refund.giftKurus)}.</p>
            : <p className="mt-2 text-xs text-text-muted">Bu karara bağlı doğrulanmış bir iade tutarı gösterilemiyor.</p>}
        </>}
      </Card>
    );
  }

  if (!state.canOpen) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-red-500 hover:text-red-600 font-medium"
      >
        {d["track.dispute.button"]}
      </button>
    );
  }

  return (
    <Card padding="md" className="space-y-3">
      <p className="font-medium text-text-primary">{d["track.dispute.title"]}</p>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full px-3 py-2 border border-bg-subtle rounded-lg text-sm bg-bg-surface text-text-primary"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {d[`track.dispute.cat.${c}` as keyof typeof d] || DISPUTE_CATEGORY_LABELS_TR[c]}
          </option>
        ))}
      </select>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder={d["track.dispute.description"]}
        className="w-full px-3 py-2 border border-bg-subtle rounded-lg text-sm bg-bg-surface text-text-primary"
      />
      {submitError && <p role="alert" className="text-sm text-red-700">{submitError}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(false)}
          className="px-4 py-1.5 text-sm border border-bg-subtle rounded-lg text-text-secondary"
        >
          {d["common.cancel"] || "İptal"}
        </button>
        <button
          onClick={submit}
          disabled={submitting || description.trim().length < 5}
          className="px-4 py-1.5 bg-red-600 text-white text-sm rounded-lg disabled:bg-gray-400"
        >
          {d["track.dispute.submit"]}
        </button>
      </div>
    </Card>
  );
}
