import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, painters, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";

const schema = z.object({
  painterId: z.string().uuid("Boyacı seçin"),
  // Courier record for the physical hand-off. Optional — some partners hand
  // over in person — but without it a lost parcel has no owner.
  carrier: z
    .enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"])
    .optional(),
  trackingNumber: z.string().trim().max(60).optional(),
});

// Manufacturer hands a QC-approved, painting-required order to a painter instead
// of shipping it. The manufacturer's part is done here, so their earning accrues
// now on the PRINT portion (amountKurus − paintingPriceKurus); the painter earns
// the painting portion when they later ship. Order → status 'painting'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  // The order must be this manufacturer's, need painting, be QC-approved, and
  // not already handed off.
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
    columns: {
      id: true, orderNumber: true, userId: true, amountKurus: true,
      paintingPriceKurus: true, productionBaseKurus: true,
      needsPainting: true, manufacturerStatus: true,
      painterStatus: true, declinedPainterIds: true, paymentStatus: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  // A hand-off accrues the print earning and gives a painter paid work, both
  // on money already returned. Readable refusal here; the race-proof half is
  // notRefundedGuard() in the UPDATE below.
  if (isRefunded(order)) {
    return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
  }
  if (!order.needsPainting) {
    return NextResponse.json({ error: "Bu sipariş için boyama seçilmemiş" }, { status: 400 });
  }
  if (order.manufacturerStatus !== "qc_approved") {
    return NextResponse.json(
      { error: "Sipariş boyacıya gönderilmeden önce QC onayından geçmeli" },
      { status: 400 }
    );
  }
  // 409, not 400: the request is valid but the order is already in the state
  // it would create — the same answer admin assign-painter and this route's own
  // lost-race branch give, so clients handle both paths alike.
  if (order.painterStatus && order.painterStatus !== "unassigned") {
    return NextResponse.json({ error: "Bu sipariş zaten bir boyacıya gönderildi" }, { status: 409 });
  }

  // A painter who already refused this job must not be handed it again. The
  // admin path (assign-painter) always checked this; this one did not, so a job
  // could bounce straight back to the painter who just turned it down. A
  // pre-check is enough: a painter can only decline while assigned, and this
  // route only runs while the order is unassigned.
  const declined = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];
  if (declined.includes(parsed.data.painterId)) {
    return NextResponse.json(
      { error: "Bu boyacı bu siparişi daha önce reddetti. Lütfen başka bir boyacı seçin." },
      { status: 409 }
    );
  }

  // Selected painter must be active + accepting + under capacity.
  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, parsed.data.painterId),
    columns: { id: true, status: true, acceptingOrders: true, maxConcurrentOrders: true, companyName: true },
  });
  if (!painter || painter.status !== "active" || !painter.acceptingOrders) {
    return NextResponse.json({ error: "Seçilen boyacı uygun değil" }, { status: 400 });
  }
  const [{ count: activeCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.painterId, painter.id),
        inArray(orders.painterStatus, [...ACTIVE_PAINTER_ORDER_STATUSES])
      )
    );
  if (activeCount >= painter.maxConcurrentOrders) {
    return NextResponse.json({ error: "Seçilen boyacının kapasitesi dolu" }, { status: 400 });
  }

  // Atomic hand-off.
  const now = new Date();
  const [updated] = await db
    .update(orders)
    .set({
      painterId: painter.id,
      painterStatus: "assigned",
      assignedToPainterAt: now,
      sentToPainterAt: now,
      painterHandoffCarrier: parsed.data.carrier ?? null,
      painterHandoffTrackingNumber: parsed.data.trackingNumber || null,
      status: "painting",
      updatedAt: now,
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, "qc_approved"),
        notRefundedGuard(),
        // No painter yet: the condition admin assign-painter writes with. The
        // painter check above reads before this write, so without it a
        // concurrent admin hand-off was overwritten by a second painter, and
        // the painter the admin picked (already notified) silently lost the job.
        or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
      )
    )
    .returning();
  if (!updated) {
    if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    // A lost race, not a bad request: the order moved between the checks above
    // and this write. 409 with a reason the manufacturer can act on (reload),
    // instead of a bare "İşlem başarısız".
    return NextResponse.json(
      {
        error:
          "Sipariş bu sırada değişti: bir boyacıya atanmış ya da QC durumu değişmiş olabilir. Sayfayı yenileyin.",
      },
      { status: 409 }
    );
  }

  await db
    .insert(manufacturerActions)
    .values({ orderId: id, manufacturerId: session.manufacturerId, action: "send_to_painter", notes: painter.companyName })
    .catch((e) => console.error("manufacturerActions send_to_painter failed", e));

  // Manufacturer's earning accrues now on the print portion (idempotent).
  // `painterId` is set (we just handed off), so the base is the production
  // kalem total — never the painting share, which is the painter's.
  const printBaseKurus = manufacturerBaseKurus({
    amountKurus: order.amountKurus,
    productionBaseKurus: order.productionBaseKurus,
    paintingPriceKurus: order.paintingPriceKurus,
    painterId: painter.id,
    paintsInHouse: false,
  });
  await accrueEarning(order.id, session.manufacturerId, printBaseKurus).catch(
    (e) => console.error("accrueEarning (print portion) failed (non-fatal)", e)
  );

  await notifyPainter({
    painterId: painter.id,
    type: "order_assigned",
    subject: "Yeni boyama işi atandı",
    body: `${order.orderNumber} numaralı sipariş için yeni bir boyama işiniz var. Panelinizden inceleyip kabul edebilirsiniz.`,
    orderId: order.id,
  }).catch((e) => console.error("notifyPainter (assigned) failed", e));

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
    manufacturerStatus: updated.manufacturerStatus,
  });

  return NextResponse.json({ success: true });
}
