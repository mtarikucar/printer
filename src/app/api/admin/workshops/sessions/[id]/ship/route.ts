import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions, workshopParticipants, adminActions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { batchShipSchema } from "@/lib/validators/workshop";
import { batchShipPending } from "@/lib/services/workshop-session";
import { notifyWorkshopParticipantsReady } from "@/lib/services/workshop-notify";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { emitOrderChanged } from "@/lib/realtime/emit";

/** Partiye giren, henüz sevk edilmemiş bir sipariş — `leftBehind` raporunun satırı. */
interface LeftBehindRow {
  orderNumber: string;
  participantName: string | null;
}

/**
 * Bir siparişin partide HÂLÂ sevk edilmeyi beklediğini söyleyen tanım —
 * `workshop-session.ts`teki `batchShipPending`. Rota kendi kopyasını TUTMAZ:
 * yüklem hem "partiye ait mi" (reddedilmemiş VE iade edilmemiş) hem "hâlâ
 * bekliyor mu" ayaklarını taşıyor ve DB'li test onu doğrudan çağırıyor.
 */
const batchPending = batchShipPending;

/**
 * Seansın sevke hazır (QC onaylı) siparişlerini TEK konsinye olarak mekana
 * sevk eder; QC onayı bekleyen ya da üretici ataması olmayan siparişler
 * dokunulmadan bırakılır ve isimle raporlanır.
 *
 * Bugün her sevk tek siparişliktir ve takip numarası zorunludur; atölye
 * partisinde N koli tek irsaliyeyle gider (ya da elden teslim edilir), bu
 * yüzden takip numarası tüm partiye ortaktır ve `elden` seçildiğinde hiç
 * gerekmez.
 *
 * `manufacturerStatus = 'qc_approved'` ZORUNLU — tekli
 * `manufacturer/orders/[id]/ship` ucunun aynı kapısı. Bu uç aynı zamanda
 * üreticinin hakedişini tahakkuk ettiriyor (aşağıda); QC onayı olmadan
 * sevk edilseydi, HİÇ BASILMAMIŞ bir figür için üreticiye ödeme yapılmış
 * olurdu — parti `accepted` durumunda üreticiye düşer (bkz.
 * workshop-session.ts closeSession), `qc_approved`a kadar hiçbir ara adım
 * onu bu uçtan ayırmazdı. `isNotNull(manufacturerId)` ayrıca ZORUNLU —
 * üreticisiz bir siparişe hakediş tahakkuk ettirilecek kimse yok.
 *
 * KISMİ SEVK bilerek desteklenir, tüm-ya-da-hiç DEĞİL: kutu mekana bir kez
 * gider ama bir katılımcının figürü QC'den geçmediği için on dokuz kişininkini
 * bloke etmek yanlış olurdu. Bu yüzden bu uç zaten sevk edilmiş siparişleri
 * atlıyor — geride kalanlar QC'yi geçtiğinde (ya da bir üretici atandığında)
 * ikinci bir çağrı (kendi takip numarasıyla, ikinci bir konsinye olarak)
 * onları toplar.
 *
 * Seansın toplu durumu partinin TAMAMI (partiden düşenler hariç, sevk/teslim
 * edilmemiş sipariş kalmadığında) sevk edilmiş sayıldığında `shipped`e
 * döner — BU ÇAĞRININ bir şey sevk edip etmediğinden BAĞIMSIZ: parti daha
 * önceki bir çağrıda kısmen sevk edildiyse ve geride kalanlar sonradan iade
 * edildiyse (`payment_status = 'refunded'`; `orders.status` DEĞİŞMEZ — bkz.
 * order-refund.ts) ya da reddedildiyse, bu çağrı hiçbir şey sevk etmese bile parti artık
 * tamamdır ve seans bunu yansıtmalı — aksi hâlde teslim butonu asla
 * görünmez ve o sevkiyat sonsuza dek "üretimde" görünen bir hayalete
 * dönüşür (bkz. fix round 2, "Finding 3"). Kısmi bir sevkte seans durumu
 * SABİT kalır ki "yola çıktı" yazısı geride kalan figürleri de
 * kapsıyormuş gibi yalan söylemesin — sevkiyat damgaları
 * (carrier/tracking/shippedAt) yalnızca BU ÇAĞRI gerçekten bir şey sevk
 * ettiyse yazılır (aksi hâlde hiç yola çıkmamış bir "sevkiyat" uydurulmuş
 * olurdu).
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

  // Sipariş güncellemesi + geride kalan raporu + seans damgası TEK işlemde:
  // "kaç sipariş sevk edildi" ile "kimler geride kaldı" asla birbirinden
  // ayrı düşmemeli — aradaki bir yarış, sevk edilmiş bir siparişi yanlışlıkla
  // "geride kaldı" listesine düşürebilirdi.
  const { shipped, leftBehind, sessionNowShipped } = await db.transaction(async (tx) => {
    const shippedRows = await tx
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
          batchPending(id),
          isNotNull(orders.manufacturerId),
          eq(orders.manufacturerStatus, "qc_approved")
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

    // Partiye ait olup HÂLÂ sevk edilmemiş siparişler: yukarıdaki UPDATE'ten
    // SONRA, ve manufacturerId ARANMADAN okunur — üreticisiz bir sipariş de
    // burada görünmek ZORUNDA (bkz. yukarıdaki fonksiyon yorumu).
    const pendingRows = await tx
      .select({
        orderNumber: orders.orderNumber,
        participantName: workshopParticipants.fullName,
      })
      .from(orders)
      .leftJoin(workshopParticipants, eq(workshopParticipants.orderId, orders.id))
      .where(batchPending(id));

    // Partide (bu çağrıdan ÖNCE ya da bu çağrıyla) sevk edilmiş EN AZ bir
    // sipariş var mı? UPDATE'ten SONRA okunduğu için bu çağrının kendi
    // sevkiyatını da doğal olarak sayar.
    const anyShippedRows = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.workshopSessionId, id), inArray(orders.status, ["shipped", "delivered"])))
      .limit(1);
    const batchNowComplete = pendingRows.length === 0 && anyShippedRows.length > 0;

    if (shippedRows.length > 0) {
      // Sevkiyat damgaları YALNIZCA bu çağrı gerçekten bir şey sevk ettiyse
      // yazılır — geride kalanlar sonradan partiden düştüğü için (iade ya da
      // red) parti tamamlanan bir çağrıda (aşağıdaki `batchNowComplete` dalı)
      // BU ÇAĞRININ taşımadığı bir kargo bilgisini uydurmamak için.
      await tx
        .update(workshopSessions)
        .set({
          batchCarrier: carrier,
          batchTrackingNumber: trackingValue,
          batchShippedAt: now,
          updatedAt: now,
          ...(batchNowComplete ? { status: "shipped" as const } : {}),
        })
        .where(eq(workshopSessions.id, id));
    } else if (batchNowComplete) {
      // Bu çağrı hiçbir şey sevk etmedi ama parti artık tamam: geride kalan
      // siparişler bu aralıkta partiden düştü (iade edildi ya da reddedildi).
      // Seans durumu bunu yansıtmalı, aksi hâlde teslim butonu asla görünmez.
      await tx
        .update(workshopSessions)
        .set({ status: "shipped", updatedAt: now })
        .where(eq(workshopSessions.id, id));
    }

    return {
      shipped: shippedRows,
      leftBehind: pendingRows as LeftBehindRow[],
      sessionNowShipped: batchNowComplete,
    };
  });

  if (shipped.length === 0 && !sessionNowShipped) {
    return NextResponse.json(
      {
        error:
          leftBehind.length > 0
            ? `Sevke hazır (QC onaylı) sipariş yok — ${leftBehind.length} sipariş hâlâ üretim/QC aşamasında.`
            : "Sevk edilecek üreticiye atanmış sipariş bulunamadı.",
        leftBehind,
      },
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

  // Katılımcı "kargoya verildi, takip no …" DEĞİL, "atölyede sizi bekliyor"
  // maili alır — figürü kendisi teslim almayacak, seansta elden alacak.
  // YALNIZCA bu çağrıda GERÇEKTEN sevk edilen siparişlerin katılımcılarına
  // gider (`shipped` id'leri) — kısmi sevkte geride kalan biri "figürünüz
  // sizi bekliyor" mailini, figürü daha basılmamışken almamalı.
  await notifyWorkshopParticipantsReady(shipped.map((o) => o.id)).catch((e) =>
    console.error("notifyWorkshopParticipantsReady failed", e)
  );

  return NextResponse.json({ shipped: shipped.length, leftBehind });
}
