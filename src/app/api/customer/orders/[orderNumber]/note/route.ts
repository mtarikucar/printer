import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/services/customer-auth";
import { handleRouteFailure, CUSTOMER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Customer adds/edits the special-instructions note on their own order. Allowed
// until the order ships; the manufacturer sees it read-only on the order detail.
async function handlePATCH(
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

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap. İş yukarıdaki `handlePATCH` içinde
 * yapılır; buradaki tek yakalama, Next'in sıfır baytlık 500'ü yerine ekranın
 * basabileceği TÜRKÇE bir cümle döndürür (gerekçe: src/lib/api/route-error.ts).
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ orderNumber: string }> }) {
  try {
    return await handlePATCH(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "PATCH /api/customer/orders/[orderNumber]/note", CUSTOMER_ACTION_FAILED_ERROR);
  }
}
