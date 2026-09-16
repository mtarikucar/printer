import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import {
  isPartnerChatUnavailable,
  markPartnerChannelRead,
} from "@/lib/services/order-partner-chat";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

// Boyacı, yöneticiden gelen mesajları okundu işaretler (üretici kanalının
// /messages/read ucunun aynısı).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;
    const job = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
      columns: { id: true },
    });
    if (!job) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });

    try {
      await markPartnerChannelRead(
        job.id,
        { partnerType: "painter", partnerId: g.painterId },
        "partner"
      );
    } catch (err) {
      // Tablo yoksa okundu işaretlemek de anlamsızdır; sessizce geç.
      if (!isPartnerChatUnavailable(err)) {
        console.error("painter messages read failed", err);
      }
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/messages/read", PARTNER_ACTION_FAILED_ERROR);
  }
}
