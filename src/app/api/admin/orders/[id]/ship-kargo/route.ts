import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { cancelShipment, createShipment } from "@/lib/services/yurtici-kargo";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import {
  onBehalfOfPartner,
  onBehalfPreflight,
  partnerHoldingOrder,
} from "@/lib/services/on-behalf";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Yurtiçi Kargo ile gönderi oluşturup siparişi kargolar.
 *
 * Kargolamanın iki yolu vardır (bkz. ship/route.ts): sipariş bir partnerin
 * elindeyse kargo ONUN ADINA yazılır ve hakediş partnerin kendi servisinden
 * doğar; partner yoksa platform kendi siparişini kargolar. Bu uç eskiden
 * `isNull(manufacturerId)` şartıyla yalnız ikinci yolu tanıyordu.
 *
 * SIRALAMA (partner yolu): gönderi DIŞ sistemde yaratıldığı için önce okunabilir
 * kapı (onBehalfPreflight) çalışır, sonra gönderi yaratılır, en son durum
 * atomik olarak yazılır. Son adım yarışı kaybederse yaratılan gönderi İPTAL
 * edilir — yoksa Yurtiçi'de sahipsiz bir kargo kaydı kalırdı.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);
    const d = getDictionary(locale);

    const a = await requireAdmin();


    if ("response" in a) return a.response;


    const session = { user: { email: a.session.user.email } };

    const { id } = await params;

    try {
      const body = await request.json().catch(() => ({}));
      const reason = typeof body.reason === "string" ? body.reason : "";

      const current = await db.query.orders.findFirst({
        where: eq(orders.id, id),
        columns: {
          id: true,
          orderNumber: true,
          customerName: true,
          shippingAddress: true,
          manufacturerId: true,
          manufacturerStatus: true,
          painterId: true,
          painterStatus: true,
        },
      });
      if (!current) {
        return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
      }

      const addr = current.shippingAddress as TurkishAddress;
      const shipmentParams = {
        cargoKey: current.orderNumber,
        receiverName: current.customerName,
        receiverAddress: addr.mahalle ? `${addr.mahalle} ${addr.adres}` : addr.adres,
        receiverPhone: addr.telefon,
        receiverCity: addr.il,
        receiverDistrict: addr.ilce,
        receiverPostalCode: addr.postaKodu,
      };

      // ─── 1. Partnerin elindeki sipariş: onun adına kargola ───
      if (partnerHoldingOrder(current) !== "none") {
        const pre = await onBehalfPreflight({ orderId: id, action: "ship", reason });
        if (!("ok" in pre) || pre.ok !== true) {
          return NextResponse.json(
            { error: pre.error, code: pre.code },
            { status: pre.httpStatus }
          );
        }

        const created = await createShipment(shipmentParams);
        if (!created.success) {
          return NextResponse.json(
            { error: d["api.kargo.createFailed"], detail: created.errorMessage },
            { status: 502 }
          );
        }

        const result = await onBehalfOfPartner({
          orderId: id,
          action: "ship",
          adminEmail: session.user.email,
          reason,
          trackingNumber: current.orderNumber,
          carrier: "yurtici",
        });
        if (!result.ok) {
          // Durum yazılamadı: yaratılan gönderiyi geri al, yoksa Yurtiçi'de
          // karşılığı olmayan bir kargo kaydı kalır.
          await cancelShipment(current.orderNumber).catch((e) =>
            console.error("ship-kargo: cancelShipment after failed commit", e)
          );
          return NextResponse.json(
            { error: result.error, code: result.code },
            { status: result.httpStatus }
          );
        }

        return NextResponse.json({
          success: true,
          cargoKey: current.orderNumber,
          onBehalfOf: result.partner,
          status: result.status,
        });
      }

      // ─── 2. Platformun kendi ürettiği sipariş ───
      // Atomically claim the order BEFORE calling the external API to prevent
      // double-shipment. notRefundedGuard(): a refunded order that was
      // mid-production is left at printing + no manufacturer (the refund detaches
      // it), which this route would otherwise hand to Yurtiçi (refund-end-state).
      const [order] = await db
        .update(orders)
        .set({
          status: "shipped",
          carrier: "yurtici",
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.status, "printing"),
            isNull(orders.manufacturerId),
            notRefundedGuard()
          )
        )
        .returning();

      if (!order) {
        // Name the refund when it is the reason; the generic 400 would send the
        // admin hunting for a status problem that is not there.
        if (await isOrderRefunded(id)) {
          return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
        }
        return NextResponse.json(
          { error: "Sipariş baskı aşamasında değil." },
          { status: 400 }
        );
      }

      const result = await createShipment(shipmentParams);

      if (!result.success) {
        // Revert status since shipment creation failed
        await db
          .update(orders)
          .set({ status: "printing", shippedAt: null, carrier: null, updatedAt: new Date() })
          .where(eq(orders.id, id));

        return NextResponse.json(
          { error: d["api.kargo.createFailed"], detail: result.errorMessage },
          { status: 502 }
        );
      }

      // Set tracking number after successful shipment creation
      await db
        .update(orders)
        .set({ trackingNumber: order.orderNumber, updatedAt: new Date() })
        .where(eq(orders.id, id));

      await db.insert(adminActions).values({
        orderId: id,
        action: "ship",
        adminEmail: session.user.email,
        notes: `Yurtici Kargo — key: ${order.orderNumber}`,
      });

      await emitOrderChanged({
        orderId: order.id,
        orderNumber: order.orderNumber,
        userId: order.userId,
        manufacturerId: order.manufacturerId,
        status: order.status,
      });

      await getEmailQueue().add("shipped", {
        type: "order_shipped",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        finish: order.finish,
        trackingNumber: order.orderNumber,
        locale,
      });

      return NextResponse.json({ success: true, cargoKey: order.orderNumber });
    } catch (error) {
      // Revert status if we claimed the order but the SOAP call threw
      await db
        .update(orders)
        .set({ status: "printing", shippedAt: null, carrier: null, updatedAt: new Date() })
        .where(and(eq(orders.id, id), eq(orders.status, "shipped")))
        .catch(() => {}); // Best-effort revert

      console.error("Yurtici Kargo ship failed:", error);
      return NextResponse.json(
        { error: d["api.kargo.shipFailed"] },
        { status: 500 }
      );
    }
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/ship-kargo", ADMIN_ACTION_FAILED_ERROR);
  }
}
