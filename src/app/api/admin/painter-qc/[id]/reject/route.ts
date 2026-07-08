import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, painterQcReviews, painterQcPhotos } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";

const schema = z.object({ reason: z.string().trim().min(1, "Gerekçe gerekli").max(2000) });

// Admin rejects a painter's QC round: qc_pending → qc_rejected. The QC round is
// bumped so the painter re-paints and submits a fresh round of photos.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek" }, { status: 400 });
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true, orderNumber: true, userId: true, manufacturerId: true,
      painterId: true, painterStatus: true, painterQcRound: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });

  const next = painterQcNextStatus((order.painterStatus ?? "") as PainterOrderStatus, "reject");
  if (!next) return NextResponse.json({ error: "Sipariş QC reddine uygun değil" }, { status: 400 });

  const [updated] = await db
    .update(orders)
    .set({
      painterStatus: next,
      painterQcRound: sql`${orders.painterQcRound} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, id), eq(orders.painterStatus, "qc_pending")))
    .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
  if (!updated) return NextResponse.json({ error: "Zaten işlenmiş" }, { status: 400 });

  await db.insert(painterQcReviews).values({
    orderId: id, round: order.painterQcRound, decision: "rejected", reason: parsed.data.reason, adminEmail: a.session.user.email,
  });
  await db
    .update(painterQcPhotos)
    .set({ reviewStatus: "rejected" })
    .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));

  if (order.painterId) {
    await notifyPainter({
      painterId: order.painterId,
      type: "qc_result",
      subject: "QC reddedildi",
      body: `${order.orderNumber} numaralı işin kalite kontrolü reddedildi. Gerekçe: ${parsed.data.reason}. Lütfen düzeltip yeni fotoğraflarla tekrar gönderin.`,
      orderId: id,
    }).catch((e) => console.error("notifyPainter (qc reject) failed", e));
  }
  await emitOrderChanged({
    orderId: updated.id, orderNumber: updated.orderNumber, userId: updated.userId,
    manufacturerId: updated.manufacturerId, status: updated.status,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
