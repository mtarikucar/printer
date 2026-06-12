"use client";

import { useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";

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
  order_assigned: { label: "Sipariş Atandı", color: "bg-indigo-100 text-indigo-700" },
  order_cancelled: { label: "Sipariş İptal", color: "bg-red-100 text-red-700" },
  admin_message: { label: "Admin Mesajı", color: "bg-amber-100 text-amber-700" },
  system_announcement: { label: "Duyuru", color: "bg-blue-100 text-blue-700" },
};

export default function ManufacturerNotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/manufacturer/notifications");
      if (!res.ok) {
        setError("Bildirimler yüklenemedi");
        return;
      }
      const data = await res.json();
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch {
      setError("Bir hata oluştu");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Realtime: refresh the instant a new manufacturer notification arrives (this
  // page is mounted inside the manufacturer RealtimeProvider).
  useRealtimeEvent((e) => {
    if (e.kind === "notification" && e.scope === "manufacturer") void load();
  });

  const markAllRead = async () => {
    await fetch("/api/manufacturer/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    await load();
  };

  const markRead = async (id: string) => {
    await fetch("/api/manufacturer/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", id }),
    });
    await load();
  };

  if (error) {
    return (
      <div className="p-4 sm:p-8">
        <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="p-4 sm:p-8 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bildirimler</h1>
          <p className="text-sm text-gray-500 mt-1">
            Admin mesajları, sipariş atamaları ve sistem duyuruları.
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Tümünü okundu işaretle ({unread})
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-500">
          Henüz bildirim yok.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const typeInfo = TYPE_LABELS[n.type] ?? {
              label: n.type,
              color: "bg-gray-100 text-gray-700",
            };
            const isUnread = !n.readAt;
            return (
              <button
                key={n.id}
                onClick={() => isUnread && markRead(n.id)}
                className={`w-full text-left bg-white rounded-xl border p-5 transition-shadow hover:shadow-sm ${
                  isUnread ? "border-indigo-200 ring-1 ring-indigo-100" : "border-gray-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeInfo.color}`}>
                    {typeInfo.label}
                  </span>
                  {isUnread && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
                  <span className="ml-auto text-[11px] text-gray-400">
                    {new Date(n.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-gray-900">{n.subject}</h3>
                <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{n.body}</p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
