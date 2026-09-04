/**
 * Atölye iptalleri — seansın tamamı ya da tek bir katılımcı.
 *
 * Mantık rotalarda DEĞİL burada yaşar (aynı gerekçe `order-refund.ts` için de
 * geçerli): para yolu tek olmalı, test edilebilmeli ve iki uç arasında
 * ayrışmamalı. Rotalar yalnızca yetki + HTTP eşlemesi yapar.
 *
 * İade DAİMA `refundOrder` üzerinden geçer — ikinci bir para yolu açılmaz.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopParticipants, workshopSessions } from "@/lib/db/schema";
import { participantCancelDisposition, seatReturnsToPool } from "@/lib/config/workshop";
import { refundOrder } from "@/lib/services/order-refund";
import { releaseSeat } from "@/lib/services/workshop-seat";
import { sendWorkshopSessionCancelledEmail } from "@/lib/services/workshop-notify";

/** Seans iptalinde katılımcıların isimle raporlanan üç kümesi. */
export interface WorkshopSessionCancelReport {
  /** İadesi başarıyla işlenen katılımcılar. */
  refunded: string[];
  /** Figürü yola çıkmış olduğu için OTOMATİK iade EDİLMEYEN katılımcılar. */
  alreadyShipped: string[];
  /** İadesi patlayan katılımcılar — `cancelled` YAPILMADILAR, tekrar denenir. */
  failed: string[];
}

export type CancelWorkshopSessionResult =
  | { ok: true; report: WorkshopSessionCancelReport }
  | { ok: false; reason: "not_found" };

export type CancelWorkshopParticipantResult =
  | { ok: true; refunded: boolean; seatReleased: boolean }
  | { ok: false; reason: "not_found" | "already_shipped" | "refund_failed" };

/**
 * Katılımcıyı `cancelled` yapar. Dönüş, satırın GERÇEKTEN bu çağrıda
 * değiştiğini söyler (`ne(status, 'cancelled')` koşulu) — çağıran bunu iki şey
 * için kullanır: zaten iptal edilmiş birine ikinci kez bilgilendirme e-postası
 * göndermemek ve koltuğu ikinci kez havuza bırakmamak. İkisi de bu rotaların
 * tekrar tekrar çağrılabilir (idempotent) olmasının şartı.
 */
async function markParticipantCancelled(
  participantId: string,
  cancelReason: string
): Promise<boolean> {
  const [row] = await db
    .update(workshopParticipants)
    .set({ status: "cancelled", cancelReason, updatedAt: new Date() })
    .where(
      and(
        eq(workshopParticipants.id, participantId),
        ne(workshopParticipants.status, "cancelled")
      )
    )
    .returning({ id: workshopParticipants.id });
  return Boolean(row);
}

/**
 * Seansın tamamını iptal eder: ödemiş katılımcıların parası iade edilir,
 * ödemeye hiç gelmemişler `cancelled` yapılır, seans `cancelled` olur.
 *
 * SEVK EDİLMİŞ sipariş otomatik iade EDİLMEZ (figür fiziksel olarak var ve
 * yola çıktı; otomatik iade ürünü bedava vermek olurdu) — isimleriyle
 * raporlanır, admin normal iade ekranından tek tek halleder.
 *
 * BAŞARISIZ iade sessizce yutulmaz: iadesi patlayan katılımcı `cancelled`
 * YAPILMAZ ve isimle raporlanır. Seans yine de `cancelled` olur (etkinlik
 * iptal edildi — bu dünyaya dair bir gerçek, paraya dair değil). Bu yüzden
 * fonksiyon İDEMPOTENTTİR: zaten `cancelled` bir seansta da çalışır ve
 * yalnızca geride kalanları yeniden dener; `already_refunded` başarı sayılır.
 */
export async function cancelWorkshopSession(input: {
  sessionId: string;
  adminEmail: string;
}): Promise<CancelWorkshopSessionResult> {
  const { sessionId: id, adminEmail } = input;

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, id),
    columns: { id: true },
  });
  if (!session) return { ok: false, reason: "not_found" };

  // Seans zaten iptalse de çalışır: bu yol aynı zamanda başarısız iadelerin
  // yeniden deneme yoludur.
  const rows = await db
    .select({
      participantId: workshopParticipants.id,
      fullName: workshopParticipants.fullName,
      email: workshopParticipants.email,
      orderId: orders.id,
      orderStatus: orders.status,
    })
    .from(workshopParticipants)
    .leftJoin(orders, eq(workshopParticipants.orderId, orders.id))
    .where(eq(workshopParticipants.sessionId, id));

  const refunded: string[] = [];
  const alreadyShipped: string[] = [];
  const failed: string[] = [];
  /** Bilgilendirme e-postası gidecekler — YALNIZCA bu çağrıda iptal edilenler. */
  const notify: Array<{ fullName: string; email: string; refunded: boolean }> = [];

  for (const r of rows) {
    const disposition = participantCancelDisposition({
      orderId: r.orderId,
      orderStatus: r.orderStatus,
    });

    if (disposition === "no_payment") {
      // Ödemeye hiç gelmemiş katılımcı: iade edilecek para yok.
      const changed = await markParticipantCancelled(r.participantId, "Seans iptal edildi");
      if (changed) notify.push({ fullName: r.fullName, email: r.email, refunded: false });
      continue;
    }
    if (disposition === "already_shipped") {
      alreadyShipped.push(r.fullName);
      continue;
    }

    const res = await refundOrder({
      orderId: r.orderId!,
      reason: "Atölye seansı iptal edildi",
      adminEmail,
    }).catch(() => ({ ok: false, reason: "error" }) as const);

    if (res.ok || res.reason === "already_refunded") {
      const changed = await markParticipantCancelled(r.participantId, "Seans iptal edildi");
      if (changed) notify.push({ fullName: r.fullName, email: r.email, refunded: true });
      refunded.push(r.fullName);
    } else {
      failed.push(r.fullName);
    }
  }

  await db
    .update(workshopSessions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(workshopSessions.id, id));

  // Bilgilendirme e-postası YALNIZCA iadesi başarılı olan ve parası hiç
  // alınmamış katılımcılara gider — sevk edilmiş ve iadesi patlamış olanlara
  // GİTMEZ, onların durumu farklı ve admin'in eliyle çözülecek.
  await Promise.allSettled(
    notify.map((n) =>
      sendWorkshopSessionCancelledEmail({
        sessionId: id,
        fullName: n.fullName,
        email: n.email,
        refunded: n.refunded,
      })
    )
  );

  return { ok: true, report: { refunded, alreadyShipped, failed } };
}

/**
 * Tek bir katılımcıyı partiden çıkarır — kullanım: modelin yetişmeyeceği
 * anlaşıldı.
 *
 * Sevk edilmiş siparişte REDDEDER (`already_shipped`): figür yolda, admin
 * normal iade ekranını kullanır. İade patlarsa katılımcı `cancelled`
 * YAPILMAZ — geri ödenmemiş bir müşteri parası "iptal edildi" diye
 * görünmemeli.
 */
export async function cancelWorkshopParticipant(input: {
  sessionId: string;
  participantId: string;
  adminEmail: string;
}): Promise<CancelWorkshopParticipantResult> {
  const { sessionId, participantId, adminEmail } = input;

  const [row] = await db
    .select({
      participantId: workshopParticipants.id,
      sessionStatus: workshopSessions.status,
      orderId: orders.id,
      orderStatus: orders.status,
    })
    .from(workshopParticipants)
    .innerJoin(workshopSessions, eq(workshopParticipants.sessionId, workshopSessions.id))
    .leftJoin(orders, eq(workshopParticipants.orderId, orders.id))
    .where(
      and(
        eq(workshopParticipants.id, participantId),
        eq(workshopParticipants.sessionId, sessionId)
      )
    )
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };

  const disposition = participantCancelDisposition({
    orderId: row.orderId,
    orderStatus: row.orderStatus,
  });
  if (disposition === "already_shipped") {
    return { ok: false, reason: "already_shipped" };
  }

  let didRefund = false;
  if (disposition === "refund") {
    const res = await refundOrder({
      orderId: row.orderId!,
      reason: "Atölye katılımı iptal edildi",
      adminEmail,
    }).catch(() => ({ ok: false, reason: "error" }) as const);
    if (!res.ok && res.reason !== "already_refunded") {
      return { ok: false, reason: "refund_failed" };
    }
    didRefund = true;
  }

  const changed = await markParticipantCancelled(participantId, "Katılım iptal edildi");

  // Koltuk YALNIZCA seans hâlâ `open` iken havuza döner (bkz.
  // `seatReturnsToPool`) ve YALNIZCA katılımcı bu çağrıda gerçekten iptal
  // edildiyse — zaten iptal edilmiş birine tekrar çağrı yapmak `bookedCount`u
  // ikinci kez düşürür ve kontenjanı sessizce şişirirdi.
  const seatReleased = changed && seatReturnsToPool(row.sessionStatus);
  if (seatReleased) await releaseSeat(sessionId);

  return { ok: true, refunded: didRefund, seatReleased };
}
