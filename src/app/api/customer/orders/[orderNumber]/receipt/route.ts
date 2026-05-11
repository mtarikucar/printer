import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { saveFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { getSessionUser } from "@/lib/services/customer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { RECEIPT_MAX_SIZE_BYTES } from "@/lib/config/payment";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

function detectReceiptType(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null {
  const img = validateImageMagicBytes(buffer);
  if (img) return img;
  if (
    buffer.length >= PDF_MAGIC.length &&
    PDF_MAGIC.every((b, i) => buffer[i] === b)
  ) {
    return "application/pdf";
  }
  return null;
}

function extForType(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);
  const { orderNumber } = await params;

  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: d["api.auth.notLoggedIn"] },
      { status: 401 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.orderNumber, orderNumber),
      eq(orders.userId, session.userId)
    ),
  });
  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }
  if (order.paymentMethod !== "bank_transfer") {
    return NextResponse.json(
      { error: "Bu sipariş havale ile ödenmiyor" },
      { status: 400 }
    );
  }
  if (order.paymentStatus !== "awaiting_transfer") {
    return NextResponse.json(
      { error: "Bu sipariş için dekont yüklenemez" },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: d["api.upload.noFile"] }, { status: 400 });
  }
  if (file.size > RECEIPT_MAX_SIZE_BYTES) {
    return NextResponse.json({ error: d["api.upload.tooLarge"] }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectReceiptType(buffer);
  if (!detected) {
    return NextResponse.json(
      { error: d["api.upload.invalidFormat"] },
      { status: 400 }
    );
  }

  const filename = `${nanoid()}.${extForType(detected)}`;
  const key = await saveFile(buffer, `receipts/${order.id}`, filename);

  await db
    .update(orders)
    .set({
      bankTransferReceiptKey: key,
      bankTransferReceiptUploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  // Notify admin — link points to authenticated admin receipt endpoint
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const adminReceiptUrl = `${appUrl}/api/admin/orders/${order.id}/receipt`;
    await getEmailQueue().add("send-email", {
      type: "bank_transfer_receipt_received",
      to: adminEmail,
      adminEmail,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      photoUrl: adminReceiptUrl,
      locale: "tr",
    });
  }

  return NextResponse.json({
    success: true,
    receiptUrl: `/api/customer/orders/${order.orderNumber}/receipt/view`,
  });
}
