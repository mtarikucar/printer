import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions, workshopParticipants, adminActions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Seansın sevk edilmiş siparişlerini TEK işlemde mekana teslim edilmiş
 * işaretler.
 *
 * `eq(orders.status, "shipped")` şartı, tekli
 * `/api/admin/orders/[id]/deliver` ucundaki AYNI kapı: `shipped` OLMAYAN bir
 * sipariş asla sessizce `delivered`e atlamaz. Aynı sebep burada da geçerli —
 * bir sipariş kargolanmadan teslim edilmiş sayılırsa iş akışı yalan söyler.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email;

  const { id } = await params;
  const now = new Date();

  // Sipariş + seans + katılımcı damgaları TEK işlemde: üçü asla birbirinden
  // ayrı düşmemeli (bkz. ship ucundaki aynı ilke).
  const delivered = await db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: "delivered", deliveredAt: now, updatedAt: now })
      .where(and(eq(orders.workshopSessionId, id), eq(orders.status, "shipped")))
      .returning({
        id: orders.id,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        manufacturerId: orders.manufacturerId,
        status: orders.status,
        manufacturerStatus: orders.manufacturerStatus,
      });

    if (rows.length > 0) {
      await tx
        .update(workshopSessions)
        .set({ status: "delivered", batchDeliveredAt: now, updatedAt: now })
        .where(eq(workshopSessions.id, id));

      await tx
        .update(workshopParticipants)
        .set({ status: "delivered", updatedAt: now })
        .where(
          inArray(
            workshopParticipants.orderId,
            rows.map((r) => r.id)
          )
        );
    }

    return rows;
  });

  if (delivered.length === 0) {
    return NextResponse.json(
      { error: "Teslim edilecek, sevk edilmiş sipariş bulunamadı." },
      { status: 400 }
    );
  }

  // Yan etkiler işlem COMMIT ettikten SONRA (ship ucundaki aynı ilke).
  for (const o of delivered) {
    await db
      .insert(adminActions)
      .values({
        orderId: o.id,
        action: "deliver",
        adminEmail,
        notes: `Atölye toplu teslim (seans ${id})`,
      })
      .catch((e) => console.error(`workshop deliver: adminActions insert ${o.id} failed`, e));

    await emitOrderChanged({
      orderId: o.id,
      orderNumber: o.orderNumber,
      userId: o.userId,
      manufacturerId: o.manufacturerId,
      status: o.status,
      manufacturerStatus: o.manufacturerStatus,
    }).catch(() => {});
  }

  return NextResponse.json({ delivered: delivered.length });
}
