import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Undo an admin self-fulfilled "start printing".
 *
 * The gap this closes: `start-printing` moves an admin-fulfilled order
 * (no manufacturer) `approved → printing`, and the only forward action from
 * there is `ship`. If the admin hit it by mistake — or decides to hand the job
 * to a manufacturer after all — there was no way back to the assignment stage.
 *
 * This is the mirror of `start-printing`: same `isNull(manufacturerId)` guard so
 * it can NEVER touch a manufacturer-driven order (those use revoke-manufacturer).
 * No money is involved on the admin self-fulfillment track, so nothing to
 * reconcile — it is a pure `printing → approved` status reset.
 *
 * İADE EDİLMİŞ SİPARİŞTE YAPILMAZ. "Geri adım" olması onu serbest bırakmaz:
 * iade edilen sipariş hiçbir yöne kımıldamaz (refund-end-state) ve bu uç
 * siparişi tam olarak ATANABİLİR hâle (`approved` + üreticisiz) sokup ardından
 * otomatik atamayı çağırır.
 *
 * Üstelik bu rotanın koşulu iadenin BIRAKTIĞI şeklin AYNISIDIR: iade
 * (services/order-refund.ts) `orders.status`e dokunmaz ama `manufacturerId`i
 * NULL'lar — yani iade edilmiş, basımdaki bir sipariş `status = 'printing'` +
 * `manufacturerId IS NULL` filtresine BİREBİR uyar. "Üreticisiz sipariş = admin
 * kendi basıyor" varsayımı iadeden sonra yanlıştır; koruma açıkça konur.
 *
 * Kapı İKİ KATMAN, kardeş rotaların düzeni: OKUMA reddin SEBEBİNİ söyler
 * (yoksa admin'e "baskı aşamasında değil ya da bir üreticiye ait" denirdi —
 * ikisi de doğru değil), YAZMA ise okuma ile yazma arasına giren iadeyi
 * yakalar (durum şartı bu yarışı kapatmaz, çünkü iade durumu değiştirmez).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email ?? "admin";

    const { id } = await params;

    // 1. katman: okuma. Sipariş yoksa burada karar verilmez — aşağıdaki atomik
    // yazma zaten kendi 400'ünü veriyor.
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

    // 2. katman: yazma. Atomic + concurrency-safe: only a printing,
    // manufacturer-less, NOT REFUNDED order matches.
    const [order] = await db
      .update(orders)
      .set({ status: "approved", updatedAt: new Date() })
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
      // Araya giren iade: sebebini söyle (yukarıdaki okuma temizdi).
      if (await isOrderRefunded(id)) {
        return NextResponse.json(
          { error: REFUNDED_ORDER_ERROR, code: "refunded" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error:
            "Sipariş baskı aşamasında değil ya da bir üreticiye ait (üretici siparişleri için 'Atamayı geri al' kullanın).",
        },
        { status: 400 }
      );
    }

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // No dedicated enum value — reuse "edit" (a neutral admin state change) so
        // this ships without an `admin_action_type` migration. The note carries
        // the real meaning for the history log.
        action: "edit",
        adminEmail,
        notes: "Baskı geri alındı → onaya (atama aşamasına) döndürüldü.",
      })
      .catch((e) => console.error("unstart-printing: adminActions insert failed", e));

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
    }).catch((e) => console.error("unstart-printing: emit failed", e));

    // Bu geçiş siparişi tam olarak "onaylı + atanmamış" hâline sokar — yani
    // otomatik atamanın tetiklendiği hâle. Yukarıdaki `isNull(manufacturerId)`
    // koşulu yüzünden buraya ancak üreticisiz bir sipariş gelebilir, dolayısıyla
    // atanacak bir sipariş her zaman gerçekten boştadır. Tetiklemezsek baskıyı
    // geri alan admin, sistemin kendiliğinden yapacağı atamayı elle aramak
    // zorunda kalırdı; siparişi "onaylı + atanmamış" bırakan diğer sekiz geçişin
    // hepsinde bu çağrı var, eksik olan tek yer burasıydı.
    //
    // Koşulsuz: kapıların hepsi (tür anahtarı, iade, durum, basılabilir içerik)
    // fonksiyonun kendi içinde ve her siparişte güvenli. Beklenerek çağrılır ki
    // admin sayfayı yenilediğinde atanmış üreticiyi görsün; fonksiyon asla
    // fırlatmaz, yani bu cevabı bozamaz.
    const placement = await autoAssignIfEligible(id, { reason: "baskı geri alındı" });

    return NextResponse.json({
      success: true,
      autoAssigned: placement.assigned,
      ...(placement.skipped ? { autoAssignSkipped: placement.skipped } : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/unstart-printing", ADMIN_ACTION_FAILED_ERROR);
  }
}
