import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";

// Painter accepts an assigned painting job: painterStatus assigned → accepted.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;

  const [order] = await db
    .update(orders)
    .set({ painterStatus: "accepted", updatedAt: new Date() })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.painterId, g.painterId),
        eq(orders.painterStatus, "assigned")
      )
    )
    .returning({ id: orders.id });
  if (!order) {
    return NextResponse.json(
      { error: "İş bulunamadı veya kabul edilebilir durumda değil" },
      { status: 400 }
    );
  }

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "accept" })
    .catch((e) => console.error("painterActions accept failed", e));

  return NextResponse.json({ success: true });
}
