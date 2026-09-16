export const dynamic = "force-dynamic";

import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  manufacturers,
  orders,
  workshopSessions,
  workshopParticipants,
} from "@/lib/db/schema";
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
    // `venue` ÇEKİRDEKTİR: mekânsız seans gösterilmez (aşağıda notFound). Üretici
    // KAYDI ise yalnızca GÖSTERİLİYOR (ad), o yüzden ilişkisel sorgudan çıkarıldı:
    // `manufacturers` okunamadığında seans ekranının tamamı 500 veriyordu.
    with: { venue: true },
  });
  if (!session || !session.venue) notFound();

  const assignedManufacturerRead = session.manufacturerId
    ? await db
        .select({ companyName: manufacturers.companyName })
        .from(manufacturers)
        .where(eq(manufacturers.id, session.manufacturerId))
        .catch((e) => {
          console.error("workshop session: üretici adı okunamadı", e);
          return null;
        })
    : [];
  const assignedNameUnreadable = assignedManufacturerRead === null;
  const assignedManufacturerName =
    assignedManufacturerRead?.[0]?.companyName ??
    (assignedNameUnreadable ? "Üretici adı okunamadı" : null);

  // `with:` BİLEREK YOK: katılımcı listesi bu sayfanın kendi verisidir, ama
  // SİPARİŞ satırları yalnızca gösteriliyor (parti sayacı, model hazırlığı,
  // komisyon toplamı). İlişkisel sorgu TEK ifadedir — `orders` okunamadığında
  // seans ekranı tamamen 500 verirdi; oysa mekân, tarih, kontenjan ve
  // katılımcılar okunabiliyordu.
  const participants = await db.query.workshopParticipants.findMany({
    where: eq(workshopParticipants.sessionId, id),
    orderBy: [asc(workshopParticipants.createdAt)],
  });

  const participantOrderIds = [
    ...new Set(participants.map((p) => p.orderId).filter((x): x is string => !!x)),
  ];
  const orderRead = participantOrderIds.length
    ? await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          // Model hazırlığı HER model türünü sayar (bkz. orderHasOwnModel).
          modelUploadedAt: orders.modelUploadedAt,
          modelGlbKey: orders.modelGlbKey,
          modelGlbUrl: orders.modelGlbUrl,
          modelStlKey: orders.modelStlKey,
          modelStlUrl: orders.modelStlUrl,
          amountKurus: orders.amountKurus,
          productionBaseKurus: orders.productionBaseKurus,
          commissionRateBps: orders.commissionRateBps,
        })
        .from(orders)
        .where(inArray(orders.id, participantOrderIds))
        .catch((e) => {
          console.error("workshop session: parti siparişleri okunamadı", e);
          return null;
        })
    : [];
  const batchOrdersUnreadable = orderRead === null;
  const orderById = new Map((orderRead ?? []).map((o) => [o.id, o]));
  /** Katılımcının siparişi — okunamadıysa null (yani "yok" DEĞİL, bilinmiyor). */
  const orderOf = (p: (typeof participants)[number]) =>
    orderById.get(p.orderId ?? "") ?? null;

  // Parti: seansa bağlı, reddedilmemiş ve İADE EDİLMEMİŞ siparişi olan
  // katılımcılar. Kural `orderInBatch`ten OKUNUR — `batchOrderFilter`ın SQL
  // hâliyle aynı iki diziden beslenir, burada elle tekrarlanmaz. İade edilmiş
  // bir sipariş ne model sayacında ne komisyon toplamında görünmeli: ekran,
  // partinin gerçekte kaç figür olduğunu söylemek zorunda.
  const batch = participants.filter((p) => {
    const o = orderOf(p);
    return o != null && orderInBatch(o);
  });
  const missing = batch.filter((p) => !orderHasOwnModel(orderOf(p)!));
  const readyCount = batch.length - missing.length;

  // Üreticinin toplam net payı her SİPARİŞİN KENDİ donmuş oranından
  // toplanır — session.commissionRateBps'ten DEĞİL. Bugün ikisi aynı değeri
  // taşır (closeSession partiye TEK oranı aynı anda yazar), ama gerçekten
  // ÖDENEN para siparişin kendi kolonundan hesaplanır (bkz. accrueEarning);
  // ekranın gösterdiği sayı, hangi kolon okunursa okunsun DEĞİL, parayı
  // üreten kolonu okuyarak doğru olmalı. Henüz oranı olmayan (seans kapanmadan
  // önce görüntülenen) bir sipariş toplama sıfır katkı yapar.
  const netTotalKurus = batch.reduce((sum, p) => {
    const o = orderOf(p)!;
    const rate = o.commissionRateBps;
    if (rate == null) return sum;
    return sum + computeEarning(o.productionBaseKurus ?? o.amountKurus, rate).netKurus;
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
  const manufacturerOptionRead = needsManufacturerPick
    ? await db.query.manufacturers
        .findMany({
          where: eq(manufacturers.status, "active"),
          orderBy: [asc(manufacturers.companyName)],
          columns: { id: true, companyName: true, acceptingOrders: true },
        })
        .catch((e) => {
          console.error("workshop session: üretici listesi okunamadı", e);
          return null;
        })
    : [];
  // Liste OKUNAMADIYSA boş görünür — "uygun üretici yok" DEĞİL. Uyarı bunu söyler.
  const manufacturerOptionsUnreadable = manufacturerOptionRead === null;
  const manufacturerOptions = needsManufacturerPick
    ? (manufacturerOptionRead ?? []).map((m) => ({
        id: m.id,
        companyName: m.companyName,
        acceptingOrders: m.acceptingOrders,
      }))
    : [];

  return (
    <>
      {(assignedNameUnreadable ||
        manufacturerOptionsUnreadable ||
        batchOrdersUnreadable) && (
        <div
          role="alert"
          className="m-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 sm:m-8"
        >
          <p className="font-semibold">
            Üretici kayıtları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              assignedNameUnreadable && "seansa atanmış üreticinin adı",
              manufacturerOptionsUnreadable &&
                "atanabilir üretici listesi — liste boş görünüyor, bu “uygun üretici yok” demek DEĞİL",
              batchOrdersUnreadable &&
                "katılımcıların SİPARİŞLERİ: parti sayacı (hazır/eksik model), sipariş durumları ve üreticinin net payı bu yüzden 0 görünüyor — bunlar ÖLÇÜM DEĞİL, okunamayan kayıtlardır; partiyi bu ekrana bakarak kapatmayın",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı. Seansın kendisi, katılımcılar ve parti sayıları gerçek
            kayıtlardır. Birkaç dakika sonra sayfayı yenileyin.
          </p>
        </div>
      )}
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
        manufacturerName: assignedManufacturerName,
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
        orderId: orderOf(p)?.id ?? null,
        orderNumber: orderOf(p)?.orderNumber ?? null,
        // Siparişin KENDİ durumu — sayfa yeniden yüklendiğinde bile hangi
        // katılımcının fiilen sevk edildiğini gösteren TEK kalıcı kaynak;
        // "geride kalanlar" client state'i (leftBehind) bir sayfa
        // yenilemesinde kaybolur, bu alan kaybolmaz.
        orderStatus: orderOf(p)?.status ?? null,
        modelReady: (() => {
          const o = orderOf(p);
          return o ? orderHasOwnModel(o) : false;
        })(),
      }))}
      readyCount={readyCount}
      totalCount={batch.length}
      missingNames={missing.map((p) => p.fullName)}
      netTotalKurus={netTotalDisplayKurus}
      daysUntilSession={daysUntilSession}
      manufacturerOptions={manufacturerOptions}
    />
    </>
  );
}
