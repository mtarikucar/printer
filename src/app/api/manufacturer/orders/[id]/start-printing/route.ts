import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { modelAckRefusal, readPartnerModelAck } from "@/lib/services/order-model-revision";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getManufacturerSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify manufacturer is active
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
    });

    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json(
        { error: "Your account is not active" },
        { status: 403 }
      );
    }

    const { id } = await params;

    // İADE ÖNCE SORULUR: hangi kapının durdurduğu doğru söylensin.
    //
    // NEDEN: iade kontrolü yalnızca aşağıdaki korumalı UPDATE ıskaladıktan SONRA
    // vardı, onay kapısı ise ondan önce okunuyordu. İade edilmiş bir siparişte
    // duyurulmuş bir sürüm varsa (ya da günlük okunamıyorsa) üretici, parası
    // müşteriye dönmüş bir iş için "yeni model sürümünü onaylayın" diye
    // yönlendiriliyordu — üstelik onay ucu iade yüzünden 409 verdiği için
    // uyulması İMKÂNSIZ bir talimat. Kardeş uçların hepsi (submit-qc,
    // send-to-painter, ship, boyacının QC/kargosu) iadeyi önce sorar.
    // Yarışa karşı asıl koruma yine UPDATE'in WHERE'indeki notRefundedGuard().
    const refundPreRead = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
      columns: { id: true, paymentStatus: true },
    });
    if (refundPreRead && isRefunded(refundPreRead)) {
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

    // Atomic status transition: accepted -> printing
    const [order] = await db
      .update(orders)
      .set({
        manufacturerStatus: "printing",
        status: "printing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.manufacturerId, session.manufacturerId),
          eq(orders.manufacturerStatus, "accepted"),
          // Refund-end-state: no printing (and no "printing" mail to a customer
          // who got their money back) on a refunded order still attached here.
          // In the UPDATE, not a pre-read, so a refund landing mid-request wins.
          notRefundedGuard()
        )
      )
      .returning();

    if (!order) {
      if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Order not found or not in accepted status" },
        { status: 400 }
      );
    }

    await db.insert(manufacturerActions).values({
      orderId: id,
      manufacturerId: session.manufacturerId,
      action: "start_printing",
    });

    // Notify customer — non-fatal: the status transition is already committed, so
    // a queue/Redis blip must not surface as a 500 that makes the manufacturer
    // retry against a guard that no longer matches.
    await getEmailQueue()
      .add("printing", {
        type: "order_printing",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
      })
      .catch((e) => console.error("printing email enqueue failed", e));

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/orders/[id]/start-printing", PARTNER_ACTION_FAILED_ERROR);
  }
}
