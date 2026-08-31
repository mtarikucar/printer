import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { rateLimitAsync } from "@/lib/services/rate-limit";
import { getClientIp } from "@/lib/utils/request";
import {
  createConsumerRequest,
  findConsumerRequestByReference,
} from "@/lib/services/consumer-requests";
import {
  isConsumerRequestType,
  CONSUMER_REQUEST_MESSAGE_MIN,
  CONSUMER_REQUEST_MESSAGE_MAX,
} from "@/lib/config/consumer-requests";

/**
 * Tüketici talep kanalı — MSY m.12/A.
 *
 * Erişim modeli sipariş takibiyle AYNI: sipariş numarası + siparişteki e-posta.
 * Misafir alışverişi mevcut olduğu için giriş şartı koymak, m.12/A'nın
 * "kesintisiz" ibaresini ihlal ederdi — hesabı olmayan tüketici talebini
 * iletemezdi.
 */

export async function POST(request: NextRequest) {
  const ip = await getClientIp();
  // Talep kanalı kapatılamaz ama kötüye kullanıma da açık bırakılamaz; kayıt
  // açmak e-posta gönderiyor. Sipariş+IP başına dar, IP başına geniş sınır.
  const perIp = await rateLimitAsync(`creq:ip:${ip}`, 20, 60 * 60_000);
  if (!perIp.success) {
    return NextResponse.json(
      { error: "Çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const orderNumber = String(body.orderNumber ?? "").trim();
  const contactEmail = String(body.contactEmail ?? "").trim().toLowerCase();
  const type = body.type;
  const message = String(body.message ?? "").trim();

  if (!orderNumber || !contactEmail) {
    return NextResponse.json(
      { error: "Sipariş numarası ve e-posta zorunludur." },
      { status: 400 }
    );
  }
  if (!isConsumerRequestType(type)) {
    return NextResponse.json({ error: "Geçersiz talep türü." }, { status: 400 });
  }
  if (
    message.length < CONSUMER_REQUEST_MESSAGE_MIN ||
    message.length > CONSUMER_REQUEST_MESSAGE_MAX
  ) {
    return NextResponse.json(
      {
        error: `Mesaj ${CONSUMER_REQUEST_MESSAGE_MIN}-${CONSUMER_REQUEST_MESSAGE_MAX} karakter olmalıdır.`,
      },
      { status: 400 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.orderNumber, orderNumber),
    columns: { id: true, email: true, userId: true },
  });

  // Sipariş yoksa veya e-posta tutmuyorsa AYNI cevabı veriyoruz: aksi hâlde
  // form, bir e-postanın hangi siparişe ait olduğunu sızdıran bir orakl olurdu.
  if (!order || order.email.trim().toLowerCase() !== contactEmail) {
    return NextResponse.json(
      { error: "Sipariş numarası ve e-posta eşleşmedi." },
      { status: 404 }
    );
  }

  const perOrder = await rateLimitAsync(`creq:order:${order.id}`, 5, 60 * 60_000);
  if (!perOrder.success) {
    return NextResponse.json(
      { error: "Bu sipariş için çok fazla talep açıldı." },
      { status: 429 }
    );
  }

  try {
    const result = await createConsumerRequest({
      orderId: order.id,
      userId: order.userId,
      type,
      message,
      contactEmail,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { error: "Talep oluşturulamadı. Lütfen tekrar deneyin." },
      { status: 500 }
    );
  }
}

/** Takip — m.12/A'nın "takip edilebilir" şartı. */
export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get("reference")?.trim() ?? "";
  const email = request.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!reference || !email) {
    return NextResponse.json(
      { error: "Referans ve e-posta gereklidir." },
      { status: 400 }
    );
  }

  const ip = await getClientIp();
  const limited = await rateLimitAsync(`creqget:${ip}`, 60, 60 * 60_000);
  if (!limited.success) {
    return NextResponse.json({ error: "Çok fazla sorgu." }, { status: 429 });
  }

  const found = await findConsumerRequestByReference(reference, email);
  if (!found) {
    return NextResponse.json({ error: "Talep bulunamadı." }, { status: 404 });
  }

  return NextResponse.json({
    reference: found.reference,
    type: found.type,
    status: found.status,
    message: found.message,
    // Satıcıya iletildiği an — tüketici bunu görebilmeli.
    forwardedAt: found.forwardedAt,
    resolutionNote: found.resolutionNote,
    resolvedAt: found.resolvedAt,
    createdAt: found.createdAt,
  });
}
