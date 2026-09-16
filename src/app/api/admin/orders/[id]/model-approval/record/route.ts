import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { adminActions, orders } from "@/lib/db/schema";
import { createApprovalRecordSchema } from "@/lib/validators/order";
import { decideModelApproval } from "@/lib/services/model-approval";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CHANNEL_TR: Record<"phone" | "whatsapp", string> = {
  phone: "telefon",
  whatsapp: "WhatsApp",
};

/**
 * Müşterinin BAŞKA KANALDAN verdiği model onayı kararını kaydet.
 *
 * Neden gerekiyor: müşteri kararını çoğu zaman telefonda söylüyor ("olur,
 * basın") ama /onay bağlantısına hiç dokunmuyor. Kararı sisteme sokacak bir yol
 * olmadığı için ödenmiş sipariş onay kapısında bekliyor, SLA süpürmesi de onu
 * ancak 48 saat sonra ve yalnız kapı hükmü 'pass' ise otomatik onaylıyordu.
 *
 * KARARIN GEÇİŞİ BURADA YAZILMAZ: `decideModelApproval()` çağrılır — müşterinin
 * kendi tıklaması da, SLA'nın otomatik onayı da aynı fonksiyondan geçer. Kopya
 * bir geçiş, atomik `WHERE status = 'awaiting_customer_approval'` kapısını,
 * kanıt satırının damgalanmasını ve onay sonrası otomatik atamayı ikizlerdi.
 *
 * KANIT DÜRÜSTLÜĞÜ: kararı müşteri TIKLAMADI. Bu yüzden kanıt satırının notuna
 * kanal ve kaydı giren admin yazılır; ileride "müşteri onayladı" denirken bu
 * satır, onayın nasıl alındığını da söyler.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }

    const parsed = createApprovalRecordSchema().safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
        { status: 400 }
      );
    }
    const { decision, channel } = parsed.data;
    const note = parsed.data.note?.trim() ?? "";

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        modelApprovalToken: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    // Refund-end-state: iade edilmiş siparişte onay üretimi yeniden açar,
    // revizyon ise kimsenin ödemediği bir üretim işi doğurur.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (order.status !== "awaiting_customer_approval") {
      return NextResponse.json(
        { error: "Bu sipariş müşteri onayı beklemiyor; kaydedilecek bir karar yok." },
        { status: 400 }
      );
    }
    if (!order.modelApprovalToken) {
      return NextResponse.json(
        {
          error:
            "Bu sipariş için onay turu açılmamış; müşterinin gördüğü bir model kaydı yok. Önce onay bağlantısını oluşturun.",
        },
        { status: 409 }
      );
    }

    // Kanıt satırına giden not: kararı kimin, hangi kanaldan kaydettiği.
    const evidenceNote =
      `[Yönetici kaydı — ${CHANNEL_TR[channel]} · ${adminEmail}]` + (note ? ` ${note}` : "");

    const result = await decideModelApproval({
      token: order.modelApprovalToken,
      decision,
      note: evidenceNote,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "Onay kaydı bulunamadı; bağlantı geçersiz olabilir." },
        { status: 404 }
      );
    }
    if (result.alreadyDecided) {
      return NextResponse.json(
        {
          error: result.refunded
            ? REFUNDED_ORDER_ERROR
            : "Bu sipariş bu arada karara bağlandı. Sayfayı yenileyip güncel durumu görün.",
          code: result.refunded ? "refunded" : "already_decided",
        },
        { status: 409 }
      );
    }

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // Onay gerçek bir onaydır ("approve"); revizyon isteği ileri bir onay
        // değildir, nötr "edit" ile yazılır (admin_action_type bir pg enum'u ve
        // bu faz ona değer eklemez).
        action: decision === "approved" ? "approve" : "edit",
        adminEmail,
        notes:
          `Müşteri kararı ${CHANNEL_TR[channel]} üzerinden alındı ve kaydedildi: ` +
          `${decision === "approved" ? "ONAY" : "REVİZYON"}${note ? ` — ${note}` : ""}`,
      })
      .catch((e) => console.error("approval record: adminActions insert failed", e));

    return NextResponse.json({
      success: true,
      status: result.status,
      decision,
      channel,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/model-approval/record", ADMIN_ACTION_FAILED_ERROR);
  }
}
