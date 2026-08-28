import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { waConversations, waInboundEvents, waMessages } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/phone";
import { SERVICE_WINDOW_MS } from "@/lib/config/whatsapp";

/**
 * The WhatsApp conversation store.
 *
 * Deliberately NOT the existing `messages` table: that one has a NOT NULL
 * `orderId` FK, so it cannot hold a thread that exists before an order, and its
 * sender enum has no value a bot could legally use.
 *
 * NOTE: no `import "server-only"` — this runs inside the BullMQ worker.
 */

export type ConversationMode = "bot" | "human" | "blocked";

/**
 * Record a webhook delivery. Returns false when we have seen this exact
 * delivery before.
 *
 * Meta retries a delivery for up to 36 hours until it gets a 200, so this is
 * the outermost of three dedupe layers (delivery → message id → BullMQ jobId).
 *
 * `ON CONFLICT DO NOTHING RETURNING` on purpose: we never catch 23505, because
 * drizzle 0.45 wraps pg errors and hides the code on `.cause` — code that
 * catches it is latently broken (the gift-card path already is).
 */
export async function recordInboundEvent(
  eventHash: string,
  payload: unknown
): Promise<boolean> {
  const inserted = await db
    .insert(waInboundEvents)
    .values({ eventHash, payload: payload as never })
    .onConflictDoNothing()
    .returning({ id: waInboundEvents.id });
  return inserted.length > 0;
}

export async function getOrCreateConversation(args: {
  phone: string;
  waId?: string | null;
  profileName?: string | null;
}): Promise<{ id: string; mode: ConversationMode; isNew: boolean; kvkkNoticeSentAt: Date | null }> {
  const phoneE164 = normalizePhone(args.phone) ?? `+${args.phone.replace(/\D/g, "")}`;

  const existing = await db
    .select()
    .from(waConversations)
    .where(eq(waConversations.phoneE164, phoneE164))
    .limit(1);
  if (existing.length > 0) {
    const row = existing[0];
    return {
      id: row.id,
      mode: row.mode as ConversationMode,
      isNew: false,
      kvkkNoticeSentAt: row.kvkkNoticeSentAt,
    };
  }

  const inserted = await db
    .insert(waConversations)
    .values({
      phoneE164,
      waId: args.waId ?? null,
      profileName: args.profileName ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    return { id: inserted[0].id, mode: "bot", isNew: true, kvkkNoticeSentAt: null };
  }

  // Lost the race with a concurrent delivery — read the winner's row.
  const [row] = await db
    .select()
    .from(waConversations)
    .where(eq(waConversations.phoneE164, phoneE164))
    .limit(1);
  return {
    id: row.id,
    mode: row.mode as ConversationMode,
    isNew: false,
    kvkkNoticeSentAt: row.kvkkNoticeSentAt,
  };
}

/**
 * Stamp an inbound message and (re)open the 24-hour service window.
 *
 * The window resets on EVERY inbound message, which is why it is stored rather
 * than derived at send time from the last message alone.
 */
export async function touchInbound(conversationId: string): Promise<void> {
  const now = new Date();
  await db
    .update(waConversations)
    .set({
      lastInboundAt: now,
      windowExpiresAt: new Date(now.getTime() + SERVICE_WINDOW_MS),
      updatedAt: now,
    })
    .where(eq(waConversations.id, conversationId));
}

/**
 * Whether free-form messages are still allowed.
 *
 * Checked at SEND time, never at enqueue time. An admin approving a model at
 * 03:00, thirty hours after the customer's last message, is a normal Tuesday —
 * and getting this wrong is the most likely way this system quietly holds
 * somebody's money while saying nothing.
 */
export async function isWindowOpen(conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ windowExpiresAt: waConversations.windowExpiresAt })
    .from(waConversations)
    .where(eq(waConversations.id, conversationId))
    .limit(1);
  if (!row?.windowExpiresAt) return false;
  return row.windowExpiresAt.getTime() > Date.now();
}

/** Store a message. Returns false when this wamid was already recorded. */
export async function recordMessage(args: {
  conversationId: string;
  direction: "in" | "out";
  waMessageId?: string | null;
  type?: string;
  body?: string | null;
  mediaKey?: string | null;
  senderKind?: "admin" | "bot" | "agent" | "system" | null;
  status?: string | null;
  errorCode?: string | null;
}): Promise<boolean> {
  if (args.waMessageId) {
    const inserted = await db
      .insert(waMessages)
      .values({
        conversationId: args.conversationId,
        direction: args.direction,
        waMessageId: args.waMessageId,
        type: args.type ?? "text",
        body: args.body ?? null,
        mediaKey: args.mediaKey ?? null,
        senderKind: args.senderKind ?? null,
        status: args.status ?? null,
        errorCode: args.errorCode ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: waMessages.id });
    return inserted.length > 0;
  }

  await db.insert(waMessages).values({
    conversationId: args.conversationId,
    direction: args.direction,
    type: args.type ?? "text",
    body: args.body ?? null,
    mediaKey: args.mediaKey ?? null,
    senderKind: args.senderKind ?? null,
    status: args.status ?? null,
    errorCode: args.errorCode ?? null,
  });
  return true;
}

export async function setMode(
  conversationId: string,
  mode: ConversationMode
): Promise<void> {
  await db
    .update(waConversations)
    .set({
      mode,
      blockedAt: mode === "blocked" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(waConversations.id, conversationId));
}

export async function markKvkkNoticeSent(conversationId: string): Promise<void> {
  await db
    .update(waConversations)
    .set({ kvkkNoticeSentAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(waConversations.id, conversationId),
        sql`${waConversations.kvkkNoticeSentAt} is null`
      )
    );
}

export async function listConversations(limit = 50) {
  return db
    .select()
    .from(waConversations)
    .orderBy(desc(waConversations.lastInboundAt))
    .limit(limit);
}

export async function listMessages(conversationId: string, limit = 200) {
  return db
    .select()
    .from(waMessages)
    .where(eq(waMessages.conversationId, conversationId))
    .orderBy(desc(waMessages.createdAt))
    .limit(limit);
}
