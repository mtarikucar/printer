"use client";

import { useRef, useState } from "react";
import { useOrderChat } from "@/lib/hooks/use-order-chat";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

// Shared per-order chat panel used by customer / manufacturer / admin. Channel
// isolation + auth are enforced server-side; this component only knows its
// endpoint (`basePath` + optional admin `query`).
export function OrderChat({
  basePath,
  query = "",
  canSend = true,
  active = true,
  heightClass = "h-80",
}: {
  basePath: string;
  query?: string;
  canSend?: boolean;
  active?: boolean;
  heightClass?: string;
}) {
  const d = useDictionary();
  const loc = useLocale() as Locale;
  const { messages, loaded, error, sending, send } = useOrderChat({ basePath, query, active });
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onSend = async () => {
    if (!text.trim() && !file) return;
    const ok = await send(text, file);
    if (ok) {
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const senderLabel = (t: string) =>
    t === "admin"
      ? d["chat.admin"]
      : t === "manufacturer"
        ? d["admin.chat.manufacturerTab"]
        : d["admin.chat.customerTab"];

  return (
    <div className="flex flex-col">
      <div
        className={`${heightClass} overflow-y-auto space-y-3 p-3 bg-gray-50 rounded-xl border border-gray-100`}
      >
        {!loaded ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">{d["chat.empty"]}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.mine
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-gray-200 text-gray-800"
                }`}
              >
                {!m.mine && (
                  <p className="text-[10px] font-semibold opacity-70 mb-0.5">
                    {senderLabel(m.senderType)}
                  </p>
                )}
                {m.attachmentUrl && (
                  <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.attachmentUrl} alt="" className="rounded-lg mb-1 max-h-48 object-cover" />
                  </a>
                )}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <p className={`text-[10px] mt-0.5 ${m.mine ? "text-indigo-200" : "text-gray-400"}`}>
                  {formatDateTime(m.createdAt, loc)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {error === "load" && <p className="text-xs text-red-600 mt-1">{d["chat.loadError"]}</p>}

      {canSend ? (
        <div className="mt-3 flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="shrink-0 w-10 h-10 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center"
            aria-label={d["chat.attach"]}
            title={d["chat.attach"]}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <div className="flex-1">
            {file && <p className="text-[11px] text-gray-500 mb-1 truncate">📎 {file.name}</p>}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={d["chat.placeholder"]}
              className="w-full resize-none px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || (!text.trim() && !file)}
            className="shrink-0 px-4 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {sending ? d["chat.sending"] : d["chat.send"]}
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-400 mt-2 text-center">{d["chat.loginToSend"]}</p>
      )}
    </div>
  );
}
