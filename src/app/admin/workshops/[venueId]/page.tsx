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

  // `with:` BİLEREK YOK: üretici ADI yalnızca gösteriliyor, ama ilişkisel sorgu
  // TEK ifadedir — `manufacturers` okunamadığında mekânın SEANS LİSTESİ tamamen
  // kaybolurdu. Ad ayrı ve korumalı okunur.
  const sessions = await db.query.workshopSessions.findMany({
    where: eq(workshopSessions.venueId, venueId),
    orderBy: [desc(workshopSessions.startsAt)],
  });

  const sessionMfgIds = [
    ...new Set(sessions.map((x) => x.manufacturerId).filter((x): x is string => !!x)),
  ];
  const sessionMfgRead = sessionMfgIds.length
    ? await db
        .select({ id: manufacturers.id, companyName: manufacturers.companyName })
        .from(manufacturers)
        .where(inArray(manufacturers.id, sessionMfgIds))
        .catch((e) => {
          console.error("venue: seans üretici adları okunamadı", e);
          return null;
        })
    : [];
  const sessionMfgUnreadable = sessionMfgRead === null;
  const sessionMfgById = new Map(
    (sessionMfgRead ?? []).map((m) => [m.id, m.companyName])
  );

  // Üretici seçimi + risk uyarısı için: aktif üreticiler, her birinin güncel
  // yükü (candidate scoring ile AYNI "bench" tanımı, bkz.
  // orderStillOnManufacturerBench) ve son işlerindeki ortalama atama→baskı
  // süresi. Sayı büyük değil (üretici listesi admin ölçeğinde), N sorgu kabul
  // edilebilir.
  // Üç okuma da TEK seçim listesini besler, bu yüzden TEK korumanın içinde:
  // biri düşerse liste bilinmiyor demektir. Okunamadığında sayfa yine açılır ve
  // uyarı, boş listenin "uygun üretici yok" DEMEDİĞİNİ söyler.
  const pickerRead = await (async () => {
    try {
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

      return await Promise.all(
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
    } catch (e) {
      console.error("venue: atanabilir üretici listesi okunamadı", e);
      return null;
    }
  })();
  const pickerUnreadable = pickerRead === null;
  const eligibleManufacturers = pickerRead ?? [];

  return (
    <>
      {(sessionMfgUnreadable || pickerUnreadable) && (
        <div
          role="alert"
          className="m-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 sm:m-8"
        >
          <p className="font-semibold">
            Üretici kayıtları şu anda okunamıyor (geçici sistem arızası)
          </p>
          <p className="mt-1 text-amber-900/80">
            {[
              sessionMfgUnreadable &&
                "seansların atanmış üretici adları (adı görünmeyen seans ATANMAMIŞ değil)",
              pickerUnreadable &&
                "atanabilir üretici listesi — liste boş görünüyor, bu “uygun üretici yok” demek DEĞİL",
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            okunamadı. Mekân ve seans bilgileri gerçek kayıtlardır; birkaç dakika
            sonra sayfayı yenileyin.
          </p>
        </div>
      )}
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
        manufacturerName:
          sessionMfgById.get(s.manufacturerId ?? "") ??
          (sessionMfgUnreadable && s.manufacturerId ? "Üretici adı okunamadı" : null),
        status: s.status,
        joinUrl: sessionJoinUrl(s.joinToken),
      }))}
      manufacturers={eligibleManufacturers}
    />
    </>
  );
}
