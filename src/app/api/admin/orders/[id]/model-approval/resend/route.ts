import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { adminActions, orderModelApprovals, orders } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { modelApprovalUrl } from "@/lib/services/model-approval";
import { getPublicUrl } from "@/lib/services/storage";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/** Rotanın `[id]` parçası doğrudan sorguya giriyor; biçimi burada elenir. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Müşteriye ONAY BAĞLANTISINI YENİDEN gönder.
 *
 * Neden gerekiyor: onay e-postası spam'e düşüyor, yanlış adrese gidiyor ya da
 * müşteri siliyor. Bağlantıyı yeniden göndermenin tek yolu siparişi yeniden
 * onaylamaktı; o da YENİ bir onay turu açıp "müşteriye gösterildi" kanıtını
 * ikizleyordu.
 *
 * Bu uç YENİ TUR AÇMAZ: `openModelApproval()` çağrılmaz, var olan jetonun
 * adresi (modelApprovalUrl) yeniden yollanır. Gösterilen model değişmediği
 * için ikinci bir kanıt satırı yanlış olurdu — turu açan tek yer, modeli
 * gerçekten değiştiren yükleme/onay adımıdır.
 *
 * OTOMATİK HATIRLATMA SUSTURULUR: onay SLA süpürmesi 72. saatte aynı postayı
 * bir kez atıyor (model-approval-sla.worker.ts). Elle gönderilen posta
 * `reminder_sent_at`i işaretlemezse müşteri birkaç saat sonra aynı postayı bir
 * daha alır. İşaret yalnız e-posta kuyruğa GİRDİKTEN sonra yazılır.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locale = getRequestLocale(request);

    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        customerName: true,
        email: true,
        locale: true,
        status: true,
        paymentStatus: true,
        modelApprovalToken: true,
        modelTurntableUrl: true,
        modelTurntableKey: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    // Refund-end-state: parası iade edilmiş müşteriden onay istemek, üretime
    // açılacak bir sipariş varmış gibi davranmaktır.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (order.status !== "awaiting_customer_approval") {
      return NextResponse.json(
        {
          error:
            "Bu sipariş müşteri onayı beklemiyor; gönderilecek açık bir onay bağlantısı yok.",
        },
        { status: 400 }
      );
    }
    if (!order.modelApprovalToken) {
      return NextResponse.json(
        {
          error:
            "Bu sipariş için onay bağlantısı hiç oluşturulmamış. Onay turu, modelin müşteriye gösterildiği adımda açılır.",
        },
        { status: 409 }
      );
    }
    if (!order.email) {
      return NextResponse.json(
        { error: "Siparişte e-posta adresi yok; onay bağlantısı gönderilemedi." },
        { status: 400 }
      );
    }

    const approvalUrl = modelApprovalUrl(order.modelApprovalToken);
    const turntableUrl =
      order.modelTurntableUrl ??
      (order.modelTurntableKey ? getPublicUrl(order.modelTurntableKey) : undefined);

    try {
      await getEmailQueue().add("model-approval-resend", {
        type: "model_approval_request",
        to: order.email,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        approvalUrl,
        turntableUrl,
        locale: order.locale === "en" ? "en" : locale,
      });
    } catch (e) {
      console.error("approval resend: email enqueue failed", e);
      return NextResponse.json(
        { error: "Onay e-postası kuyruğa alınamadı. Lütfen tekrar deneyin." },
        { status: 502 }
      );
    }

    // Kuyruğa girdikten SONRA: kaybolan bir posta altı saat sonra süpürme
    // tarafından yeniden denenir, ikizlenen bir posta ise hiç gönderilmez.
    await db
      .update(orderModelApprovals)
      .set({ reminderSentAt: new Date() })
      .where(
        and(
          eq(orderModelApprovals.orderId, id),
          isNull(orderModelApprovals.decidedAt),
          isNull(orderModelApprovals.reminderSentAt)
        )
      )
      .catch((e) => console.error("approval resend: reminder stamp failed", e));

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u; bu faz enum'a değer EKLEMEZ (geri alma
        // migration'ı bir enum değerini temiz kaldıramaz). Nötr "edit" kullanılır,
        // gerçek anlam notta durur.
        action: "edit",
        adminEmail,
        notes: `Model onay bağlantısı müşteriye yeniden gönderildi (${order.email}).`,
      })
      .catch((e) => console.error("approval resend: adminActions insert failed", e));

    return NextResponse.json({ success: true, approvalUrl, sentTo: order.email });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/model-approval/resend", ADMIN_ACTION_FAILED_ERROR);
  }
}
