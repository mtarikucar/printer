import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderDrafts,
  workshopParticipants,
  workshopSessions,
} from "@/lib/db/schema";
import { resolveOrCreateGuestUser } from "@/lib/services/guest-user";
import { buildDraftReference } from "@/lib/services/order-draft";
import { buildMerchantOid } from "@/lib/services/paytr";
import { WORKSHOP_FIGURE_PRICE_KURUS } from "@/lib/config/workshop";
import { coerceFinishForKind } from "@/lib/validators/order";
import { isSafePhotoKey } from "@/lib/validators/workshop";
import type { TurkishAddress } from "@/lib/db/schema";

export interface JoinInput {
  fullName: string;
  email: string;
  /** E.164 — `joinSessionSchema` normalize eder. */
  phone: string;
  photoKey: string;
}

export type JoinResult =
  | { reference: string; payUrl: string }
  | { error: string; status: number };

/**
 * Koltuğu ATOMİK olarak rezerve eder. Oku-sonra-yaz DEĞİL: iki kişi son
 * koltuğu aynı anda kapayabilir ve kontenjan aşılırsa mekanda figürü olmayan
 * bir katılımcı oluşur.
 *
 * 0 satır dönerse koltuk kapılmıştır ya da seans kapanmıştır.
 */
async function reserveSeat(sessionId: string): Promise<boolean> {
  const rows = await db
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

/** Rezervasyonu geri alır (ödeme başarısız / taslak süresi doldu). */
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
 * Public katılım: koltuğu rezerve eder, ödeme taslağını yazar ve katılımcıyı
 * kaydeder. Dönen `payUrl` müşteriyi mevcut `/pay/<reference>` akışına götürür.
 *
 * `reserveSeat`'ten SONRAKİ her yol try/catch içindedir: taslak ya da katılımcı
 * yazılamazsa koltuk geri bırakılır, yoksa kontenjan sessizce sızar ve seans
 * ömür boyu bir koltuk kaybeder.
 */
export async function joinSession(
  token: string,
  input: JoinInput
): Promise<JoinResult> {
  // Savunma amaçlı uzunluk sınırı, DB'ye gitmeden (bkz. workshop-join.ts).
  if (!token || token.length > 64) return { error: "Seans bulunamadı", status: 404 };

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.joinToken, token),
    with: { venue: true },
  });
  if (!session || !session.venue) return { error: "Seans bulunamadı", status: 404 };
  if (session.status !== "open") return { error: "Bu seans katılıma kapalı.", status: 409 };

  if (!isSafePhotoKey(input.photoKey)) {
    return { error: "Geçersiz fotoğraf.", status: 400 };
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
    // `code`, `error` DEĞİL.
    return {
      error:
        guest.code === "email_registered"
          ? "Bu e-posta ile kayıtlı bir hesap var. Lütfen giriş yapıp tekrar deneyin."
          : "Kayıt oluşturulamadı.",
      status: 409,
    };
  }

  if (!(await reserveSeat(session.id))) {
    return { error: "Kontenjan doldu ya da katılım kapandı.", status: 409 };
  }

  try {
    const reference = buildDraftReference();
    const amountKurus = session.pricePerSeatKurus || WORKSHOP_FIGURE_PRICE_KURUS;
    // Sipariş adresi MEKANIN adresidir — toplu teslimat buradan doğal olarak
    // çıkar: koliler zaten aynı adrese gider, üzerlerinde katılımcının adı yazar.
    // Yalnızca telefon katılımcınındır; kurye teslimatta onu arar.
    const shippingAddress: TurkishAddress = {
      ...session.venue.address,
      telefon: input.phone,
    };

    // Taslak ve katılımcı TEK işlemde yazılır: ikincisi patlarsa geriye
    // hiçbir zaman ödenmeyecek bir taslak (ve /admin/drafts kuyruğunda hayalet
    // bir kayıt) kalmasın. Koltuk rezervasyonu bilerek DIŞARIDA: işlemin içine
    // alınsaydı satır kilidi taslak yazılana kadar tutulur ve eşzamanlı
    // katılımlar sıraya girerdi.
    await db.transaction(async (tx) => {
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
          productTitleSnapshot: `Atölye figürü — ${session.venue.name}`,
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
    });

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com").replace(/\/$/, "");
    return { reference, payUrl: `${base}/pay/${reference}` };
  } catch (err) {
    // Taslak yazılamadıysa koltuğu geri bırak, yoksa kontenjan sızar.
    await releaseSeat(session.id).catch(() => {});
    throw err;
  }
}
