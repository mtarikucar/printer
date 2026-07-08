import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";

// Painter marks the figurine painted: painterStatus accepted|painting → painted.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const [order] = await db
    .update(orders)
    .set({ painterStatus: "painted", paintedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.painterId, g.painterId),
        inArray(orders.painterStatus, ["accepted", "painting"])
      )
    )
    .returning({ id: orders.id });
  if (!order) {
    return NextResponse.json(
      { error: "İş bulunamadı veya bu durumda işaretlenemez" },
      { status: 400 }
    );
  }

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "painted" })
    .catch((e) => console.error("painterActions painted failed", e));

  return NextResponse.json({ success: true });
}
