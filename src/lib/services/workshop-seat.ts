/**
 * Atölye koltuğu sayacı — `workshop_sessions.booked_count` muhasebesi.
 *
 * AYRI bir modül olmasının sebebi teknik: koltuğu bırakan yol hem taslak yaşam
 * döngüsünden (`order-draft.ts` — süresi dolan/reddedilen ödeme) hem katılım
 * akışından çağrılıyor, ama `workshop-participant.ts` taslak referansı için
 * `order-draft.ts`'i import ediyor. Bırakma fonksiyonları katılım modülünde
 * kalsaydı `order-draft ↔ workshop-participant` döngüsü doğardı; bu dosya
 * yalnızca `@/lib/db` ve şemaya bağlı olduğu için döngü YOKTUR ve yeni bir
 * import'la döngü doğurmamalıdır.
 *
 * `reserveSeat` bilerek burada DEĞİL: o, katılımın kendi `db.transaction`'ı
 * içinde (`tx` ile) çalışmak zorunda — taslak ve katılımcı insert'leriyle aynı
 * commit'e bağlı. Bu dosyadaki iki fonksiyon ise tam tersine, çağıranın işlemi
 * COMMIT ettikten SONRA `db` üzerinden çalışır (gerekçe aşağıda).
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopParticipants, workshopSessions } from "@/lib/db/schema";

/**
 * Rezervasyonu geri alır. Katılım akışının kendisi buna İHTİYAÇ DUYMAZ (orada
 * rollback yeterli); ödeme gelmediğinde koltuğu bırakan yol için vardır.
 */
export async function releaseSeat(sessionId: string): Promise<void> {
  await db
    .update(workshopSessions)
    .set({
      // GREATEST(0, ...) — sayaç asla negatife düşmesin.
      bookedCount: sql`GREATEST(0, ${workshopSessions.bookedCount} - 1)`,
      updatedAt: new Date(),
    })
    .where(eq(workshopSessions.id, sessionId));
}

/**
 * Taslak ÖDENMEDEN sonlandığında (süre doldu / ödeme reddedildi) koltuğu
 * havuza döndürür.
 *
 * Koşullu UPDATE tek koruma noktasıdır ve oku-sonra-yaz'a çevrilmemelidir:
 *  - iki kez çalışan bir çağrı sayacı iki kez düşüremez (ikinci UPDATE 0 satır),
 *  - terfi ile yarışırsa katılımcı çoktan `paid` olduğu için yine 0 satır döner;
 *    ödemiş birinin koltuğu asla geri alınmaz.
 * Bu yüzden çağıranın ayrıca "acaba hâlâ bekliyor mu" diye okumasına gerek yok.
 *
 * Taslağı ZATEN güncellemiş bir işlemin İÇİNDE çağrılmamalıdır. Katılım işlemi
 * kilitleri seans → taslak sırasıyla alır; burası ters yönde (taslak → seans)
 * ilerler. İkisi tek işlemde birleşirse döngü kapanır ve eşzamanlı katılımlarda
 * deadlock olur. Bu yüzden `tx` değil `db` üzerinden, çağıranın işlemi COMMIT
 * ettikten SONRA çalışır.
 */
export async function releaseSeatForDraft(
  draftId: string,
  /** Katılımcı satırında ve admin ekranında görünür — çağıran bilerek seçer. */
  cancelReason: string
): Promise<void> {
  const [participant] = await db
    .update(workshopParticipants)
    .set({ status: "cancelled", cancelReason, updatedAt: new Date() })
    .where(
      and(
        eq(workshopParticipants.draftId, draftId),
        eq(workshopParticipants.status, "pending_payment")
      )
    )
    .returning({ sessionId: workshopParticipants.sessionId });
  if (!participant) return;
  await releaseSeat(participant.sessionId);
}
