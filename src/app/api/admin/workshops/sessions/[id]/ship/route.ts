import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions, adminActions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { batchShipSchema } from "@/lib/validators/workshop";
import { notifyWorkshopParticipantsReady } from "@/lib/services/workshop-notify";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { emitOrderChanged } from "@/lib/realtime/emit";

/**
 * Seansın tüm siparişlerini TEK konsinye olarak mekana sevk eder.
 *
 * Bugün her sevk tek siparişliktir ve takip numarası zorunludur; atölye
 * partisinde N koli tek irsaliyeyle gider (ya da elden teslim edilir), bu
 * yüzden takip numarası tüm partiye ortaktır ve `elden` seçildiğinde hiç
 * gerekmez.
 *
 * `manufacturerId IS NOT NULL` ve `status NOT IN ('rejected', ...)` şartları
 * partiyi `workshop-session.ts`'teki `batchOrderFilter` tanımıyla aynı tutar:
 * iadeli bir sipariş asla "sevk edildi" olamaz, üreticisiz bir sipariş de
 * kimsenin basmadığı bir figürü kutuya koymuş gibi görünmemeli.
 *
 * `status NOT IN (shipped, delivered, rejected)` — sadece `!= 'shipped'`
 * DEĞİL: bir seans zaten `delivered`e geçtikten SONRA bu uç yanlışlıkla
 * tekrar çağrılırsa (çift tıklama, eski bir sekme), `!= 'shipped'` tek
 * başına `delivered` siparişleri de "sevk edilmemiş" sanıp onları `shipped`e
 * GERİ ALIRDI — takip numarasını ezer, hakedişi (idempotent olsa da)
 * anlamsızca tekrar dener ve figürünü çoktan teslim almış katılımcıya
 * "atölyede seni bekliyor" mailini İKİNCİ kez atardı. Scratch doğrulamasında
 * yakalandı (bkz. task-12a-report.md).
 *
 * Bilerek manufacturer QC zincirine (qc_approved) bağlı DEĞİL: seans detay
 * ekranındaki model-hazırlık sayacı zaten bu kararı admin'e görünür kılıyor,
 * ve toplu sevk fiziksel gerçeğin (parti fiilen yola çıktı) admin tarafından
 * beyanıdır — tıpkı tekli sevk/teslim uçlarının da mevcut durumun ötesine
 * derin doğrulama yapmadan "atomic status transition" uygulaması gibi.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email;

  const { id } = await params;
  const parsed = batchShipSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const { carrier, trackingNumber } = parsed.data;
  const trackingValue = trackingNumber?.trim() || null;
  if (carrier !== "elden" && !trackingValue) {
    return NextResponse.json(
      { error: "Kargoyla sevkte takip numarası zorunludur." },
      { status: 400 }
    );
  }

  const now = new Date();

  // Sipariş güncellemesi + seans damgası TEK işlemde: parti "yola çıktı"
  // yazısı ile sevk edilen sipariş sayısı asla birbirinden ayrı düşmemeli.
  const shipped = await db.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({
        status: "shipped",
        manufacturerStatus: "shipped",
        carrier,
        trackingNumber: trackingValue,
        shippedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(orders.workshopSessionId, id),
          notInArray(orders.status, ["shipped", "delivered", "rejected"]),
          isNotNull(orders.manufacturerId)
        )
      )
      .returning({
        id: orders.id,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        manufacturerId: orders.manufacturerId,
        status: orders.status,
        manufacturerStatus: orders.manufacturerStatus,
        amountKurus: orders.amountKurus,
        productionBaseKurus: orders.productionBaseKurus,
        paintingPriceKurus: orders.paintingPriceKurus,
        painterId: orders.painterId,
      });

    if (rows.length > 0) {
      await tx
        .update(workshopSessions)
        .set({
          status: "shipped",
          batchCarrier: carrier,
          batchTrackingNumber: trackingValue,
          batchShippedAt: now,
          updatedAt: now,
        })
        .where(eq(workshopSessions.id, id));
    }

    return rows;
  });

  if (shipped.length === 0) {
    return NextResponse.json(
      { error: "Sevk edilecek üreticiye atanmış sipariş bulunamadı." },
      { status: 400 }
    );
  }

  // Yan etkiler işlem COMMIT ettikten SONRA: bir e-posta/hakediş hatası
  // "parti yola çıktı" yazısını asla geri almamalı (closeSession'daki aynı
  // ilke — bkz. workshop-session.ts).
  for (const o of shipped) {
    await db
      .insert(adminActions)
      .values({
        orderId: o.id,
        action: "ship",
        adminEmail,
        notes:
          carrier === "elden"
            ? `Atölye toplu sevk — elden teslim (seans ${id})`
            : `Atölye toplu sevk — ${carrier}, takip: ${trackingValue} (seans ${id})`,
      })
      .catch((e) => console.error(`workshop ship: adminActions insert ${o.id} failed`, e));

    // Üreticinin hakedişi burada tahakkuk eder — tıpkı tekli
    // manufacturer/orders/[id]/ship ucunda olduğu gibi. Bunu atlamak,
    // üreticinin atölye partisi için asla ödenmemesi anlamına gelirdi.
    // `paintingPriceKurus` atölye siparişinde HER ZAMAN 0'dır (kalem
    // invariant'ı — boyacı bu akışa hiç girmez), bu yüzden `paintsInHouse`
    // bayrağı sonucu etkilemez; yine de gerçek değer okunur, varsayılmaz.
    if (o.manufacturerId) {
      const grossKurus = manufacturerBaseKurus({
        amountKurus: o.amountKurus,
        productionBaseKurus: o.productionBaseKurus,
        paintingPriceKurus: o.paintingPriceKurus,
        painterId: o.painterId,
        paintsInHouse: false,
      });
      await accrueEarning(o.id, o.manufacturerId, grossKurus).catch((e) =>
        console.error(`workshop ship: accrueEarning ${o.id} failed`, e)
      );
    }

    await emitOrderChanged({
      orderId: o.id,
      orderNumber: o.orderNumber,
      userId: o.userId,
      manufacturerId: o.manufacturerId,
      status: o.status,
      manufacturerStatus: o.manufacturerStatus,
    }).catch(() => {});
  }

  // Katılımcı "kargoya verildi, takip no …" DEĞİL, "atölyede seni bekliyor"
  // maili alır — figürü kendisi teslim almayacak, seansta elden alacak.
  await notifyWorkshopParticipantsReady(id).catch((e) =>
    console.error("notifyWorkshopParticipantsReady failed", e)
  );

  return NextResponse.json({ shipped: shipped.length });
}
