import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import { ACTIVE_MFG_STATUSES } from "@/lib/services/manufacturer-assignment";

export async function GET(_request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

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
        inArray(orders.manufacturerStatus, [...ACTIVE_MFG_STATUSES])
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
    taxId: m.taxId,
    taxIdType: m.taxIdType,
    requiresManualTaxReview: m.requiresManualTaxReview,
    status: m.status,
    activeOrderCount: countMap.get(m.id) ?? 0,
    createdAt: m.createdAt,
  }));

  return NextResponse.json({ manufacturers: result });
}
