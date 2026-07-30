import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  orders,
  adminActions,
  manufacturers,
  generationAttempts,
  orderItems,
} from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const session = { user: { email: a.session.user.email } };

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

    // An order with nothing to print must never reach a manufacturer: that is
    // exactly how an assigned order ended up showing the partner an empty
    // screen. Printable content = an uploaded model, a legacy generated model,
    // a marketplace product (own or per line item), a customer-uploaded file,
    // or — for a manual/WhatsApp order — at least one written line item.
    const target = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        modelGlbKey: true,
        modelStlKey: true,
        productId: true,
        uploadedModelId: true,
        selectedAddons: true,
      },
      with: {
        generationAttempts: {
          where: eq(generationAttempts.status, "succeeded"),
          columns: { id: true },
          limit: 1,
        },
      },
    });
    if (!target) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // Cart sub-orders carry their products per line (there is no orders→items
    // relation), so check that table directly.
    const lineProducts = await db
      .select({ productId: orderItems.productId })
      .from(orderItems)
      .where(eq(orderItems.orderId, id));
    const hasPrintable =
      !!target.modelGlbKey ||
      !!target.modelStlKey ||
      !!target.productId ||
      !!target.uploadedModelId ||
      target.generationAttempts.length > 0 ||
      lineProducts.some((i) => !!i.productId) ||
      (target.selectedAddons?.length ?? 0) > 0;
    if (!hasPrintable) {
      return NextResponse.json(
        {
          error:
            "Bu siparişte üreticiye gönderilecek basılabilir içerik yok (model, ürün veya kalem). Önce 3D modeli yükleyin ya da sipariş kalemlerini girin.",
        },
        { status: 400 }
      );
    }

    // Assignable states: custom/upload orders after admin approval, and
    // marketplace orders straight from payment (platform-owned products are
    // born status="paid" + unassigned — without this they could never be
    // assigned to a manufacturer at all).
    const statusOk = or(
      eq(orders.status, "approved"),
      and(eq(orders.status, "paid"), eq(orders.orderType, "marketplace"))
    );

    // Atomic: assign manufacturer to order (only while unassigned)
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
          statusOk,
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
            statusOk,
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

      await emitOrderChanged({
        orderId: orderRetry.id,
        orderNumber: orderRetry.orderNumber,
        userId: orderRetry.userId,
        manufacturerId,
        status: orderRetry.status,
        manufacturerStatus: orderRetry.manufacturerStatus,
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

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Assign manufacturer failed:", error);
    return NextResponse.json(
      { error: "Failed to assign manufacturer" },
      { status: 500 }
    );
  }
}
