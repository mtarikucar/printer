/**
 * Atölye iptalleri — seansın tamamı ya da tek bir katılımcı.
 *
 * Mantık rotalarda DEĞİL burada yaşar (aynı gerekçe `order-refund.ts` için de
 * geçerli): para yolu tek olmalı, test edilebilmeli ve iki uç arasında
 * ayrışmamalı. Rotalar yalnızca yetki + HTTP eşlemesi yapar.
 *
 * Bir katılımcının iptalinin İKİ farklı çıkışı var ve ikisi de kapatılmak
 * zorunda:
 *  - PARASI ALINMIŞ (orderId dolu) → `refundOrder`; ikinci bir para yolu yok.
 *  - ÖDEMESİ SÜREN (draftId dolu, orderId boş) → `expireDraft`. Katılımcıyı
 *    `cancelled` yapmak TEK BAŞINA yetmez: taslak `pending` kaldığı sürece
 *    `promoteDraftToOrder` yalnızca taslağın durumuna bakar ve katılımcıyı
 *    süzgeçsiz `paid`e çevirir (order-draft.ts). Yani geciken bir PayTR
 *    webhook'u iptal edilmiş seansa gerçek bir ödeme bağlar, admin'in
 *    çıkardığı katılımcıyı diriltir ve bırakılmış koltuğu ikinci kez sayar.
 *    `expireDraft` taslağı atomik olarak `expired` yapar (sonraki terfi
 *    `DRAFT_NOT_PROMOTABLE` ile reddedilir), hediye kartını iade eder VE
 *    koltuğu `releaseSeatForDraft`'in tek işleminde bırakır — bu yüzden o yolda
 *    AYRICA koltuk bırakılmaz, yoksa sayaç iki kez düşerdi.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, workshopParticipants, workshopSessions } from "@/lib/db/schema";
import {
  participantCancelDisposition,
  seatReturnsToPool,
  sessionCancellable,
} from "@/lib/config/workshop";
import { refundOrder } from "@/lib/services/order-refund";
import { cancelParticipantSeat } from "@/lib/services/workshop-seat";
import { expireDraft } from "@/lib/services/order-draft";
import { sendWorkshopSessionCancelledEmail } from "@/lib/services/workshop-notify";
import { notifyManufacturerSessionCancelled } from "@/lib/services/workshop-manufacturer-notify";

/** Seans iptalinde katılımcıların isimle raporlanan kümeleri. */
export interface WorkshopSessionCancelReport {
  /** İadesi BU ÇAĞRIDA işleme alınan katılımcılar. */
  refunded: string[];
  /**
   * Parası zaten daha önce iade edilmiş katılımcılar. `refunded` ile
   * BİRLEŞTİRİLMEZ: idempotens açısından ikisi de başarı, ama para raporu
   * olarak birleştirmek, günler önce iade edilmiş insanları "iadesi şimdi
   * işleme alındı" diye göstermek olurdu.
   */
  alreadyRefunded: string[];
  /** Figürü yola çıkmış olduğu için OTOMATİK iade EDİLMEYEN katılımcılar. */
  alreadyShipped: string[];
  /** Çıkışı kapatılamayan katılımcılar — `cancelled` YAPILMADILAR, tekrar denenir. */
  failed: string[];
  /**
   * `refunded` ile aynı kişiler, ama SİPARİŞ NUMARASI ve TUTARLA.
   *
   * Neden ayrı bir alan: bu kod tabanında PayTR iade API'si YOK. `refundOrder`
   * defter durumunu yazar ve müşteriye "iadeniz işleme alındı" der; parayı
   * gerçekten geri gönderen adım, admin'in PayTR panelinde ELLE yaptığı
   * işlemdir. Tek siparişlik iadede bu görünür bir yük değil; 20 koltukluk bir
   * seansın toplu iptali ise tek tıkla 20 kişiye söz verip ~₺27.000'lik bir
   * yükümlülük yaratıyor. Ekranın bu listeyi KOPYALANABİLİR biçimde vermesi
   * için isim yetmez — PayTR'de aranacak şey sipariş numarasıdır.
   *
   * `refunded` (yalnız isim) BIRAKILDI: mevcut çağıranlar ve testler onu
   * okuyor, kırılmasının bir faydası yok.
   */
  refundedOrders: Array<{ fullName: string; orderNumber: string; amountKurus: number }>;
}

export type CancelWorkshopSessionResult =
  | { ok: true; report: WorkshopSessionCancelReport }
  | { ok: false; reason: "not_found" | "not_cancellable" };

export type CancelWorkshopParticipantResult =
  | { ok: true; refunded: boolean; seatReleased: boolean }
  | {
      ok: false;
      reason: "not_found" | "already_shipped" | "refund_failed" | "expire_failed";
    };

/** Bir katılımcının iptal edilirken okunması gereken asgari bağlamı. */
interface CancelRow {
  participantId: string;
  fullName: string;
  email: string;
  participantStatus: string;
  draftId: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderAmountKurus: number | null;
  orderStatus: string | null;
}

/**
 * Ödemesi süren katılımcının taslağını sonlandırır. `true` → çıkış kapandı.
 *
 * Hata FIRLATMAZ, `false` döner: bir katılımcının taslağı sonlandırılamadıysa
 * o kişi `cancelled` YAPILMAMALI (ödemesi hâlâ tamamlanabilir) ve isimle
 * raporlanmalı — Karar 3'ün başarısız iade için koyduğu ilkenin aynısı.
 */
async function endPendingDraft(
  draftId: string,
  reason: { failure: string; cancel: string }
): Promise<boolean> {
  try {
    await expireDraft(draftId, {
      failureReason: reason.failure,
      cancelReason: reason.cancel,
      // "Koltuğunuz serbest bırakıldı, tekrar katılabilirsiniz" maili iptal
      // edilmiş bir seansa davet anlamına gelirdi. Katılımcı bunun yerine
      // iptal mailini alır (seans iptali) ya da hiç mail almaz (tek katılımcı
      // iptali — admin kişiyi kendi bilerek çıkarıyor).
      notifySeatReleased: false,
    });
    return true;
  } catch (e) {
    console.error(`workshop cancel: expireDraft ${draftId} başarısız`, e);
    return false;
  }
}

/**
 * Seansın tamamını iptal eder: ödemiş katılımcıların parası iade edilir,
 * ödemesi süren katılımcıların taslağı sonlandırılır, seans `cancelled` olur.
 *
 * SEVK EDİLMİŞ sipariş otomatik iade EDİLMEZ (figür fiziksel olarak var ve
 * yola çıktı; otomatik iade ürünü bedava vermek olurdu) — isimleriyle
 * raporlanır, admin normal iade ekranından tek tek halleder.
 *
 * BAŞARISIZ çıkış sessizce yutulmaz: iadesi (ya da taslak sonlandırması)
 * patlayan katılımcı `cancelled` YAPILMAZ ve isimle raporlanır. Seans yine de
 * `cancelled` olur (etkinlik iptal edildi — bu dünyaya dair bir gerçek, paraya
 * dair değil). Bu yüzden fonksiyon İDEMPOTENTTİR: zaten `cancelled` bir
 * seansta da çalışır ve yalnızca geride kalanları yeniden dener.
 *
 * `delivered`/`completed` seans REDDEDİLİR — bkz. `sessionCancellable`.
 */
export async function cancelWorkshopSession(input: {
  sessionId: string;
  adminEmail: string;
}): Promise<CancelWorkshopSessionResult> {
  const { sessionId: id, adminEmail } = input;

  const session = await db.query.workshopSessions.findFirst({
    where: eq(workshopSessions.id, id),
    columns: { id: true, status: true, manufacturerId: true },
  });
  if (!session) return { ok: false, reason: "not_found" };
  if (!sessionCancellable(session.status)) {
    return { ok: false, reason: "not_cancellable" };
  }

  // Seans zaten iptalse de çalışır: bu yol aynı zamanda başarısız çıkışların
  // yeniden deneme yoludur.
  const rows: CancelRow[] = await db
    .select({
      participantId: workshopParticipants.id,
      fullName: workshopParticipants.fullName,
      email: workshopParticipants.email,
      participantStatus: workshopParticipants.status,
      draftId: workshopParticipants.draftId,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      orderAmountKurus: orders.amountKurus,
      orderStatus: orders.status,
    })
    .from(workshopParticipants)
    .leftJoin(orders, eq(workshopParticipants.orderId, orders.id))
    .where(eq(workshopParticipants.sessionId, id));

  const refunded: string[] = [];
  const refundedOrders: WorkshopSessionCancelReport["refundedOrders"] = [];
  const alreadyRefunded: string[] = [];
  const alreadyShipped: string[] = [];
  const failed: string[] = [];
  // `failed` iki farklı hatayı taşır: iadesi tutmayan SİPARİŞ ve kapatılamayan
  // ödemesiz TASLAK. Üreticinin kuyruğunda yalnızca birincisi durur — ikincisi
  // hiç sipariş olmadı. Üreticiye giden sayı bu yüzden ayrı tutulur.
  let refundFailedCount = 0;
  /** Bilgilendirme e-postası gidecekler — YALNIZCA bu çağrıda iptal edilenler. */
  const notify: Array<{ participantId: string; refunded: boolean }> = [];

  for (const r of rows) {
    const disposition = participantCancelDisposition({
      orderId: r.orderId,
      orderStatus: r.orderStatus,
    });

    if (disposition === "no_payment") {
      // Ödemeye hiç gelmemiş katılımcı: iade edilecek para yok — ama ödemesi
      // SÜRÜYOR olabilir; taslağı kapatmadan onu `cancelled` yapmak, geciken
      // bir ödemenin iptal edilmiş seansa sipariş bağlamasına kapı bırakır.
      if (r.draftId) {
        const ended = await endPendingDraft(r.draftId, {
          failure: "Atölye seansı iptal edildi",
          cancel: "Seans iptal edildi",
        });
        if (!ended) {
          failed.push(r.fullName);
          continue;
        }
      }
      // Koltuk BURADA bırakılmaz: taslaklı yolda `expireDraft` zaten bıraktı,
      // taslaksız yolda ise seans ölü olduğu için sayacın anlamı kalmadı.
      // (Güvenlik ağı: `expireDraft` katılımcı `pending_payment` değilse onu
      // iptal etmez; bu çağrı postkoşulu her hâlükârda sağlar.)
      await cancelParticipantSeat(r.participantId, "Seans iptal edildi", {
        releaseSeat: false,
      });
      // E-posta kararı BURADA koşullu UPDATE'in dönüşüne bakamaz: taslaklı
      // yolda katılımcıyı zaten `expireDraft` iptal etti, dolayısıyla yukarıdaki
      // güvenlik ağı `false` döner. Çağrı ÖNCESİNDEKİ duruma bakılır; en kötü
      // ihtimalle iki eşzamanlı iptal aynı kişiye iki mail gönderir (admin
      // eylemi, pratikte yarışmaz), sessizce mail göndermemekten iyidir.
      if (r.participantStatus !== "cancelled") {
        notify.push({ participantId: r.participantId, refunded: false });
      }
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

    if (!res.ok && res.reason !== "already_refunded") {
      failed.push(r.fullName);
      refundFailedCount += 1;
      continue;
    }

    const changed = await cancelParticipantSeat(r.participantId, "Seans iptal edildi", {
      releaseSeat: false,
    });
    if (changed) notify.push({ participantId: r.participantId, refunded: true });
    if (res.ok) {
      refunded.push(r.fullName);
      // PayTR tarafında ELLE yapılacak iadenin iş listesi. Yalnızca BU çağrıda
      // gerçekten iade işlenenler: `alreadyRefunded` bir önceki çağrıda zaten
      // raporlanmıştı, ikinci kez yükümlülük gibi göstermek yanlış olurdu.
      refundedOrders.push({
        fullName: r.fullName,
        orderNumber: r.orderNumber ?? "—",
        amountKurus: r.orderAmountKurus ?? 0,
      });
    } else alreadyRefunded.push(r.fullName);
  }

  await db
    .update(workshopSessions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(workshopSessions.id, id));

  // Bilgilendirme e-postası YALNIZCA bu çağrıda iptal edilenlere gider —
  // sevk edilmiş ve çıkışı patlamış olanlara GİTMEZ (durumları farklı ve
  // admin'in eliyle çözülecek), zaten iptal edilmiş olanlara da ikinci kez
  // gitmez.
  const byId = new Map(rows.map((r) => [r.participantId, r]));
  await Promise.allSettled(
    notify.map((n) => {
      const r = byId.get(n.participantId)!;
      return sendWorkshopSessionCancelledEmail({
        sessionId: id,
        fullName: r.fullName,
        email: r.email,
        refunded: n.refunded,
      });
    })
  );

  // Üretici de haber almalı: `refundOrder` her siparişin `manufacturerId`sini
  // NULL yapıyor, yani parti üreticinin kuyruğundan sessizce buharlaşıyor.
  // Üretici bu tarih için kapasite ayırmıştı; haber vermemek ona gerçek slot
  // kaybettirir. Yalnızca ön rezerve bir üretici varsa gider ve kendi hatasını
  // yutar.
  // Yalnızca seansı GERÇEKTEN bu çağrı iptal ettiyse. Bu uç aynı zamanda
  // başarısız iadelerin yeniden deneme yolu; her denemede üreticiye yeni bir
  // panel satırı + e-posta göndermek onu aynı iptalle defalarca rahatsız eder.
  if (session.manufacturerId && session.status !== "cancelled") {
    await notifyManufacturerSessionCancelled(id, {
      refundedCount: refunded.length + alreadyRefunded.length,
      leftWithManufacturerCount: alreadyShipped.length + refundFailedCount,
    });
  }

  return {
    ok: true,
    report: { refunded, alreadyRefunded, alreadyShipped, failed, refundedOrders },
  };
}

/**
 * Tek bir katılımcıyı partiden çıkarır — kullanım: modelin yetişmeyeceği
 * anlaşıldı.
 *
 * Sevk edilmiş siparişte REDDEDER (`already_shipped`): figür yolda, admin
 * normal iade ekranını kullanır. İade ya da taslak sonlandırma patlarsa
 * katılımcı `cancelled` YAPILMAZ — geri ödenmemiş (ya da hâlâ ödenebilir) bir
 * katılım "iptal edildi" diye görünmemeli.
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
      participantStatus: workshopParticipants.status,
      draftId: workshopParticipants.draftId,
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

  // Ödemesi süren katılımcı: taslak kapatılmadan iptal, geciken bir ödemenin
  // iptal edilmiş katılımı diriltmesine kapı bırakır (bkz. dosya başlığı).
  if (disposition === "no_payment" && row.draftId) {
    const ended = await endPendingDraft(row.draftId, {
      failure: "Atölye katılımı iptal edildi",
      cancel: "Katılım iptal edildi",
    });
    if (!ended) return { ok: false, reason: "expire_failed" };

    // Koltuk `expireDraft` içinde, `releaseSeatForDraft`'in TEK işleminde
    // bırakıldı — burada tekrar bırakmak sayacı iki kez düşürürdü. O yol
    // koltuğu seansın durumundan bağımsız bırakır; sakıncası yok, çünkü
    // donmuş komisyon oranı `bookedCount`tan değil ÖDENMİŞ sipariş adedinden
    // türer (bkz. closeSession) ve kapanmış bir seans zaten katılım almaz.
    // Güvenlik ağı: `expireDraft` katılımcıyı yalnızca `pending_payment` iken
    // iptal eder; bu çağrı "katılımcı `cancelled` biter" postkoşulunu her
    // hâlükârda sağlar ve sayaca dokunmaz.
    await cancelParticipantSeat(participantId, "Katılım iptal edildi", {
      releaseSeat: false,
    });
    return {
      ok: true,
      refunded: false,
      // Koltuğu `releaseSeatForDraft`'in koşullu UPDATE'i yalnızca katılımcı
      // hâlâ `pending_payment` iken bırakır; rapor bunu yansıtır.
      seatReleased: row.participantStatus === "pending_payment",
    };
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

  // Koltuk YALNIZCA seans hâlâ `open` iken havuza döner (bkz.
  // `seatReturnsToPool`) ve YALNIZCA katılımcı bu çağrıda gerçekten iptal
  // edildiyse — ikisi de `cancelParticipantSeat`in TEK işleminde karara
  // bağlanır, aradaki bir çökme koltuğu kaybettirmesin diye.
  const wantSeat = seatReturnsToPool(row.sessionStatus);
  const changed = await cancelParticipantSeat(participantId, "Katılım iptal edildi", {
    releaseSeat: wantSeat,
  });

  return { ok: true, refunded: didRefund, seatReleased: changed && wantSeat };
}
