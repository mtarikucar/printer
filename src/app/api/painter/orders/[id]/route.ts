import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";

// Single painting-job detail — only the painter it is assigned to may read it.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      style: true,
      figurineSize: true,
      finish: true,
      modifiers: true,
      customerNote: true,
      painterStatus: true,
      paintingPriceKurus: true,
      assignedToPainterAt: true,
      paintedAt: true,
      trackingNumber: true,
    },
  });
  if (!order) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });

  return NextResponse.json({
    job: {
      ...order,
      assignedAt: order.assignedToPainterAt?.toISOString() ?? null,
      paintedAt: order.paintedAt?.toISOString() ?? null,
    },
  });
}
