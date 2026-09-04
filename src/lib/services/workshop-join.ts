import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopSessions } from "@/lib/db/schema";

/**
 * Public katılım sayfasının (`/atolye/katil/<token>`) gördüğü her şey.
 *
 * Ziyaretçi kimliği doğrulanmamış bir yabancıdır — bu şekil onun tarayıcısına
 * gider. Yalnızca mekanın kamuya açık bilgilerini ve koltuk/son tarih
 * gerçeklerini taşır: üretici yok, fiyatlandırmanın iç ayrıntıları yok
 * (koltuk fiyatı dışında), admin notu yok, katılımcı listesi yok, ihtiyaç
 * duyulmayan hiçbir kimlik alanı yok.
 */
export interface JoinView {
  sessionId: string;
  venueName: string;
  venueCity: string;
  venueDistrict: string;
  venueAddressLine: string;
  startsAt: string;
  joinClosesAt: string;
  capacity: number;
  bookedCount: number;
  pricePerSeatKurus: number;
  /** Form gösterilsin mi; false ise `closedReason` doludur. */
  open: boolean;
  closedReason: string | null;
}

/**
 * Token'dan katılım görünümü. Bulunamayan token `null` döner ve sayfa
 * `notFound()` çağırır — yanlış, silinmiş ve uydurma token birbirinden
 * ayırt edilemez.
 */
export async function loadSessionByToken(token: string): Promise<JoinView | null> {
  // Savunma amaçlı uzunluk sınırı, DB'ye gitmeden (bkz. order-journey.ts).
  if (!token || token.length > 64) return null;

  const s = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.joinToken, token),
    with: { venue: true },
  });
  if (!s || !s.venue) return null;

  const now = Date.now();
  let closedReason: string | null = null;
  if (s.status === "cancelled") closedReason = "Bu atölye seansı iptal edildi.";
  else if (s.status !== "open") closedReason = "Bu seans şu anda katılıma kapalı.";
  else if (now > s.joinClosesAt.getTime())
    closedReason =
      "Katılım süresi doldu. Figürlerin seansa yetişmesi için son katılım tarihi geçti.";
  else if (s.bookedCount >= s.capacity) closedReason = "Kontenjan doldu.";

  return {
    sessionId: s.id,
    venueName: s.venue.name,
    venueCity: s.venue.address.il,
    venueDistrict: s.venue.address.ilce,
    venueAddressLine: s.venue.address.adres,
    startsAt: s.startsAt.toISOString(),
    joinClosesAt: s.joinClosesAt.toISOString(),
    capacity: s.capacity,
    bookedCount: s.bookedCount,
    pricePerSeatKurus: s.pricePerSeatKurus,
    open: closedReason === null,
    closedReason,
  };
}
