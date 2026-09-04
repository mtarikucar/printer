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
 * Sayacı bir azaltan TEK ifade. Hem tek başına `releaseSeat` hem de
 * `releaseSeatForDraft`'in işlemi bunu kullanır; kural (negatife düşmeme) iki
 * yere kopyalanmaz.
 */
function decrementBookedCount() {
  return {
    // GREATEST(0, ...) — sayaç asla negatife düşmesin.
    bookedCount: sql`GREATEST(0, ${workshopSessions.bookedCount} - 1)`,
    updatedAt: new Date(),
  };
}

/**
 * Rezervasyonu geri alır. Katılım akışının kendisi buna İHTİYAÇ DUYMAZ (orada
 * rollback yeterli); ödeme gelmediğinde koltuğu bırakan yol için vardır.
 *
 * Katılımcı satırı zaten terminal durumdayken (örn. ödemiş bir katılımcının
 * admin tarafından iptali) doğrudan çağrılır; taslaktan yürüyen yol için
 * `releaseSeatForDraft`'i kullanın.
 */
export async function releaseSeat(sessionId: string): Promise<void> {
  await db
    .update(workshopSessions)
    .set(decrementBookedCount())
    .where(eq(workshopSessions.id, sessionId));
}

/**
 * `releaseSeatForDraft` gerçekten bir koltuk bıraktığında döndürdüğü bağlam.
 * Hepsi zaten güncellenen katılımcı satırından gelir — ek sorgu yoktur.
 * Çağıran bunu iki şey için kullanır: (a) taslağın bir ATÖLYE taslağı olduğunu
 * anlamak, (b) katılımcıya doğru e-postayı göndermek.
 */
export interface ReleasedSeat {
  sessionId: string;
  fullName: string;
  email: string;
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
): Promise<ReleasedSeat | null> {
  // Koltuğu bırakmanın iki adımı (katılımcıyı iptal et + sayacı düşür) TEK
  // işlemdedir. Ayrı ayrı yazılsalardı, aradaki bir çökme katılımcıyı
  // `cancelled` bırakır ama sayacı düşürmezdi; koşullu UPDATE bir daha asla
  // eşleşmeyeceği için o koltuk KALICI olarak kaybolurdu — hiçbir tekrar
  // deneme kurtaramazdı.
  //
  // Bu, katılım yoluyla deadlock döngüsü YARATMAZ: yön hâlâ katılımcı → seans
  // ve bu işlem, çağıranın (taslağı güncelleyen) işlemi COMMIT ettikten sonra,
  // ondan bağımsız olarak açılır.
  return db.transaction(async (tx) => {
    const [participant] = await tx
      .update(workshopParticipants)
      .set({ status: "cancelled", cancelReason, updatedAt: new Date() })
      .where(
        and(
          eq(workshopParticipants.draftId, draftId),
          eq(workshopParticipants.status, "pending_payment")
        )
      )
      .returning({
        sessionId: workshopParticipants.sessionId,
        fullName: workshopParticipants.fullName,
        email: workshopParticipants.email,
      });
    if (!participant) return null;

    await tx
      .update(workshopSessions)
      .set(decrementBookedCount())
      .where(eq(workshopSessions.id, participant.sessionId));

    return participant;
  });
}
