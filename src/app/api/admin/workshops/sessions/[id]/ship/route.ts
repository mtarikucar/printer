import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopSessions, workshopParticipants, adminActions } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/require-admin";
import { batchShipSchema } from "@/lib/validators/workshop";
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
 * Bir siparişin partiye ait sayılması için ortak yüklem:
 * seansa bağlı, üreticiye atanmış, henüz sevk/teslim edilmemiş ve
 * reddedilmemiş. `workshop-session.ts`'teki `batchOrderFilter` ile aynı
 * tanımı taşır (o fonksiyon export edilmediği için burada tekrarlanır).
 *
 * `status NOT IN (shipped, delivered, rejected)` — sadece `!= 'shipped'`
 * DEĞİL: bir seans zaten `delivered`e geçtikten SONRA bu uç yanlışlıkla
 * tekrar çağrılırsa (çift tıklama, eski bir sekme), `!= 'shipped'` tek
 * başına `delivered` siparişleri de "sevk edilmemiş" sanıp onları `shipped`e
 * GERİ ALIRDI — takip numarasını ezer, hakedişi (idempotent olsa da)
 * anlamsızca tekrar dener ve figürünü çoktan teslim almış katılımcıya
 * "atölyede seni bekliyor" mailini İKİNCİ kez atardı. Scratch doğrulamasında
 * yakalandı (bkz. task-12a-report.md, "Bug found").
 */
function batchEligible(sessionId: string) {
  return and(
    eq(orders.workshopSessionId, sessionId),
    notInArray(orders.status, ["shipped", "delivered", "rejected"]),
    isNotNull(orders.manufacturerId)
  );
}

/**
 * Seansın sevke hazır (QC onaylı) siparişlerini TEK konsinye olarak mekana
 * sevk eder; QC onayı bekleyen siparişler dokunulmadan bırakılır ve isimle
 * raporlanır.
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
 * onu bu uçtan ayırmazdı.
 *
 * KISMİ SEVK bilerek desteklenir, tüm-ya-da-hiç DEĞİL: kutu mekana bir kez
 * gider ama bir katılımcının figürü QC'den geçmediği için on dokuz kişininkini
 * bloke etmek yanlış olurdu. Bu yüzden bu uç zaten sevk edilmiş siparişleri
 * atlıyor — geride kalanlar QC'yi geçtiğinde ikinci bir çağrı (kendi takip
 * numarasıyla, ikinci bir konsinye olarak) onları toplar. Seansın toplu
 * durumu yalnızca partinin TAMAMI sevk edildiğinde `shipped`e döner; kısmi
 * bir sevkte seans durumu SABİT kalır ki "yola çıktı" yazısı geride kalan
 * figürleri de kapsıyormuş gibi yalan söylemesin — sevkiyat damgaları
 * (carrier/tracking/shippedAt) yine de bu son sevkiyatı yansıtacak şekilde
 * yazılır.
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
  const { shipped, leftBehind } = await db.transaction(async (tx) => {
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
      .where(and(batchEligible(id), eq(orders.manufacturerStatus, "qc_approved")))
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
    // SONRA okunduğu için, bu satırlar yalnızca "QC onaylı değildi, o yüzden
    // güncellenmedi" olabilir — ayrıca bir "manufacturerStatus != qc_approved"
    // şartı yazmaya gerek yok, aynı `batchEligible` yüklemi UPDATE'in
    // dokunmadığı satırları doğal olarak verir.
    const pendingRows = await tx
      .select({
        orderNumber: orders.orderNumber,
        participantName: workshopParticipants.fullName,
      })
      .from(orders)
      .leftJoin(workshopParticipants, eq(workshopParticipants.orderId, orders.id))
      .where(batchEligible(id));

    if (shippedRows.length > 0) {
      // Sevkiyat damgaları HER zaman bu çağrının bilgisini yansıtır (kısmi
      // sevkte bile) — geride kalanlar için ikinci bir konsinye geldiğinde bu
      // alanlar o çağrıyla tekrar güncellenir, tek gerçek kaynak siparişlerin
      // KENDİ carrier/trackingNumber kolonlarıdır.
      //
      // Seans durumu YALNIZCA parti tamamen boşaldığında (`pendingRows.length
      // === 0`) `shipped`e döner — kısmi bir sevkte SABİT kalır, aksi hâlde
      // "yola çıktı" durumu geride kalan figürleri de kapsıyormuş gibi
      // yanlış beyan ederdi.
      await tx
        .update(workshopSessions)
        .set({
          batchCarrier: carrier,
          batchTrackingNumber: trackingValue,
          batchShippedAt: now,
          updatedAt: now,
          ...(pendingRows.length === 0 ? { status: "shipped" as const } : {}),
        })
        .where(eq(workshopSessions.id, id));
    }

    return { shipped: shippedRows, leftBehind: pendingRows as LeftBehindRow[] };
  });

  if (shipped.length === 0) {
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

  // Katılımcı "kargoya verildi, takip no …" DEĞİL, "atölyede seni bekliyor"
  // maili alır — figürü kendisi teslim almayacak, seansta elden alacak.
  // YALNIZCA bu çağrıda GERÇEKTEN sevk edilen siparişlerin katılımcılarına
  // gider (`shipped` id'leri) — kısmi sevkte geride kalan biri "figürün seni
  // bekliyor" mailini, figürü daha basılmamışken almamalı.
  await notifyWorkshopParticipantsReady(shipped.map((o) => o.id)).catch((e) =>
    console.error("notifyWorkshopParticipantsReady failed", e)
  );

  return NextResponse.json({ shipped: shipped.length, leftBehind });
}
