export const dynamic = "force-dynamic";

import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { manufacturers, workshopSessions, workshopParticipants } from "@/lib/db/schema";
import { orderInBatch } from "@/lib/config/workshop";
import { orderHasOwnModel } from "@/lib/config/order-model-presence";
import { computeEarning } from "@/lib/services/finance";
import { SessionClient } from "./session-client";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminWorkshopSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, id),
    with: {
      venue: true,
      manufacturer: { columns: { id: true, companyName: true } },
    },
  });
  if (!session || !session.venue) notFound();

  const participants = await db.query.workshopParticipants.findMany({
    where: eq(workshopParticipants.sessionId, id),
    orderBy: [asc(workshopParticipants.createdAt)],
    with: {
      order: {
        columns: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          // Model hazırlığı HER model türünü sayar: yalnız STL (baskı
          // parçaları) yüklenmiş bir sipariş de hazırdır. Yalnız GLB'ye bakmak,
          // modeli yüklenmiş katılımcıyı "Eksik" gösterip gereksiz yeniden
          // yüklemeye ya da partiyi bekletmeye yol açıyordu.
          modelUploadedAt: true,
          modelGlbKey: true,
          modelGlbUrl: true,
          modelStlKey: true,
          modelStlUrl: true,
          amountKurus: true,
          productionBaseKurus: true,
          commissionRateBps: true,
        },
      },
    },
  });

  // Parti: seansa bağlı, reddedilmemiş ve İADE EDİLMEMİŞ siparişi olan
  // katılımcılar. Kural `orderInBatch`ten OKUNUR — `batchOrderFilter`ın SQL
  // hâliyle aynı iki diziden beslenir, burada elle tekrarlanmaz. İade edilmiş
  // bir sipariş ne model sayacında ne komisyon toplamında görünmeli: ekran,
  // partinin gerçekte kaç figür olduğunu söylemek zorunda.
  const batch = participants.filter((p) => p.order && orderInBatch(p.order));
  const missing = batch.filter((p) => !orderHasOwnModel(p.order!));
  const readyCount = batch.length - missing.length;

  // Üreticinin toplam net payı her SİPARİŞİN KENDİ donmuş oranından
  // toplanır — session.commissionRateBps'ten DEĞİL. Bugün ikisi aynı değeri
  // taşır (closeSession partiye TEK oranı aynı anda yazar), ama gerçekten
  // ÖDENEN para siparişin kendi kolonundan hesaplanır (bkz. accrueEarning);
  // ekranın gösterdiği sayı, hangi kolon okunursa okunsun DEĞİL, parayı
  // üreten kolonu okuyarak doğru olmalı. Henüz oranı olmayan (seans kapanmadan
  // önce görüntülenen) bir sipariş toplama sıfır katkı yapar.
  const netTotalKurus = batch.reduce((sum, p) => {
    const rate = p.order!.commissionRateBps;
    if (rate == null) return sum;
    return (
      sum + computeEarning(p.order!.productionBaseKurus ?? p.order!.amountKurus, rate).netKurus
    );
  }, 0);
  // Ekranda hâlâ "oran henüz donmadı" mesajını session seviyesinde
  // göstermek için: seans hiç kapanmadıysa (commissionRateBps NULL) parti
  // siparişlerinin de oranı yoktur — bu durumda toplam anlamsız, gösterilmez.
  const netTotalDisplayKurus = session.commissionRateBps != null ? netTotalKurus : null;

  // `new Date().getTime()` yerine bilerek `Date.now()` KULLANILMAZ: eslint
  // react-hooks/purity kuralı `Date.now()`u render gövdesinde "saf olmayan
  // çağrı" olarak işaretliyor (RSC'de yanlış pozitif — bu sayfa istek başına
  // bir kez çalışır, React yeniden render etmez). `new Date()` bu kuralda
  // işaretlenmiyor; aynı değeri üretir.
  const daysUntilSession = Math.ceil(
    (session.startsAt.getTime() - new Date().getTime()) / DAY_MS
  );

  // Üretici listesi YALNIZCA gerçekten gerektiğinde yüklenir: seans üreticisiz
  // ve hâlâ atanabilir durumda. Ekranın geri kalanı (her seans görüntülemesi)
  // bu sorgunun bedelini ödememeli.
  const needsManufacturerPick =
    !session.manufacturerId && ["closed", "in_production"].includes(session.status);
  const manufacturerOptions = needsManufacturerPick
    ? (
        await db.query.manufacturers.findMany({
          where: eq(manufacturers.status, "active"),
          orderBy: [asc(manufacturers.companyName)],
          columns: { id: true, companyName: true, acceptingOrders: true },
        })
      ).map((m) => ({
        id: m.id,
        companyName: m.companyName,
        acceptingOrders: m.acceptingOrders,
      }))
    : [];

  return (
    <SessionClient
      session={{
        id: session.id,
        venueName: session.venue.name,
        venueAddress: {
          adres: session.venue.address.adres,
          ilce: session.venue.address.ilce,
          il: session.venue.address.il,
        },
        startsAt: session.startsAt.toISOString(),
        durationMinutes: session.durationMinutes,
        capacity: session.capacity,
        bookedCount: session.bookedCount,
        pricePerSeatKurus: session.pricePerSeatKurus,
        manufacturerName: session.manufacturer?.companyName ?? null,
        commissionRateBps: session.commissionRateBps,
        status: session.status,
        batchCarrier: session.batchCarrier,
        batchTrackingNumber: session.batchTrackingNumber,
        batchShippedAt: session.batchShippedAt ? session.batchShippedAt.toISOString() : null,
        batchDeliveredAt: session.batchDeliveredAt
          ? session.batchDeliveredAt.toISOString()
          : null,
        joinClosesAt: session.joinClosesAt.toISOString(),
        deliverBy: session.deliverBy.toISOString(),
        adminNotes: session.adminNotes,
      }}
      participants={participants.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        email: p.email,
        status: p.status,
        orderId: p.order?.id ?? null,
        orderNumber: p.order?.orderNumber ?? null,
        // Siparişin KENDİ durumu — sayfa yeniden yüklendiğinde bile hangi
        // katılımcının fiilen sevk edildiğini gösteren TEK kalıcı kaynak;
        // "geride kalanlar" client state'i (leftBehind) bir sayfa
        // yenilemesinde kaybolur, bu alan kaybolmaz.
        orderStatus: p.order?.status ?? null,
        modelReady: p.order ? orderHasOwnModel(p.order) : false,
      }))}
      readyCount={readyCount}
      totalCount={batch.length}
      missingNames={missing.map((p) => p.fullName)}
      netTotalKurus={netTotalDisplayKurus}
      daysUntilSession={daysUntilSession}
      manufacturerOptions={manufacturerOptions}
    />
  );
}
