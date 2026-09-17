import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import { parseTryToKurus } from "@/lib/config/cost-lines";
import { carvePaintingShare, manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { editOrderMoneySplit } from "@/lib/services/order-money-edit";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Boyama kalemi olmadan satılmış bir siparişe boyama payı ekler; ardından
 * mevcut "Boyacı ata" akışı açılır.
 *
 * Neden gerekli: boyacı hattı `needsPainting`'e, o da `paintingPriceKurus > 0`'a
 * bağlı (kalem modeli). Boyama kalemi olmadan açılmış bir siparişte admin
 * panelindeki boyama kartı hiç görünmüyordu ve düzenleme route'u da yüzeyi
 * boyamaya çevirmeyi reddediyordu — yani üreticinin bastığı bir işi boyacıya
 * vermenin HİÇBİR yolu yoktu.
 *
 * PARA: müşterinin ödediği toplam DEĞİŞMEZ. Boyama payı üretim payından
 * AYRILIR: `productionBaseKurus` P kadar azalır, `paintingPriceKurus` P kadar
 * artar; ikisinin toplamı `amountKurus`'a eşit kalır (kalem invariant'ı).
 * Müşteriden ek ücret almak bu route'un işi değil — tahsil edilmemiş bir
 * tutarı boyacıya vaat etmek olurdu.
 *
 * Bu, düzenleme route'unun "ödenmiş siparişte parayı oynatma" kuralına bilinçli
 * ve DAR bir istisnadır: üretici/boyacı için hiçbir tarihsel hakediş kaydı
 * yokken yapılabilir; geri çevrilmiş kayıtlar da engeldir. Tahakkuktan sonra
 * bölüşüm değişirse üreticiye ödenmiş/ödenecek tutar geriye dönük değişirdi.
 * Üreticiye bildirim gider, admin kaydı düşülür.
 */

const schema = z.object({
  amount: z.string().trim().min(1, "Boyama tutarı girin").max(20),
  reason: z.string().trim().min(10, "Değişiklik gerekçesi en az 10 karakter olmalıdır.").max(1000),
});

const tl = (kurus: number) =>
  `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }
    // Türkçe binlik ayracını ondalık sanmayan tek ayrıştırıcı ("2.400" → ₺2.400).
    const paintingKurus = parseTryToKurus(parsed.data.amount);
    if (!Number.isInteger(paintingKurus) || paintingKurus <= 0) {
      return NextResponse.json({ error: "Geçerli bir boyama tutarı girin." }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        userId: true,
        status: true,
        finish: true,
        amountKurus: true,
        productionBaseKurus: true,
        paintingPriceKurus: true,
        needsPainting: true,
        painterId: true,
        manufacturerId: true,
        manufacturerStatus: true,
        shippedAt: true,
        workshopSessionId: true,
        paymentStatus: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    }
    if (order.needsPainting || order.paintingPriceKurus > 0) {
      return NextResponse.json(
        { error: "Bu siparişte zaten boyama kalemi var; aşağıdan boyacı atayabilirsiniz." },
        { status: 409 }
      );
    }
    // Bölüşümün kendisi saf fonksiyonda — admin ekranının önizlemesi de onu çağırır.
    const carve = carvePaintingShare(order, paintingKurus);
    if (!carve.ok) {
      const productionNow = order.productionBaseKurus ?? order.amountKurus;
      return NextResponse.json(
        {
          error:
            carve.reason === "exceeds_production"
              ? `Boyama payı üretim payından küçük olmalı (şu an üretim payı ${tl(productionNow)}).`
              : "Geçerli bir boyama tutarı girin.",
        },
        { status: 400 }
      );
    }
    const { productionBefore, productionAfter, paintingAfter } = carve;

    // Tek yazıcı: geçmiş hakediş, durum, yarış ve gerekçe denetimi aynı
    // kilitli işlemde; bu adaptör ikinci bir UPDATE/audit yolu açmaz.
    const result = await editOrderMoneySplit({
      orderId: id,
      productionKurus: productionAfter,
      paintingKurus: paintingAfter,
      expectedProductionKurus: productionBefore,
      expectedPaintingKurus: order.paintingPriceKurus,
      reason: parsed.data.reason,
      adminEmail: a.session.user.email,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    const updated = result.order;
    let warning: string | undefined;

    if (result.changed && updated.manufacturerId) {
      try {
        // Rakamlar TEK türetim noktasından (manufacturerBaseKurus), elle değil.
        // "Kendim boyarım" üreticisinin payı iş bir boyacıya devredilmedikçe
        // DEĞİŞMEZ; ona "payınız düştü" demek hem yanlış olurdu hem de gereksiz bir
        // itiraz doğururdu.
        const mfr = await db.query.manufacturers.findFirst({
          where: eq(manufacturers.id, updated.manufacturerId),
          columns: { paintsInHouse: true },
        });
        const paintsInHouse = mfr?.paintsInHouse ?? false;
        const before = manufacturerBaseKurus({
          amountKurus: order.amountKurus,
          productionBaseKurus: order.productionBaseKurus,
          paintingPriceKurus: order.paintingPriceKurus,
          painterId: null,
          paintsInHouse,
        });
        const after = { amountKurus: order.amountKurus, productionBaseKurus: productionAfter, paintingPriceKurus: paintingAfter };
        const ifHandedOff = manufacturerBaseKurus({ ...after, painterId: "handed-off", paintsInHouse });
        const ifPaintsItself = manufacturerBaseKurus({ ...after, painterId: null, paintsInHouse });
        const body = paintsInHouse
          ? `${order.orderNumber} numaralı siparişe boyama eklendi (${tl(paintingKurus)}). Siparişi kendi atölyenizde boyarsanız payınız değişmez (${tl(ifPaintsItself)}). İş bir boyacıya devredilirse boyama payı boyacıya geçer ve üretim payınız ${tl(ifHandedOff)} olur.`
          : `${order.orderNumber} numaralı sipariş boyacıya gidecek. Boyama payı (${tl(paintingKurus)}) üretim payından ayrıldı; bu siparişteki üretim payınız ${tl(before)} yerine ${tl(ifHandedOff)} olarak hesaplanacak. Baskı ve QC sonrası iş boyacıya devredilir.`;
        await notifyManufacturer({
          manufacturerId: updated.manufacturerId,
          orderId: id,
          type: "system_announcement",
          subject: `${order.orderNumber}: siparişe boyama eklendi`,
          body: `${body} Gerekçe: ${parsed.data.reason}`,
        });
      } catch (e) {
        console.error("notifyManufacturer add-painting failed", e);
        warning = "Boyama kalemi kaydedildi; üretici bildirimi oluşturulamadı. Üreticiye sipariş mesajlarından bilgi verin.";
      }
    }

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
    }).catch((e) => console.error("emitOrderChanged add-painting failed", e));

    return NextResponse.json({
      success: true,
      warning,
      paintingPriceKurus: paintingAfter,
      productionBaseKurus: productionAfter,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/add-painting", ADMIN_ACTION_FAILED_ERROR);
  }
}
