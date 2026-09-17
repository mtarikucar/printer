import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { createShipOrderSchema } from "@/lib/validators/order";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getEmailQueue } from "@/lib/queue/queues";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { sendSms } from "@/lib/services/sms";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { modelAckRefusal, readPartnerModelAck } from "@/lib/services/order-model-revision";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Kargo gövdesindeki alan adlarının Türkçe karşılığı — hata cümlesi için.
 * Zod'un kendi (İngilizce) tip cümlesi partnere GÖSTERİLMEZ.
 */
const SHIP_FIELD_LABELS: Record<string, string> = {
  trackingNumber: "takip numarası",
  carrier: "kargo firması",
};

/**
 * Eksik/geçersiz gövdenin partnere okunabilir TEK cümlesi.
 *
 * NEDEN: buradan `(error as ...).errors` dönülüyordu — zod 3 biçimi. Proje zod
 * 4'te ve orada alan `issues`, yani `errors` undefined: cevap gövdesi harfiyen
 * `{}` olarak gidiyor, panel de kendi yedek cümlesini ("İşlem tamamlanamadı
 * (HTTP 400)") gösteriyordu. Partner, hangi alanı eksik gönderdiğini hiçbir
 * yerde okuyamıyordu. Alan adları bilinmiyorsa (gövde nesne bile değilse) genel
 * ama yine Türkçe bir cümle kurulur.
 */
function shipBodyErrorTr(error: unknown): string {
  const issues =
    (error as { issues?: { path?: (string | number)[] }[] }).issues ?? [];
  const fields = [
    ...new Set(
      issues
        .map((i) => SHIP_FIELD_LABELS[String(i.path?.[0] ?? "")])
        .filter((label): label is string => !!label)
    ),
  ];
  return fields.length
    ? `Eksik veya geçersiz alan: ${fields.join(", ")}. Takip numarasını yazın ve kargo firmasını seçin.`
    : "İstek gövdesi eksik veya geçersiz. Takip numarasını yazın ve kargo firmasını seçin.";
}

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

    // Bozuk gövde İSTEMCİ hatasıdır, sunucu arızası değil.
    //
    // `request.json()` try'ın içinde çıplak duruyordu ve aşağıdaki catch yalnız
    // ZodError'ı ayırdığı için yarım/bozuk bir gövde partnere 500 "Failed to ship
    // order" diye dönüyordu: tekrar denemesi anlamsız görünen, sebebini
    // söylemeyen bir cevap. Boş gövde ({}) zaten alan hatasıyla 400 alıyor; iki
    // durum aynı kapıdan geçer.
    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return NextResponse.json(
        {
          error:
            "İstek gövdesi okunamadı (geçersiz JSON). Takip numarası ve kargo firmasını gönderin.",
        },
        { status: 400 }
      );
    }

    try {
      const validated = createShipOrderSchema().parse(body);

      // Atölye siparişi TEK TEK kargolanmaz.
      //
      // Bir atölye partisi mekana TEK sevkiyatla gider ve katılımcı figürünü
      // seansta elden alır. Bu uçtan kargolanırsa müşteriye standart "kargoya
      // verildi, takip no …" e-postası gider (bkz. aşağısı) ve katılımcı,
      // atölyede teslim alacağı bir koli için günlerce takip numarası kovalar;
      // ayrıca hakediş atölye toplu sevkinin dışında tahakkuk eder ve seans
      // hiçbir zaman `shipped`e ulaşamaz. Kapı ÖNCE burada (anlaşılır Türkçe
      // mesajla), sonra aşağıdaki koşullu UPDATE'te (yarışa karşı) durur.
      const current = await db.query.orders.findFirst({
        where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
        columns: { workshopSessionId: true, paymentStatus: true, needsPainting: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
      }
      // A refunded order never ships, workshop or not: the customer has their
      // money back, so no "shipped" mail and no fresh earning. This is the
      // readable refusal; the race-proof half is notRefundedGuard() below.
      if (current && isRefunded(current)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      if (current?.workshopSessionId) {
        return NextResponse.json(
          {
            error:
              "Bu sipariş bir atölye partisine ait ve tek tek kargolanamaz. " +
              "Parti, seans mekanına Figurünica tarafından tek sevkiyatla " +
              "gönderilir; siz yalnızca basıp QC onayına gönderin.",
          },
          { status: 409 }
        );
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
      // Ret TEK kaynaktan: onay bekleyen sürüm 409, onay günlüğü OKUNAMADIYSA
      // 503. Burada eskiden yalnız `ack.pending` okunuyordu; arıza dalı o okumada
      // görünmediği için üretici "yeni bir model sürümü yüklendi" cümlesini —
      // sistemin bilmediği bir olayı — okuyup onay düğmesine yönleniyordu. Kapı
      // iki dalda da KAPALI kalır; değişen yalnız gerekçe ve tekrar deneme
      // tavsiyesi.
      const ackRefusal = modelAckRefusal(ack);
      if (ackRefusal) {
        return NextResponse.json(
          { error: ackRefusal.error, code: ackRefusal.code },
          { status: ackRefusal.status }
        );
      }

      // Atomic status transition: printed -> shipped
      const [order] = await db
        .update(orders)
        .set({
          manufacturerStatus: "shipped",
          status: "shipped",
          trackingNumber: validated.trackingNumber,
          carrier: validated.carrier ?? null,
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.manufacturerId, session.manufacturerId),
            // Ship gate: only orders that passed admin QC approval may ship.
            eq(orders.manufacturerStatus, "qc_approved"),
            // Boyama okuma ile sevk arasında eklendiyse yeni iş görülmeden sevk edilmez.
            eq(orders.needsPainting, current.needsPainting),
            // Workshop batches ship from the admin panel, never one by one. The
            // readable refusal is above; this is the race-proof half.
            isNull(orders.workshopSessionId),
            // Refund-end-state (see the pre-read above): a refund landing
            // between that read and this write still wins.
            notRefundedGuard(),
            // Painting orders: a manufacturer that paints in-house may ship one it
            // did NOT hand off (earning the full amount); everyone else must hand
            // off to a painter. `isNull(painterId)` blocks shipping any order
            // already in the painter pipeline — the invariant that keeps the
            // in-house-ship and send-to-painter earnings mutually exclusive
            // (manufacturer_earnings.order_id is UNIQUE + onConflictDoNothing, so
            // a double accrual would be silently mis-amounted, not errored).
            manufacturer.paintsInHouse
              ? or(eq(orders.needsPainting, false), isNull(orders.painterId))
              : eq(orders.needsPainting, false)
          )
        )
        .returning();

      if (!order) {
        if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
          return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
        }
        return NextResponse.json(
          { error: "Sipariş bu sırada değişmiş veya sevk koşullarını sağlamıyor (QC onayı ve boyama durumu). Sayfayı yenileyin." },
          { status: 400 }
        );
      }

      await db.insert(manufacturerActions).values({
        orderId: id,
        manufacturerId: session.manufacturerId,
        action: "ship",
        notes: `Tracking: ${validated.trackingNumber}`,
      });

      // Faz 2: accrue the manufacturer's earning for this completed order
      // (idempotent on orderId; non-fatal if it fails).
      //
      // The ship gate above guarantees one of two shapes, and the kalem base
      // resolves each correctly: an order with no painting share (base = the
      // production total = the whole amount), or one this manufacturer painted
      // in house without handing off (base = production + painting = the whole
      // amount). It is never the full amount on an order a painter is doing —
      // `isNull(orders.painterId)` in the gate makes that unreachable.
      const earningBaseKurus = manufacturerBaseKurus({
        amountKurus: order.amountKurus,
        productionBaseKurus: order.productionBaseKurus,
        paintingPriceKurus: order.paintingPriceKurus,
        painterId: order.painterId,
        paintsInHouse: manufacturer.paintsInHouse,
      });
      await accrueEarning(order.id, session.manufacturerId, earningBaseKurus).catch(
        (e) => console.error("accrueEarning failed (non-fatal)", e)
      );

      // Faz 4: in-app notification + best-effort SMS. All side-effects below run
      // AFTER the irreversible status commit, so each is non-fatal — a failure in
      // one must not abort the rest (esp. emitOrderChanged) or surface a false 500
      // for an order that is actually shipped.
      await notifyCustomer({
        userId: order.userId,
        orderId: order.id,
        type: "order_shipped",
        title: "Siparişiniz kargolandı",
        body: `${order.orderNumber} numaralı siparişiniz kargoya verildi. Takip no: ${validated.trackingNumber}`,
      }).catch((e) => console.error("notifyCustomer (shipped) failed", e));
      await sendSms(
        order.phone,
        `Figurünica: ${order.orderNumber} siparişiniz kargolandı. Takip: ${validated.trackingNumber}`
      ).catch((e) => console.error("sendSms (shipped) failed", e));

      // Notify customer
      await getEmailQueue()
        .add("shipped", {
          type: "order_shipped",
          to: order.email,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          finish: order.finish,
          trackingNumber: validated.trackingNumber,
        })
        .catch((e) => console.error("shipped email enqueue failed", e));

      // Notify admin with manufacturer-specific email
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail) {
        await getEmailQueue()
          .add("manufacturer-shipped", {
            type: "manufacturer_shipped",
            to: order.email,
            adminEmail,
            orderNumber: order.orderNumber,
            customerName: order.customerName,
            trackingNumber: validated.trackingNumber,
            companyName: manufacturer.companyName,
          })
          .catch((e) => console.error("manufacturer-shipped email enqueue failed", e));
      }

      await emitOrderChanged({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        manufacturerId: order.manufacturerId,
        status: order.status,
        manufacturerStatus: order.manufacturerStatus,
      });

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "ZodError") {
        return NextResponse.json({ error: shipBodyErrorTr(error) }, { status: 400 });
      }
      console.error("Manufacturer ship order failed:", error);
      return NextResponse.json(
        { error: "Kargo bilgisi kaydedilemedi. Kaydın geçip geçmediğini görmek için sayfayı yenileyin; sorun sürerse yöneticiye bildirin." },
        { status: 500 }
      );
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/orders/[id]/ship", PARTNER_ACTION_FAILED_ERROR);
  }
}
