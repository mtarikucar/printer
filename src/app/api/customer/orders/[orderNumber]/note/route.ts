import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";

// Customer adds/edits the special-instructions note on their own order. Allowed
// until the order ships; the manufacturer sees it read-only on the order detail.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orderNumber } = await params;

  const body = await request.json().catch(() => ({}));
  const raw = typeof body.note === "string" ? body.note.trim() : "";
  const note = raw.slice(0, 2000) || null;

  const [updated] = await db
    .update(orders)
    .set({ customerNote: note, updatedAt: new Date() })
    .where(
      and(
        eq(orders.orderNumber, orderNumber),
        eq(orders.userId, session.userId),
        notInArray(orders.status, ["shipped", "delivered"])
      )
    )
    .returning({ id: orders.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Note can't be updated (order not found or already shipped)" },
      { status: 400 }
    );
  }
  return NextResponse.json({ success: true, note });
}
