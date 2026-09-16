import { NextRequest, NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterQcPhotos, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { QC_MIN_PHOTOS } from "@/lib/config/qc";
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
  "İş günlüğüne yazılamadığı için gönderim uygulanmadı (geçici sistem arızası): iş eski durumunda " +
  "kaldı ve hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

// Painter submits the current QC round for admin review:
// accepted|painting|painted|qc_rejected → qc_pending (requires >=1 photo).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;

    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
      columns: {
        id: true, orderNumber: true, userId: true, manufacturerId: true,
        painterStatus: true, painterQcRound: true, paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "İş bulunamadı" }, { status: 404 });
    // Before the photo count, so a refunded job is not told to upload more
    // photos. The race-proof half is notRefundedGuard() in the UPDATE below.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    // Yeni model sürümü onay bekliyorsa QC'ye gönderilemez: elindeki baskı eski
    // sürüme ait olabilir ve onaylanan bir QC turu işi kargoya açar. Ekran da
    // aynı kuralı çalıştırır (partner-model-ack.ts); burası sunucu tarafıdır.
    const ack = await readPartnerModelAck(id, { kind: "painter", id: g.painterId });
    // Ret TEK kaynaktan gelir (modelAckRefusal): onay bekleyen sürüm 409, onay
    // günlüğü OKUNAMADIYSA 503 + "geçici arıza" cümlesi. Burada eskiden yalnız
    // `ack.pending` okunuyordu; arıza dalı (readFailed) o okumada görünmediği için
    // boyacı, sistemin BİLMEDİĞİ bir olayı ("yeni bir model sürümü yüklendi,
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

    const current = (order.painterStatus ?? "") as PainterOrderStatus;
    const next = painterQcNextStatus(current, "submit");
    if (!next) {
      return NextResponse.json({ error: "İş QC'ye gönderilebilir durumda değil" }, { status: 400 });
    }

    // Turun fotoğraf SAYISI bir kapıyı besliyor: okunamayan sayı SIFIR
    // sayılamaz. Kapı KAPALI kalır; değişen, cevabın sebebi söylemesi.
    let photoCount: number;
    try {
      const [photoRow] = await db
        .select({ value: count() })
        .from(painterQcPhotos)
        .where(and(eq(painterQcPhotos.orderId, id), eq(painterQcPhotos.round, order.painterQcRound)));
      photoCount = Number(photoRow?.value ?? 0);
    } catch (e) {
      console.error("painter submit-qc: turun QC fotoğrafları sayılamadı", e);
      return NextResponse.json(
        { error: QC_PHOTO_COUNT_UNAVAILABLE_ERROR, code: "qc_photo_count_unavailable" },
        { status: 503 }
      );
    }
    // The painter agreement binds each QC round to at least 4 photos
    // (front, back/side, close-up of the finest detail, base).
    if (photoCount < QC_MIN_PHOTOS) {
      return NextResponse.json(
        { error: `İncelemeye göndermek için en az ${QC_MIN_PHOTOS} fotoğraf yükleyin.` },
        { status: 400 }
      );
    }

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Eylem satırı eskiden `.catch(console.error)` ile yazılıyordu: geçiş
    // uygulanırken boyacının "hangi turu ne zaman gönderdim" kaydı SESSİZCE
    // kaybolabiliyordu ve arıza geçtikten sonra eksik günlük, eksik olduğunu
    // söylemeden tam liste gibi görünüyordu. Artık ikisi tek işlem: kayıt
    // yazılamazsa geçiş de geri sarılır ve boyacı bunu cevaptan okur.
    const outcome = await db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(orders)
          .set({ painterStatus: next, updatedAt: new Date() })
          .where(
            and(
              eq(orders.id, id),
              eq(orders.painterId, g.painterId),
              eq(orders.painterStatus, current),
              notRefundedGuard()
            )
          )
          .returning({ id: orders.id, orderNumber: orders.orderNumber, userId: orders.userId, manufacturerId: orders.manufacturerId, status: orders.status });
        if (!row) return null;
        await tx
          .insert(painterActions)
          .values({ orderId: id, painterId: g.painterId, action: "submit_qc" });
        return row;
      })
      .catch((e) => {
        console.error("painter submit-qc: iş günlüğü yazılamadı, gönderim geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: QC_SUBMIT_UNRECORDED_ERROR, code: "transition_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isPartnerOrderRefunded(id, { painterId: g.painterId })) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });
    }
    const updated = outcome;

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/submit-qc", PARTNER_ACTION_FAILED_ERROR);
  }
}
