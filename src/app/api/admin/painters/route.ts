import { NextRequest, NextResponse } from "next/server";
import { and, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters, orders } from "@/lib/db/schema";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";

export async function GET(_request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const allPainters = await db.query.painters.findMany({
    orderBy: (p, { desc }) => [desc(p.createdAt)],
  });

  // Active painting-job counts per painter (assigned → painted; shipped = done).
  const activeOrderCounts = await db
    .select({
      painterId: orders.painterId,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.painterId} IS NOT NULL`,
        inArray(orders.painterStatus, [...ACTIVE_PAINTER_ORDER_STATUSES])
      )
    )
    .groupBy(orders.painterId);

  const countMap = new Map(
    activeOrderCounts.map((r) => [r.painterId, r.count])
  );

  const result = allPainters.map((p) => ({
    id: p.id,
    email: p.email,
    companyName: p.companyName,
    contactPerson: p.contactPerson,
    phone: p.phone,
    taxId: p.taxId,
    taxIdType: p.taxIdType,
    requiresManualTaxReview: p.requiresManualTaxReview,
    status: p.status,
    workSamplePhotoUploadedAt: p.workSamplePhotoUploadedAt,
    activeOrderCount: countMap.get(p.id) ?? 0,
    createdAt: p.createdAt,
  }));

  return NextResponse.json({ painters: result });
}
