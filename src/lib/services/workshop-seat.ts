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
 * Bir atölye koltuğunun kime ait olduğunu söyleyen asgari bağlam. Çağıran bunu
 * iki şey için kullanır: (a) taslağın bir ATÖLYE taslağı olduğunu anlamak,
 * (b) katılımcıya doğru e-postayı göndermek.
 */
export interface ReleasedSeat {
  sessionId: string;
  fullName: string;
  email: string;
}

/**
 * `releaseSeatForDraft`'in ÜÇ ayrı sonucu. Ayrı tutulmaları şart: "koltuk yok"
 * ile "bırakma patladı" tek bir `null`a indirgenirse, bırakması hata veren
 * GERÇEK bir atölye taslağı, çağıran tarafından atölye-olmayan sanılır ve
 * katılımcıya yanlış e-posta (havale / 72 saat / `/create`) gider.
 *
 *  - `released`    — koltuk gerçekten bırakıldı; `seat` katılımcıyı tanımlar.
 *  - `not_held`    — bu taslak için `pending_payment` bir katılımcı yok.
 *                    Pratikte "atölye taslağı değil" demektir: ödemiş
 *                    (`paid`) ya da zaten iptal edilmiş bir katılımcının
 *                    taslağı, taslak durumu kapısına zaten takılır.
 *  - `error`       — işlem patladı. Koltuk hâlâ tutuluyor (rollback), taslağın
 *                    atölye taslağı olup olmadığı BURADAN bilinemez; çağıran
 *                    karar vermek için `findParticipantSeatByDraft`'i kullanır.
 */
export type ReleaseSeatOutcome =
  | { status: "released"; seat: ReleasedSeat }
  | { status: "not_held" }
  | { status: "error"; error: unknown };

/**
 * Ucuz, KORUMASIZ okuma: bu taslak bir atölye katılımcısına mı ait?
 *
 * `releaseSeatForDraft` hata verdiğinde çağıranın hangi e-postayı göndereceğine
 * karar vermesi için vardır. Bilerek koşulsuz (`status` filtresi yok) ve
 * bilerek salt-okunur: burada amaç koltuğu bırakmak değil, KİMLİK tespiti.
 * `workshop_participants_draft_idx` üzerinden tek indeksli okuma.
 */
export async function findParticipantSeatByDraft(
  draftId: string
): Promise<ReleasedSeat | null> {
  const [row] = await db
    .select({
      sessionId: workshopParticipants.sessionId,
      fullName: workshopParticipants.fullName,
      email: workshopParticipants.email,
    })
    .from(workshopParticipants)
    .where(eq(workshopParticipants.draftId, draftId))
    .limit(1);
  return row ?? null;
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
): Promise<ReleaseSeatOutcome> {
  // Koltuğu bırakmanın iki adımı (katılımcıyı iptal et + sayacı düşür) TEK
  // işlemdedir. Ayrı ayrı yazılsalardı, aradaki bir çökme katılımcıyı
  // `cancelled` bırakır ama sayacı düşürmezdi; koşullu UPDATE bir daha asla
  // eşleşmeyeceği için o koltuk KALICI olarak kaybolurdu — hiçbir tekrar
  // deneme kurtaramazdı.
  //
  // Bu, katılım yoluyla deadlock döngüsü YARATMAZ: yön hâlâ katılımcı → seans
  // ve bu işlem, çağıranın (taslağı güncelleyen) işlemi COMMIT ettikten sonra,
  // ondan bağımsız olarak açılır.
  //
  // Hata FIRLATILMAZ, `error` sonucu olarak döndürülür: çağıranın bunu
  // "atölye taslağı değil" ile karıştırmaması bu sözleşmenin bütün amacı
  // (bkz. ReleaseSeatOutcome).
  try {
    const seat = await db.transaction(async (tx) => {
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
    return seat ? { status: "released", seat } : { status: "not_held" };
  } catch (error) {
    return { status: "error", error };
  }
}
