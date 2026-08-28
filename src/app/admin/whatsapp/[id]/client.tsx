"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MAX_TEXT_LENGTH } from "@/lib/config/whatsapp";
import {
  MODE_BADGE,
  MODE_LABEL,
  SENDER_LABEL,
  STATUS_BADGE,
  STATUS_LABEL,
  formatRelative,
} from "../shared";

interface Conversation {
  id: string;
  phoneE164: string;
  profileName: string | null;
  mode: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  windowExpiresAt: string | null;
  kvkkNoticeSentAt: string | null;
  createdAt: string;
}

interface Message {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  mediaUrl: string | null;
  mediaKey: string | null;
  senderKind: string | null;
  status: string | null;
  errorCode: string | null;
  createdAt: string;
}

interface LinkedOrder {
  id: string;
  orderNumber: string;
  status: string;
}

// Going back to 'bot' is the one transition that can do real damage, so it is
// the one that has to be a deliberate click. Restoring a bot in the middle of
// an open complaint is how a complaint becomes a tüketici hakem heyeti file.
const MODE_CONFIRM: Record<string, string> = {
  bot:
    "Bu konuşmayı bota geri veriyorsunuz.\n\n" +
    "Devam eden bir şikâyetin ortasında botu sessizce geri açmak, şikâyeti " +
    "tüketici hakem heyeti dosyasına dönüştüren şeydir. Müşteriye verdiğiniz " +
    "sözler tamamlandıysa ve konuşmada açık bir talep kalmadıysa devam edin.\n\n" +
    "Bot bu konuşmaya yeniden yanıt versin mi?",
  human:
    "Konuşmayı siz devralıyorsunuz. Bot ve otomatik mesajlar bu konuşmada " +
    "susturulur; yalnızca yönetici yanıtları gider.",
  blocked:
    "Bu numara engellenecek. Bu konuşmaya bundan sonra HİÇBİR mesaj " +
    "gönderilmez — otomatik sipariş bildirimleri de dahil.",
};

export function ThreadClient({
  conversation,
  messages,
  orders,
  templates,
}: {
  conversation: Conversation;
  messages: Message[];
  orders: LinkedOrder[];
  templates: { key: string; name: string }[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState(templates[0]?.name ?? "");
  const [templateParams, setTemplateParams] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const now = Date.now();
  const expiresAt = conversation.windowExpiresAt
    ? new Date(conversation.windowExpiresAt).getTime()
    : 0;
  const windowOpen = expiresAt > now;
  const blocked = conversation.mode === "blocked";

  const post = async (url: string, payload: unknown) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "İşlem başarısız");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const sendText = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const ok = await post(`/api/admin/whatsapp/${conversation.id}/reply`, {
      body: trimmed,
    });
    if (ok) {
      setBody("");
      setNotice("Yanıt kuyruğa alındı. Gönderim durumu birazdan görünür.");
    }
  };

  const sendTemplate = async () => {
    if (!templateName) return;
    const params = templateParams
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    const ok = await post(`/api/admin/whatsapp/${conversation.id}/reply`, {
      templateName,
      templateParams: params,
    });
    if (ok) {
      setTemplateParams("");
      setNotice("Şablon kuyruğa alındı.");
    }
  };

  const changeMode = async (mode: string) => {
    if (mode === conversation.mode) return;
    if (!window.confirm(MODE_CONFIRM[mode])) return;
    await post(`/api/admin/whatsapp/${conversation.id}/mode`, { mode });
  };

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <Link
        href="/admin/whatsapp"
        className="text-sm text-gray-500 hover:text-gray-900"
      >
        ← Tüm konuşmalar
      </Link>

      <div className="mt-3 bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {conversation.profileName || "İsimsiz"}
            </h1>
            <p className="font-mono text-sm text-gray-500">
              {conversation.phoneE164}
            </p>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${MODE_BADGE[conversation.mode]}`}
          >
            {MODE_LABEL[conversation.mode]}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(["bot", "human", "blocked"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              disabled={busy || m === conversation.mode}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                m === conversation.mode
                  ? "bg-gray-100 text-gray-400 border-gray-200 cursor-default"
                  : m === "blocked"
                    ? "border-red-200 text-red-700 hover:bg-red-50"
                    : "border-gray-200 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {m === "bot"
                ? "Botu geri ver"
                : m === "human"
                  ? "Konuşmayı devral"
                  : "Engelle"}
            </button>
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <dt className="text-gray-500">Son gelen</dt>
            <dd className="text-gray-900">
              {conversation.lastInboundAt
                ? formatRelative(conversation.lastInboundAt, now)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Son giden</dt>
            <dd className="text-gray-900">
              {conversation.lastOutboundAt
                ? formatRelative(conversation.lastOutboundAt, now)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">KVKK bildirimi</dt>
            <dd className="text-gray-900">
              {conversation.kvkkNoticeSentAt ? "Gönderildi" : "Gönderilmedi"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Açılış</dt>
            <dd className="text-gray-900">
              {new Date(conversation.createdAt).toLocaleDateString("tr-TR")}
            </dd>
          </div>
        </dl>

        {orders.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">Bağlı siparişler:</span>
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="font-mono text-indigo-600 hover:underline"
              >
                {o.orderNumber}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div
        className={`mt-4 rounded-xl border p-4 text-sm ${
          windowOpen
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-amber-50 border-amber-200 text-amber-900"
        }`}
      >
        {windowOpen ? (
          <>
            <strong>24 saatlik hizmet penceresi açık</strong> —{" "}
            {formatRelative(conversation.windowExpiresAt!, now, true)}. Serbest
            metin yazabilirsiniz.
          </>
        ) : (
          <>
            <strong>Hizmet penceresi kapalı.</strong> Müşteri 24 saattir yazmadı;
            serbest metin Meta tarafından reddedilir (hata 131047) ve müşteriye
            hiçbir şey ulaşmaz. Yalnızca aşağıdaki onaylı şablonlardan biri
            gönderilebilir. Müşteri yanıt verdiği anda pencere yeniden açılır.
          </>
        )}
      </div>

      <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-6">
            Bu konuşmada henüz mesaj yok.
          </p>
        )}
        {messages.map((m) => {
          const inbound = m.direction === "in";
          return (
            <div
              key={m.id}
              className={`flex ${inbound ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 ${
                  inbound
                    ? "bg-gray-100 text-gray-900"
                    : "bg-green-50 border border-green-100 text-gray-900"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 mb-1">
                  <span>{inbound ? "Müşteri" : "Biz"}</span>
                  {!inbound && m.senderKind && (
                    <span className="font-medium text-gray-600">
                      {SENDER_LABEL[m.senderKind] ?? m.senderKind}
                    </span>
                  )}
                  <span>
                    {new Date(m.createdAt).toLocaleString("tr-TR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  {m.status && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full font-medium ${
                        STATUS_BADGE[m.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {STATUS_LABEL[m.status] ?? m.status}
                      {m.errorCode ? ` (${m.errorCode})` : ""}
                    </span>
                  )}
                </div>
                {m.mediaUrl && m.type === "image" && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.mediaUrl}
                    alt={m.body ?? "WhatsApp görseli"}
                    className="rounded-lg max-h-64 mb-1"
                  />
                )}
                {m.mediaUrl && m.type !== "image" && (
                  <a
                    href={m.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-indigo-600 hover:underline mb-1 break-all"
                  >
                    Ek: {m.mediaKey}
                  </a>
                )}
                {m.body && (
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {m.type === "template" ? `Şablon: ${m.body}` : m.body}
                  </p>
                )}
                {!m.body && !m.mediaUrl && (
                  <p className="text-sm text-gray-500">({m.type})</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 bg-white rounded-xl border border-gray-200 p-4">
        {blocked ? (
          <p className="text-sm text-gray-600">
            Bu konuşma engelli. Mesaj göndermek için önce engeli kaldırın.
          </p>
        ) : windowOpen ? (
          <>
            {conversation.mode === "bot" && (
              <p className="text-xs text-amber-700 mb-2">
                Konuşma bot modunda. Yanıtınız gider, ancak bot da yanıt vermeye
                devam eder. Konuşmayı tamamen devralmak için “Konuşmayı devral”.
              </p>
            )}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={MAX_TEXT_LENGTH}
              placeholder="Yanıtınızı yazın…"
              className="w-full text-sm border border-gray-200 rounded-lg p-2"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-400">
                {body.length}/{MAX_TEXT_LENGTH}
              </span>
              <button
                type="button"
                onClick={sendText}
                disabled={busy || body.trim().length === 0}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                Gönder
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-900 mb-2">
              Onaylı şablon gönder
            </p>
            <select
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg p-2 mb-2"
            >
              {templates.map((t) => (
                <option key={t.key} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
            <textarea
              value={templateParams}
              onChange={(e) => setTemplateParams(e.target.value)}
              rows={3}
              placeholder="Şablon değişkenleri — her satıra bir değer (boş bırakılabilir)"
              className="w-full text-sm border border-gray-200 rounded-lg p-2"
            />
            <div className="flex justify-end mt-2">
              <button
                type="button"
                onClick={sendTemplate}
                disabled={busy || !templateName}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                Şablonu gönder
              </button>
            </div>
          </>
        )}

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-2 text-sm text-green-700">{notice}</p>}
      </div>
    </div>
  );
}
