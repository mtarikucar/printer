import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { createShipOrderSchema } from "@/lib/validators/order";
import { accruePainterEarning } from "@/lib/services/painter-payouts";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";
import { sendSms } from "@/lib/services/sms";

// Painter ships the painted figurine DIRECTLY to the customer. This is the
// terminal painting event: order → shipped, and the painter's earning
// (paintingPriceKurus, split 70/30) is accrued.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  try {
    const body = await request.json();
    const validated = createShipOrderSchema().parse(body);

    // Atomic gate: only a painted job owned by this painter may ship.
    const [order] = await db
      .update(orders)
      .set({
        painterStatus: "shipped",
        status: "shipped",
        trackingNumber: validated.trackingNumber,
        carrier: validated.carrier ?? null,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.painterId, g.painterId),
          // Ship gate: only jobs that passed admin painter-QC approval may ship.
          eq(orders.painterStatus, "qc_approved")
        )
      )
      .returning();
    if (!order) {
      return NextResponse.json(
        { error: "İş bulunamadı veya kargolanabilir durumda değil (önce QC onayı gerekir)" },
        { status: 400 }
      );
    }

    await db
      .insert(painterActions)
      .values({ orderId: id, painterId: g.painterId, action: "ship", notes: `Tracking: ${validated.trackingNumber}` })
      .catch((e) => console.error("painterActions ship failed", e));

    // Accrue the painter's earning on the painting portion (idempotent on orderId).
    await accruePainterEarning(order.id, g.painterId, order.paintingPriceKurus).catch(
      (e) => console.error("accruePainterEarning failed (non-fatal)", e)
    );

    // Customer notifications (all non-fatal — the ship commit already happened).
    await notifyCustomer({
      userId: order.userId,
      orderId: order.id,
      type: "order_shipped",
      title: "Siparişiniz kargolandı",
      body: `${order.orderNumber} numaralı (profesyonel boyamalı) siparişiniz kargoya verildi. Takip no: ${validated.trackingNumber}`,
    }).catch((e) => console.error("notifyCustomer (painter ship) failed", e));
    await sendSms(
      order.phone,
      `Figurünica: ${order.orderNumber} siparişiniz kargolandı. Takip: ${validated.trackingNumber}`
    ).catch((e) => console.error("sendSms (painter ship) failed", e));
    await getEmailQueue()
      .add("shipped", {
        type: "order_shipped",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        trackingNumber: validated.trackingNumber,
      })
      .catch((e) => console.error("shipped email enqueue failed", e));

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json({ error: (error as Error & { errors?: unknown }).errors }, { status: 400 });
    }
    console.error("Painter ship order failed:", error);
    return NextResponse.json({ error: "Kargolama başarısız" }, { status: 500 });
  }
}
