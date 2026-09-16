"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";

interface PartnerMessage {
  id: string;
  sender: "painter" | "manufacturer" | "admin";
  body: string;
  createdAt: string;
  mine: boolean;
}

/**
 * Boyacı ↔ yönetici mesajlaşması (iş kartının içinde).
 *
 * Paylaşılan `OrderChat` bileşeni KULLANILMADI: o bileşen gönderici türü
 * olarak yalnız customer/admin/manufacturer bilir ve `messages` tablosunun
 * uçlarına bağlıdır. Boyacı kanalı ayrı bir tabloda yaşıyor (pg enum'a
 * "painter_admin" değeri eklemek geri alınamazdı), bu yüzden kanalın kendi
 * küçük paneli var.
 *
 * Mesajlar YALNIZ panel açıldığında çekilir: iş listesinde 20 kart olabilir,
 * hepsinin açılışta istek atması sayfayı yorardı.
 */
export function JobChat({
  orderId,
  unreadCount,
}: {
  orderId: string;
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<PartnerMessage[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/painter/orders/${orderId}/messages`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) {
        setError("Mesajlar okunamadı.");
        return;
      }
      const data = await res.json();
      setMessages(data.messages ?? []);
      setUnavailable(typeof data.unavailable === "string" ? data.unavailable : null);
      setError(null);
    } catch {
      setError("Mesajlar okunamadı.");
    }
  }, [base]);

  // Panel açıkken yönetici yazarsa anında görünsün (boyacı SSE konusu).
  useRealtimeEvent((e) => {
    if (open && e.kind === "message" && e.orderId === orderId) void refresh();
  });

  useEffect(() => {
    if (!open) return;
    void refresh();
    // Açıkken yöneticiden gelenleri okundu işaretle: kartın rozeti ancak
    // böylece sıfırlanır.
    void fetch(`${base}/read`, { method: "POST" }).catch(() => {});
  }, [open, refresh, base]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Mesaj gönderilemedi.");
        return;
      }
      setText("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >
        <span>Yönetici ile mesajlaş</span>
        <span className="flex items-center gap-2">
          {unreadCount > 0 && !open && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
              {unreadCount} yeni
            </span>
          )}
          <span className="text-gray-400">{open ? "Kapat" : "Aç"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 p-3">
          {unavailable ? (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{unavailable}</p>
          ) : (
            <>
              <div className="mb-2 max-h-56 space-y-2 overflow-y-auto">
                {messages == null ? (
                  <p className="text-xs text-gray-400">Yükleniyor…</p>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    Henüz mesaj yok. İşle ilgili bir sorun varsa (hasarlı parça, eksik
                    bilgi, renk sorusu) buradan yazabilirsiniz.
                  </p>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${
                          m.mine
                            ? "bg-indigo-600 text-white"
                            : "border border-gray-200 bg-white text-gray-800"
                        }`}
                      >
                        {!m.mine && (
                          <p className="mb-0.5 text-[10px] font-semibold opacity-70">
                            Yönetici
                          </p>
                        )}
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Yöneticiye mesaj yazın"
                  maxLength={4000}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy || !text.trim()}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Gönder
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
