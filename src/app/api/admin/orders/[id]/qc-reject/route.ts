import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, qcReviews } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { rejectPendingQcPhotos } from "@/lib/services/order-model";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

/**
 * Reddin GEREKÇE KAYDI yazılamadığında dönen cümle.
 *
 * "Hiçbir şey değişmedi" diyebiliyor, çünkü karar satırı ile durum yazması TEK
 * işlemdir: kayıt düşerse tur artışı da geri sarılır.
 */
const QC_DECISION_UNRECORDED_ERROR =
  "QC kararı kaydedilemedi (geçici sistem arızası): ret UYGULANMADI, sipariş QC beklemede kaldı " +
  "ve hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

/**
 * Ret VERİLDİ ama eski turun fotoğrafları damgalanamadı.
 *
 * Yalnız yönetici günlüğüne düşer: bu bir iç arıza kaydıdır, üreticinin okuduğu
 * QC gerekçesi değil.
 */
const QC_PHOTO_STAMP_FAILED_NOTE =
  "[Sistem notu] QC fotoğraflarının durumu güncellenemedi (tablo okunamadı): ret UYGULANDI ve tur " +
  "artırıldı, ancak eski turun fotoğraf satırları \"bekliyor\" görünmeye devam edebilir.";

// Admin rejects the submitted QC photos → qc_rejected; bumps qcRound so the
// manufacturer uploads a fresh round. Shipping stays blocked.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const parsed = rejectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
    }
    const { reason } = parsed.data;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        manufacturerStatus: true,
        qcRound: true,
        manufacturerId: true,
        orderNumber: true,
        userId: true,
        paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    // A rejection sends the manufacturer back to reprint: forward work on money
    // already returned. A refunded order still attached stops here.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    const next = qcNextStatus(
      (order.manufacturerStatus ?? "") as ManufacturerOrderStatus,
      "reject"
    );
    if (!next) {
      return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
    }

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Ret de en az onay kadar bir KARARDIR: turu artırır, üreticiyi yeniden
    // baskıya yollar ve gerekçesi üreticinin okuduğu metindir. Kayıt tarafı
    // düşerken UPDATE'in geçmesi, sebebi hiçbir yerde yazmayan bir ret bırakırdı
    // — üstelik aynı reddi tekrar denemek 400 verdiği için gerekçe ekrandan bir
    // daha yazılamazdı. İkisi tek işlemdir: ret ya kaydıyla olur ya hiç olmaz.
    const outcome = await db
      .transaction(async (tx) => {
        const [updated] = await tx
          .update(orders)
          .set({
            manufacturerStatus: next,
            qcRound: sql`${orders.qcRound} + 1`,
            qcRejectionCount: sql`${orders.qcRejectionCount} + 1`,
            updatedAt: new Date(),
          })
          // The guard again in the write, so a refund landing after the read wins.
          .where(and(eq(orders.id, id), eq(orders.manufacturerStatus, "qc_pending"), notRefundedGuard()))
          .returning({ id: orders.id });
        if (!updated) return null;
        await tx.insert(qcReviews).values({
          orderId: id,
          round: order.qcRound,
          decision: "rejected",
          reason,
          adminEmail,
        });
        await tx.insert(adminActions).values({
          orderId: id,
          action: "qc_reject",
          adminEmail,
          // Sistem notu bu satıra KARIŞMAZ; damgalama arızası aşağıda AYRI bir
          // satıra düşer: qc_reviews.reason üreticinin okuduğu metindir ve bizim
          // iç arızamızı anlatmaz.
          notes: reason,
        });
        return true;
      })
      .catch((e) => {
        console.error("qc-reject: QC kararı kaydedilemedi, ret geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: QC_DECISION_UNRECORDED_ERROR, code: "qc_decision_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isOrderRefunded(id)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
    }

    // Mark the just-reviewed (old) round's photos rejected; new uploads land on
    // the bumped round.
    //
    // The rule lives in order-model.ts because a new MODEL REVISION resets QC the
    // same way (resetQcForNewRevision). Two copies would drift, and the half that
    // drifted would leave `pending` photos of a superseded round haunting the QC
    // queue.
    //
    // Damgalama KAYIT işidir, kapı değil — ve reddin GEREKÇESİ de değildir; o
    // yüzden işlemin DIŞINDA, commit'ten SONRA durur. Fotoğraf tablosu
    // okunamazken reddi geri sarmak, üreticinin beklediği gerekçeyi hiç
    // yazmamak olurdu: ret geçerlidir, yalnız eski turun satırları "bekliyor"
    // görünmeye devam edebilir.
    let photoStampFailed = false;
    try {
      await rejectPendingQcPhotos(id, order.qcRound);
    } catch (e) {
      console.error("qc-reject: bekleyen QC fotoğrafları reddedilemedi", e);
      photoStampFailed = true;
    }
    if (photoStampFailed) {
      // AYRI satır (qc-approve ile aynı biçim): yukarıdaki notun metni
      // üreticinin de okuduğu gerekçedir, iç arızamızı oraya karıştırmak
      // partnere bizim sistem notumuzu okuturdu. Yeni bir `action` değeri de
      // EKLENMEZ — admin_action_type bir pg enum'u ve enum'a değer eklemek geri
      // alınabilir bir migration ile temizlenemez; gerçek anlam notta durur.
      await db
        .insert(adminActions)
        .values({
          orderId: id,
          action: "qc_reject",
          adminEmail,
          notes: QC_PHOTO_STAMP_FAILED_NOTE,
        })
        .catch((e) => console.error("qc-reject: damgalama arızası kaydedilemedi", e));
    }

    if (order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: order.manufacturerId,
        type: "qc_result",
        subject: `QC reddedildi — ${order.orderNumber}`,
        body: `Kalite kontrol reddedildi. Gerekçe: ${reason}. Lütfen düzeltip yeni fotoğraf yükleyerek tekrar gönderin.`,
        orderId: id,
      }).catch((e) => console.error("notifyManufacturer qc_reject failed", e));
    }

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      manufacturerStatus: next,
    });

    // Ret geçerlidir; damgalama düştüyse bu SÖYLENİR, yapılan iş yapılmamış
    // gibi anlatılmaz.
    return NextResponse.json({ success: true, photoStampFailed });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/qc-reject", ADMIN_ACTION_FAILED_ERROR);
  }
}
