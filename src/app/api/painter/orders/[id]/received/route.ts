import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";

/**
 * Painter confirms the base print physically arrived.
 *
 * The hand-off used to be a database flag only: nobody could tell whether the
 * parcel had actually reached the painter, so a lost print surfaced days later
 * with no owner. The agreement gives the painter a defect-reporting window that
 * starts from this timestamp.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const [order] = await db
    .update(orders)
    .set({ receivedByPainterAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.painterId, g.painterId),
        // Only before painting starts, and only once.
        inArray(orders.painterStatus, ["assigned", "accepted"]),
        isNull(orders.receivedByPainterAt)
      )
    )
    .returning({ id: orders.id });
  if (!order) {
    return NextResponse.json(
      { error: "İş bulunamadı veya teslim alındı olarak işaretlenemez" },
      { status: 400 }
    );
  }

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "received" })
    .catch((e) => console.error("painterActions received failed", e));

  return NextResponse.json({ success: true });
}
