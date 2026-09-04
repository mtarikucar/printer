export const dynamic = "force-dynamic";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { manufacturers, orders, workshopSessions, workshopVenues } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { sessionJoinUrl } from "@/lib/services/workshop-session";
import {
  ACTIVE_MFG_STATUSES,
  averagePrintDaysFor,
  orderStillOnManufacturerBench,
} from "@/lib/services/manufacturer-assignment";
import { VenueClient } from "./venue-client";

export default async function AdminWorkshopVenuePage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { venueId } = await params;

  const venue = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.id, venueId),
  });
  if (!venue) notFound();

  const sessions = await db.query.workshopSessions.findMany({
    where: eq(workshopSessions.venueId, venueId),
    orderBy: [desc(workshopSessions.startsAt)],
    with: { manufacturer: { columns: { id: true, companyName: true } } },
  });

  // Üretici seçimi + risk uyarısı için: aktif üreticiler, her birinin güncel
  // yükü (candidate scoring ile AYNI "bench" tanımı, bkz.
  // orderStillOnManufacturerBench) ve son işlerindeki ortalama atama→baskı
  // süresi. Sayı büyük değil (üretici listesi admin ölçeğinde), N sorgu kabul
  // edilebilir.
  const activeMfgs = await db.query.manufacturers.findMany({
    where: eq(manufacturers.status, "active"),
    orderBy: [asc(manufacturers.companyName)],
    columns: {
      id: true,
      companyName: true,
      address: true,
      maxConcurrentOrders: true,
      acceptingOrders: true,
    },
  });

  const loadRows = await db
    .select({
      manufacturerId: orders.manufacturerId,
      load: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.manufacturerStatus, [...ACTIVE_MFG_STATUSES]),
        orderStillOnManufacturerBench(),
        sql`${orders.manufacturerId} IS NOT NULL`
      )
    )
    .groupBy(orders.manufacturerId);
  const loadMap = new Map(loadRows.map((r) => [r.manufacturerId, r.load]));

  const eligibleManufacturers = await Promise.all(
    activeMfgs.map(async (m) => ({
      id: m.id,
      companyName: m.companyName,
      city: (m.address as TurkishAddress | null)?.il ?? null,
      maxConcurrentOrders: m.maxConcurrentOrders,
      currentLoad: loadMap.get(m.id) ?? 0,
      acceptingOrders: m.acceptingOrders,
      avgPrintDays: await averagePrintDaysFor(m.id),
    }))
  );

  return (
    <VenueClient
      venue={{
        id: venue.id,
        name: venue.name,
        contactName: venue.contactName,
        contactEmail: venue.contactEmail,
        contactPhone: venue.contactPhone,
        address: venue.address,
        status: venue.status,
        notes: venue.notes,
        createdAt: venue.createdAt.toISOString(),
      }}
      sessions={sessions.map((s) => ({
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        durationMinutes: s.durationMinutes,
        capacity: s.capacity,
        bookedCount: s.bookedCount,
        pricePerSeatKurus: s.pricePerSeatKurus,
        manufacturerName: s.manufacturer?.companyName ?? null,
        status: s.status,
        joinUrl: sessionJoinUrl(s.joinToken),
      }))}
      manufacturers={eligibleManufacturers}
    />
  );
}
