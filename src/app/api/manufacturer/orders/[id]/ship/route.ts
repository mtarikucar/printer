import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { createShipOrderSchema } from "@/lib/validators/order";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { accrueEarning } from "@/lib/services/payouts";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { sendSms } from "@/lib/services/sms";
import { emitOrderChanged } from "@/lib/realtime/emit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify manufacturer is active
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json(
      { error: "Your account is not active" },
      { status: 403 }
    );
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const validated = createShipOrderSchema().parse(body);

    // Atomic status transition: printed -> shipped
    const [order] = await db
      .update(orders)
      .set({
        manufacturerStatus: "shipped",
        status: "shipped",
        trackingNumber: validated.trackingNumber,
        carrier: validated.carrier ?? null,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.manufacturerId, session.manufacturerId),
          // Ship gate: only orders that passed admin QC approval may ship.
          eq(orders.manufacturerStatus, "qc_approved")
        )
      )
      .returning();

    if (!order) {
      return NextResponse.json(
        { error: "Order not found or not approved for shipping (QC required)" },
        { status: 400 }
      );
    }

    await db.insert(manufacturerActions).values({
      orderId: id,
      manufacturerId: session.manufacturerId,
      action: "ship",
      notes: `Tracking: ${validated.trackingNumber}`,
    });

    // Faz 2: accrue the manufacturer's earning for this completed order
    // (idempotent on orderId; non-fatal if it fails).
    await accrueEarning(order.id, session.manufacturerId, order.amountKurus).catch(
      (e) => console.error("accrueEarning failed (non-fatal)", e)
    );

    // Faz 4: in-app notification + best-effort SMS. All side-effects below run
    // AFTER the irreversible status commit, so each is non-fatal — a failure in
    // one must not abort the rest (esp. emitOrderChanged) or surface a false 500
    // for an order that is actually shipped.
    await notifyCustomer({
      userId: order.userId,
      orderId: order.id,
      type: "order_shipped",
      title: "Siparişiniz kargolandı",
      body: `${order.orderNumber} numaralı siparişiniz kargoya verildi. Takip no: ${validated.trackingNumber}`,
    }).catch((e) => console.error("notifyCustomer (shipped) failed", e));
    await sendSms(
      order.phone,
      `Figurünica: ${order.orderNumber} siparişiniz kargolandı. Takip: ${validated.trackingNumber}`
    ).catch((e) => console.error("sendSms (shipped) failed", e));

    // Notify customer
    await getEmailQueue()
      .add("shipped", {
        type: "order_shipped",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        trackingNumber: validated.trackingNumber,
      })
      .catch((e) => console.error("shipped email enqueue failed", e));

    // Notify admin with manufacturer-specific email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await getEmailQueue()
        .add("manufacturer-shipped", {
          type: "manufacturer_shipped",
          to: order.email,
          adminEmail,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          trackingNumber: validated.trackingNumber,
          companyName: manufacturer.companyName,
        })
        .catch((e) => console.error("manufacturer-shipped email enqueue failed", e));
    }

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
    console.error("Manufacturer ship order failed:", error);
    return NextResponse.json(
      { error: "Failed to ship order" },
      { status: 500 }
    );
  }
}
