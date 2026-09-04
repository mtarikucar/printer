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

// Bu iki durumdan dönüşüm reddedilir: talep zaten kapanmış, "onaylı" değil.
// new/reviewing/scheduled/completed hepsi dönüştürülebilir kalır — admin
// planlamadan önce, umut vaat eden taze bir lead'i de doğrudan mekana
// çevirebilmeli.
const NON_CONVERTIBLE_STATUSES = new Set(["rejected", "cancelled"]);

/**
 * Onaylı bir atölye TALEBİNİ kalıcı bir MEKANA dönüştürür.
 *
 * Talep bir lead'dir: tek seferlik, üzerinde bir tarih ve bir teklif rakamı
 * taşır ve hiçbir şey üretmez. Mekan ise defalarca seans açılabilen partner
 * kaydıdır. Bağ `requestId` ile korunur, böylece "bu kafe nereden geldi"
 * sorusu cevaplanabilir kalır.
 *
 * Aynı talepten ikinci kez mekan yaratılmaz. Bu, uygulama kodunda değil
 * VERİTABANINDA doğru: `workshopRequests` satırı `FOR UPDATE` ile kilitlenir
 * ve "zaten var mı" kontrolü bu kilidin İÇİNDE yapılır, böylece aynı talebe
 * eşzamanlı iki dönüştürme isteği (iki admin sekmesi, çift tıklama + ağ
 * gecikmesi, vs.) sıraya girer — ikincisi birincinin commit'ini bekler ve
 * onun eklediği mekanı görür. İkinci koruma katmanı migration 0051'deki
 * `workshop_venues_request_id_unique_idx` kısmi UNIQUE indeksidir: kilit
 * bir şekilde atlanırsa bile DB ikinci INSERT'i reddeder.
 */
export async function createVenueFromRequest(
  requestId: string,
  input: VenueInput,
  adminEmail: string
): Promise<{ venueId: string } | { error: string }> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({ id: workshopRequests.id, status: workshopRequests.status })
      .from(workshopRequests)
      .where(eq(workshopRequests.id, requestId))
      .for("update");
    if (!request) return { error: "Talep bulunamadı" };
    if (NON_CONVERTIBLE_STATUSES.has(request.status)) {
      return {
        error: "Reddedilmiş veya iptal edilmiş bir talep mekana dönüştürülemez.",
      };
    }

    // Kilit ALINDIKTAN sonra kontrol ediliyor: aynı talebe eşzamanlı ikinci
    // bir çağrı burada birincinin commit'ini bekler, sonra bu satırı görür.
    const existing = await tx.query.workshopVenues.findFirst({
      where: eq(workshopVenues.requestId, requestId),
      columns: { id: true },
    });
    if (existing) return { error: "Bu talep zaten bir mekana dönüştürülmüş." };

    const [venue] = await tx
      .insert(workshopVenues)
      .values({ requestId, ...input, notes: input.notes || null })
      .returning({ id: workshopVenues.id });

    // Talebi 'scheduled' yap: artık işlenmiş bir lead'dir.
    await tx
      .update(workshopRequests)
      .set({ status: "scheduled", adminEmail, updatedAt: new Date() })
      .where(eq(workshopRequests.id, requestId));

    return { venueId: venue.id };
  });
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
