import { and, eq, isNull, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { workshopSessions, workshopVenues } from "@/lib/db/schema";
import { deriveSessionDates, WORKSHOP_DELIVER_DAYS_BEFORE } from "@/lib/config/workshop";

/** Katılım token'ı: 12 karakter × 64 sembol ≈ 72 bit. Ev kuralı (order-journey). */
const TOKEN_LENGTH = 12;

/**
 * Seansın katılım linki. `ensureJourneyToken` ile aynı yarış-güvenli tembel
 * mint deseni: token varsa döner; yoksa `isNull(joinToken)` koşuluyla yazmayı
 * dener, kaybederse yeniden okur. Basılmış/paylaşılmış bir link asla
 * geçersizleşmez.
 *
 * Pratikte `createSession` token'ı zaten yaratışta yazıyor; bu fonksiyon
 * yine de var — eski/elle eklenmiş bir satırda token eksikse (ör. gelecekte
 * bir göç adımı) çağıran taraf DB'yi elle değiştirmeden tamamlayabilsin diye.
 */
export async function ensureJoinToken(sessionId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.query.workshopSessions.findFirst({
      where: eq(workshopSessions.id, sessionId),
      columns: { joinToken: true },
    });
    if (!row) return null;
    if (row.joinToken) return row.joinToken;

    const candidate = nanoid(TOKEN_LENGTH);
    const [updated] = await db
      .update(workshopSessions)
      .set({ joinToken: candidate, updatedAt: new Date() })
      .where(and(eq(workshopSessions.id, sessionId), isNull(workshopSessions.joinToken)))
      .returning({ joinToken: workshopSessions.joinToken });
    if (updated?.joinToken) return updated.joinToken;

    // Ya biri yarışı kazandı (yeniden oku, onunkini kullan) ya da unique
    // indeks çakışmayı reddetti (taze token'la tekrar dene).
  }
  return null;
}

export function sessionJoinUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
  return `${base}/atolye/katil/${token}`;
}

export interface CreateSessionInput {
  venueId: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  pricePerSeatKurus: number;
  manufacturerId?: string | null;
  adminNotes?: string | null;
}

/**
 * Yeni bir seans yaratır: kapanış ve teslim tarihlerini `deriveSessionDates`
 * ile türetir, katılım token'ını hemen basar (link admin ekranında anında
 * gösterilebilsin) ve `draft` durumunda başlatır — `open`'a geçiş ayrı bir
 * admin eylemidir (üretici seçilmiş olma şartıyla, bkz. PATCH route).
 */
export async function createSession(
  input: CreateSessionInput
): Promise<{ sessionId: string; joinToken: string } | { error: string }> {
  const venue = await db.query.workshopVenues.findFirst({
    where: eq(workshopVenues.id, input.venueId),
    columns: { id: true, status: true },
  });
  if (!venue) return { error: "Mekan bulunamadı" };
  if (venue.status !== "active") return { error: "Mekan aktif değil" };

  const now = Date.now();
  if (input.startsAt.getTime() <= now) {
    return { error: "Seans tarihi geçmişte olamaz." };
  }

  const { joinClosesAt, deliverBy } = deriveSessionDates(input.startsAt);
  // Kapanış zaten geçmişse link hiç açılamaz — admin'i sessizce ölü bir
  // seansla bırakmak yerine reddet.
  if (joinClosesAt.getTime() <= now) {
    return {
      error:
        "Bu tarih için katılım penceresi zaten kapanmış olurdu (kapanış seanstan 5 gün öncedir). Daha ileri bir tarih seçin.",
    };
  }

  const token = nanoid(TOKEN_LENGTH);
  const [row] = await db
    .insert(workshopSessions)
    .values({
      venueId: input.venueId,
      startsAt: input.startsAt,
      durationMinutes: input.durationMinutes,
      capacity: input.capacity,
      pricePerSeatKurus: input.pricePerSeatKurus,
      manufacturerId: input.manufacturerId ?? null,
      adminNotes: input.adminNotes ?? null,
      joinToken: token,
      joinClosesAt,
      deliverBy,
      status: "draft",
    })
    .returning({ id: workshopSessions.id, joinToken: workshopSessions.joinToken });

  return { sessionId: row.id, joinToken: row.joinToken };
}

/**
 * Seçilen üreticinin bu tarihe yetişip yetişemeyeceğine dair uyarı.
 *
 * ENGELLEMEZ — admin bilerek riskli bir seans açabilir (üreticiyle telefonda
 * anlaşmış olabilir). Saf fonksiyon: girdi hesaplanıp verilir, DB'ye gitmez,
 * test edilebilir.
 */
export function assessSessionRisk(args: {
  daysUntilSession: number;
  /** Üreticinin son işlerindeki ortalama atama→baskı süresi (gün). */
  avgPrintDays: number;
  currentLoad: number;
  maxConcurrentOrders: number;
}): { level: "ok" | "warn" | "danger"; message: string } {
  const { daysUntilSession, avgPrintDays, currentLoad, maxConcurrentOrders } = args;

  if (currentLoad >= maxConcurrentOrders) {
    return {
      level: "danger",
      message: `Bu üreticinin kapasitesi dolu (${currentLoad}/${maxConcurrentOrders}). Parti sıraya girer.`,
    };
  }

  // Parti mekana seanstan WORKSHOP_DELIVER_DAYS_BEFORE gün önce teslim
  // edilmek zorunda; üreticinin fiilen basmak için kullanabileceği süre budur.
  const usableDays = daysUntilSession - WORKSHOP_DELIVER_DAYS_BEFORE;
  if (usableDays < avgPrintDays) {
    return {
      level: "danger",
      message: `Seansa ${daysUntilSession} gün var; bu üreticinin ortalama baskı süresi ${avgPrintDays} gün. Yetişmeyebilir.`,
    };
  }
  if (usableDays < avgPrintDays * 1.5) {
    return {
      level: "warn",
      message: `Seansa ${daysUntilSession} gün var; ortalama baskı süresi ${avgPrintDays} gün. Pay dar.`,
    };
  }
  return { level: "ok", message: "Süre yeterli görünüyor." };
}

/** Kapanış zamanı geçmiş, hâlâ açık seanslar (kapanış worker'ı için). */
export async function findSessionsDueToClose(now: Date) {
  return db
    .select({ id: workshopSessions.id })
    .from(workshopSessions)
    .where(and(eq(workshopSessions.status, "open"), lte(workshopSessions.joinClosesAt, now)));
}
