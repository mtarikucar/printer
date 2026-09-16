import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  formatAdminNoteLine,
  isRefunded,
  REFUNDED_ORDER_ERROR,
} from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { revertReasonError } from "@/lib/validators/order";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Bozuk bir [id] Postgres'te 22P02 fırlatır ve HTML 500 olarak kaçar; kardeş
 * rotaların kapısının aynısı burada da durur ki yanıt okunaklı Türkçe JSON
 * kalsın.
 *
 * İADE KURALI BU DOSYADA TEKTİR, YÖNDEN BAĞIMSIZ: iade edilmiş sipariş HİÇBİR
 * YÖNE kımıldamaz (refund-end-state). Hem teslim damgası (POST) hem teslimi
 * geri alma (DELETE) iade edilmiş siparişi reddeder; ölçü "işi ileri taşıyor
 * mu" değil "sipariş kımıldıyor mu"dur ve ikisi de kımıldatır.
 *
 * Damganın eskiden serbest sayılmasının gerekçesi "paket zaten yola çıkmıştı,
 * damga yalnızca vardığının KAYDIdır"dı. Kayıt ihtiyacı gerçek, ama bu uç bir
 * kayıt ucu değil: `orders.status`ü `delivered` yapar, `delivered_at` damgasını
 * atar ve müşteriye "Siparişiniz teslim edildi" e-postası + uygulama içi
 * bildirimi gönderir — parası geri verilmiş bir sipariş için. Üstelik tek
 * yönlüydü: aynı siparişte DELETE iade yüzünden reddettiğinden yanlış basılan
 * damga bir daha geri alınamıyordu.
 *
 * Paketin ulaştığını KAYDETMEK isteyen admin bunu sipariş notuna yazar
 * (`adminNotes` — düzenleme rotası): not siparişi kımıldatmaz, hakediş
 * doğurmaz, müşteriye bildirim göndermez.
 *
 * İade `orders.status`e DOKUNMAZ; sipariş 'shipped'/'delivered' olarak kalır,
 * yani durum şartı tek başına iade edilmiş siparişi durdurmaz. Koruma her iki
 * yöntemde de açıkça konur, hem okumada hem yazmada.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Geçersiz sipariş kimliği." }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const note = typeof body.notes === "string" ? body.notes.trim() : "";
    const noteLine = note ? formatAdminNoteLine(`Teslim edildi: ${note}`) : null;

    // İADE KAPISI, 1. katman: okuma. Reddin SEBEBİNİ söyleyebilmek için —
    // aşağıdaki atomik WHERE eşleşmediğinde elde yalnız "eşleşmedi" bilgisi
    // kalır ve iade edilmiş siparişe "kargoya verilmiş durumda değil" demek
    // admin'i olmayan bir durum sorununu aramaya gönderirdi (sipariş gerçekten
    // 'shipped'tir).
    const current = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { paymentStatus: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    if (isRefunded(current)) {
      return NextResponse.json(
        { error: REFUNDED_ORDER_ERROR, code: "refunded" },
        { status: 409 }
      );
    }

    // 2. katman: yazma. Atomik geçiş; iade koruması WHERE'in içinde, çünkü okuma
    // ile yazma arasına giren iade durum şartına takılmaz.
    const [order] = await db
      .update(orders)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        // Appended, never overwritten (see order-status-policy.ts): an overwrite
        // wiped the [SLA] / decline flags other writers leave in adminNotes.
        ...(noteLine
          ? {
              adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${noteLine} ELSE ${orders.adminNotes} || E'\n' || ${noteLine} END`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, id), eq(orders.status, "shipped"), notRefundedGuard()))
      .returning();

    if (!order) {
      // Araya giren iade: sebebini söyle (yukarıdaki okuma temizdi). Bu daldan
      // sonra gelen e-posta ve uygulama içi bildirim de böylece hiç kurulmaz —
      // iade edilmiş siparişin müşterisine "teslim edildi" denmez.
      if (await isOrderRefunded(id)) {
        return NextResponse.json(
          { error: REFUNDED_ORDER_ERROR, code: "refunded" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: d["api.order.notShipped"] },
        { status: 400 }
      );
    }

    await db.insert(adminActions).values({
      orderId: id,
      action: "deliver",
      adminEmail: session.user.email,
      notes: body.notes,
    });

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
    });

    await getEmailQueue().add("delivered", {
      type: "order_delivered",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });

    // Faz 4: in-app notification
    await notifyCustomer({
      userId: order.userId,
      orderId: order.id,
      type: "order_delivered",
      title: "Siparişiniz teslim edildi",
      body: `${order.orderNumber} numaralı siparişiniz teslim edildi.`,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/deliver", ADMIN_ACTION_FAILED_ERROR);
  }
}

/**
 * "Teslim edildi"yi geri al: delivered → shipped.
 *
 * Neden gerekiyor: teslim, kargo şirketinin kaydına ya da müşterinin sözüne
 * bakılarak elle işaretlenir ve yanlış siparişte işaretlenebiliyor. Geri dönüş
 * yolu olmadığı için sipariş kalıcı olarak "teslim edildi" kalıyordu — müşteri
 * hâlâ paketi beklerken.
 *
 * Bu bir GERİ adımdır, ileri değil: hiçbir hakediş doğurmaz, hiçbir para
 * hareketi yapmaz ve müşteriye "teslim edildi" e-postası göndermez (yanlış
 * bildirim zaten gitmiş olabilir; ikincisini göndermek durumu daha da bulandırır).
 * Yalnız damga silinir ve kayıt denetim kaydına düşer.
 *
 * İADE EDİLMİŞ SİPARİŞTE YAPILMAZ. "Geri adım" olması onu serbest bırakmaz:
 * iade edilen sipariş hiçbir yöne kımıldamaz ve bu uç siparişi kargo tarafına
 * GERİ SOKAR (delivered → shipped). Red, dosyanın POST'uyla AYNI kuraldır (bkz.
 * dosya başı) ve kargo geri almanın (DELETE /ship) kullandığı Türkçe metnin
 * aynısını döndürür; ekran her reddi tek koda ("refunded") bakarak tanır.
 */
export async function DELETE(
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
    const body = await request.json().catch(() => ({}));
    // Gerekçe ZORUNLU (DELETE /ship ile aynı kapı, aynı metin): teslim damgasını
    // silmek müşteriye gitmiş bir bildirimi yalanlar; sebebi denetim kaydında
    // kalmalı.
    const reasonError = revertReasonError(body.reason);
    if (reasonError) {
      return NextResponse.json({ error: reasonError }, { status: 400 });
    }
    const reason = String(body.reason).trim();

    // İADE KAPISI, İKİ KATMAN — ikisi de gerekli, biri diğerinin yerini tutmaz:
    //
    //  1. OKUMA: reddin SEBEBİNİ söyleyebilmek için. Aşağıdaki atomik WHERE
    //     eşleşmediğinde elde yalnız "eşleşmedi" bilgisi kalır; iade edilmiş bir
    //     siparişe "teslim edildi durumunda değil" demek, admin'i olmayan bir
    //     durum sorununu aramaya gönderirdi (sipariş gerçekten 'delivered'tir).
    //  2. YAZMA: okuma ile yazma arasına giren bir iadeye karşı. İade
    //     `orders.status`e dokunmaz, o yüzden durum şartı yarışı kapatmaz.
    const current = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: { paymentStatus: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Sipariş bulunamadı." }, { status: 404 });
    }
    if (isRefunded(current)) {
      return NextResponse.json(
        { error: REFUNDED_ORDER_ERROR, code: "refunded" },
        { status: 409 }
      );
    }

    // Atomik: yalnız gerçekten teslim edilmiş VE iade edilmemiş bir sipariş geri
    // alınabilir.
    const [order] = await db
      .update(orders)
      .set({ status: "shipped", deliveredAt: null, updatedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, "delivered"), notRefundedGuard()))
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
        { error: "Sipariş 'teslim edildi' durumunda değil." },
        { status: 400 }
      );
    }

    await db
      .insert(adminActions)
      .values({
        orderId: id,
        // admin_action_type bir pg enum'u ve bu faz migration açmıyor; nötr
        // "edit" değeri kullanılır, gerçek anlam notta durur (unstart-printing
        // rotasının kurduğu düzen).
        action: "edit",
        adminEmail,
        notes: `Teslim geri alındı → "kargolandı" durumuna döndürüldü. Gerekçe: ${reason}`,
      })
      .catch((e) => console.error("deliver revert: adminActions insert failed", e));

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      status: order.status,
    }).catch((e) => console.error("deliver revert: emit failed", e));

    return NextResponse.json({ success: true, status: order.status });
  } catch (e) {
    return handleRouteFailure(e, "DELETE /api/admin/orders/[id]/deliver", ADMIN_ACTION_FAILED_ERROR);
  }
}
