"use client";

import { useCallback, useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Card } from "@/components/ui";

const CATEGORIES = ["not_as_described", "damaged", "not_received", "other"] as const;

interface DisputeState {
  canOpen: boolean;
  dispute: { status: string; resolution: string | null } | null;
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

  const load = useCallback(async () => {
    try {
      const r = await fetch(base);
      if (!r.ok) {
        setState(false);
        return;
      }
      setState((await r.json()) as DisputeState);
    } catch {
      setState(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  if (!state) return null;

  const submit = async () => {
    if (description.trim().length < 5) return;
    setSubmitting(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, description }),
      });
      if (res.ok) {
        setOpen(false);
        setDescription("");
        await load();
      }
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
            {d[`track.dispute.cat.${c}` as keyof typeof d]}
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
