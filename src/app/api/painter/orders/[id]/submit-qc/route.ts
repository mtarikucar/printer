import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterQcPhotos, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { emitOrderChanged } from "@/lib/realtime/emit";

// Painter submits the current QC round for admin review:
// accepted|painting|painted|qc_rejected → qc_pending (requires >=1 photo).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
    columns: {
      id: true, orderNumber: true, userId: true, manufacturerId: true,
      painterStatus: true, painterQcRound: true,
    },
  });
  if (!order) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });

  const current = (order.painterStatus ?? "") as PainterOrderStatus;
  const next = painterQcNextStatus(current, "submit");
  if (!next) {
    return NextResponse.json({ error: "İş QC'ye gönderilebilir durumda değil" }, { status: 400 });
  }

  const [photoRow] = await db
    .select({ value: count() })
    .from(painterQcPhotos)
    .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));
  if (Number(photoRow?.value ?? 0) < 1) {
    return NextResponse.json({ error: "Göndermeden önce en az bir fotoğraf ekleyin" }, { status: 400 });
  }

  const [updated] = await db
    .update(orders)
    .set({ painterStatus: next, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.painterId, g.painterId), eq(orders.painterStatus, current)))
    .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
  if (!updated) return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "submit_qc" })
    .catch((e) => console.error("painterActions submit_qc failed", e));

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
