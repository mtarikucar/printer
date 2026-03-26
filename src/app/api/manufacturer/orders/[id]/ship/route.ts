import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { createShipOrderSchema } from "@/lib/validators/order";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";

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
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.manufacturerId, session.manufacturerId),
          eq(orders.manufacturerStatus, "printed")
        )
      )
      .returning();

    if (!order) {
      return NextResponse.json(
        { error: "Order not found or not in printed status" },
        { status: 400 }
      );
    }

    await db.insert(manufacturerActions).values({
      orderId: id,
      manufacturerId: session.manufacturerId,
      action: "ship",
      notes: `Tracking: ${validated.trackingNumber}`,
    });

    // Notify customer
    await getEmailQueue().add("shipped", {
      type: "order_shipped",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      trackingNumber: validated.trackingNumber,
    });

    // Notify admin with manufacturer-specific email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await getEmailQueue().add("manufacturer-shipped", {
        type: "manufacturer_shipped",
        to: order.email,
        adminEmail,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        trackingNumber: validated.trackingNumber,
        companyName: manufacturer.companyName,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error("Manufacturer ship order failed:", error);
    return NextResponse.json(
      { error: "Failed to ship order" },
      { status: 500 }
    );
  }
}
