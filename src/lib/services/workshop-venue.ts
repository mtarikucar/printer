import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopVenues, workshopRequests } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";

export interface VenueInput {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: TurkishAddress;
  notes?: string;
}

/**
 * Onaylı bir atölye TALEBİNİ kalıcı bir MEKANA dönüştürür.
 *
 * Talep bir lead'dir: tek seferlik, üzerinde bir tarih ve bir teklif rakamı
 * taşır ve hiçbir şey üretmez. Mekan ise defalarca seans açılabilen partner
 * kaydıdır. Bağ `requestId` ile korunur, böylece "bu kafe nereden geldi"
 * sorusu cevaplanabilir kalır.
 *
 * Aynı talepten ikinci kez mekan yaratılmaz.
 */
export async function createVenueFromRequest(
  requestId: string,
  input: VenueInput,
  adminEmail: string
): Promise<{ venueId: string } | { error: string }> {
  const request = await db.query.workshopRequests.findFirst({
    where: eq(workshopRequests.id, requestId),
    columns: { id: true },
  });
  if (!request) return { error: "Talep bulunamadı" };

  const existing = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.requestId, requestId),
    columns: { id: true },
  });
  if (existing) return { error: "Bu talep zaten bir mekana dönüştürülmüş." };

  const [venue] = await db
    .insert(workshopVenues)
    .values({ requestId, ...input, notes: input.notes || null })
    .returning({ id: workshopVenues.id });

  // Talebi 'scheduled' yap: artık işlenmiş bir lead'dir.
  await db
    .update(workshopRequests)
    .set({ status: "scheduled", adminEmail, updatedAt: new Date() })
    .where(eq(workshopRequests.id, requestId));

  return { venueId: venue.id };
}

/** Talepsiz, doğrudan mekan (telefonla anlaşılmış kafe). */
export async function createVenue(input: VenueInput): Promise<{ venueId: string }> {
  const [venue] = await db
    .insert(workshopVenues)
    .values({ requestId: null, ...input, notes: input.notes || null })
    .returning({ id: workshopVenues.id });
  return { venueId: venue.id };
}

export async function listVenues() {
  return db.query.workshopVenues.findMany({
    orderBy: [desc(workshopVenues.createdAt)],
  });
}

export async function setVenueStatus(id: string, status: string): Promise<boolean> {
  const [row] = await db
    .update(workshopVenues)
    .set({ status, updatedAt: new Date() })
    .where(eq(workshopVenues.id, id))
    .returning({ id: workshopVenues.id });
  return !!row;
}
