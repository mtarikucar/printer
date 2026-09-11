import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  orders,
  adminActions,
  manufacturers,
  manufacturerActions,
} from "@/lib/db/schema";
import {
  revokeManufacturerAssignment,
  type RevokeResult,
} from "@/lib/services/manufacturer-revoke";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { applyStrike } from "@/lib/services/strikes";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  isOrderRefunded,
  notRefundedGuard,
} from "@/lib/services/manufacturer-assign";
import {
  REFUNDED_PAYMENT_STATUS,
  isRefunded,
} from "@/lib/config/order-status-policy";

/**
 * Take an assigned order back from a manufacturer, optionally handing it to a
 * specific one in the same call. Without this an unresponsive manufacturer
 * (neither accept nor decline) froze the order permanently.
 *
 * On a refunded order the plain revoke stays allowed, at any manufacturer
 * sub-status: it is cleanup, taking the job off a partner who should not be
 * working on money already returned. Handing it to another manufacturer is a
 * forward action and is refused.
 */
const schema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    targetManufacturerId: z.string().uuid().optional(),
    // Keep the ranker from handing the order straight back.
    blocklist: z.boolean().default(true),
    // Reliability penalty — opt-in, since "did not answer" may be a holiday.
    strike: z.boolean().default(false),
  })
  .strict();

/** 409 copy when a hand-off target is sent for a refunded order. */
const REFUNDED_HANDOFF_ERROR = "İade edilen sipariş başka bir üreticiye devredilemez.";

/**
 * Plain revoke on a refunded order at a sub-status the ordinary revoke refuses
 * (shipped, or any status outside its whitelist).
 *
 * Those limits exist so a revoke never strands an earning a later manufacturer
 * would then fail to accrue. A refunded order has no later manufacturer (every
 * assign path refuses it) and its earnings were already reversed by the
 * refund, so the limits protect nothing there. Refusing left a legacy refunded
 * row, attached from before refunds detached, on the manufacturer's panel for
 * good.
 *
 * It does what a refund does today: it takes the manufacturer off the order
 * and nothing else. The order status is kept (refund-end-state), no earning is
 * touched, and the WHERE matches only a refunded row, so this can never detach
 * a live order. A painter still holding the job is left to revoke-painter,
 * which detaches both partners together.
 */
async function detachFromRefundedOrder(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
  blocklist: boolean;
}): Promise<RevokeResult> {
  const { orderId, adminEmail, reason, blocklist } = args;
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        painterStatus: orders.painterStatus,
        declinedManufacturerIds: orders.declinedManufacturerIds,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        orderType: orders.orderType,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) return { code: "not_found" as const };
    if (
      !order.manufacturerId ||
      !order.manufacturerStatus ||
      order.manufacturerStatus === "unassigned"
    ) {
      return { code: "not_assigned" as const };
    }
    if (order.painterStatus != null && order.painterStatus !== "unassigned") {
      return { code: "handed_to_painter" as const };
    }

    const prevManufacturerId = order.manufacturerId;
    const prevStatus = order.manufacturerStatus;
    const declined = Array.isArray(order.declinedManufacturerIds)
      ? (order.declinedManufacturerIds as string[])
      : [];
    const note = `[GERİ ALMA] Admin ${adminEmail} iade edilmiş siparişte atamayı geri aldı (önceki durum: ${prevStatus}). Sebep: ${reason}`;

    const [updated] = await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        ...(blocklist
          ? {
              declinedManufacturerIds: Array.from(
                new Set([...declined, prevManufacturerId])
              ),
            }
          : {}),
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.manufacturerId, prevManufacturerId),
          // Refunded rows only: this path skips the sub-status limits, so it
          // must never reach an order that can still be worked on.
          eq(orders.paymentStatus, REFUNDED_PAYMENT_STATUS),
          or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
        )
      )
      .returning({ id: orders.id });
    if (!updated) return { code: "lost_race" as const };

    // Same free-text action as the ordinary revoke: not "decline", which the
    // ranker scores as a refusal.
    await tx.insert(manufacturerActions).values({
      orderId,
      manufacturerId: prevManufacturerId,
      action: "admin_revoked",
      notes: `[Admin geri aldı, sipariş iade edilmiş] ${reason}`.slice(0, 500),
    });

    return {
      code: "ok" as const,
      prevManufacturerId,
      prevStatus,
      orderNumber: order.orderNumber,
      userId: order.userId,
      orderType: order.orderType,
      orderStatus: order.status,
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email ?? "admin";

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Sebep zorunludur (en az 3 karakter)." },
      { status: 400 }
    );
  }
  const { reason, targetManufacturerId, blocklist, strike } = parsed.data;

  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: { manufacturerId: true, customerName: true, paymentStatus: true },
  });

  // Refused before anything moves. Revoking first and then failing the
  // hand-off left the admin with a half-done action and a client message that
  // blamed a race and invited a retry that could never succeed. The hand-off
  // UPDATE below repeats the guard for a refund landing after this read.
  if (targetManufacturerId && current && isRefunded(current)) {
    return NextResponse.json(
      { error: REFUNDED_HANDOFF_ERROR, reason: "refunded" },
      { status: 409 }
    );
  }

  // Validate the target up front so we don't revoke and then fail to reassign.
  let target: { id: string; companyName: string } | null = null;
  if (targetManufacturerId) {
    const found = await db.query.manufacturers.findFirst({
      where: and(
        eq(manufacturers.id, targetManufacturerId),
        eq(manufacturers.status, "active")
      ),
      columns: { id: true, companyName: true },
    });
    if (!found) {
      return NextResponse.json(
        { error: "Hedef üretici bulunamadı veya aktif değil." },
        { status: 400 }
      );
    }
    target = found;
  }

  if (targetManufacturerId && current?.manufacturerId === targetManufacturerId) {
    return NextResponse.json(
      { error: "Sipariş zaten bu üreticide. Farklı bir üretici seçin." },
      { status: 400 }
    );
  }

  let result: RevokeResult = await revokeManufacturerAssignment({
    orderId: id,
    adminEmail,
    reason,
    blocklist,
  });

  // The ordinary revoke refuses past QC approval and after shipping. On a
  // refunded order, a plain revoke falls back to the cleanup detach instead
  // (see detachFromRefundedOrder). Refunded orders inside the whitelist keep
  // the ordinary path above. A hand-off never gets here: it was refused before
  // anything moved. A refund is terminal, so the pre-read settles it.
  if (
    !targetManufacturerId &&
    !!current &&
    isRefunded(current) &&
    (result.code === "wrong_status" || result.code === "already_shipped")
  ) {
    result = await detachFromRefundedOrder({
      orderId: id,
      adminEmail,
      reason,
      blocklist,
    });
  }

  if (result.code !== "ok") {
    const messages: Record<string, { message: string; status: number }> = {
      not_found: { message: "Sipariş bulunamadı.", status: 404 },
      not_assigned: {
        message: "Siparişte aktif bir üretici ataması yok.",
        status: 400,
      },
      wrong_status: {
        message:
          "Bu aşamadan sonra atama geri alınamaz (QC onayı verilmiş veya kargolanmış). İade/ihtilaf akışını kullanın.",
        status: 409,
      },
      handed_to_painter: {
        message: "Bu sipariş boyacıya devredildi; üretici ataması geri alınamaz.",
        status: 409,
      },
      already_shipped: {
        message: "Sipariş kargolandı; geri alınamaz. İade akışını kullanın.",
        status: 409,
      },
      lost_race: {
        message:
          "Sipariş bu sırada başka bir işlemle değiştirildi; sayfayı yenileyin.",
        status: 409,
      },
    };
    const m = messages[result.code] ?? {
      message: "Atama geri alınamadı.",
      status: 400,
    };
    return NextResponse.json({ error: m.message }, { status: m.status });
  }

  const prevCompany = await db.query.manufacturers
    .findFirst({
      where: eq(manufacturers.id, result.prevManufacturerId),
      columns: { companyName: true },
    })
    .catch(() => null);
  const prevName = prevCompany?.companyName ?? result.prevManufacturerId;

  // Optional atomic hand-off. Guarded so a concurrent assignment wins cleanly:
  // the revoke itself already succeeded, so we still return 200. This write
  // bypasses assignManufacturerToOrder, so it repeats that function's refund
  // guard: a refund landing between the revoke above and this write must not
  // put the order back on a bench (refund-end-state); it stays unassigned.
  let reassigned = false;
  if (target) {
    const [row] = await db
      .update(orders)
      .set({
        manufacturerId: target.id,
        manufacturerStatus: "assigned",
        assignedToManufacturerAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.manufacturerStatus, "unassigned"),
          notRefundedGuard()
        )
      )
      .returning({ id: orders.id });
    reassigned = !!row;
  }

  // Did the refund keep the order from going back to work? Either it was
  // refunded before this call (plain revoke) or a refund beat the hand-off
  // write above. A refund is terminal, so the pre-read settles it when it can.
  const refunded =
    !reassigned &&
    ((!!current && isRefunded(current)) || (await isOrderRefunded(id)));

  // Every side effect below is isolated: the order has already moved, so a
  // failing email or Redis must not turn this into a 500 the admin reads as
  // "nothing happened".
  await db
    .insert(adminActions)
    .values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail,
      notes: reassigned
        ? `Geri alındı: ${prevName} (${result.prevStatus}) → yeniden atandı: ${target!.companyName}. Sebep: ${reason}`
        : refunded
          ? `Atama geri alındı: ${prevName} (${result.prevStatus}). Sipariş iade edildiği için kuyruğa dönmedi${target ? `, ${target.companyName} üreticisine devredilmedi` : ""}. Sebep: ${reason}`
          : `Atama geri alındı: ${prevName} (${result.prevStatus}) → kuyruğa döndü. Sebep: ${reason}`,
    })
    .catch((e) => console.error("revoke: adminActions insert failed", e));

  // The losing manufacturer's copy must match what happens next. A refunded
  // order is not re-routed anywhere: the job is cancelled, and telling them it
  // goes to another manufacturer was untrue.
  await notifyManufacturer({
    manufacturerId: result.prevManufacturerId,
    type: "order_unassigned",
    subject: refunded
      ? `Sipariş iade edildi, iş iptal edildi — ${result.orderNumber}`
      : `Sipariş ataması geri alındı — ${result.orderNumber}`,
    body: refunded
      ? `${result.orderNumber} numaralı sipariş müşteriye iade edildi. Bu yüzden ataması ` +
        `yönetici tarafından geri alındı ve iş iptal edildi; bu sipariş için üretime devam etmeyin.\n\n` +
        `Sebep: ${reason}\n\n` +
        `Bu sipariş artık üretici panelinizde görünmeyecektir.`
      : `${result.orderNumber} numaralı siparişin ataması yönetici tarafından geri alındı ` +
      `ve sipariş başka bir üreticiye yönlendirilecek.\n\n` +
      `Sebep: ${reason}\n\n` +
      `Bu sipariş artık üretici panelinizde görünmeyecektir. ` +
      `Yoğunluk nedeniyle sipariş alamıyorsanız panelinizdeki "Sipariş Alıyor" anahtarını kapatabilirsiniz.`,
    orderId: id,
  }).catch((e) =>
    console.error("revoke: losing-manufacturer notify failed", e)
  );

  if (strike) {
    await applyStrike(result.prevManufacturerId).catch((e) =>
      console.error("revoke: applyStrike failed", e)
    );
  }

  // The old manufacturer's panel only listens on its own topic, so the drop
  // needs its own emit — a single event cannot reach both sides.
  await emitOrderChanged({
    orderId: id,
    orderNumber: result.orderNumber,
    userId: result.userId,
    manufacturerId: result.prevManufacturerId,
    status: result.orderStatus,
    manufacturerStatus: "unassigned",
  }).catch((e) => console.error("revoke: emit (old manufacturer) failed", e));

  if (reassigned && target) {
    await notifyManufacturer({
      manufacturerId: target.id,
      type: "order_assigned",
      subject: `Yeni sipariş atandı — ${result.orderNumber}`,
      body:
        `Sayın ${target.companyName},\n\n` +
        `${result.orderNumber} numaralı sipariş size atandı.\n\n` +
        `Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\n` +
        `Müşteri: ${current?.customerName ?? ""}`,
      orderId: id,
    }).catch((e) => console.error("revoke: new-manufacturer notify failed", e));

    await emitOrderChanged({
      orderId: id,
      orderNumber: result.orderNumber,
      userId: result.userId,
      manufacturerId: target.id,
      status: result.orderStatus,
      manufacturerStatus: "assigned",
    }).catch((e) => console.error("revoke: emit (new manufacturer) failed", e));
  }

  return NextResponse.json({
    success: true,
    reassigned,
    prevStatus: result.prevStatus,
    prevManufacturer: prevName,
    // Tells the client why the order went neither back to the queue nor to
    // the chosen manufacturer, so it does not blame a race and invite a retry.
    ...(refunded ? { reason: "refunded" as const } : {}),
  });
}
