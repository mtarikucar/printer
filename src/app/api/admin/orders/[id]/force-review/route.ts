import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Siparişi elle incelemeye al: paid|generating|processing_mesh → review.
 *
 * İADE EDİLMİŞ SİPARİŞTE YAPILMAZ. `review` görünüşte zararsız bir ara duraktır
 * ama ONAY DÜĞMESİNİN AÇILDIĞI yerdir: oradan `approved`, üretici ataması ve
 * partner hakedişi gelir. İade kuralı (refund-end-state) siparişin hiçbir yöne
 * kımıldamamasını söyler; bu rota ise iade edilmiş siparişi yeniden o kapının
 * önüne koyuyor, üstelik panelde tek tıkla (ekranın `canForceReview` koşulu
 * kardeşlerinin aksine iadeye bakmıyordu).
 *
 * Kapı İKİ KATMAN; ikisi de gerekli, biri diğerinin yerini tutmaz:
 *  1. OKUMA: reddin SEBEBİNİ söyleyebilmek için. Aşağıdaki atomik WHERE
 *     eşleşmediğinde elde yalnız "eşleşmedi" bilgisi kalır; iade edilmiş bir
 *     siparişe "bu durumda incelemeye alınamaz" demek, admin'i olmayan bir
 *     durum sorununu aramaya gönderirdi — sipariş gerçekten `paid` olabilir.
 *  2. YAZMA: okuma ile yazma arasına giren bir iadeye karşı. İade
 *     `orders.status`e DOKUNMAZ, o yüzden durum şartı bu yarışı kapatmaz.
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
    const body = await request.json().catch(() => ({}));

    const reviewableStatuses = ["paid", "generating", "processing_mesh"] as const;

    // 1. katman: okuma. Sipariş yoksa burada karar verilmez — aşağıdaki atomik
    // yazma zaten "bu durumda değil" cevabını veriyor, iki ayrı 404/400 cümlesi
    // üretmeye gerek yok.
    const current = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { paymentStatus: true },
    });
    if (current && isRefunded(current)) {
      return NextResponse.json(
        { error: REFUNDED_ORDER_ERROR, code: "refunded" },
        { status: 409 }
      );
    }

    // 2. katman: yazma. Atomik durum geçişi + iade koruması aynı WHERE'de.
    const [order] = await db
      .update(orders)
      .set({ status: "review", updatedAt: new Date() })
      .where(
        and(eq(orders.id, id), inArray(orders.status, [...reviewableStatuses]), notRefundedGuard())
      )
      .returning();

    if (!order) {
      // Araya giren iade: sebebini söyle (yukarıdaki okuma temizdi).
      if (await isOrderRefunded(id)) {
        return NextResponse.json(
          { error: REFUNDED_ORDER_ERROR, code: "refunded" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Order is not in a status that can be force-reviewed" },
        { status: 400 }
      );
    }

    await db.insert(adminActions).values({
      orderId: id,
      action: "force_review",
      adminEmail: session.user.email,
      notes: body.notes || "Manually moved to review",
    });
    void d;

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/force-review", ADMIN_ACTION_FAILED_ERROR);
  }
}
