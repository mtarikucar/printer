import { eq, and, asc, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import {
  containsContactInfo,
  isUnread,
  type MessageChannel,
  type MessageSenderType,
} from "@/lib/services/order-messages";

export interface SerializedMessage {
  id: string;
  senderType: MessageSenderType;
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
  mine: boolean;
}

// Save a chat image attachment under chat-attachments/. Re-encodes via sharp to
// strip EXIF. Throws on oversized / non-image input.
export async function saveChatAttachment(
  file: File
): Promise<{ attachmentKey: string; attachmentThumbnailKey: string | null }> {
  if (file.size > 10 * 1024 * 1024) throw new Error("ATTACHMENT_TOO_LARGE");
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = validateImageMagicBytes(buffer);
  if (!detected || !["image/jpeg", "image/png"].includes(detected)) {
    throw new Error("INVALID_IMAGE");
  }
  const isPng = detected === "image/png";
  const ext = isPng ? "png" : "jpg";
  let mainBuffer: Buffer = buffer;
  let attachmentThumbnailKey: string | null = null;
  try {
    const oriented = sharp(buffer).rotate();
    mainBuffer = await (isPng
      ? oriented.png()
      : oriented.jpeg({ quality: 90 })
    ).toBuffer();
    const thumb = await sharp(buffer)
      .rotate()
      .resize(600, 600, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();
    attachmentThumbnailKey = await saveFile(thumb, "chat-attachments", `${nanoid()}.jpg`);
  } catch {
    mainBuffer = buffer;
    attachmentThumbnailKey = null;
  }
  const attachmentKey = await saveFile(mainBuffer, "chat-attachments", `${nanoid()}.${ext}`);
  return { attachmentKey, attachmentThumbnailKey };
}

export async function createOrderMessage(args: {
  orderId: string;
  channel: MessageChannel;
  senderType: MessageSenderType;
  senderId?: string | null;
  senderEmail?: string | null;
  body: string;
  attachmentKey?: string | null;
  attachmentThumbnailKey?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(messages)
    .values({
      orderId: args.orderId,
      channel: args.channel,
      senderType: args.senderType,
      senderId: args.senderId ?? null,
      senderEmail: args.senderEmail ?? null,
      body: args.body,
      attachmentKey: args.attachmentKey ?? null,
      attachmentThumbnailKey: args.attachmentThumbnailKey ?? null,
      // Disintermediation heuristic (off-platform contact) → admin can review.
      flagged: containsContactInfo(args.body),
    })
    .returning({ id: messages.id });
  return row.id;
}

// All messages for a channel, oldest first, tagged `mine` for the viewer.
export async function listOrderMessages(
  orderId: string,
  channel: MessageChannel,
  viewerSenderType: MessageSenderType
): Promise<SerializedMessage[]> {
  const rows = await db.query.messages.findMany({
    where: and(eq(messages.orderId, orderId), eq(messages.channel, channel)),
    orderBy: [asc(messages.createdAt)],
  });
  return rows.map((m) => ({
    id: m.id,
    senderType: m.senderType,
    body: m.body,
    attachmentUrl: m.attachmentThumbnailKey
      ? getPublicUrl(m.attachmentThumbnailKey)
      : m.attachmentKey
        ? getPublicUrl(m.attachmentKey)
        : null,
    createdAt: m.createdAt.toISOString(),
    mine: m.senderType === viewerSenderType,
  }));
}

export async function markChannelRead(
  orderId: string,
  channel: MessageChannel,
  viewer: "admin" | "counterparty"
): Promise<void> {
  if (viewer === "admin") {
    await db
      .update(messages)
      .set({ readByAdminAt: new Date() })
      .where(
        and(
          eq(messages.orderId, orderId),
          eq(messages.channel, channel),
          isNull(messages.readByAdminAt),
          ne(messages.senderType, "admin")
        )
      );
  } else {
    await db
      .update(messages)
      .set({ readByCounterpartyAt: new Date() })
      .where(
        and(
          eq(messages.orderId, orderId),
          eq(messages.channel, channel),
          isNull(messages.readByCounterpartyAt),
          eq(messages.senderType, "admin")
        )
      );
  }
}

export async function countChannelUnread(
  orderId: string,
  channel: MessageChannel,
  viewer: "admin" | "counterparty"
): Promise<number> {
  const rows = await db.query.messages.findMany({
    where: and(eq(messages.orderId, orderId), eq(messages.channel, channel)),
    columns: { senderType: true, readByAdminAt: true, readByCounterpartyAt: true },
  });
  return rows.reduce((n, m) => (isUnread(viewer, m) ? n + 1 : n), 0);
}
