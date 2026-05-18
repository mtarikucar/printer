import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturerActions } from "@/lib/db/schema";
import { rankForOrderWithShadow } from "@/lib/services/manufacturer-assignment-shadow";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { getEmailQueue } from "@/lib/queue/queues";

const MAX_DECLINES_BEFORE_ADMIN = 3;

/**
 * Best-effort admin notification when an order needs manual assignment.
 * Two trigger paths: hit the decline cap, or no eligible candidate left.
 * Email failure doesn't roll back the decline — the adminNotes flag is the
 * durable signal.
 */
async function notifyAdminManualAssignment(args: {
  orderNumber: string;
  orderId: string;
  reason: string;
  declineCount: number;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
  try {
    await getEmailQueue().add("admin-manual-assignment", {
      type: "admin_custom",
      to: adminEmail,
      orderNumber: args.orderNumber,
      customerName: "Admin",
      customSubject: `Manuel atama gerekli — ${args.orderNumber}`,
      customBody:
        `Sipariş ${args.orderNumber} otomatik üretici atamasından çıktı.\n\n` +
        `Sebep: ${args.reason}\n` +
        `Reddeden üretici sayısı: ${args.declineCount}\n\n` +
        `Lütfen /admin/orders üzerinden manuel olarak bir üretici atayın.`,
      locale: "tr",
    });
  } catch (err) {
    console.error(
      `[N12] admin manual-assignment email enqueue failed for ${args.orderNumber}`,
      err
    );
  }
}

export type DeclineResult =
  | { ok: true; action: "reassigned"; newManufacturerId: string }
  | { ok: true; action: "admin_queue"; reason: string }
  | { ok: false; reason: string };

/**
 * Manufacturer-initiated decline of an assigned order (N12).
 *
 * Flow:
 *   1. Verify the order is currently `assigned` to this manufacturer. We
 *      don't permit declining an already-`accepted` order — that's abandoning
 *      a job and should go through admin.
 *   2. Atomically:
 *        - Clear manufacturerId + manufacturerStatus
 *        - Append the declining mfg id to declinedManufacturerIds
 *        - Insert a `decline` row in manufacturer_actions (used by the
 *          reliability score)
 *   3. If declines < MAX_DECLINES_BEFORE_ADMIN, attempt automatic
 *      reassignment to the next-best eligible candidate (excluding any
 *      previously-declining manufacturer for this order).
 *   4. Otherwise, leave the order unassigned with an adminNotes flag —
 *      `/admin/orders` queue picks it up.
 *
 * Returns the chosen path so the API layer can shape its response.
 */
export async function declineOrder(args: {
  orderId: string;
  manufacturerId: string;
  reason?: string;
}): Promise<DeclineResult> {
  const { orderId, manufacturerId, reason } = args;

  // Step 1+2 atomically.
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) return { code: "not_found" as const };
    if (order.manufacturerId !== manufacturerId) {
      return { code: "not_yours" as const };
    }
    if (order.manufacturerStatus !== "assigned") {
      return { code: "wrong_status" as const, status: order.manufacturerStatus };
    }

    const declinedList = Array.isArray(order.declinedManufacturerIds)
      ? order.declinedManufacturerIds
      : [];
    // Defensive — avoid duplicate entries if the same manufacturer somehow
    // declines twice (cooldown bypass / replay).
    const nextDeclined = declinedList.includes(manufacturerId)
      ? declinedList
      : [...declinedList, manufacturerId];

    await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        declinedManufacturerIds: nextDeclined,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await tx.insert(manufacturerActions).values({
      orderId,
      manufacturerId,
      action: "decline",
      notes: reason?.slice(0, 500) ?? null,
    });

    return {
      code: "ok" as const,
      declinedCount: nextDeclined.length,
      declinedList: nextDeclined,
      orderNumber: order.orderNumber,
    };
  });

  if (result.code === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  if (result.code === "not_yours") {
    return { ok: false, reason: "not_yours" };
  }
  if (result.code === "wrong_status") {
    return { ok: false, reason: `wrong_status:${result.status}` };
  }

  // Step 3: cap check.
  if (result.declinedCount >= MAX_DECLINES_BEFORE_ADMIN) {
    await db
      .update(orders)
      .set({
        adminNotes:
          `[N12] ${result.declinedCount} manufacturer(s) declined — needs manual assignment.`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    await notifyAdminManualAssignment({
      orderNumber: result.orderNumber,
      orderId,
      reason: `Max declines reached (${result.declinedCount})`,
      declineCount: result.declinedCount,
    });
    return {
      ok: true,
      action: "admin_queue",
      reason: `max_declines_reached:${result.declinedCount}`,
    };
  }

  // Step 3a: attempt automatic reassignment to next-best eligible.
  // Goes through the Q7 shadow wrapper — same authoritative pick as
  // admin UI, plus the parallel evaluation is logged. Shadow logging
  // is fire-and-forget inside the wrapper, so a failure here doesn't
  // roll back the decline.
  const candidates = await rankForOrderWithShadow(orderId);
  const next = candidates.find(
    (c) =>
      c.eligible &&
      c.manufacturerId !== manufacturerId &&
      !result.declinedList.includes(c.manufacturerId)
  );

  if (!next) {
    await db
      .update(orders)
      .set({
        adminNotes:
          `[N12] No eligible manufacturer left after ${result.declinedCount} decline(s).`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));
    await notifyAdminManualAssignment({
      orderNumber: result.orderNumber,
      orderId,
      reason: "No eligible manufacturer remaining",
      declineCount: result.declinedCount,
    });
    return {
      ok: true,
      action: "admin_queue",
      reason: "no_eligible_candidate",
    };
  }

  // Atomic re-assign — guard against a concurrent admin reassigning in the
  // gap between rankManufacturersForOrder and this update by requiring the
  // status is still `unassigned`.
  const [updated] = await db
    .update(orders)
    .set({
      manufacturerId: next.manufacturerId,
      manufacturerStatus: "assigned",
      assignedToManufacturerAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.manufacturerStatus, "unassigned")
      )
    )
    .returning({ id: orders.id });
  if (!updated) {
    return {
      ok: true,
      action: "admin_queue",
      reason: "concurrent_assignment_lost_race",
    };
  }

  // Best-effort notification to the newly-assigned manufacturer.
  try {
    await notifyManufacturer({
      manufacturerId: next.manufacturerId,
      type: "order_assigned",
      subject: `Yeni sipariş atandı — ${result.orderNumber}`,
      body:
        `Size yeni bir sipariş atandı: ${result.orderNumber}\n\n` +
        `Önceki üretici siparişi reddettiği için otomatik olarak siz görevlendirildiniz.\n\n` +
        `Üretici panelinden detayları görüntüleyebilirsiniz.`,
      orderId,
    });
  } catch (err) {
    console.error("[N12] reassign notification failed", err);
  }

  return { ok: true, action: "reassigned", newManufacturerId: next.manufacturerId };
}
