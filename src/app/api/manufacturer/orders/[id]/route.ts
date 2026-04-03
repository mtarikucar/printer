import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderPhotos,
  generationAttempts,
  manufacturerActions,
  manufacturers,
} from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import type { TurkishAddress } from "@/lib/db/schema";
import { normalizeFileUrl } from "@/lib/services/storage";

export async function GET(
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
    columns: { status: true },
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Account not active" }, { status: 403 });
  }

  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.id, id),
      eq(orders.manufacturerId, session.manufacturerId)
    ),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      phone: true,
      figurineSize: true,
      style: true,
      modifiers: true,
      status: true,
      manufacturerStatus: true,
      shippingAddress: true,
      assignedToManufacturerAt: true,
      manufacturerAcceptedAt: true,
      manufacturerPrintedAt: true,
      trackingNumber: true,
      shippedAt: true,
      createdAt: true,
    },
    with: {
      photos: {
        columns: { originalUrl: true },
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { outputGlbUrl: true },
        orderBy: desc(generationAttempts.createdAt),
        limit: 1,
      },
      manufacturerActions: {
        orderBy: desc(manufacturerActions.createdAt),
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      style: order.style,
      modifiers: order.modifiers,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
      shippingAddress: order.shippingAddress as TurkishAddress,
      assignedToManufacturerAt: order.assignedToManufacturerAt,
      manufacturerAcceptedAt: order.manufacturerAcceptedAt,
      manufacturerPrintedAt: order.manufacturerPrintedAt,
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt,
      createdAt: order.createdAt,
      photoUrls: order.photos.map((p) => normalizeFileUrl(p.originalUrl) ?? p.originalUrl),
      glbUrl: normalizeFileUrl(order.generationAttempts[0]?.outputGlbUrl ?? null),
      actions: order.manufacturerActions.map((a) => ({
        id: a.id,
        action: a.action,
        notes: a.notes,
        createdAt: a.createdAt,
      })),
    },
  });
}
