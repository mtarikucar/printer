import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, orderPhotos } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";

/**
 * Admin add/remove reference photos on an existing order. Photos are uploaded
 * first via /api/admin/orders/upload-photo (which returns storage keys); this
 * route attaches them as order_photos rows (POST) or detaches one (DELETE).
 * Used for WhatsApp / admin-fulfilled orders whose reference photos change after
 * the order was created.
 */
const addSchema = z.object({
  photoKeys: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { id: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
  }

  const rows = await db
    .insert(orderPhotos)
    .values(
      parsed.data.photoKeys.map((key) => ({
        orderId: id,
        originalUrl: getPublicUrl(key),
      }))
    )
    .returning({ id: orderPhotos.id, originalUrl: orderPhotos.originalUrl });

  return NextResponse.json({ ok: true, photos: rows });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const photoId = body?.photoId;
  if (typeof photoId !== "string") {
    return NextResponse.json({ error: "photoId gerekli." }, { status: 400 });
  }

  await db
    .delete(orderPhotos)
    .where(and(eq(orderPhotos.id, photoId), eq(orderPhotos.orderId, id)));

  return NextResponse.json({ ok: true });
}
