export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, waConversations } from "@/lib/db/schema";
import { listMessages } from "@/lib/services/whatsapp-conversation";
import { getPublicUrl } from "@/lib/services/storage";
import { WA_TEMPLATES } from "@/lib/config/whatsapp";
import { ThreadClient } from "./client";

export default async function AdminWhatsAppThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [conversation] = await db
    .select()
    .from(waConversations)
    .where(eq(waConversations.id, id))
    .limit(1);
  if (!conversation) notFound();

  // listMessages returns newest-first (it is a "last N" query); the thread
  // reads oldest-first.
  const rows = (await listMessages(id, 200)).reverse();

  const linkedOrders = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.waConversationId, id))
    .orderBy(desc(orders.createdAt))
    .limit(10);

  return (
    <ThreadClient
      conversation={{
        id: conversation.id,
        phoneE164: conversation.phoneE164,
        profileName: conversation.profileName,
        mode: conversation.mode,
        lastInboundAt: conversation.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: conversation.lastOutboundAt?.toISOString() ?? null,
        windowExpiresAt: conversation.windowExpiresAt?.toISOString() ?? null,
        kvkkNoticeSentAt: conversation.kvkkNoticeSentAt?.toISOString() ?? null,
        createdAt: conversation.createdAt.toISOString(),
      }}
      messages={rows.map((m) => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        body: m.body,
        // Inbound photos live in our own storage; the admin sees them through
        // the same signed /api/files URL as everywhere else.
        mediaUrl: m.mediaKey ? getPublicUrl(m.mediaKey) : null,
        mediaKey: m.mediaKey,
        senderKind: m.senderKind,
        status: m.status,
        errorCode: m.errorCode,
        createdAt: m.createdAt.toISOString(),
      }))}
      orders={linkedOrders}
      templates={Object.entries(WA_TEMPLATES).map(([key, name]) => ({
        key,
        name,
      }))}
    />
  );
}
