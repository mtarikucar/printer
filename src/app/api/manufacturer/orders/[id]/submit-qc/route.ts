import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { QC_MIN_PHOTOS } from "@/lib/config/qc";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions, qcPhotos } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { modelAckRefusal, readPartnerModelAck } from "@/lib/services/order-model-revision";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Turun fotoğrafları SAYILAMADIĞINDA dönen cümle.
 *
 * Tur "fotoğrafsız" değil, "bilinmiyor": okunamayan sayıyı sıfır sanmak arızayı
 * bir kural reddine çevirirdi ("4 fotoğraf yükleyin"), oysa fotoğraflar
 * yüklenmiş olabilir.
 */
const QC_PHOTO_COUNT_UNAVAILABLE_ERROR =
  "Bu turdaki QC fotoğraflarının sayısı şu anda okunamadı (geçici sistem arızası): tur FOTOĞRAFSIZ " +
  `DEĞİL, kaç fotoğraf olduğu bilinmiyor. En az ${QC_MIN_PHOTOS} fotoğraf kuralı doğrulanamadığı ` +
  "için gönderim yapılmadı; birkaç dakika sonra tekrar deneyin.";

/**
 * Geçişin GÜNLÜK KAYDI yazılamadığında dönen cümle.
 *
 * "Hiçbir şey değişmedi" diyebiliyor, çünkü durum yazması ile eylem satırı TEK
 * işlemdir: kayıt düşerse geçiş de geri sarılır.
 */
const QC_SUBMIT_UNRECORDED_ERROR =
  "İş günlüğüne yazılamadığı için gönderim uygulanmadı (geçici sistem arızası): sipariş eski " +
  "durumunda kaldı ve hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

// Manufacturer submits the current round of QC photos for admin review:
// printed | qc_rejected → qc_pending (order.status → quality_check).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getManufacturerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
    }

    const { id } = await params;
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
      columns: {
        id: true,
        manufacturerStatus: true,
        qcRound: true,
        email: true,
        orderNumber: true,
        customerName: true,
        paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    // Before the photo count, so a refunded job is not told to upload more
    // photos. The race-proof half is notRefundedGuard() in the UPDATE below.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    // Onaylanmamış yeni model sürümü varsa bu adım kapalıdır.
    //
    // Admin, iş üretimdeyken yeni bir model sürümü yükleyebilir
    // (late-model-upload kararı); üreticinin yeni dosyayı GÖRDÜĞÜNÜ onaylaması
    // gerekir. Üretici ekranı bu kapıyı zaten uyguluyor — burası sunucu
    // tarafıdır, çünkü ekranı atlayan bir istek eski modelle üretime devam
    // edebilirdi; eski baskı QC'den geçip kargoya çıkarsa hakediş de oradan
    // tahakkuk ederdi. Kabul ve ret bilerek serbest bırakıldı: işi hiç almamış
    // bir atölyeyi onaya zorlamak onu kilitler (config/partner-model-ack.ts).
    const ack = await readPartnerModelAck(id, {
      kind: "manufacturer",
      id: session.manufacturerId,
    });
    // Ret TEK kaynaktan gelir (modelAckRefusal): onay bekleyen sürüm 409, onay
    // günlüğü OKUNAMADIYSA 503 + "geçici arıza" cümlesi. Burada eskiden yalnız
    // `ack.pending` okunuyordu; arıza dalı (readFailed) o okumada görünmediği için
    // üretici, sistemin BİLMEDİĞİ bir olayı ("yeni bir model sürümü yüklendi,
    // onaylayın") gerekçe diye okuyup o cümlenin gösterdiği onay düğmesine basıyor
    // ve boş gövdeli bir 500 alıyordu. Kapı iki dalda da KAPALI kalır; değişen
    // yalnız gerekçe ve tekrar deneme tavsiyesi.
    const ackRefusal = modelAckRefusal(ack);
    if (ackRefusal) {
      return NextResponse.json(
        { error: ackRefusal.error, code: ackRefusal.code },
        { status: ackRefusal.status }
      );
    }

    const current = (order.manufacturerStatus ?? "") as ManufacturerOrderStatus;
    const next = qcNextStatus(current, "submit");
    if (!next) {
      return NextResponse.json(
        { error: "Order is not in a submittable status" },
        { status: 400 }
      );
    }

    // Turun fotoğraf SAYISI bir kapıyı besliyor: okunamayan sayı SIFIR
    // sayılamaz. Korumasız hâlinde arıza, üreticiye neyin durduğunu anlatmayan
    // genel bir 500 olarak dönüyordu. Kapı yine KAPALI kalır; değişen, cevabın
    // sebebi adıyla söylemesi ve tekrar denemeyi önermesi.
    let photoCount: number;
    try {
      const [photoRow] = await db
        .select({ value: count() })
        .from(qcPhotos)
        .where(and(eq(qcPhotos.orderId, id), eq(qcPhotos.round, order.qcRound)));
      photoCount = Number(photoRow?.value ?? 0);
    } catch (e) {
      console.error("submit-qc: turun QC fotoğrafları sayılamadı", e);
      return NextResponse.json(
        { error: QC_PHOTO_COUNT_UNAVAILABLE_ERROR, code: "qc_photo_count_unavailable" },
        { status: 503 }
      );
    }
    // The partnership contract binds the manufacturer to at least 4 QC photos per
    // round (overall front + back/side + close-up of the finest detail + a shot
    // with a ruler). One photo cannot show what QC has to judge.
    if (photoCount < QC_MIN_PHOTOS) {
      return NextResponse.json(
        { error: `İncelemeye göndermek için en az ${QC_MIN_PHOTOS} fotoğraf yükleyin.` },
        { status: 400 }
      );
    }

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Geçiş işi admin'in QC kuyruğuna taşır; üreticinin "hangi turu ne zaman
    // gönderdim" kaydı o eylem satırıdır. Ayrı yazıldığında satır sessizce
    // kaybolabiliyordu (QA'da ölçüldü: partner günlüğü okunamazken iş 200 döndü,
    // günlük satırı hiç yazılmadı) ve arıza geçtikten sonra eksik günlük, eksik
    // olduğunu söylemeden tam liste gibi görünüyordu. Artık ikisi tek işlem.
    const outcome = await db
      .transaction(async (tx) => {
        // Atomic transition guarded on the exact status we read.
        const [row] = await tx
          .update(orders)
          .set({ manufacturerStatus: next, status: "quality_check", updatedAt: new Date() })
          .where(
            and(
              eq(orders.id, id),
              eq(orders.manufacturerId, session.manufacturerId),
              eq(orders.manufacturerStatus, current),
              notRefundedGuard()
            )
          )
          .returning({
            id: orders.id,
            orderNumber: orders.orderNumber,
            userId: orders.userId,
            manufacturerId: orders.manufacturerId,
            status: orders.status,
            manufacturerStatus: orders.manufacturerStatus,
          });
        if (!row) return null;
        await tx.insert(manufacturerActions).values({
          orderId: id,
          manufacturerId: session.manufacturerId,
          action: "submit_qc",
          notes: `round ${order.qcRound}`,
        });
        return row;
      })
      .catch((e) => {
        console.error("submit-qc: iş günlüğü yazılamadı, gönderim geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: QC_SUBMIT_UNRECORDED_ERROR, code: "transition_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Order is not in a submittable status" },
        { status: 400 }
      );
    }
    const updated = outcome;

    // Notify admin there's a QC review waiting (recipient overridden to adminEmail).
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      // Non-fatal: status already committed, don't 500 on a queue blip.
      await getEmailQueue()
        .add("qc-submitted", {
          type: "qc_submitted",
          to: order.email,
          adminEmail,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          companyName: manufacturer.companyName,
        })
        .catch((e) => console.error("qc-submitted email enqueue failed", e));
    }

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/orders/[id]/submit-qc", PARTNER_ACTION_FAILED_ERROR);
  }
}
