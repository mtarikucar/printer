import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderPhotos,
  generationAttempts,
  manufacturers,
} from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { normalizeFileUrl } from "@/lib/services/storage";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check manufacturer status
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json(
      { error: "Your account is not active" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [eq(orders.manufacturerId, session.manufacturerId)];

  if (
    statusFilter &&
    ["assigned", "accepted", "printing", "printed", "shipped"].includes(
      statusFilter
    )
  ) {
    conditions.push(
      eq(
        orders.manufacturerStatus,
        statusFilter as
          | "assigned"
          | "accepted"
          | "printing"
          | "printed"
          | "shipped"
      )
    );
  }

  const where = and(...conditions);

  const [orderRows, countResult] = await Promise.all([
    db.query.orders.findMany({
      where,
      columns: {
        id: true,
        orderNumber: true,
        figurineSize: true,
        style: true,
        modifiers: true,
        manufacturerStatus: true,
        assignedToManufacturerAt: true,
        customerName: true,
      },
      with: {
        photos: {
          columns: { originalUrl: true },
          limit: 1,
        },
        generationAttempts: {
          where: eq(generationAttempts.status, "succeeded"),
          columns: { outputGlbUrl: true },
          orderBy: desc(generationAttempts.createdAt),
          limit: 1,
        },
      },
      orderBy: desc(orders.assignedToManufacturerAt),
      limit: PAGE_SIZE,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(where!),
  ]);

  const total = countResult[0]?.count ?? 0;

  const result = orderRows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    figurineSize: o.figurineSize,
    style: o.style,
    modifiers: o.modifiers,
    manufacturerStatus: o.manufacturerStatus,
    assignedToManufacturerAt: o.assignedToManufacturerAt,
    customerName: o.customerName,
    photoUrl: normalizeFileUrl(o.photos[0]?.originalUrl ?? null),
    glbUrl: normalizeFileUrl(o.generationAttempts[0]?.outputGlbUrl ?? null),
  }));

  return NextResponse.json({
    orders: result,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
  });
}
