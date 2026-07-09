import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions, manufacturerEarnings } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { reverseEarning } from "@/lib/services/payouts";
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

  // The manufacturer's PRINT-portion earning was accrued at hand-off
  // (send-to-painter). The hand-off just bounced, so back it out and clear the
  // row: otherwise the stale row would block a differently-amounted re-accrual —
  // a later in-house ship (full amount) or a re-hand-off (print portion) is
  // silently dropped by accrueEarning's onConflictDoNothing, underpaying the
  // manufacturer. reverseEarning detaches it from any pending payout + marks
  // non-paid rows 'reversed'; deleting those reversed rows lets the next
  // completing action accrue the correct amount cleanly. An already-'paid' row
  // is left untouched (a transfer can't be undone — a rare edge, logged).
  await reverseEarning(id).catch((e) =>
    console.error("reverseEarning (painter decline) failed", e)
  );
  await db
    .delete(manufacturerEarnings)
    .where(
      and(
        eq(manufacturerEarnings.orderId, id),
        eq(manufacturerEarnings.status, "reversed")
      )
    )
    .catch((e) => console.error("clear reversed earning (painter decline) failed", e));

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
