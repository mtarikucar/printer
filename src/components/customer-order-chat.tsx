"use client";

import { useEffect, useState } from "react";
import { OrderChat } from "@/components/order-chat";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Card } from "@/components/ui";

type OwnerState = { note: string; editable: boolean } | null | false;

// Customer chat + special-instructions note. Owner-gated: the messages GET is
// owner-scoped, so a guest tracking someone else's order gets a non-OK response
// and this renders nothing.
export function CustomerOrderChat({ orderNumber }: { orderNumber: string }) {
  const d = useDictionary();
  const base = `/api/customer/orders/${encodeURIComponent(orderNumber)}/messages`;
  const [state, setState] = useState<OwnerState>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then(async (r) => {
        if (!r.ok) return false as const;
        const data = await r.json();
        return { note: data.customerNote || "", editable: !!data.noteEditable };
      })
      .then((v) => {
        if (!cancelled) setState(v);
      })
      .catch(() => {
        if (!cancelled) setState(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (!state) return null; // loading (null) or not owner (false) → render nothing

  return (
    <Card className="p-6 sm:p-8 space-y-6">
      <NoteEditor orderNumber={orderNumber} initialNote={state.note} editable={state.editable} />
      <div>
        <h2 className="text-lg font-serif text-text-primary mb-3">{d["chat.title"]}</h2>
        <OrderChat basePath={base} />
      </div>
    </Card>
  );
}

function NoteEditor({
  orderNumber,
  initialNote,
  editable,
}: {
  orderNumber: string;
  initialNote: string;
  editable: boolean;
}) {
  const d = useDictionary();
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(
        `/api/customer/orders/${encodeURIComponent(orderNumber)}/note`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        }
      );
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-lg font-serif text-text-primary mb-1">{d["track.note.title"]}</h2>
      {!editable ? (
        <>
          {note && <p className="text-sm text-text-secondary whitespace-pre-wrap mt-1">{note}</p>}
          <p className="text-xs text-text-muted mt-1">{d["track.note.locked"]}</p>
        </>
      ) : (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={d["track.note.placeholder"]}
            className="w-full mt-2 px-3 py-2 border border-bg-subtle rounded-xl text-sm bg-bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
            >
              {saving ? d["track.note.saving"] : d["track.note.save"]}
            </button>
            {saved && <span className="text-xs text-green-600">{d["track.note.saved"]}</span>}
          </div>
        </>
      )}
    </div>
  );
}
