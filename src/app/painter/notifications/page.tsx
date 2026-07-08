"use client";

import { useEffect, useState } from "react";

interface Notification {
  id: string;
  type: string;
  subject: string;
  body: string;
  orderId: string | null;
  readAt: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  order_assigned: { label: "İş Atandı", color: "bg-indigo-100 text-indigo-700" },
  admin_message: { label: "Admin Mesajı", color: "bg-amber-100 text-amber-700" },
  system_announcement: { label: "Duyuru", color: "bg-blue-100 text-blue-700" },
  payout: { label: "Ödeme", color: "bg-green-100 text-green-700" },
};

export default function PainterNotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/painter/notifications");
      if (!res.ok) {
        setError("Bildirimler yüklenemedi");
        return;
      }
      const data = await res.json();
      setItems(data.notifications);
    } catch {
      setError("Bir hata oluştu");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const markAllRead = async () => {
    await fetch("/api/painter/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    void load();
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Bildirimler</h1>
        {items && items.some((n) => !n.readAt) && (
          <button
            onClick={markAllRead}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Tümünü okundu işaretle
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {items === null ? (
        <p className="text-gray-400 text-sm">Yükleniyor…</p>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          Henüz bildirim yok.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const meta = TYPE_LABELS[n.type] ?? {
              label: n.type,
              color: "bg-gray-100 text-gray-700",
            };
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-4 ${
                  n.readAt ? "bg-white border-gray-200" : "bg-indigo-50/40 border-indigo-200"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{n.subject}</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{n.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
