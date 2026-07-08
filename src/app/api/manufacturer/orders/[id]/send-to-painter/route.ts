import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, painters, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { accrueEarning } from "@/lib/services/payouts";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";

const schema = z.object({ painterId: z.string().uuid("Boyacı seçin") });

// Manufacturer hands a QC-approved, painting-required order to a painter instead
// of shipping it. The manufacturer's part is done here, so their earning accrues
// now on the PRINT portion (amountKurus − paintingPriceKurus); the painter earns
// the painting portion when they later ship. Order → status 'painting'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  // The order must be this manufacturer's, need painting, be QC-approved, and
  // not already handed off.
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: {
      id: true, orderNumber: true, userId: true, amountKurus: true,
      paintingPriceKurus: true, needsPainting: true, manufacturerStatus: true,
      painterStatus: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  if (!order.needsPainting) {
    return NextResponse.json({ error: "Bu sipariş için boyama seçilmemiş" }, { status: 400 });
  }
  if (order.manufacturerStatus !== "qc_approved") {
    return NextResponse.json(
      { error: "Sipariş boyacıya gönderilmeden önce QC onayından geçmeli" },
      { status: 400 }
    );
  }
  if (order.painterStatus && order.painterStatus !== "unassigned") {
    return NextResponse.json({ error: "Bu sipariş zaten bir boyacıya gönderildi" }, { status: 400 });
  }

  // Selected painter must be active + accepting + under capacity.
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, parsed.data.painterId),
    columns: { id: true, status: true, acceptingOrders: true, maxConcurrentOrders: true, companyName: true },
  });
  if (!painter || painter.status !== "active" || !painter.acceptingOrders) {
    return NextResponse.json({ error: "Seçilen boyacı uygun değil" }, { status: 400 });
  }
  const [{ count: activeCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.painterId, painter.id),
        inArray(orders.painterStatus, ["assigned", "accepted", "painting", "painted"])
      )
    );
  if (activeCount >= painter.maxConcurrentOrders) {
    return NextResponse.json({ error: "Seçilen boyacının kapasitesi dolu" }, { status: 400 });
  }

  // Atomic hand-off.
  const now = new Date();
  const [updated] = await db
    .update(orders)
    .set({
      painterId: painter.id,
      painterStatus: "assigned",
      assignedToPainterAt: now,
      sentToPainterAt: now,
      status: "painting",
      updatedAt: now,
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, "qc_approved")
      )
    )
    .returning();
  if (!updated) return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });

  await db
    .insert(manufacturerActions)
    .values({ orderId: id, manufacturerId: session.manufacturerId, action: "send_to_painter", notes: painter.companyName })
    .catch((e) => console.error("manufacturerActions send_to_painter failed", e));

  // Manufacturer's earning accrues now on the print portion (idempotent).
  const printBaseKurus = Math.max(0, order.amountKurus - order.paintingPriceKurus);
  await accrueEarning(order.id, session.manufacturerId, printBaseKurus).catch(
    (e) => console.error("accrueEarning (print portion) failed (non-fatal)", e)
  );

  await notifyPainter({
    painterId: painter.id,
    type: "order_assigned",
    subject: "Yeni boyama işi atandı",
    body: `${order.orderNumber} numaralı sipariş için yeni bir boyama işiniz var. Panelinizden inceleyip kabul edebilirsiniz.`,
    orderId: order.id,
  }).catch((e) => console.error("notifyPainter (assigned) failed", e));

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
    manufacturerStatus: updated.manufacturerStatus,
  });

  return NextResponse.json({ success: true });
}
