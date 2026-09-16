import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import {
  PARTNER_CHAT_MAX_BODY,
  PARTNER_CHAT_UNAVAILABLE_ERROR,
  countPartnerChannelUnread,
  createPartnerOrderMessage,
  isPartnerChatUnavailable,
  listPartnerOrderMessages,
} from "@/lib/services/order-partner-chat";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR, PARTNER_READ_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Boyacı ↔ yönetici mesajlaşması (siparişe bağlı).
 *
 * Boyacının yöneticiye ulaşacak hiçbir kanalı yoktu: müşteri ve üretici
 * sohbet edebiliyordu, boyacı elindeki işle ilgili bir sorunu (hasarlı baskı,
 * eksik parça, renk sorusu) yalnız e-postayla soruyordu. Kanal ayrı bir
 * tabloda yaşıyor çünkü `messages.channel` bir pg enum'dur ve geri alınabilir
 * olması gereken bir şey için enum'a değer eklenmez.
 *
 * Kanal kimliği HER ZAMAN oturumdan gelir (gövdeden değil): boyacı yalnız
 * kendi işinin kanalını okur ve yazar.
 */
async function ownJob(orderId: string, painterId: string) {
  return db.query.orders.findFirst({
    where: and(eq(orders.id, orderId), eq(orders.painterId, painterId)),
    columns: { id: true },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;
    const job = await ownJob(id, g.painterId);
    if (!job) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });

    const partner = { partnerType: "painter" as const, partnerId: g.painterId };
    try {
      const [messages, unreadCount] = await Promise.all([
        listPartnerOrderMessages(job.id, partner, "partner"),
        countPartnerChannelUnread(job.id, partner, "partner"),
      ]);
      return NextResponse.json({ messages, unreadCount });
    } catch (err) {
      if (isPartnerChatUnavailable(err)) {
        // Migration henüz uygulanmadı: boş bir kanal + anlaşılır uyarı, HTML 500
        // değil. Boyacı yine de işine devam edebilir.
        return NextResponse.json(
          { messages: [], unreadCount: 0, unavailable: PARTNER_CHAT_UNAVAILABLE_ERROR },
          { status: 200 }
        );
      }
      console.error("painter messages GET failed", err);
      return NextResponse.json({ error: "Mesajlar okunamadı." }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "GET /api/painter/orders/[id]/messages", PARTNER_READ_FAILED_ERROR);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;
    const job = await ownJob(id, g.painterId);
    if (!job) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });

    const raw = await request.json().catch(() => ({}));
    const body = String((raw as { body?: unknown })?.body ?? "").trim();
    if (!body) return NextResponse.json({ error: "Mesaj boş." }, { status: 400 });
    if (body.length > PARTNER_CHAT_MAX_BODY) {
      return NextResponse.json({ error: "Mesaj çok uzun." }, { status: 400 });
    }

    try {
      const msgId = await createPartnerOrderMessage({
        orderId: job.id,
        partnerType: "painter",
        partnerId: g.painterId,
        sender: "painter",
        body,
      });
      return NextResponse.json({ success: true, id: msgId });
    } catch (err) {
      if (isPartnerChatUnavailable(err)) {
        return NextResponse.json({ error: PARTNER_CHAT_UNAVAILABLE_ERROR }, { status: 503 });
      }
      console.error("painter messages POST failed", err);
      return NextResponse.json({ error: "Mesaj gönderilemedi." }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/messages", PARTNER_ACTION_FAILED_ERROR);
  }
}
