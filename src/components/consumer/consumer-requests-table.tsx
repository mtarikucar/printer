"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  CONSUMER_REQUEST_LABELS,
  type ConsumerRequestType,
} from "@/lib/config/consumer-requests";

export interface ConsumerRequestRow {
  id: string;
  reference: string;
  orderNumber: string | null;
  type: ConsumerRequestType;
  status: string;
  message: string;
  contactEmail: string;
  forwardedAt: string | null;
  forwardFailedReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: "Yeni",
  forwarded: "Satıcıya iletildi",
  in_progress: "İşlemde",
  resolved: "Çözüldü",
  rejected: "Reddedildi",
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-amber-100 text-amber-800",
  forwarded: "bg-blue-100 text-blue-800",
  in_progress: "bg-indigo-100 text-indigo-800",
  resolved: "bg-green-100 text-green-800",
  rejected: "bg-gray-100 text-gray-700",
};

/**
 * Tüketici talepleri tablosu — admin ve satıcı panelinde paylaşılır.
 *
 * `canResolve` false ise salt okunur. Durum güncellemesi `endpoint`e PATCH
 * atar; satıcı ve admin farklı rotalar kullanır ama aynı gövdeyi gönderir.
 */
export function ConsumerRequestsTable({
  requests,
  endpoint,
}: {
  requests: ConsumerRequestRow[];
  endpoint: string;
}) {
  const [rows, setRows] = useState(requests);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function update(id: string, status: string) {
    setBusy(id);
    try {
      const res = await fetch(`${endpoint}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNote: note[id] ?? undefined }),
      });
      if (res.ok) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status, resolutionNote: note[id] ?? r.resolutionNote }
              : r
          )
        );
      }
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <Card padding="md">
        <p className="text-sm text-text-secondary">Henüz talep yok.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id} padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-text-primary">{r.reference}</span>
              <span className="text-sm text-text-secondary">
                {CONSUMER_REQUEST_LABELS[r.type]}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-xs ${
                  STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"
                }`}
              >
                {STATUS_LABELS[r.status] ?? r.status}
              </span>
            </div>
            <span className="text-xs text-text-muted">
              {new Date(r.createdAt).toLocaleString("tr-TR")}
            </span>
          </div>

          <div className="text-xs text-text-muted space-x-3">
            {r.orderNumber && <span>Sipariş: {r.orderNumber}</span>}
            <span>{r.contactEmail}</span>
            {/* m.12/A "derhal iletme" kanıtı — iletilememişse görünür olmalı. */}
            {r.forwardedAt ? (
              <span>İletildi: {new Date(r.forwardedAt).toLocaleString("tr-TR")}</span>
            ) : (
              <span className="text-red-600">
                Satıcıya İLETİLEMEDİ{r.forwardFailedReason ? ` — ${r.forwardFailedReason}` : ""}
              </span>
            )}
          </div>

          <p className="text-sm text-text-primary whitespace-pre-wrap">{r.message}</p>

          {r.resolutionNote && (
            <p className="text-sm text-text-secondary border-l-2 border-bg-subtle pl-3">
              {r.resolutionNote}
            </p>
          )}

          {r.status !== "resolved" && r.status !== "rejected" && (
            <div className="space-y-2 pt-2 border-t border-bg-subtle">
              <textarea
                rows={2}
                className="input-base"
                placeholder="Tüketiciye iletilecek yanıt (opsiyonel)"
                value={note[r.id] ?? ""}
                onChange={(e) => setNote((p) => ({ ...p, [r.id]: e.target.value }))}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="!px-4 inline-flex"
                  loading={busy === r.id}
                  onClick={() => update(r.id, "in_progress")}
                >
                  İşleme al
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="!px-4 inline-flex"
                  loading={busy === r.id}
                  onClick={() => update(r.id, "resolved")}
                >
                  Çözüldü
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="!px-4 inline-flex"
                  loading={busy === r.id}
                  onClick={() => update(r.id, "rejected")}
                >
                  Reddet
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
