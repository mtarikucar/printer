export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, waConversations } from "@/lib/db/schema";
import { listMessages } from "@/lib/services/whatsapp-conversation";
import { getPublicUrl } from "@/lib/services/storage";
import { WA_TEMPLATES } from "@/lib/config/whatsapp";
import { ThreadClient } from "./client";

/**
 * GÖSTERİM amaçlı okuma: sonucu ekranda yalnızca GÖSTERİLİR, bir kapıyı açıp
 * kapatmaz. Arıza YUTULMAZ — null döner ve null "kayıt yok" DEĞİL "BİLİNMİYOR"
 * demektir; bayrak sayfanın üstündeki şeritte yazılır.
 *
 * NEDEN: mesaj listesi ile bağlı sipariş listesi, konuşmanın KENDİSİYLE aynı
 * ifadede okunuyordu. Yalnız gösterilen bir tablo (ya da onun altındaki
 * `orders`) okunamadığında sayfanın TAMAMI 500 veriyor, admin de müşteriye
 * yazacak alanı hiç göremiyordu — oysa konuşma satırı okunabiliyordu.
 */
async function displayRead<T>(
  label: string,
  conversationId: string,
  query: PromiseLike<T>
): Promise<T | null> {
  try {
    return await query;
  } catch (e) {
    console.error(`[whatsapp ${conversationId}] ${label} okunamadı`, e);
    return null;
  }
}

/** Hangi GÖSTERİM alanı okunamadı: şerit sayfanın en üstünde basılır. */
function ThreadReadNotice({ areas }: { areas: string[] }) {
  if (areas.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">
        Bu konuşmanın bazı bilgileri şu anda okunamıyor (geçici sistem arızası)
      </p>
      <p className="mt-1 text-amber-900/80">
        Konuşma açıldı; ama şu bölümler BOŞ DEĞİL, BİLİNMİYOR: {areas.join(" · ")}.
        Boş görünmeleri &quot;kayıt yok&quot; anlamına gelmez; hiçbir mesaj
        silinmedi. Yanıt yazmadan önce birkaç dakika sonra sayfayı yenileyin.
      </p>
    </div>
  );
}

export default async function AdminWhatsAppThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // ÇEKİRDEK OKUMA: konuşmanın kendisi. Bu satır okunamazsa gösterilecek bir
  // konuşma da yoktur — kimliği arızaya dayanarak uydurmak yerine sayfa düşer.
  const [conversation] = await db
    .select()
    .from(waConversations)
    .where(eq(waConversations.id, id))
    .limit(1);
  if (!conversation) notFound();

  // Yalnız GÖSTERİLEN iki liste: AYRI ve KORUMALI okunur.
  const [messageRead, linkedRead] = await Promise.all([
    // listMessages returns newest-first (it is a "last N" query); the thread
    // reads oldest-first.
    displayRead("konuşma mesajları", id, listMessages(id, 200)),
    displayRead(
      "bağlı siparişler",
      id,
      db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
        })
        .from(orders)
        .where(eq(orders.waConversationId, id))
        .orderBy(desc(orders.createdAt))
        .limit(10)
    ),
  ]);

  const rows = messageRead === null ? [] : [...messageRead].reverse();
  const linkedOrders = linkedRead ?? [];
  const unreadableAreas = [
    messageRead === null &&
      "Konuşma geçmişi (müşterinin yazdıkları BOŞ değil, okunamıyor — yanıtınızı bu boş listeye bakarak yazmayın)",
    linkedRead === null && "Bu numaraya bağlı siparişler",
  ].filter((x): x is string => typeof x === "string");

  return (
    <>
      <ThreadReadNotice areas={unreadableAreas} />
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
    </>
  );
}
