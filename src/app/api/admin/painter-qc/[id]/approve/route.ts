import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterQcReviews, painterQcPhotos } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Kararın GEREKÇE KAYDI yazılamadığında dönen cümle.
 *
 * "Hiçbir şey değişmedi" diyebiliyor, çünkü karar satırı ile durum yazması TEK
 * işlemdir: kayıt düşerse geçiş de geri sarılır.
 */
const PAINTER_QC_DECISION_UNRECORDED_ERROR =
  "QC kararı kaydedilemedi (geçici sistem arızası): karar UYGULANMADI, iş QC beklemede kaldı ve " +
  "hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

// Admin approves a painter's QC round: qc_pending → qc_approved (shipping unlocked).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const { id } = await params;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true, orderNumber: true, userId: true, manufacturerId: true,
        painterId: true, painterStatus: true, painterQcRound: true, paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    // Approving painter QC unlocks the painter's ship, which accrues their
    // earning. A refunded order that still has its painter attached stops here.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    const next = painterQcNextStatus((order.painterStatus ?? "") as PainterOrderStatus, "approve");
    if (!next) return NextResponse.json({ error: "Sipariş QC onayına uygun değil" }, { status: 400 });

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Onay boyacının kargosunu açar, kargo da boyacı hakedişini doğurur: parayı
    // başlatan adımın ARKASINDA onu haklı çıkaran karar satırı durmak zorunda.
    // Ayrı yazıldıklarında admin "işlem tamamlanamadı" okurken iş YAPILMIŞ,
    // kaydı ise hiç oluşmamış oluyordu (üreticinin QC'sinde canlı olarak ölçüldü).
    const outcome = await db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(orders)
          .set({ painterStatus: next, updatedAt: new Date() })
          // The guard again in the write, so a refund landing after the read wins.
          .where(and(eq(orders.id, id), eq(orders.painterStatus, "qc_pending"), notRefundedGuard()))
          .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
        if (!row) return null;
        await tx.insert(painterQcReviews).values({
          orderId: id, round: order.painterQcRound, decision: "approved", adminEmail: a.session.user.email,
        });
        return row;
      })
      .catch((e) => {
        console.error("painter-qc/approve: QC kararı kaydedilemedi, onay geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: PAINTER_QC_DECISION_UNRECORDED_ERROR, code: "qc_decision_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isOrderRefunded(id)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json({ error: "Zaten işlenmiş" }, { status: 400 });
    }
    const updated = outcome;

    // Fotoğraf satırlarını damgalamak KAYIT işidir, kapı değil — ve onayın
    // GEREKÇESİ de değildir; o yüzden işlemin DIŞINDA, commit'ten SONRA durur.
    // Ekran bu denetimi, fotoğraf tablosu okunamazken de sunuyor (client.tsx ·
    // readFailures.painterQcPhotos); korumasız hâlinde aynı arıza burada
    // fırlıyor ve admin "işlem tamamlanamadı" okuyordu — oysa iş YAPILMIŞTI.
    // Yapılan işi yapılmamış gibi anlatan cevap, en pahalı cevaptır.
    let photoStampFailed = false;
    try {
      await db
        .update(painterQcPhotos)
        .set({ reviewStatus: "approved" })
        .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));
    } catch (e) {
      console.error("painter-qc/approve: QC fotoğraflarının durumu güncellenemedi", e);
      photoStampFailed = true;
    }

    if (order.painterId) {
      await notifyPainter({
        painterId: order.painterId,
        type: "qc_result",
        subject: "QC onaylandı",
        body: `${order.orderNumber} numaralı işin kalite kontrolü onaylandı. Artık kargolayabilirsiniz.`,
        orderId: id,
      }).catch((e) => console.error("notifyPainter (qc approve) failed", e));
    }
    await emitOrderChanged({
      orderId: updated.id, orderNumber: updated.orderNumber, userId: updated.userId,
      manufacturerId: updated.manufacturerId, status: updated.status,
    }).catch(() => {});

    // Damgalama düştüyse bu SÖYLENİR: onay geçerlidir, yalnız fotoğraf satırları
    // "bekliyor" görünmeye devam edebilir.
    return NextResponse.json({ success: true, photoStampFailed });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/painter-qc/[id]/approve", ADMIN_ACTION_FAILED_ERROR);
  }
}
