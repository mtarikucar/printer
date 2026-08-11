import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, painterActions, painters } from "@/lib/db/schema";
import { accrueEarning } from "@/lib/services/payouts";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Admin hand-off to a painter — the counterpart to the manufacturer's
 * send-to-painter.
 *
 * Without this an order could stall with nobody able to move it: the
 * manufacturer is the only party who could hand it over, so if they never do,
 * or every painter they picked declined, or an admin pulled it back from a bad
 * painter, the job sits at qc_approved forever. This is the same operation with
 * the same guards and the same money, performed by an admin.
 */

const schema = z.object({
  painterId: z.string().uuid("Boyacı seçin"),
  carrier: z
    .enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"])
    .optional(),
  trackingNumber: z.string().trim().max(60).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      orderNumber: true,
      userId: true,
      amountKurus: true,
      paintingPriceKurus: true,
      needsPainting: true,
      manufacturerId: true,
      manufacturerStatus: true,
      painterStatus: true,
      declinedPainterIds: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
  }
  if (!order.needsPainting) {
    return NextResponse.json(
      { error: "Bu sipariş için boyama seçilmemiş." },
      { status: 400 }
    );
  }
  // Same gate as the manufacturer path: the figure must physically exist and
  // have passed QC before it can travel to a painter.
  if (order.manufacturerStatus !== "qc_approved") {
    return NextResponse.json(
      { error: "Sipariş boyacıya gönderilmeden önce üretici QC onayından geçmeli." },
      { status: 409 }
    );
  }
  if (order.painterStatus && order.painterStatus !== "unassigned") {
    return NextResponse.json(
      {
        error:
          "Bu sipariş zaten bir boyacıda. Önce 'Boyacıdan geri al' ile çıkarın.",
      },
      { status: 409 }
    );
  }

  // A painter who already refused this order must not be handed it again —
  // same rule the manufacturer ranking applies to declinedManufacturerIds.
  const declined = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];
  if (declined.includes(parsed.data.painterId)) {
    return NextResponse.json(
      { error: "Bu boyacı siparişi daha önce reddetti." },
      { status: 409 }
    );
  }

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, parsed.data.painterId),
    columns: {
      id: true,
      status: true,
      acceptingOrders: true,
      maxConcurrentOrders: true,
      companyName: true,
    },
  });
  if (!painter || painter.status !== "active") {
    return NextResponse.json(
      { error: "Seçilen boyacı aktif değil." },
      { status: 400 }
    );
  }
  if (!painter.acceptingOrders) {
    return NextResponse.json(
      { error: "Seçilen boyacı şu an iş almıyor." },
      { status: 400 }
    );
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
    return NextResponse.json(
      { error: "Seçilen boyacının kapasitesi dolu." },
      { status: 409 }
    );
  }

  // Atomic: only assign while the order is still unassigned + QC-approved, so a
  // concurrent manufacturer send-to-painter can't double-assign.
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
        eq(orders.manufacturerStatus, "qc_approved"),
        sql`(${orders.painterStatus} IS NULL OR ${orders.painterStatus} = 'unassigned')`
      )
    )
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Sipariş bu sırada başka bir işlemle değişti. Sayfayı yenileyin." },
      { status: 409 }
    );
  }

  // Partner-facing events are audited on the partner's own action log, not
  // adminActions — the same convention the revoke paths follow, and it keeps
  // the enum free of one-off values. The admin's identity rides in `notes`.
  await db
    .insert(painterActions)
    .values({
      orderId: id,
      painterId: painter.id,
      action: "admin_assigned",
      notes: a.session.user.email,
    })
    .catch((e) => console.error("painterActions admin_assigned failed", e));

  // The manufacturer's print earning accrues at hand-off, exactly as it does on
  // the manufacturer's own send-to-painter — otherwise an admin-performed
  // hand-off would silently skip paying them. Idempotent on orderId, so a
  // re-assignment after a decline does not double-pay; the revoke path deletes
  // the reversed row first, so a genuine re-accrual still lands.
  if (order.manufacturerId) {
    const printBaseKurus = Math.max(
      0,
      order.amountKurus - order.paintingPriceKurus
    );
    await accrueEarning(order.id, order.manufacturerId, printBaseKurus).catch(
      (e) => console.error("accrueEarning (print portion) failed (non-fatal)", e)
    );
  }

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
