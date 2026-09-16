import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { REFUNDED_ORDER_ERROR } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";

/**
 * Nereye kadar gelindi. Tek soru: KABUL YAZILDI MI? Beklenmeyen bir hatada
 * atölyeye ne diyeceğimizi bu ayrım belirler.
 */
type AcceptProgress = { accepted: boolean };

async function handleAccept(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: AcceptProgress
) {
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

  // Atomic status transition: assigned -> accepted
  const [order] = await db
    .update(orders)
    .set({
      manufacturerStatus: "accepted",
      manufacturerAcceptedAt: new Date(),
      // Freeze the commission the partner agreed to. Earnings accrue at ship
      // time; without this a rate change between accept and ship would apply
      // retroactively, which the agreement rules out.
      commissionRateBps: sql`COALESCE(${orders.commissionRateBps}, ${PLATFORM_COMMISSION_RATE_BPS})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.manufacturerId, session.manufacturerId),
        eq(orders.manufacturerStatus, "assigned"),
        // Refund-end-state: a refunded order still attached to this partner
        // (legacy row, or a refund racing this click) must not move forward.
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
      { error: "Order not found or not in assigned status" },
      { status: 400 }
    );
  }

  // Buradan sonrası "KABUL YAZILDI" dünyası: atomik UPDATE commit oldu, sipariş
  // bu atölyenin üzerine geçti. Aşağıdaki bir adım patlarsa atölyeye "kabul
  // edilemedi" DENMEZ.
  progress.accepted = true;

  // Kabulün KALICI kaydı siparişin kendi satırında: `manufacturerStatus` ve
  // `manufacturerAcceptedAt` yukarıdaki atomik UPDATE ile yazıldı. Bu satır onun
  // denetim kopyasıdır ve puana girmez (BAD_ACTIONS yalnız 'decline' ve
  // 'cancel_after_accept'). Eylem günlüğü yazılamaz olduğunda bu EK yazma
  // fırlıyor ve Next onu BOŞ GÖVDELİ bir 500'e çeviriyordu: atölye "kabul
  // edilemedi" okuyup tekrar deniyor, oysa sipariş ÇOKTAN kabul edilmiş oluyordu
  // (QA'da ölçüldü). Boyacı ikizleri (accept/received/painted) bu yazmayı zaten
  // yutuyor; üretici tarafı atlanmıştı.
  await db
    .insert(manufacturerActions)
    .values({
      orderId: id,
      manufacturerId: session.manufacturerId,
      action: "accept",
    })
    .catch((e) => console.error("üretici kabul: eylem günlüğü yazılamadı", e));

  // Canlı yayın da en iyi çabadır: kabul commit oldu, yayının patlaması
  // atölyeye başarısızlık diye gösterilmemeli.
  await emitOrderChanged({
    orderId: order.id,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
  }).catch((e) => console.error("üretici kabul: canlı yayın başarısız", e));

  return NextResponse.json({ success: true });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * QA'da ölçülen hâl: eylem günlüğü yazılamazken kabul ucu SIFIR BAYTLIK bir 500
 * dönüyordu. Panel o zaman kendi yedek cümlesini gösteriyor ("İşlem
 * tamamlanamadı (HTTP 500)"), atölye reddedildiğini sanıp tekrar deniyor, oysa
 * sipariş ÇOKTAN kabul edilmiş oluyordu. Rotanın bütün işi tek yerden geçer ve
 * İKİ HÂL ayrılır, çünkü atölyeye verilecek öğüt bu ayrıma bağlıdır:
 *  • Kabul yazılmadan patladıysa yazma tek işlemdir ve geri sarılır; sipariş el
 *    değmemiştir, güvenle tekrar denenebilir.
 *  • Yazıldıktan sonra patladıysa (denetim satırı, canlı yayın) sipariş ARTIK
 *    o atölyenindir; "tekrar deneyin" demek olmuş bir işi ikinci kez
 *    yaptırmaya çalışmak olurdu.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const progress: AcceptProgress = { accepted: false };
  try {
    return await handleAccept(request, ctx, progress);
  } catch (e) {
    console.error("üretici kabul: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.accepted
          ? "Siparişi kabul ettiniz, ancak sonraki adımlar (bildirim, canlı güncelleme) tamamlanamadı. Sayfayı yenileyin; sipariş kabul edilmiş görünüyorsa işlem tamamdır ve üretime başlayabilirsiniz."
          : "Beklenmeyen bir hata nedeniyle sipariş kabul edilemedi; siparişte hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
