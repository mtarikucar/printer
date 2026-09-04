export const dynamic = "force-dynamic";

import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { workshopSessions, workshopParticipants } from "@/lib/db/schema";
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
          modelGlbUrl: true,
          amountKurus: true,
          productionBaseKurus: true,
        },
      },
    },
  });

  // Parti: seansa bağlı, İADE EDİLMEMİŞ siparişi olan katılımcılar. Aynı
  // tanım workshop-session.ts'teki batchOrderFilter ile birebir aynı — iadeli
  // bir sipariş ne model sayacında ne komisyon toplamında sayılmamalı.
  const batch = participants.filter((p) => p.order && p.order.status !== "rejected");
  const missing = batch.filter((p) => !p.order!.modelGlbUrl);
  const readyCount = batch.length - missing.length;

  // Üreticinin toplam net payı DONMUŞ orandan hesaplanır, merdivenden asla
  // yeniden türetilmez (bkz. IMPLEMENTER-CONTEXT). Seans henüz fiyatlanmadıysa
  // (commissionRateBps NULL) gösterecek bir şey yok.
  const netTotalKurus =
    session.commissionRateBps != null
      ? batch.reduce(
          (sum, p) =>
            sum +
            computeEarning(
              p.order!.productionBaseKurus ?? p.order!.amountKurus,
              session.commissionRateBps!
            ).netKurus,
          0
        )
      : null;

  // `new Date().getTime()` yerine bilerek `Date.now()` KULLANILMAZ: eslint
  // react-hooks/purity kuralı `Date.now()`u render gövdesinde "saf olmayan
  // çağrı" olarak işaretliyor (RSC'de yanlış pozitif — bu sayfa istek başına
  // bir kez çalışır, React yeniden render etmez). `new Date()` bu kuralda
  // işaretlenmiyor; aynı değeri üretir.
  const daysUntilSession = Math.ceil(
    (session.startsAt.getTime() - new Date().getTime()) / DAY_MS
  );

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
        modelReady: Boolean(p.order?.modelGlbUrl),
      }))}
      readyCount={readyCount}
      totalCount={batch.length}
      missingNames={missing.map((p) => p.fullName)}
      netTotalKurus={netTotalKurus}
      daysUntilSession={daysUntilSession}
    />
  );
}
