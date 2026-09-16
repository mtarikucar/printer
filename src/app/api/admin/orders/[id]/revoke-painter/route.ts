import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  adminActions,
  manufacturerActions,
  manufacturers,
  orders,
  painterActions,
  painters,
} from "@/lib/db/schema";
import {
  revokeAfterPainterHandoff,
  type RevokeAfterPainterResult,
} from "@/lib/services/revoke-after-painter";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { isOrderRefunded } from "@/lib/services/manufacturer-assign";
import { REFUNDED_PAYMENT_STATUS } from "@/lib/config/order-status-policy";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Pull a painting order back from the painter to the assignment queue, detaching
 * both the painter and the manufacturer and reversing the manufacturer's accrued
 * print earning. See `revokeAfterPainterHandoff` for the invariants.
 *
 * On a refunded order this is cleanup, and cleanup runs a DIFFERENT path
 * (`detachRefundedFromPainter` below): it takes the job off both partners and
 * stops there. The ordinary service resets the order to the assignment stage,
 * which is exactly what a refunded order must not do — it keeps its status
 * (refund-end-state). The order goes back to no queue (every assign path
 * refuses a refunded order), so the audit note and both partner notices say
 * the job is cancelled instead.
 */
const schema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    blocklistManufacturer: z.boolean().default(true),
    blocklistPainter: z.boolean().default(false),
    // "Kuyruğumda kalsın": geri alınan sipariş otomatik olarak yeni bir
    // üreticiye yerleştirilmesin. Üretici geri almasındaki (revoke-manufacturer)
    // seçeneğin aynısı — admin bazen siparişi bilerek kendi kuyruğunda tutar.
    keepInQueue: z.boolean().default(false),
  })
  .strict();

/**
 * İade edilmiş siparişi boyacıdan (ve üreticiden) geri alma = SALT KOPARMA.
 *
 * Olağan yol (revokeAfterPainterHandoff) siparişi atama aşamasına döndürür:
 * durumu `approved`/`paid` yapar, kara liste seçeneklerini uygular ve sonunda
 * otomatik atamayı tetikler. İade edilmiş siparişte bunların hiçbiri
 * OLMAMALIDIR — sipariş kımıldamaz, kimse cezalandırılmaz ve iş kimseye
 * gitmez (bkz. config/order-status-policy.ts). Geriye tek bir gerçek iş kalır:
 * iade edilmiş bir siparişte hâlâ duran partnerleri koparmak. İadeden ÖNCEKİ
 * iadeler (eski satırlar) partnerleri bağlı bırakmıştı ve bu siparişleri başka
 * hiçbir yol toparlamıyor.
 *
 * PARAYA DOKUNMAZ: hakediş geri alma iadenin kendi işidir (order-refund.ts) ve
 * burada yeni bir üretici olmayacağına göre "sonraki tahakkuku açmak" için
 * ters kayıt atmaya da gerek yok. Kargolanmış sipariş yine dışarıda: o sınır
 * iade edilmiş siparişte de anlamlıdır, çünkü paket gerçekten yola çıkmıştır.
 *
 * WHERE yalnız İADE EDİLMİŞ satıra eşleşir: bu yol alt durum sınırlarını
 * atladığı için canlı bir siparişe asla değemez.
 */
async function detachRefundedFromPainter(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
}): Promise<RevokeAfterPainterResult> {
  const { orderId, adminEmail, reason } = args;
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        painterId: orders.painterId,
        painterStatus: orders.painterStatus,
        shippedAt: orders.shippedAt,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) return { code: "not_found" as const };
    if (order.shippedAt != null) return { code: "already_shipped" as const };
    if (
      !order.painterId ||
      !order.painterStatus ||
      order.painterStatus === "unassigned"
    ) {
      return { code: "not_handed_to_painter" as const };
    }
    if (order.painterStatus === "shipped") {
      return { code: "already_shipped" as const };
    }

    const prevManufacturerId = order.manufacturerId;
    const prevPainterId = order.painterId;
    const prevManufacturerStatus = order.manufacturerStatus;
    const prevPainterStatus = order.painterStatus;
    const note = `[BOYACIDAN GERİ ALMA] Admin ${adminEmail} iade edilmiş siparişte partnerleri kopardı (üretici: ${prevManufacturerStatus ?? "-"}, boyacı: ${prevPainterStatus}). Sipariş durumu korundu, kuyruğa dönmedi. Sebep: ${reason}`;

    const [updated] = await tx
      .update(orders)
      .set({
        // Detach the manufacturer.
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        manufacturerAcceptedAt: null,
        manufacturerPrintedAt: null,
        // Detach the painter and wipe every hand-off breadcrumb.
        painterId: null,
        painterStatus: "unassigned",
        assignedToPainterAt: null,
        sentToPainterAt: null,
        receivedByPainterAt: null,
        paintedAt: null,
        painterHandoffCarrier: null,
        painterHandoffTrackingNumber: null,
        // `status` BİLEREK YOK: iade edilen sipariş durumunu KORUR. Kara liste
        // (declinedManufacturerIds / declinedPainterIds) ve QC turu artırımı da
        // yok — ikisi de "sıradaki partner" içindir, oysa sıradaki partner
        // olmayacak.
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.painterId, prevPainterId),
          // Refunded rows only: this path skips the sub-status limits, so it
          // must never reach an order that can still be worked on.
          eq(orders.paymentStatus, REFUNDED_PAYMENT_STATUS)
        )
      )
      .returning({ id: orders.id });
    if (!updated) return { code: "lost_race" as const };

    // Denetim izi iki partnerin de defterine. `admin_revoked` bilerek seçildi:
    // `decline`/`cancel_after_accept` güvenilirlik puanını düşürürdü
    // (manufacturer-assignment.ts BAD_ACTIONS) ve burada partnerin bir kusuru
    // yok — sipariş iade edilmiş.
    if (prevManufacturerId) {
      await tx.insert(manufacturerActions).values({
        orderId,
        manufacturerId: prevManufacturerId,
        action: "admin_revoked",
        notes: `[Admin boyacıdan geri aldı, sipariş iade edilmiş] ${reason}`.slice(0, 500),
      });
    }
    await tx.insert(painterActions).values({
      orderId,
      painterId: prevPainterId,
      action: "admin_revoked",
      notes: `[Admin boyacıdan geri aldı, sipariş iade edilmiş] ${reason}`.slice(0, 500),
    });

    return {
      code: "ok" as const,
      prevManufacturerId,
      prevPainterId,
      prevManufacturerStatus,
      prevPainterStatus,
      orderNumber: order.orderNumber,
      userId: order.userId,
      // Durum DEĞİŞMEDİ: SSE yayını da siparişin gerçek durumunu taşımalı.
      orderStatus: order.status,
      autoAssigned: false,
    };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email ?? "admin";

    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Sebep zorunludur (en az 3 karakter)." },
        { status: 400 }
      );
    }
    const { reason, blocklistManufacturer, blocklistPainter, keepInQueue } = parsed.data;

    // İade TERMİNALDİR, bu yüzden bu ön okuma soruyu kapatır. Geri almadan ÖNCE
    // okunuyor, sonra değil: olağan geri alma siparişi atama aşamasına döndürür
    // ve iade edilmiş bir siparişte engellenmesi gereken tam olarak o geri
    // sarmadır — sonradan okumak, iş olup bittikten sonra öğrenmek olurdu.
    // Okuma hata verirse admin'in istediği geri alma iptal edilmez, olağan yola
    // düşülür.
    const refundedBefore = await isOrderRefunded(id).catch(() => false);

    // Otomatik atama servisin İÇİNDE, para mutabakatından sonra yapılır
    // (revoke-after-painter.ts); burada yalnız admin'in açık isteği taşınır.
    // İade edilmiş siparişte servis HİÇ çağrılmaz: yerine salt koparma koşar —
    // durum korunur, kara liste ve "kuyrukta kalsın" seçenekleri uygulanmaz
    // (uygulanacak bir kuyruk yok), otomatik atama tetiklenmez.
    let refunded = refundedBefore;
    let result = refundedBefore
      ? await detachRefundedFromPainter({ orderId: id, adminEmail, reason })
      : await revokeAfterPainterHandoff({
          orderId: id,
          adminEmail,
          reason,
          blocklistManufacturer,
          blocklistPainter,
          keepInQueue,
        });

    // Ön okuma ile servis arasına düşen iade. Servis artık bunu KENDİ okumasında
    // görüyor ve siparişe de paraya da dokunmadan `refunded` dönüyor
    // (revoke-after-painter.ts) — eskiden o yarışı kaybeden istek siparişi yine
    // geri sarar, iki kara listeyi de işlerdi. Burada koparmaya geçilir ve
    // aşağıdaki denetim satırı, partner metinleri ve cevap da iade dilini
    // kullanır: yoksa hepsi siparişin kuyruğa döndüğünü söylerdi, oysa dönmedi.
    if (result.code === "refunded") {
      refunded = true;
      result = await detachRefundedFromPainter({ orderId: id, adminEmail, reason });
    }

    if (result.code !== "ok") {
      const messages: Record<string, { message: string; status: number }> = {
        not_found: { message: "Sipariş bulunamadı.", status: 404 },
        not_handed_to_painter: {
          message: "Bu sipariş bir boyacıya devredilmemiş.",
          status: 400,
        },
        already_shipped: {
          message:
            "Sipariş kargolandı; geri alınamaz. İade/ihtilaf akışını kullanın.",
          status: 409,
        },
        wrong_status: {
          message: "Boyacı bu durumdayken geri alınamaz.",
          status: 409,
        },
        earning_settled: {
          message:
            "Üreticinin baskı hakedişi ödenmiş (payout kapanmış); boyacıdan geri alma yapılamaz. İade/ihtilaf akışını kullanın.",
          status: 409,
        },
        reverse_failed: {
          message:
            "Üretici hakedişi geri alınamadı; işlem iptal edildi. Lütfen tekrar deneyin.",
          status: 500,
        },
        lost_race: {
          message:
            "Sipariş bu sırada başka bir işlemle değiştirildi; sayfayı yenileyin.",
          status: 409,
        },
        // Kapalı tarafa düşen tek dal: koparma yarışı kaybedildi ve ödeme durumu
        // okunamadığı için üreticinin baskı hakedişi yeniden yazılmadı. Sebebi
        // uydurmuyoruz, olduğu gibi söylüyoruz — admin parayı elle kontrol etsin.
        state_unreadable: {
          message:
            "Sipariş bu sırada başka bir işlemle değiştirildi ve ödeme durumu okunamadı: üreticinin baskı hakedişi geri alınmış durumda ve otomatik olarak yeniden yazılmadı. Siparişi ve üretici hakedişlerini kontrol edin.",
          status: 500,
        },
      };
      const m = messages[result.code] ?? {
        message: "Boyacıdan geri alınamadı.",
        status: 400,
      };
      return NextResponse.json({ error: m.message }, { status: m.status });
    }

    // Sipariş satıcının KENDİ katalog ürünü mü ve iş tam da o satıcının
    // atölyesinden mi alındı? Öyleyse mülkiyet kuralı gereği başka bir atölyeye
    // GİDEMEZ: kuyrukta kalmasının sebebi aday yokluğu ya da kapalı bir anahtar
    // değil, kuralın kendisidir. Hesap üretici geri almasındaki (revoke-manufacturer)
    // ile aynıdır ve aynı adla döndürülür, çünkü iki ekranın da aynı cümleyi
    // kurabilmesi gerekir. Üretici yoksa soru anlamsızdır, o zaman okumayız.
    const sellerManufacturerId = result.prevManufacturerId
      ? ((
          await db.query.orders
            .findFirst({
              where: eq(orders.id, id),
              columns: { sellerManufacturerId: true },
            })
            .catch(() => null)
        )?.sellerManufacturerId ?? null)
      : null;
    const heldForSeller =
      !result.autoAssigned &&
      !refunded &&
      !!sellerManufacturerId &&
      sellerManufacturerId === result.prevManufacturerId;

    // Kaybeden üreticiye giden yazı da olan bitene uymalı. "Sipariş yeniden
    // atanacak" cümlesi üç durumda yalandı: admin kuyrukta bıraktığında, uygun
    // aday çıkmadığında ve ürün satıcının kendi kataloğundan çıktığında (o
    // durumda üretici zaten satıcının kendisidir, iş kimseye yönlendirilmez).
    // Üretici geri almasındaki nextStepLine ile aynı cümleler.
    const nextStepLine = result.autoAssigned
      ? "Sipariş başka bir üreticiye yönlendirildi."
      : heldForSeller
        ? "Bu ürün sizin kataloğunuzdan çıktı ve yalnız sizin atölyenizde basılabilir; " +
          "bu yüzden sipariş başka bir atölyeye yönlendirilmeyecek. Şu an yönetici " +
          "kuyruğunda bekliyor, nasıl devam edileceğine yönetici karar verecek."
        : "Sipariş şu an yönetici kuyruğunda bekliyor; başka bir üreticiye " +
          "yönlendirilip yönlendirilmeyeceğine yönetici karar verecek.";

    // Every side effect below is isolated: the order has already moved, so a
    // failing email or Redis must not turn this into a 500 the admin reads as
    // "nothing happened".
    const prevMfg = result.prevManufacturerId
      ? await db.query.manufacturers
          .findFirst({
            where: eq(manufacturers.id, result.prevManufacturerId),
            columns: { companyName: true },
          })
          .catch(() => null)
      : null;
    const prevPainter = await db.query.painters
      .findFirst({
        where: eq(painters.id, result.prevPainterId),
        columns: { companyName: true },
      })
      .catch(() => null);

    // admin_action_type bir pg ENUM: yeni değer eklenemez (geri alma migration'ı
    // temiz kaldıramaz), bu yüzden bu fazın uçları NÖTR 'edit' değerini yazıp
    // gerçek anlamı nota bırakır. Burada 'assign_manufacturer' YAZILMAZ: bu satır
    // BOYACIDAN GERİ ALMAYI anlatıyor, oysa o değeri gerçek üretici atamaları
    // kullanıyor (assignment-sweep, revoke-manufacturer, manufacturer-assign) ve
    // denetim kaydını eyleme göre süzen biri burada hiç yapılmamış bir üretici
    // ataması görürdü. Geri alma sonrası otomatik yerleştirme OLURSA onu zaten
    // manufacturer-assign kendi 'assign_manufacturer' satırıyla yazar; boyacı
    // değişimi (swap-painter) de aynı kuralı izliyor.
    await db
      .insert(adminActions)
      .values({
        orderId: id,
        action: "edit",
        adminEmail,
        notes:
          `Boyacıdan geri alındı: üretici ${prevMfg?.companyName ?? result.prevManufacturerId ?? "-"} ` +
          `(${result.prevManufacturerStatus ?? "-"}) + boyacı ${prevPainter?.companyName ?? result.prevPainterId} ` +
          `(${result.prevPainterStatus}) ` +
          (refunded
            ? `→ sipariş iade edildiği için kuyruğa dönmedi, iş iptal edildi; durumu korundu, kara liste ve otomatik atama seçenekleri uygulanmadı. `
            : result.autoAssigned
              ? `→ otomatik olarak başka bir üreticiye atandı. `
              : keepInQueue
                ? `→ admin isteğiyle kuyrukta bırakıldı (otomatik atama yapılmadı). `
                : `→ atama kuyruğuna döndü. `) +
          `Sebep: ${reason}`,
      })
      .catch((e) => console.error("revoke-painter: adminActions insert failed", e));

    if (result.prevManufacturerId) {
      await notifyManufacturer({
        manufacturerId: result.prevManufacturerId,
        type: "order_unassigned",
        subject: refunded
          ? `Sipariş iade edildi, iş iptal edildi — ${result.orderNumber}`
          : `Sipariş ataması geri alındı — ${result.orderNumber}`,
        body: refunded
          ? `${result.orderNumber} numaralı sipariş müşteriye iade edildi. Bu yüzden ataması ` +
            `yönetici tarafından geri alındı ve iş iptal edildi; bu sipariş için yapmanız gereken başka bir işlem yok.\n\n` +
            `Sebep: ${reason}\n\n` +
            `Bu sipariş artık üretici panelinizde görünmeyecektir.`
          : `${result.orderNumber} numaralı siparişin ataması yönetici tarafından geri alındı.\n\n` +
            `${nextStepLine}\n\nSebep: ${reason}\n\n` +
            `Bu sipariş artık üretici panelinizde görünmeyecektir.`,
        orderId: id,
      }).catch((e) =>
        console.error("revoke-painter: manufacturer notify failed", e)
      );
    }

    await notifyPainter({
      painterId: result.prevPainterId,
      type: "system_announcement",
      subject: refunded
        ? `Sipariş iade edildi, boyama işi iptal edildi — ${result.orderNumber}`
        : `Boyama işi geri alındı — ${result.orderNumber}`,
      // The painter may be mid-paint: on a refund they must stop, not just learn
      // the job moved.
      body: refunded
        ? `${result.orderNumber} numaralı sipariş müşteriye iade edildi. Bu yüzden boyama işi ` +
          `yönetici tarafından geri alındı ve iptal edildi; bu iş için boyamaya ya da kargoya devam etmeyin.\n\n` +
          `Sebep: ${reason}\n\n` +
          `Bu iş artık boyacı panelinizde görünmeyecektir.`
        : `${result.orderNumber} numaralı boyama işi yönetici tarafından geri alındı ` +
          `ve bu iş artık boyacı panelinizde görünmeyecektir.\n\nSebep: ${reason}`,
      orderId: id,
    }).catch((e) => console.error("revoke-painter: painter notify failed", e));

    // Reach the losing manufacturer's panel via its own topic (painter SSE is
    // deferred, so the painter is informed by e-mail above).
    await emitOrderChanged({
      orderId: id,
      orderNumber: result.orderNumber,
      userId: result.userId,
      manufacturerId: result.prevManufacturerId,
      status: result.orderStatus,
      manufacturerStatus: "unassigned",
    }).catch((e) => console.error("revoke-painter: emit failed", e));

    return NextResponse.json({
      success: true,
      prevManufacturer: prevMfg?.companyName ?? result.prevManufacturerId,
      prevPainter: prevPainter?.companyName ?? result.prevPainterId,
      prevPainterStatus: result.prevPainterStatus,
      // Sipariş kuyruğa döndükten sonra otomatik yerleşti mi, yoksa admin
      // isteğiyle kuyrukta mı kaldı — istemci mesajı bunu söylemeli.
      autoAssigned: result.autoAssigned,
      keptInQueue: keepInQueue,
      // Üretici geri almasının verdiği alanın aynısı: sipariş satıcının kendi
      // ürünü olduğu için mi kuyrukta kaldı? Ekranın "uygun aday bulunamadı ya da
      // otomatik atama kapalı" cümlesi burada yanlıştır.
      ...(heldForSeller ? { heldForSeller: true as const } : {}),
      // Same signal revoke-manufacturer gives: the order went neither back to the
      // queue nor to anyone else, because it was refunded.
      ...(refunded ? { reason: "refunded" as const } : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/revoke-painter", ADMIN_ACTION_FAILED_ERROR);
  }
}
