import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allManufacturers = await db.query.manufacturers.findMany({
    orderBy: (m, { desc }) => [desc(m.createdAt)],
  });

  // Get active order counts per manufacturer
  const activeOrderCounts = await db
    .select({
      manufacturerId: orders.manufacturerId,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.manufacturerId} IS NOT NULL`,
        inArray(orders.manufacturerStatus, [
          "assigned",
          "accepted",
          "printing",
          "printed",
        ])
      )
    )
    .groupBy(orders.manufacturerId);

  const countMap = new Map(
    activeOrderCounts.map((r) => [r.manufacturerId, r.count])
  );

  const result = allManufacturers.map((m) => ({
    id: m.id,
    email: m.email,
    companyName: m.companyName,
    contactPerson: m.contactPerson,
    phone: m.phone,
    status: m.status,
    activeOrderCount: countMap.get(m.id) ?? 0,
    createdAt: m.createdAt,
  }));

  return NextResponse.json({ manufacturers: result });
}
