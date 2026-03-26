import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions, manufacturers } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json(
      { error: d["api.auth.unauthorized"] },
      { status: 401 }
    );
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { manufacturerId } = body;

    if (!manufacturerId) {
      return NextResponse.json(
        { error: "manufacturerId is required" },
        { status: 400 }
      );
    }

    // Validate manufacturer exists and is active
    const manufacturer = await db.query.manufacturers.findFirst({
      where: and(
        eq(manufacturers.id, manufacturerId),
        eq(manufacturers.status, "active")
      ),
    });

    if (!manufacturer) {
      return NextResponse.json(
        { error: "Manufacturer not found or not active" },
        { status: 400 }
      );
    }

    // Atomic: assign manufacturer to order (only if approved and unassigned)
    const [order] = await db
      .update(orders)
      .set({
        manufacturerId,
        manufacturerStatus: "assigned",
        assignedToManufacturerAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.status, "approved"),
          isNull(orders.manufacturerStatus)
        )
      )
      .returning();

    if (!order) {
      // Try with unassigned status as well
      const [orderRetry] = await db
        .update(orders)
        .set({
          manufacturerId,
          manufacturerStatus: "assigned",
          assignedToManufacturerAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.status, "approved"),
            eq(orders.manufacturerStatus, "unassigned")
          )
        )
        .returning();

      if (!orderRetry) {
        return NextResponse.json(
          {
            error:
              "Order not found, not in approved status, or already assigned",
          },
          { status: 400 }
        );
      }

      // Use orderRetry for the rest
      await db.insert(adminActions).values({
        orderId: id,
        action: "assign_manufacturer",
        adminEmail: session.user.email,
        notes: `Assigned to ${manufacturer.companyName}`,
      });

      // Notify manufacturer
      await getEmailQueue().add("order-assigned", {
        type: "order_assigned",
        to: orderRetry.customerName,
        manufacturerEmail: manufacturer.email,
        orderNumber: orderRetry.orderNumber,
        customerName: orderRetry.customerName,
      });

      return NextResponse.json({ success: true });
    }

    await db.insert(adminActions).values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail: session.user.email,
      notes: `Assigned to ${manufacturer.companyName}`,
    });

    // Notify manufacturer
    await getEmailQueue().add("order-assigned", {
      type: "order_assigned",
      to: order.customerName,
      manufacturerEmail: manufacturer.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Assign manufacturer failed:", error);
    return NextResponse.json(
      { error: "Failed to assign manufacturer" },
      { status: 500 }
    );
  }
}
