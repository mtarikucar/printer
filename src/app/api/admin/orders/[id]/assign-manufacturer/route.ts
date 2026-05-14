import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { orders, adminActions, manufacturers } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
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

      // Notify manufacturer (persistent inbox + email)
      await notifyManufacturer({
        manufacturerId,
        type: "order_assigned",
        subject: `Yeni sipariş atandı: ${orderRetry.orderNumber}`,
        body: `Sayın ${manufacturer.companyName},\n\n${orderRetry.orderNumber} numaralı sipariş size atandı. Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\nMüşteri: ${orderRetry.customerName}`,
        orderId: orderRetry.id,
      });

      return NextResponse.json({ success: true });
    }

    await db.insert(adminActions).values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail: session.user.email,
      notes: `Assigned to ${manufacturer.companyName}`,
    });

    // Notify manufacturer (persistent inbox + email)
    await notifyManufacturer({
      manufacturerId,
      type: "order_assigned",
      subject: `Yeni sipariş atandı: ${order.orderNumber}`,
      body: `Sayın ${manufacturer.companyName},\n\n${order.orderNumber} numaralı sipariş size atandı. Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\nMüşteri: ${order.customerName}`,
      orderId: order.id,
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
