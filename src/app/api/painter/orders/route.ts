import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";

// List the authenticated painter's painting jobs.
export async function GET() {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const rows = await db.query.orders.findMany({
    where: and(eq(orders.painterId, g.painterId), eq(orders.needsPainting, true)),
    orderBy: [desc(orders.assignedToPainterAt)],
    limit: 200,
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      style: true,
      figurineSize: true,
      finish: true,
      painterStatus: true,
      paintingPriceKurus: true,
      assignedToPainterAt: true,
    },
  });

  return NextResponse.json({
    jobs: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      style: o.style,
      figurineSize: o.figurineSize,
      finish: o.finish,
      painterStatus: o.painterStatus,
      paintingPriceKurus: o.paintingPriceKurus,
      assignedAt: o.assignedToPainterAt?.toISOString() ?? null,
    })),
  });
}
