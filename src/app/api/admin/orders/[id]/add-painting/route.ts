import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { adminActions, manufacturerEarnings, manufacturers, orders } from "@/lib/db/schema";
import { parseTryToKurus } from "@/lib/config/cost-lines";
import { finishNeedsPainter } from "@/lib/config/prices";
import { carvePaintingShare, manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";

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
 * ve DAR bir istisnadır: yalnız üreticinin hakedişi henüz TAHAKKUK ETMEDEN
 * yapılabilir (hakediş kargoda ya da boyacıya devirde doğar). Tahakkuktan sonra
 * bölüşüm değişirse üreticiye ödenmiş/ödenecek tutar geriye dönük değişirdi.
 * Üreticiye bildirim gider, admin kaydı düşülür.
 */

const schema = z.object({
  amount: z.string().trim().min(1, "Boyama tutarı girin").max(20),
});

// Bu durumlarda sipariş fiziksel olarak yola çıkmış ya da kapanmıştır.
const CLOSED_STATUSES = ["shipped", "delivered", "rejected"];

const tl = (kurus: number) =>
  `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  // İade kararı (refund-end-state): iade edilen sipariş ileri gitmez. Boyama
  // payı ayırmak, parası müşteriye dönmüş bir iş için boyacı hattını (ve bir
  // boyacı hakedişini) açmak olurdu.
  if (isRefunded(order)) {
    return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
  }
  if (order.needsPainting || order.paintingPriceKurus > 0) {
    return NextResponse.json(
      { error: "Bu siparişte zaten boyama kalemi var; aşağıdan boyacı atayabilirsiniz." },
      { status: 409 }
    );
  }
  if (order.painterId) {
    return NextResponse.json({ error: "Sipariş zaten bir boyacıda." }, { status: 409 });
  }
  if (order.shippedAt || CLOSED_STATUSES.includes(order.status)) {
    return NextResponse.json(
      { error: "Sipariş kargolanmış ya da kapanmış; boyama eklenemez." },
      { status: 409 }
    );
  }

  // Atölye partisi mekâna TOPLU teslim edilir ve boyacı hattına hiç girmez: parti
  // kargosu atölye siparişinde paintingPriceKurus'un her zaman 0 olduğuna dayanır.
  // Burada boyama eklemek ya boyacı payını kimseye ödemeden bırakır ya da işi
  // partiden koparıp tek başına kargolatırdı.
  if (order.workshopSessionId) {
    return NextResponse.json(
      {
        error:
          "Atölye siparişine boyama eklenemez: atölye partisi mekâna toplu teslim edilir, boyacı hattına girmez.",
      },
      { status: 409 }
    );
  }

  const accrued = await db.query.manufacturerEarnings.findFirst({
    where: and(eq(manufacturerEarnings.orderId, id), ne(manufacturerEarnings.status, "reversed")),
    columns: { id: true },
  });
  if (accrued) {
    return NextResponse.json(
      {
        error:
          "Üreticinin hakedişi tahakkuk etmiş; boyama payı artık üretim payından ayrılamaz.",
      },
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

  // Yüzey ile para aynı şeyi söylesin: boyacıya giden bir işin kartında
  // "boyamasız" yazması, düzenleme route'unun korumaya çalıştığı çelişkinin ta
  // kendisi olurdu.
  const finishPatch = finishNeedsPainter(order.finish) ? {} : { finish: "hand_painted" as const };

  // Atomik: kontrol ile yazma arasında üretici kargolar ya da biri boyacıya
  // devrederse güncelleme hiç olmasın.
  const [updated] = await db
    .update(orders)
    .set({
      productionBaseKurus: productionAfter,
      paintingPriceKurus: paintingAfter,
      needsPainting: true,
      ...finishPatch,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, id),
        eq(orders.needsPainting, false),
        eq(orders.paintingPriceKurus, order.paintingPriceKurus),
        isNull(orders.painterId),
        isNull(orders.shippedAt),
        isNull(orders.workshopSessionId),
        // Okuma ile yazma arasında gelen bir iade de kazansın.
        notRefundedGuard(),
        sql`NOT EXISTS (SELECT 1 FROM ${manufacturerEarnings} WHERE ${manufacturerEarnings.orderId} = ${orders.id} AND ${manufacturerEarnings.status} <> 'reversed')`
      )
    )
    .returning();
  if (!updated) {
    return NextResponse.json(
      { error: "Sipariş bu sırada değişti. Sayfayı yenileyip tekrar deneyin." },
      { status: 409 }
    );
  }

  await db
    .insert(adminActions)
    .values({
      orderId: id,
      action: "edit",
      adminEmail: a.session.user.email,
      notes: `Boyama kalemi eklendi: ${tl(paintingKurus)}. Üretim payı ${tl(productionBefore)} → ${tl(productionAfter)}; toplam ${tl(order.amountKurus)} değişmedi.`,
    })
    .catch((e) => console.error("adminActions add-painting failed", e));

  if (order.manufacturerId) {
    // Rakamlar TEK türetim noktasından (manufacturerBaseKurus), elle değil.
    // "Kendim boyarım" üreticisinin payı iş bir boyacıya devredilmedikçe
    // DEĞİŞMEZ; ona "payınız düştü" demek hem yanlış olurdu hem de gereksiz bir
    // itiraz doğururdu.
    const mfr = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, order.manufacturerId),
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
      manufacturerId: order.manufacturerId,
      orderId: id,
      type: "system_announcement",
      subject: `${order.orderNumber}: siparişe boyama eklendi`,
      body,
    }).catch((e) => console.error("notifyManufacturer add-painting failed", e));
  }

  await emitOrderChanged({
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    userId: updated.userId,
    manufacturerId: updated.manufacturerId,
    status: updated.status,
    manufacturerStatus: updated.manufacturerStatus,
  });

  return NextResponse.json({
    success: true,
    paintingPriceKurus: paintingAfter,
    productionBaseKurus: productionAfter,
  });
}
