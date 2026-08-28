/**
 * Presentation helpers shared by the WhatsApp inbox list (server) and the
 * thread view (client). Pure — no DB, no `server-only`.
 */

export const MODE_LABEL: Record<string, string> = {
  bot: "Bot",
  human: "İnsan",
  blocked: "Engelli",
};

export const MODE_BADGE: Record<string, string> = {
  bot: "bg-blue-100 text-blue-700",
  human: "bg-amber-100 text-amber-700",
  blocked: "bg-red-100 text-red-700",
};

export const SENDER_LABEL: Record<string, string> = {
  admin: "Yönetici",
  bot: "Bot",
  agent: "Asistan",
  system: "Sistem",
};

export const STATUS_LABEL: Record<string, string> = {
  sent: "Gönderildi",
  delivered: "İletildi",
  read: "Okundu",
  failed: "Başarısız",
};

export const STATUS_BADGE: Record<string, string> = {
  sent: "bg-gray-100 text-gray-600",
  delivered: "bg-blue-100 text-blue-700",
  read: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

/** One-line summary of a message for the list column. */
export function previewText(body: string | null, type: string): string {
  if (type === "image") return body ? `📷 ${body}` : "📷 Fotoğraf";
  if (type === "video") return body ? `🎥 ${body}` : "🎥 Video";
  if (type === "template") return `📄 Şablon: ${body ?? ""}`;
  if (type === "buttons") return `🔘 ${body ?? ""}`;
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!text) return `(${type})`;
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/**
 * Coarse relative time in Turkish. `future` flips the phrasing, which is what
 * the service-window column needs ("18 sa kaldı", not "18 sa önce").
 */
export function formatRelative(
  at: Date | string,
  now: number = Date.now(),
  future = false
): string {
  const ms = Math.abs(
    (typeof at === "string" ? new Date(at).getTime() : at.getTime()) - now
  );
  const suffix = future ? "kaldı" : "önce";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return future ? "birazdan" : "az önce";
  if (minutes < 60) return `${minutes} dk ${suffix}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa ${suffix}`;
  const days = Math.floor(hours / 24);
  return `${days} gün ${suffix}`;
}
