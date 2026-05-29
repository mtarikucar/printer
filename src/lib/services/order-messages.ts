// Pure helpers for the per-order, two-channel messaging system. Dependency-free
// so the channel-isolation + unread rules are a single tested source of truth
// (scripts/test-order-messages.ts) reused by the customer/manufacturer/admin
// message routes.

export type MessageChannel = "customer_admin" | "manufacturer_admin";
export type MessageSenderType = "customer" | "admin" | "manufacturer";

/**
 * Channel a non-admin sender is allowed to write to / read from. Derived from
 * the authenticated role on the server — NEVER from the request body — so a
 * customer can never name `manufacturer_admin` and vice-versa.
 */
export function channelForSender(role: "customer" | "manufacturer"): MessageChannel {
  return role === "customer" ? "customer_admin" : "manufacturer_admin";
}

interface UnreadMessage {
  senderType: MessageSenderType;
  readByAdminAt: Date | string | null;
  readByCounterpartyAt: Date | string | null;
}

/**
 * Whether a message is unread for the given viewer. Each channel has exactly two
 * participants — the admin and one counterparty (customer or manufacturer) — so
 * two read-timestamps fully describe read state.
 *   - admin:        unread = inbound (non-admin) message not yet seen by admin
 *   - counterparty: unread = admin message not yet seen by the counterparty
 */
export function isUnread(
  viewer: "admin" | "counterparty",
  msg: UnreadMessage
): boolean {
  if (viewer === "admin") {
    return msg.senderType !== "admin" && msg.readByAdminAt == null;
  }
  return msg.senderType === "admin" && msg.readByCounterpartyAt == null;
}

export function countUnread(
  viewer: "admin" | "counterparty",
  msgs: UnreadMessage[]
): number {
  return msgs.reduce((n, m) => (isUnread(viewer, m) ? n + 1 : n), 0);
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/i;
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;

/**
 * Heuristic flag for disintermediation attempts (sharing off-platform contact
 * so customer↔manufacturer can deal directly). Flags emails, URLs, and any run
 * of 10+ digits (Turkish phone numbers). This sets `messages.flagged` for admin
 * review — it does NOT block the message.
 */
export function containsContactInfo(body: string): boolean {
  if (EMAIL_RE.test(body) || URL_RE.test(body)) return true;
  const digitsOnly = body.replace(/[\s().+-]/g, "");
  return /\d{10,}/.test(digitsOnly);
}
