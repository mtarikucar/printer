import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderPartnerMessages, orders } from "@/lib/db/schema";
import { emitOrderMessage } from "@/lib/realtime/emit";
import { isUnread } from "@/lib/services/order-messages";

/**
 * Partner ↔ admin per-order chat — bugün BOYACI kanalı.
 *
 * NEDEN AYRI TABLO, `messages` DEĞİL: `messages.channel` bir pg enum
 * (message_channel) ve `messages.sender_type` de öyle. "painter_admin" /
 * "painter" değerlerini eklemek, geri alma migration'ının temiz şekilde
 * kaldıramayacağı iki enum değeri demekti (Faz 2 kuralı: kaldırılabilmesi
 * gereken bir şey için pg enum'a değer EKLENMEZ). Bu yüzden kanal, `text`
 * ayırıcıları olan kendi tablosunda yaşıyor: yeni bir partner türü eklemek
 * migration istemez.
 *
 * TABLO TANIMI schema.ts'TE: drizzle-kit yalnızca schema.ts'i tarar, bu yüzden
 * tanım burada kalsaydı tablo için migration ÜRETİLEMEZ ve tablo veritabanında
 * hiç oluşmazdı — sohbet 42P01 ile kapalı kalırdı. Migration 0056 onu yaratır;
 * yine de her okuma/yazma, migration uygulanmamış bir ortamda
 * `PARTNER_CHAT_UNAVAILABLE` ile anlaşılır bir Türkçe cevaba döner, 500'e
 * değil.
 */
// Tablo tanımı ARTIK schema.ts'te (migration 0056). Eski içe aktarmalar
// kırılmasın diye buradan yeniden dışa aktarılıyor.
export { orderPartnerMessages };

export type PartnerChatPartnerType = "painter" | "manufacturer";
export type PartnerChatSender = PartnerChatPartnerType | "admin";

export interface SerializedPartnerMessage {
  id: string;
  sender: PartnerChatSender;
  senderEmail: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
}

/** Mesaj gövdesinin üst sınırı — `messages` rotalarıyla aynı. */
export const PARTNER_CHAT_MAX_BODY = 4000;

export const PARTNER_CHAT_UNAVAILABLE_ERROR =
  "Boyacı mesajlaşması henüz etkinleştirilmedi (veritabanı güncellemesi bekleniyor). Lütfen yönetici ile e-posta üzerinden iletişime geçin.";

/**
 * Tablo henüz yok mu (migration uygulanmamış)?
 *
 * Drizzle 0.45 pg hatasını SARAR: yakalanan hatanın `.code`'u undefined'dır,
 * gerçek kod `.cause` üzerindedir (bkz. drizzle-error-wrapping notu). İkisine
 * de bakılır.
 */
export function isPartnerChatUnavailable(err: unknown): boolean {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code?: unknown }).code)
      : null;
  return code(err) === "42P01" || code((err as { cause?: unknown })?.cause) === "42P01";
}

export async function createPartnerOrderMessage(args: {
  orderId: string;
  partnerType: PartnerChatPartnerType;
  partnerId: string;
  sender: PartnerChatSender;
  senderEmail?: string | null;
  body: string;
}): Promise<string> {
  const [row] = await db
    .insert(orderPartnerMessages)
    .values({
      orderId: args.orderId,
      partnerType: args.partnerType,
      partnerId: args.partnerId,
      sender: args.sender,
      senderEmail: args.senderEmail ?? null,
      body: args.body,
    })
    .returning({ id: orderPartnerMessages.id });

  // Realtime: karşı tarafın ekranı anket beklemeden tazelensin. Best-effort —
  // realtime arızası mesajın yazılmasını geri almaz.
  try {
    const ord = await db.query.orders.findFirst({
      where: eq(orders.id, args.orderId),
      columns: { orderNumber: true, userId: true, manufacturerId: true, painterId: true },
    });
    if (ord) {
      await emitOrderMessage({
        orderId: args.orderId,
        orderNumber: ord.orderNumber,
        channel: `${args.partnerType}_admin`,
        senderType: args.sender,
        userId: ord.userId,
        manufacturerId: ord.manufacturerId,
        painterId: ord.painterId,
      });
    }
  } catch {
    /* best-effort realtime */
  }

  return row.id;
}

export async function listPartnerOrderMessages(
  orderId: string,
  partner: { partnerType: PartnerChatPartnerType; partnerId: string },
  viewer: "admin" | "partner"
): Promise<SerializedPartnerMessage[]> {
  const rows = await db
    .select()
    .from(orderPartnerMessages)
    .where(
      and(
        eq(orderPartnerMessages.orderId, orderId),
        eq(orderPartnerMessages.partnerType, partner.partnerType),
        eq(orderPartnerMessages.partnerId, partner.partnerId)
      )
    )
    .orderBy(asc(orderPartnerMessages.createdAt));
  return rows.map((m) => ({
    id: m.id,
    sender: m.sender as PartnerChatSender,
    senderEmail: m.senderEmail,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: viewer === "admin" ? m.sender === "admin" : m.sender !== "admin",
  }));
}

export async function markPartnerChannelRead(
  orderId: string,
  partner: { partnerType: PartnerChatPartnerType; partnerId: string },
  viewer: "admin" | "partner"
): Promise<void> {
  const scope = and(
    eq(orderPartnerMessages.orderId, orderId),
    eq(orderPartnerMessages.partnerType, partner.partnerType),
    eq(orderPartnerMessages.partnerId, partner.partnerId)
  );
  if (viewer === "admin") {
    await db
      .update(orderPartnerMessages)
      .set({ readByAdminAt: new Date() })
      .where(
        and(scope, isNull(orderPartnerMessages.readByAdminAt), ne(orderPartnerMessages.sender, "admin"))
      );
    return;
  }
  await db
    .update(orderPartnerMessages)
    .set({ readByPartnerAt: new Date() })
    .where(
      and(scope, isNull(orderPartnerMessages.readByPartnerAt), eq(orderPartnerMessages.sender, "admin"))
    );
}

/**
 * Okunmamış sayısı. Kural `order-messages.ts`'in `isUnread`'inden gelir —
 * iki kanalın okundu mantığı tek ve test edilmiş bir yerde kalsın diye
 * (satırlar "counterparty" yerine "partner" adını taşıyor, eşleme burada).
 */
export async function countPartnerChannelUnread(
  orderId: string,
  partner: { partnerType: PartnerChatPartnerType; partnerId: string },
  viewer: "admin" | "partner"
): Promise<number> {
  const rows = await db
    .select({
      sender: orderPartnerMessages.sender,
      readByAdminAt: orderPartnerMessages.readByAdminAt,
      readByPartnerAt: orderPartnerMessages.readByPartnerAt,
    })
    .from(orderPartnerMessages)
    .where(
      and(
        eq(orderPartnerMessages.orderId, orderId),
        eq(orderPartnerMessages.partnerType, partner.partnerType),
        eq(orderPartnerMessages.partnerId, partner.partnerId)
      )
    );
  return rows.reduce(
    (n, r) =>
      isUnread(viewer === "admin" ? "admin" : "counterparty", {
        // order-messages'ın birleşimi partner türlerini "manufacturer" olarak
        // temsil eder; tek sorduğu "admin mi, değil mi".
        senderType: r.sender === "admin" ? "admin" : "manufacturer",
        readByAdminAt: r.readByAdminAt,
        readByCounterpartyAt: r.readByPartnerAt,
      })
        ? n + 1
        : n,
    0
  );
}

/** Admin ekranı için: bir siparişte boyacı kanalında okunmamış var mı. */
export async function partnerChannelSummary(
  orderId: string,
  partner: { partnerType: PartnerChatPartnerType; partnerId: string }
): Promise<{ total: number; unreadForAdmin: number }> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(orderPartnerMessages)
    .where(
      and(
        eq(orderPartnerMessages.orderId, orderId),
        eq(orderPartnerMessages.partnerType, partner.partnerType),
        eq(orderPartnerMessages.partnerId, partner.partnerId)
      )
    );
  const unreadForAdmin = await countPartnerChannelUnread(orderId, partner, "admin");
  return { total: row?.total ?? 0, unreadForAdmin };
}
