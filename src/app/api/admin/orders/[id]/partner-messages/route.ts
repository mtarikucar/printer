import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import {
  PARTNER_CHAT_MAX_BODY,
  PARTNER_CHAT_UNAVAILABLE_ERROR,
  countPartnerChannelUnread,
  createPartnerOrderMessage,
  isPartnerChatUnavailable,
  listPartnerOrderMessages,
  markPartnerChannelRead,
  type PartnerChatPartnerType,
} from "@/lib/services/order-partner-chat";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR, ADMIN_READ_FAILED_ERROR } from "@/lib/api/route-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Partner ↔ yönetici sipariş sohbetinin YÖNETİCİ tarafı (bugün boyacı kanalı).
 *
 * Boyacı tarafı (/api/painter/orders/[id]/messages) çoktan vardı: boyacı soru
 * yazabiliyor, satır veritabanına düşüyor ama yöneticinin onu göreceği ya da
 * cevaplayacağı bir uç yoktu — kanal tek yönlü çalışıyordu.
 *
 * Kanal `messages` tablosunda DEĞİL: `messages.channel` ve `sender_type` birer
 * pg enum ve geri alınabilir olması gereken bir şey için enum'a değer
 * eklenmez. Kanal kendi tablosunda yaşıyor (order_partner_messages, 0056).
 *
 * Partner kimliği HER ZAMAN siparişten okunur, gövdeden ya da sorgudan değil:
 * yönetici yalnız bu siparişin atanmış partneriyle yazışabilir.
 */
function parsePartner(request: NextRequest): PartnerChatPartnerType | null {
  const p = new URL(request.url).searchParams.get("partner");
  return p === "painter" || p === "manufacturer" ? p : null;
}

const PARTNER_TR: Record<PartnerChatPartnerType, string> = {
  painter: "boyacı",
  manufacturer: "üretici",
};

async function loadChannel(orderId: string, partnerType: PartnerChatPartnerType) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { id: true, orderNumber: true, painterId: true, manufacturerId: true },
  });
  if (!order) return { order: null, partnerId: null as string | null };
  const partnerId = partnerType === "painter" ? order.painterId : order.manufacturerId;
  return { order, partnerId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const partnerType = parsePartner(request);
    if (!partnerType) {
      return NextResponse.json(
        { error: "Geçersiz partner türü (boyacı ya da üretici olmalı)." },
        { status: 400 }
      );
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    const { order, partnerId } = await loadChannel(id, partnerType);
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    if (!partnerId) {
      // Hata değil: bu siparişte henüz o partner yok. Panel boş bir kanal ve
      // sebebini okunur bir cümleyle gösterir.
      return NextResponse.json({
        messages: [],
        unreadCount: 0,
        unavailable: `Bu siparişte atanmış ${PARTNER_TR[partnerType]} yok; yazışma kanalı atamayla açılır.`,
      });
    }

    const partner = { partnerType, partnerId };
    try {
      const [messages, unreadCount] = await Promise.all([
        listPartnerOrderMessages(order.id, partner, "admin"),
        countPartnerChannelUnread(order.id, partner, "admin"),
      ]);
      // Yönetici kanalı AÇTI: okundu damgası burada basılır. Ayrı bir /read ucu
      // yok, çünkü bu panelin tek okuma yolu bu istektir; damgasız kalırsa
      // sipariş listesindeki "okunmamış" rozeti hiç sönmez.
      await markPartnerChannelRead(order.id, partner, "admin").catch((e) =>
        console.error("admin partner-messages: mark read failed", e)
      );
      return NextResponse.json({ messages, unreadCount });
    } catch (err) {
      if (isPartnerChatUnavailable(err)) {
        // Migration uygulanmamış ortam: HTML 500 yerine boş kanal + Türkçe uyarı.
        return NextResponse.json({
          messages: [],
          unreadCount: 0,
          unavailable: PARTNER_CHAT_UNAVAILABLE_ERROR,
        });
      }
      console.error("admin partner-messages GET failed", err);
      return NextResponse.json({ error: "Mesajlar okunamadı." }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "GET /api/admin/orders/[id]/partner-messages", ADMIN_READ_FAILED_ERROR);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const partnerType = parsePartner(request);
    if (!partnerType) {
      return NextResponse.json(
        { error: "Geçersiz partner türü (boyacı ya da üretici olmalı)." },
        { status: 400 }
      );
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    const { order, partnerId } = await loadChannel(id, partnerType);
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    if (!partnerId) {
      return NextResponse.json(
        {
          error: `Bu siparişte atanmış ${PARTNER_TR[partnerType]} yok; mesaj gönderilemez.`,
        },
        { status: 400 }
      );
    }

    const raw = await request.json().catch(() => ({}));
    const body = String((raw as { body?: unknown })?.body ?? "").trim();
    if (!body) return NextResponse.json({ error: "Mesaj boş." }, { status: 400 });
    if (body.length > PARTNER_CHAT_MAX_BODY) {
      return NextResponse.json({ error: "Mesaj çok uzun." }, { status: 400 });
    }

    const partner = { partnerType, partnerId };
    try {
      // E-posta yalnız İLK okunmamış mesajda: partner panelde değilse haber
      // almalı, ama arka arkaya yazılan üç cümle üç e-posta etmemeli. `messages`
      // kanalının müşteri tarafında kurulan düzenin aynısı.
      const unreadBefore = await countPartnerChannelUnread(order.id, partner, "partner");

      const msgId = await createPartnerOrderMessage({
        orderId: order.id,
        partnerType,
        partnerId,
        sender: "admin",
        senderEmail: adminEmail,
        body,
      });

      if (unreadBefore === 0) {
        const subject = `Yöneticiden mesaj — ${order.orderNumber}`;
        const notice =
          `${order.orderNumber} numaralı iş için yöneticiden yeni bir mesajınız var:\n\n${body}\n\n` +
          "Cevabınızı panelden, işin kendi ekranından yazabilirsiniz.";
        if (partnerType === "painter") {
          await notifyPainter({
            painterId: partnerId,
            type: "admin_message",
            subject,
            body: notice,
            orderId: order.id,
          }).catch((e) => console.error("admin partner-messages: notifyPainter failed", e));
        } else {
          await notifyManufacturer({
            manufacturerId: partnerId,
            type: "admin_message",
            subject,
            body: notice,
            orderId: order.id,
          }).catch((e) =>
            console.error("admin partner-messages: notifyManufacturer failed", e)
          );
        }
      }

      return NextResponse.json({ success: true, id: msgId });
    } catch (err) {
      if (isPartnerChatUnavailable(err)) {
        return NextResponse.json({ error: PARTNER_CHAT_UNAVAILABLE_ERROR }, { status: 503 });
      }
      console.error("admin partner-messages POST failed", err);
      return NextResponse.json({ error: "Mesaj gönderilemedi." }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/partner-messages", ADMIN_ACTION_FAILED_ERROR);
  }
}
