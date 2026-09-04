export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import {
  workshopCommissionLadderLines,
  WORKSHOP_SESSION_STATUS_LABELS,
} from "@/lib/config/workshop";
import { WorkshopCommitClient } from "./commit-client";

/**
 * Üreticinin, kendisine ön rezerve edilmiş bir atölye seansının tarihini
 * TAAHHÜT ettiği ekran.
 *
 * `POST /api/manufacturer/workshop-sessions/[id]/commit` bu sayfadan önce
 * HİÇBİR yerden çağrılmıyordu: uç vardı, ona giden bir bağlantı yoktu ve
 * `manufacturer_committed_at` her seansta NULL kalıyordu. Oysa kapanışta
 * partinin soğuk atama ve 24 saatlik kabul beklemesi olmadan doğrudan üreticiye
 * düşmesinin dayanağı tam olarak o taahhüttür — 5 günlük katılım penceresini
 * gerçekçi kılan şey. Seans açılış bildirimi artık buraya bağlanıyor.
 *
 * Yalnızca seansın KENDİ üreticisi görebilir; başkasının seansının varlığı
 * sızdırılmaz (404).
 */
export default async function ManufacturerWorkshopSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const { id } = await params;
  const row = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, id),
    with: { venue: true },
  });
  if (!row || !row.venue || row.manufacturerId !== session.manufacturerId) {
    notFound();
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <WorkshopCommitClient
        session={{
          id: row.id,
          venueName: row.venue.name,
          venueLine: `${row.venue.address.adres} (${row.venue.address.ilce}/${row.venue.address.il})`,
          startsAt: row.startsAt.toISOString(),
          durationMinutes: row.durationMinutes,
          capacity: row.capacity,
          pricePerSeatKurus: row.pricePerSeatKurus,
          joinClosesAt: row.joinClosesAt.toISOString(),
          deliverBy: row.deliverBy.toISOString(),
          status: row.status,
          statusLabel:
            (WORKSHOP_SESSION_STATUS_LABELS as Record<string, string>)[row.status] ??
            row.status,
          commissionRateBps: row.commissionRateBps,
          committedAt: row.manufacturerCommittedAt
            ? row.manufacturerCommittedAt.toISOString()
            : null,
        }}
        ladder={workshopCommissionLadderLines()}
      />
    </div>
  );
}
