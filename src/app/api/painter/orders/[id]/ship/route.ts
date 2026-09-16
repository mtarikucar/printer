import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { createShipOrderSchema } from "@/lib/validators/order";
import { accruePainterEarning } from "@/lib/services/painter-payouts";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";
import { sendSms } from "@/lib/services/sms";
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

// Painter ships the painted figurine DIRECTLY to the customer. This is the
// terminal painting event: order → shipped, and the painter's earning
// (paintingPriceKurus, split 70/30) is accrued.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await requireActivePainter();
    if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
    const { id } = await params;

    // Bozuk gövde İSTEMCİ hatasıdır: boş gövde ({}) alan hatasıyla 400 alırken,
    // yarım/bozuk JSON catch'e düşüp boyacıya 500 "Kargolama başarısız" diye
    // dönüyordu — sunucu arızası gibi okunan, tekrar denemesi anlamsız bir cevap.
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

      // İADE ÖNCE SORULUR: hangi kapının durdurduğu doğru söylensin.
      //
      // İade nihai bir durumdur; onay kapısının arıza cevabı ise 503 "birkaç dakika
      // sonra tekrar deneyin"dir. Sıra tersken iade edilmiş bir iş, asla
      // başarılı olamayacak bir tekrara davet ediliyor ve onu durduran kapı YANLIŞ
      // adlandırılıyordu. Üreticinin kargo ucu bu sırayı zaten uyguluyor. Yarışa
      // karşı asıl nöbetçi aşağıdaki UPDATE'teki notRefundedGuard(); bu okuma
      // yalnızca gerekçeyi doğru söylemek içindir.
      const current = await db.query.orders.findFirst({
        where: and(eq(orders.id, id), eq(orders.painterId, g.painterId)),
        columns: { paymentStatus: true },
      });
      if (current && isRefunded(current)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }

      // Onaylanmamış yeni model sürümü varsa kargolanamaz. Kargo, boyacı
      // hakedişini tahakkuk ettiren ve müşteriye "kargolandı" e-postası atan
      // adımdır; eski sürüme boyanmış bir parça bu kapıdan geçmemeli.
      const ack = await readPartnerModelAck(id, { kind: "painter", id: g.painterId });
      // Ret TEK kaynaktan (bkz. üreticinin kargo ucundaki aynı kapı): onay
      // bekleyen sürüm 409, onay günlüğü OKUNAMADIYSA 503. Yalnız `ack.pending`
      // okumak, arızada boyacıya OLMAYAN bir yüklemeyi anlatıyordu.
      const ackRefusal = modelAckRefusal(ack);
      if (ackRefusal) {
        return NextResponse.json(
          { error: ackRefusal.error, code: ackRefusal.code },
          { status: ackRefusal.status }
        );
      }

      // Atomic gate: only a painted job owned by this painter may ship.
      const [order] = await db
        .update(orders)
        .set({
          painterStatus: "shipped",
          status: "shipped",
          trackingNumber: validated.trackingNumber,
          carrier: validated.carrier ?? null,
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.painterId, g.painterId),
            // Ship gate: only jobs that passed admin painter-QC approval may ship.
            eq(orders.painterStatus, "qc_approved"),
            // Refund-end-state: no shipping mail and no painter earning on money
            // already returned. In the UPDATE, so a refund mid-request still wins.
            notRefundedGuard()
          )
        )
        .returning();
      if (!order) {
        if (await isPartnerOrderRefunded(id, { painterId: g.painterId })) {
          return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
        }
        return NextResponse.json(
          { error: "İş bulunamadı veya kargolanabilir durumda değil (önce QC onayı gerekir)" },
          { status: 400 }
        );
      }

      await db
        .insert(painterActions)
        .values({ orderId: id, painterId: g.painterId, action: "ship", notes: `Tracking: ${validated.trackingNumber}` })
        .catch((e) => console.error("painterActions ship failed", e));

      // Accrue the painter's earning on the painting portion (idempotent on orderId).
      await accruePainterEarning(order.id, g.painterId, order.paintingPriceKurus).catch(
        (e) => console.error("accruePainterEarning failed (non-fatal)", e)
      );

      // Customer notifications (all non-fatal — the ship commit already happened).
      await notifyCustomer({
        userId: order.userId,
        orderId: order.id,
        type: "order_shipped",
        title: "Siparişiniz kargolandı",
        body: `${order.orderNumber} numaralı (profesyonel boyamalı) siparişiniz kargoya verildi. Takip no: ${validated.trackingNumber}`,
      }).catch((e) => console.error("notifyCustomer (painter ship) failed", e));
      await sendSms(
        order.phone,
        `Figurünica: ${order.orderNumber} siparişiniz kargolandı. Takip: ${validated.trackingNumber}`
      ).catch((e) => console.error("sendSms (painter ship) failed", e));
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
      console.error("Painter ship order failed:", error);
      return NextResponse.json({ error: "Kargolama başarısız" }, { status: 500 });
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/painter/orders/[id]/ship", PARTNER_ACTION_FAILED_ERROR);
  }
}
