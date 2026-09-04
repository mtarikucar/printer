import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions, workshopParticipants, adminActions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES } from "@/lib/config/workshop";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Bir siparişin partide HÂLÂ teslim edilmeyi beklediğini söyleyen tanım.
 * `shipped` burada HARİÇ TUTULMAZ (ship'in `batchPending`inin tam tersi):
 * `shipped` olan bir sipariş tam olarak bu bekleme listesindeki sipariştir.
 */
function deliverPending(sessionId: string) {
  return and(
    eq(orders.workshopSessionId, sessionId),
    notInArray(orders.status, [...WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES])
  );
}

/**
 * Seansın sevk edilmiş siparişlerini TEK işlemde mekana teslim edilmiş
 * işaretler.
 *
 * `eq(orders.status, "shipped")` şartı, tekli
 * `/api/admin/orders/[id]/deliver` ucundaki AYNI kapı: `shipped` OLMAYAN bir
 * sipariş asla sessizce `delivered`e atlamaz. Aynı sebep burada da geçerli —
 * bir sipariş kargolanmadan teslim edilmiş sayılırsa iş akışı yalan söyler.
 *
 * Seansın toplu durumu ship ucundaki AYNI ilkeyle `delivered`e döner: yalnızca
 * partide (rejected hariç) teslim edilmemiş sipariş KALMADIĞINDA — bu
 * çağrının bir şey teslim edip etmediğinden BAĞIMSIZ. Örnek: parti kısmen
 * teslim edildi, kalan sipariş(ler) sonradan iade edilip `rejected` oldu;
 * sonraki bir "Toplu teslim" çağrısı hiçbir yeni satır güncellemese bile
 * parti artık tamamdır ve seans bunu yansıtmalı (bkz. fix round 2, "Finding
 * 2" — ship ucundaki aynı düzeltmenin ("Finding 3") burada aynalanmış hâli).
 * Bunun tersi — bir sipariş teslim eder etmez seansı `delivered`e çevirmek —
 * partide hâlâ `shipped` bekleyen başka siparişler varken teslimatın
 * TAMAMLANDIĞINI yanlış beyan eder.
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
  const { delivered, sessionNowDelivered } = await db.transaction(async (tx) => {
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
        .update(workshopParticipants)
        .set({ status: "delivered", updatedAt: now })
        .where(
          inArray(
            workshopParticipants.orderId,
            rows.map((r) => r.id)
          )
        );
    }

    // Partide (bu çağrıdan ÖNCE ya da bu çağrıyla) teslim edilmemiş sipariş
    // kaldı mı? UPDATE'ten SONRA okunduğu için bu çağrının kendi teslimatını
    // da doğal olarak düşer.
    const pendingRows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(deliverPending(id));

    // Partide EN AZ bir teslim edilmiş sipariş var mı (bu çağrıdan önce ya
    // da bu çağrıyla)? "Hiç teslimat olmadı ama her şey iade edildi" durumunu
    // yanlışlıkla `delivered`e çevirmemek için.
    const anyDeliveredRows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.workshopSessionId, id), eq(orders.status, "delivered")))
      .limit(1);
    const batchComplete = pendingRows.length === 0 && anyDeliveredRows.length > 0;

    // `batchDeliveredAt` YALNIZCA bu çağrı gerçekten bir şey teslim ettiyse
    // güncellenir — ship ucundaki aynı ilke (bkz. o dosyadaki yorum): geride
    // kalanlar sonradan iade edildiği için parti tamamlanan bir çağrıda
    // (aşağıdaki `else if`) BU ÇAĞRININ taşımadığı bir teslimat damgası
    // uydurulmaz, yalnızca seans durumu ilerler.
    if (rows.length > 0) {
      await tx
        .update(workshopSessions)
        .set({
          batchDeliveredAt: now,
          updatedAt: now,
          ...(batchComplete ? { status: "delivered" as const } : {}),
        })
        .where(eq(workshopSessions.id, id));
    } else if (batchComplete) {
      await tx
        .update(workshopSessions)
        .set({ status: "delivered", updatedAt: now })
        .where(eq(workshopSessions.id, id));
    }

    return { delivered: rows, sessionNowDelivered: batchComplete };
  });

  if (delivered.length === 0 && !sessionNowDelivered) {
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
