import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderDrafts,
  workshopParticipants,
  workshopSessions,
} from "@/lib/db/schema";
import { WORKSHOP_SEAT_HOLD_HOURS } from "@/lib/config/workshop";
import { cardExpireJobId, getPaymentDeadlineQueue } from "@/lib/queue/queues";
import { resolveOrCreateGuestUser } from "@/lib/services/guest-user";
import { buildDraftReference } from "@/lib/services/order-draft";
import { buildMerchantOid } from "@/lib/services/paytr";
import { coerceFinishForKind } from "@/lib/validators/order";
import { isSafePhotoKey } from "@/lib/validators/workshop";
import type { TurkishAddress } from "@/lib/db/schema";

/** İşlem tipi — order-draft.ts'teki `GiftTx` ile aynı kalıp. */
type JoinTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface JoinInput {
  fullName: string;
  email: string;
  /** E.164 — `joinSessionSchema` normalize eder. */
  phone: string;
  photoKey: string;
}

/**
 * Makine-okunabilir hata ayrımı. `route.ts` bunu JSON gövdesinde `error`
 * metniyle birlikte iletir; `join-client.tsx` "kayıtlı e-posta" özel UI'ını
 * (giriş bağlantısı) bu koda göre tetikler — Türkçe mesaj metnine göre DEĞİL.
 * Sebep: mesaj metni bir yazım/ifade düzeltmesiyle değişebilir, kod değişmez.
 */
export type JoinErrorCode =
  | "session_not_found"
  | "session_closed"
  | "invalid_photo"
  | "email_registered"
  | "guest_creation_failed"
  | "capacity_full";

export type JoinResult =
  | { reference: string; payUrl: string }
  | { error: string; status: number; code: JoinErrorCode };

/**
 * Koltuğu ATOMİK olarak rezerve eder. Oku-sonra-yaz DEĞİL: iki kişi son
 * koltuğu aynı anda kapayabilir ve kontenjan aşılırsa mekanda figürü olmayan
 * bir katılımcı oluşur.
 *
 * 0 satır dönerse koltuk kapılmıştır ya da seans kapanmıştır.
 *
 * Çağıranın İŞLEMİNDE çalışır: artış, taslak ve katılımcı satırlarıyla aynı
 * commit'e bağlıdır. Elle geri alma gerekmez — rollback sayacı zaten eski
 * hâline döndürür. Asıl sebep şu: rezervasyon ayrı commit edilseydi, araya
 * giren bir çökme ya da şüpheli commit "koltuk dolu ama ne taslak ne katılımcı
 * var" durumunu üretebilirdi; Task 10'un kurtarması `workshopParticipants.draftId`
 * üzerinden yürüdüğü için o koltuk admin kapasiteyi elle düzeltene kadar kayıp kalırdı.
 *
 * Bedeli, seans satırının kilidinin iki insert boyunca tutulması: AYNI seansa
 * eşzamanlı katılımlar sıraya girer. Kapasite ≤ 200 ve iki hızlı insert için
 * kabul edilebilir; doğruluk birkaç milisaniyeden önemli.
 *
 * Karşılığı olan bırakma fonksiyonları `@/lib/services/workshop-seat`'te:
 * onlar çağıranın işleminin DIŞINDA çalışmak zorunda, bu ise İÇİNDE.
 */
async function reserveSeat(tx: JoinTx, sessionId: string): Promise<boolean> {
  const rows = await tx
    .update(workshopSessions)
    .set({ bookedCount: sql`${workshopSessions.bookedCount} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(workshopSessions.id, sessionId),
        eq(workshopSessions.status, "open"),
        sql`${workshopSessions.bookedCount} < ${workshopSessions.capacity}`,
        gt(workshopSessions.joinClosesAt, new Date())
      )
    )
    .returning({ bookedCount: workshopSessions.bookedCount });
  return rows.length > 0;
}

/**
 * Public katılım: koltuğu rezerve eder, ödeme taslağını yazar ve katılımcıyı
 * kaydeder. Dönen `payUrl` müşteriyi mevcut `/pay/<reference>` akışına götürür.
 *
 * Üçü de TEK işlemdedir: ya koltuk + taslak + katılımcı birlikte vardır, ya da
 * hiçbiri yoktur. Kontenjan sızıntısı da hayalet taslak da bu yüzden imkânsız.
 *
 * İşlem commit ettikten sonra koltuk tutma süresinin destek işi kuyruğa alınır
 * (`WORKSHOP_SEAT_HOLD_HOURS`); ödeme gelmezse koltuğu havuza döndüren şey odur.
 */
export async function joinSession(
  token: string,
  input: JoinInput
): Promise<JoinResult> {
  // Savunma amaçlı uzunluk sınırı, DB'ye gitmeden (bkz. workshop-join.ts).
  if (!token || token.length > 64)
    return { error: "Seans bulunamadı", status: 404, code: "session_not_found" };

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.joinToken, token),
    with: { venue: true },
  });
  if (!session || !session.venue)
    return { error: "Seans bulunamadı", status: 404, code: "session_not_found" };
  if (session.status !== "open")
    return { error: "Bu seans katılıma kapalı.", status: 409, code: "session_closed" };
  const venue = session.venue;

  if (!isSafePhotoKey(input.photoKey)) {
    return { error: "Geçersiz fotoğraf.", status: 400, code: "invalid_photo" };
  }

  // Kimlik e-postası her yerde aynı normalleştirilmiş biçimde saklanır:
  // kullanıcı satırı zaten küçük harfe çevriliyor, taslak ve katılımcı da
  // onunla eşleşmezse admin taraması ve hesap sahiplenme e-postası ayrışır.
  const email = input.email.trim().toLowerCase();

  // Public guest checkout: allowExistingAccount ASLA verilmez. E-postası kayıtlı
  // birinin siparişini bir yabancının başkasının hesabına iliştirmesini
  // engelleyen şey budur.
  const guest = await resolveOrCreateGuestUser({
    email,
    name: input.fullName,
    phone: input.phone,
  });
  if (!guest.ok) {
    // ResolveGuestResult: { ok: false; code: "email_registered" } — alan adı
    // `code`, `error` DEĞİL. `JoinErrorCode`'un `email_registered` değeri
    // buradaki `guest.code` ile aynı adı bilerek taşır — client bu koda göre
    // "giriş yap" bağlantısını gösterir (bkz. JoinErrorCode doc yorumu).
    const code: JoinErrorCode =
      guest.code === "email_registered" ? "email_registered" : "guest_creation_failed";
    return {
      error:
        code === "email_registered"
          ? "Bu e-posta ile kayıtlı bir hesap var. Lütfen giriş yapıp tekrar deneyin."
          : "Kayıt oluşturulamadı.",
      status: 409,
      code,
    };
  }

  const reference = buildDraftReference();
  const amountKurus = session.pricePerSeatKurus;
  // Sipariş adresi MEKANIN adresidir — toplu teslimat buradan doğal olarak
  // çıkar: koliler zaten aynı adrese gider, üzerlerinde katılımcının adı yazar.
  // Yalnızca telefon katılımcınındır; kurye teslimatta onu arar.
  const shippingAddress: TurkishAddress = {
    ...venue.address,
    telefon: input.phone,
  };

  const outcome = await db.transaction(
    async (tx): Promise<{ capacityFull: true } | { draftId: string }> => {
      if (!(await reserveSeat(tx, session.id))) {
        // Hiçbir satır yazılmadı; boş işlem commit edilir.
        return { capacityFull: true };
      }

      const [draft] = await tx
        .insert(orderDrafts)
        .values({
          reference,
          userId: guest.user.id,
          email,
          customerName: input.fullName,
          phone: input.phone,
          shippingAddress,
          orderType: "custom",
          amountKurus,
          // Kalem modeli: boyama seansın KENDİSİDİR, boyacı payı yoktur —
          // productionBaseKurus + paintingPriceKurus === amountKurus.
          productionBaseKurus: amountKurus,
          paintingPriceKurus: 0,
          needsPainting: false,
          finish: coerceFinishForKind("workshop_figure", "paintable_kit") as "paintable_kit",
          photoKeys: [input.photoKey],
          paymentMethod: "card",
          status: "pending",
          paytrMerchantOid: buildMerchantOid(reference),
          productTitleSnapshot: `Atölye figürü — ${venue.name}`,
          attributionChannel: "workshop",
        })
        .returning({ id: orderDrafts.id });

      await tx.insert(workshopParticipants).values({
        sessionId: session.id,
        draftId: draft.id,
        fullName: input.fullName,
        email,
        phone: input.phone,
        photoKey: input.photoKey,
        kvkkConsentAt: new Date(),
        contentConsentAt: new Date(),
        status: "pending_payment",
      });

      return { draftId: draft.id };
    }
  );

  if ("capacityFull" in outcome) {
    return {
      error: "Kontenjan doldu ya da katılım kapandı.",
      status: 409,
      code: "capacity_full",
    };
  }

  // Koltuk, ödeme BAŞLARKEN rezerve edilir; ödeme hiç gelmezse geri
  // bırakılmalıdır, yoksa ödemeyen biri koltuğu süresiz tutar ve kontenjan
  // sızar. Kart taslakları normalde bu destek işini planlamaz (bkz.
  // /api/orders: "nothing is locked up") — atölyede KİLİTLENEN bir şey var,
  // o yüzden burada planlanır. Terfi/başarısızlık/süre dolumu anında
  // `cancelHavaleJobs` işi siler; süre dolarsa `expireDraft` koltuğu bırakır.
  //
  // İşlem COMMIT ettikten SONRA sıraya girer: rollback'te var olmayan bir
  // taslağın işi Redis'te kalmasın.
  //
  // Redis'e ulaşılamazsa katılım YİNE DE başarılı sayılır: müşteriyi ödeme
  // sayfasına hiç götürmemenin bedeli, koltuğun geç dönmesinden ağırdır.
  // Kayıp, admin'in elle düzeltebilmesi için log'a düşer.
  await getPaymentDeadlineQueue()
    .add(
      "card-expire",
      { draftId: outcome.draftId, reference, type: "card_expire" },
      {
        jobId: cardExpireJobId(outcome.draftId),
        delay: WORKSHOP_SEAT_HOLD_HOURS * 3600 * 1000,
      }
    )
    .catch((e) =>
      console.error(
        `workshop seat-hold expiry could not be scheduled for draft ${outcome.draftId}`,
        e
      )
    );

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
  return { reference, payUrl: `${base}/pay/${reference}` };
}
