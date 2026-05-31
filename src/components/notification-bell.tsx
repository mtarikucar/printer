"use client";

import { useCallback, useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

// Customer in-app notification bell (Faz 4). Polls every 30s for the unread
// count; opening the dropdown marks everything read.
export function NotificationBell() {
  const d = useDictionary();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/customer/notifications");
      if (r.ok) {
        const data = await r.json();
        setItems(data.notifications || []);
        setUnread(data.unreadCount || 0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Defer the initial fetch out of the synchronous effect body so its setState
    // doesn't trigger the cascading-render lint rule.
    const initial = setTimeout(load, 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [load]);

  // Realtime: refresh the instant a notification arrives (when mounted inside a
  // customer RealtimeProvider). The 30s poll above stays as a fallback.
  useRealtimeEvent((e) => {
    if (e.kind === "notification" && e.scope === "customer") load();
  });

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      try {
        await fetch("/api/customer/notifications/read", { method: "POST" });
        setUnread(0);
        setItems((prev) => prev.map((i) => ({ ...i, read: true })));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative p-2 rounded-full hover:bg-bg-elevated transition-colors"
        aria-label={d["notif.title"]}
      >
        <svg className="w-5 h-5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-bg-surface border border-bg-subtle rounded-xl shadow-lg z-50">
          <div className="px-4 py-2 border-b border-bg-subtle">
            <span className="text-sm font-medium text-text-primary">{d["notif.title"]}</span>
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-sm text-text-muted text-center">{d["notif.empty"]}</p>
          ) : (
            <div className="divide-y divide-bg-subtle">
              {items.map((n) => (
                <div key={n.id} className={`px-4 py-3 ${n.read ? "" : "bg-green-500/5"}`}>
                  <p className="text-sm font-medium text-text-primary">{n.title}</p>
                  <p className="text-xs text-text-muted mt-0.5">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
