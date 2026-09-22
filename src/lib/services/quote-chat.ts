/**
 * Teklif sohbeti (müşteri ↔ admin).
 *
 * Sipariş sohbetinin ikinci bir kopyası DEĞİLDİR ama kurallarını paylaşır:
 * ek dosya `saveChatAttachment` ile (tek kaydetme yolu, EXIF temizleme dahil),
 * okunmamış sayımı `isUnread` ile, platform dışına çıkarma sezgisi
 * `containsContactInfo` ile. Ayrı bir tablo (`quote_messages`) olmasının sebebi
 * teknik: `messages.order_id` NOT NULL'dur ve `sender_type` bir pg enum'dur —
 * enum değeri geri alınamadığı için teklif buraya sığamazdı.
 *
 * Kanal SUNUCUDA sabittir: müşteri yalnız "customer" olarak yazar, admin yalnız
 * "admin". Gövdeden gelen bir rol asla okunmaz.
 */
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { quoteMessages, quotes } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { saveChatAttachment, type SerializedMessage } from "@/lib/services/order-chat";
import { containsContactInfo, isUnread } from "@/lib/services/order-messages";
import { notifyQuoteMessage } from "@/lib/services/quote-notify";
import { QuoteServiceError } from "@/lib/services/quote-service";
import { getPublicUrl } from "@/lib/services/storage";

export const MAX_MESSAGE_LENGTH = 4000;

export type QuoteChatViewer = "customer" | "admin";

/** `isUnread` iki katılımcı bilir: "admin" ve "karşı taraf" (burada müşteri). */
function unreadViewer(viewer: QuoteChatViewer): "admin" | "counterparty" {
  return viewer === "admin" ? "admin" : "counterparty";
}

export async function listQuoteMessages(
  quoteId: string,
  viewer: QuoteChatViewer
): Promise<{ messages: SerializedMessage[]; unreadCount: number }> {
  const rows = await db
    .select()
    .from(quoteMessages)
    .where(eq(quoteMessages.quoteId, quoteId))
    .orderBy(asc(quoteMessages.createdAt));

  const messages: SerializedMessage[] = rows.map((m) => ({
    id: m.id,
    senderType: m.sender,
    body: m.body,
    // Küçük resim varsa O gönderilir: sohbet balonu tam boy bir fotoğrafı
    // indirmek zorunda kalmasın.
    attachmentUrl: m.attachmentThumbnailKey
      ? getPublicUrl(m.attachmentThumbnailKey)
      : m.attachmentKey
        ? getPublicUrl(m.attachmentKey)
        : null,
    createdAt: m.createdAt.toISOString(),
    mine: m.sender === viewer,
  }));

  const who = unreadViewer(viewer);
  const unreadCount = rows.reduce(
    (n, m) =>
      isUnread(who, {
        senderType: m.sender,
        readByAdminAt: m.readByAdminAt,
        readByCounterpartyAt: m.readByCustomerAt,
      })
        ? n + 1
        : n,
    0
  );
  return { messages, unreadCount };
}

export async function createQuoteMessage(args: {
  quoteId: string;
  sender: QuoteChatViewer;
  senderUserId?: string | null;
  senderEmail?: string | null;
  body: string;
  file?: File | null;
}): Promise<void> {
  const body = args.body.trim();
  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new QuoteServiceError(
      `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`,
      400,
      "message_too_long"
    );
  }
  if (!body && !args.file) {
    throw new QuoteServiceError("Boş mesaj gönderilemez.", 400, "empty_message");
  }

  let attachmentKey: string | null = null;
  let attachmentThumbnailKey: string | null = null;
  if (args.file) {
    try {
      const saved = await saveChatAttachment(args.file);
      attachmentKey = saved.attachmentKey;
      attachmentThumbnailKey = saved.attachmentThumbnailKey;
    } catch {
      // `saveChatAttachment` teknik etiketler fırlatır (ATTACHMENT_TOO_LARGE /
      // INVALID_IMAGE); müşteri Türkçe tek bir cümle görmeli.
      throw new QuoteServiceError(
        "Ek dosya yalnız 20 MB'a kadar JPEG veya PNG olabilir.",
        400,
        "invalid_attachment"
      );
    }
  }

  await db.insert(quoteMessages).values({
    quoteId: args.quoteId,
    sender: args.sender,
    senderUserId: args.senderUserId ?? null,
    senderEmail: args.senderEmail ?? null,
    body,
    attachmentKey,
    attachmentThumbnailKey,
    // Platform dışına taşıma sezgisi: mesajı ENGELLEMEZ, admin incelemesi için
    // işaretler (sipariş sohbetiyle aynı kural).
    flagged: containsContactInfo(body),
  });

  // Canlı yayın ve bildirim EN İYİ ÇABA: mesaj yazıldıktan sonra Redis ya da
  // SMTP arızası isteği düşürmemeli.
  try {
    const [quote] = await db
      .select({ userId: quotes.userId })
      .from(quotes)
      .where(eq(quotes.id, args.quoteId))
      .limit(1);
    const to = [topics.quote(args.quoteId), topics.admin()];
    if (quote?.userId) to.push(topics.customer(quote.userId));
    await publishRealtime(to, {
      kind: "message",
      // Sohbet bileşeni olayları `orderId` alanına göre süzer; teklif sohbetinde
      // o alan teklifin kimliğidir (kanal adı ikisini ayırır).
      orderId: args.quoteId,
      channel: "quote",
      senderType: args.sender,
    });
  } catch {
    /* en iyi çaba */
  }
  void notifyQuoteMessage(args.quoteId, args.sender);
}

/** Karşı tarafın mesajlarını okundu işaretler (kendi mesajları sayılmaz). */
export async function markQuoteMessagesRead(
  quoteId: string,
  viewer: QuoteChatViewer
): Promise<void> {
  if (viewer === "admin") {
    await db
      .update(quoteMessages)
      .set({ readByAdminAt: new Date() })
      .where(
        and(
          eq(quoteMessages.quoteId, quoteId),
          isNull(quoteMessages.readByAdminAt),
          ne(quoteMessages.sender, "admin")
        )
      );
    return;
  }
  await db
    .update(quoteMessages)
    .set({ readByCustomerAt: new Date() })
    .where(
      and(
        eq(quoteMessages.quoteId, quoteId),
        isNull(quoteMessages.readByCustomerAt),
        eq(quoteMessages.sender, "admin")
      )
    );
}
