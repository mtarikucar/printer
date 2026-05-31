"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";

export interface ChatMessage {
  id: string;
  senderType: "customer" | "admin" | "manufacturer";
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
  mine: boolean;
}

// Per-order chat state with polling. `basePath` is the messages endpoint
// (e.g. /api/manufacturer/orders/<id>/messages); `query` carries the admin
// channel param. Polls every 10s while `active` (panel open) and visible.
// To later upgrade to SSE, swap the polling effect for an EventSource on
// `${basePath}/stream${query}` — the returned contract stays identical.
export function useOrderChat({
  basePath,
  query = "",
  active,
  orderId,
}: {
  basePath: string;
  query?: string;
  active: boolean;
  // When provided, only realtime message events for THIS order trigger a
  // refresh. Omit on pre-scoped streams (e.g. the public track page, whose
  // stream already carries a single order's events).
  orderId?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<"load" | "send" | null>(null);
  const [sending, setSending] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const listUrl = `${basePath}${query}`;
  const readUrl = `${basePath}/read${query}`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(listUrl);
      if (!res.ok) {
        setError("load");
        return;
      }
      const data = await res.json();
      setMessages(data.messages || []);
      setUnreadCount(data.unreadCount || 0);
      setError(null);
      setLoaded(true);
    } catch {
      setError("load");
    }
  }, [listUrl]);

  // Realtime: refresh the moment a message event for this order arrives via the
  // surface's SSE stream. No-ops when rendered outside a RealtimeProvider, so
  // the polling effect below remains the fallback.
  useRealtimeEvent((e) => {
    if (e.kind === "message" && (!orderId || e.orderId === orderId)) {
      refresh();
    }
  });

  const markRead = useCallback(async () => {
    try {
      await fetch(readUrl, { method: "POST" });
      setUnreadCount(0);
    } catch {
      /* best-effort */
    }
  }, [readUrl]);

  const send = useCallback(
    async (body: string, file?: File | null): Promise<boolean> => {
      if (!body.trim() && !file) return false;
      setSending(true);
      try {
        const form = new FormData();
        form.append("body", body);
        if (file) form.append("file", file);
        const res = await fetch(listUrl, { method: "POST", body: form });
        if (!res.ok) {
          setError("send");
          return false;
        }
        await refresh();
        return true;
      } catch {
        setError("send");
        return false;
      } finally {
        setSending(false);
      }
    },
    [listUrl, refresh]
  );

  useEffect(() => {
    refresh();
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(tick, active ? 10000 : 30000);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, active]);

  // Auto-mark-read while the panel is open and there's something unread.
  useEffect(() => {
    if (active && loaded && unreadCount > 0) markRead();
  }, [active, loaded, unreadCount, markRead]);

  return { messages, unreadCount, loaded, error, sending, send, markRead, refresh };
}
