import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";

// Painter declines an assigned job: the order reverts to the manufacturer's
// post-QC state (status 'quality_check', painter cleared) so the manufacturer
// can send it to another painter. The decliner is recorded so a later
// reassignment can skip them.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

  const existing = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
    columns: { id: true, manufacturerId: true, orderNumber: true, declinedPainterIds: true, painterStatus: true },
  });
  if (!existing || existing.painterStatus !== "assigned") {
    return NextResponse.json(
      { error: "İş bulunamadı veya reddedilebilir durumda değil" },
      { status: 400 }
    );
  }

  const declined = Array.from(
    new Set([...(existing.declinedPainterIds ?? []), g.painterId])
  );

  const [order] = await db
    .update(orders)
    .set({
      painterId: null,
      painterStatus: "unassigned",
      assignedToPainterAt: null,
      sentToPainterAt: null,
      declinedPainterIds: declined,
      status: "quality_check",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.painterId, g.painterId),
        eq(orders.painterStatus, "assigned")
      )
    )
    .returning({ id: orders.id });
  if (!order) {
    return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });
  }

  await db
    .insert(painterActions)
    .values({ orderId: id, painterId: g.painterId, action: "decline", notes: reason })
    .catch((e) => console.error("painterActions decline failed", e));

  // Tell the manufacturer their painting hand-off bounced back for re-send.
  if (existing.manufacturerId) {
    await notifyManufacturer({
      manufacturerId: existing.manufacturerId,
      type: "system_announcement",
      subject: "Boyacı işi reddetti",
      body: `${existing.orderNumber} numaralı sipariş için gönderdiğiniz boyama işi reddedildi. Lütfen başka bir boyacıya gönderin.`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer (painter decline) failed", e));
  }

  return NextResponse.json({ success: true });
}
