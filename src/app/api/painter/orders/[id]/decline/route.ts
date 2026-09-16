import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterActions, manufacturerEarnings } from "@/lib/db/schema";
import { requireActivePainter } from "@/lib/services/painter-guard";
import { reverseEarning } from "@/lib/services/payouts";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { isRefunded } from "@/lib/config/order-status-policy";

// Painter declines an assigned job: the order reverts to the manufacturer's
// post-QC state (status 'quality_check', painter cleared) so the manufacturer
// can send it to another painter. The decliner is recorded so a later
// reassignment can skip them.
//
// A decline is cleanup, so it is never refused on a refunded job. But on a
// refunded order the detach is ALL that happens: the status is not rewound
// (refund-end-state) and the painter is not written to the order's blocklist —
// the job goes to no one else, so the record would only mark the painter.
// The manufacturer's notice changes too: a refunded order cannot be sent to
// another painter (send-to-painter answers 409), so asking them to do it
// would send them into a refusal.
// İade edilmiş siparişte bu koparmanın SİPARİŞ ÜSTÜNDEKİ tek izi. Boyacının
// kendi eylem günlüğüne bir `decline` satırı düşüyor (puana girmez), ama o satır
// boyacının siciline yazılır: siparişe bakan yönetici, işin neden boyacısız
// kaldığını sipariş sayfasında hiçbir yerde okuyamıyordu. Cümle üretici
// ikizleriyle (CANCEL_NOTE_REFUNDED / DECLINE_NOTE_REFUNDED) aynı kalıpta ve
// olanı söylüyor: sipariş üreticiye GERİ DÖNMEDİ.
const DECLINE_NOTE_REFUNDED =
  "[RET] Boyacı işi bıraktı — sipariş iade edilmiş olduğu için üreticinin kalite kontrol adımına GERİ DÖNMEDİ, iş kapandı. Boyacıya ceza uygulanmadı.";

// Boyacıya dönen dürüst cevap: iade edilmiş siparişte "başka bir boyacıya
// gönderilecek" ya da "üretici yeniden yönlendirecek" demek yalan olurdu.
const REFUNDED_DECLINE_MESSAGE =
  "Bu sipariş iade edilmiş. İşi bıraktınız ve iş listenizden düştü; başka bir boyacıya yönlendirilmeyecek ve bu bırakma güvenilirlik puanınıza işlenmedi.";

/**
 * Nereye kadar gelindi. Tek soru: KOPARMA YAZILDI MI? Beklenmeyen bir hatada
 * boyacıya ne diyeceğimizi bu ayrım belirler.
 */
type DeclineProgress = { detached: boolean };

async function handlePainterDecline(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: DeclineProgress
) {
  const g = await requireActivePainter();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;

  // Tek işlem, KİLİTLİ okuma: yükün iki alanı (durum ve kara liste) iade
  // durumuna bağlı, bu yüzden o durum okunduktan sonra yazılana kadar
  // değişmemeli. Kilitsiz ön okuma bu pencereyi açık bırakırdı.
  const outcome = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        orderNumber: orders.orderNumber,
        declinedPainterIds: orders.declinedPainterIds,
        painterStatus: orders.painterStatus,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.painterId, g.painterId)))
      .for("update");
    if (!existing || existing.painterStatus !== "assigned") {
      return { code: "not_declinable" as const };
    }

    const refunded = isRefunded(existing);
    const declined = Array.from(
      new Set([...(existing.declinedPainterIds ?? []), g.painterId])
    );

    const [updated] = await tx
      .update(orders)
      .set({
        painterId: null,
        painterStatus: "unassigned",
        assignedToPainterAt: null,
        sentToPainterAt: null,
        // İade edilmiş siparişte koparma HEPSİ budur: durum `quality_check`e
        // geri sarılmaz (iade edilen sipariş durumunu KORUR) ve boyacı kara
        // listeye yazılmaz — iş başka bir boyacıya zaten gönderilemeyecek, kayıt
        // yalnız bu boyacının siciline iz bırakırdı.
        ...(refunded
          ? {
              // Koparma dışında yapılan TEK şey: admin notu. Ceza değil kayıt —
              // puanlanan bir eylem satırı ya da kara liste yazmıyor, yalnızca
              // olan biteni yöneticinin baktığı yere yazıyor.
              adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${DECLINE_NOTE_REFUNDED} ELSE ${orders.adminNotes} || E'\n' || ${DECLINE_NOTE_REFUNDED} END`,
            }
          : { declinedPainterIds: declined, status: "quality_check" as const }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.painterId, g.painterId),
          eq(orders.painterStatus, "assigned")
        )
      )
      .returning({ id: orders.id });
    if (!updated) return { code: "lost_race" as const };

    // Boyacı eylem günlüğü işlemin İÇİNDE: koparma ile kaydı birbirinden
    // ayrılamaz. (Üretici tarafındaki `decline` satırının aksine bu satır bir
    // ceza değildir — boyacı sıralamasında puanlanmıyor — o yüzden iade edilmiş
    // siparişte de yazılır.)
    await tx
      .insert(painterActions)
      .values({ orderId: id, painterId: g.painterId, action: "decline", notes: reason });

    return {
      code: "ok" as const,
      refunded,
      manufacturerId: existing.manufacturerId,
      orderNumber: existing.orderNumber,
    };
  });

  if (outcome.code === "not_declinable") {
    return NextResponse.json(
      { error: "İş bulunamadı veya reddedilebilir durumda değil" },
      { status: 400 }
    );
  }
  if (outcome.code === "lost_race") {
    return NextResponse.json({ error: "İşlem başarısız" }, { status: 400 });
  }
  const { refunded, manufacturerId, orderNumber } = outcome;

  // Buradan sonrası "KOPARMA YAZILDI" dünyası: işlem commit oldu, iş boyacının
  // listesinden düştü. Aşağıdaki bir adım patlarsa boyacıya "reddedemediniz"
  // DENMEZ.
  progress.detached = true;

  // The manufacturer's PRINT-portion earning was accrued at hand-off
  // (send-to-painter). The hand-off just bounced, so back it out and clear the
  // row: otherwise the stale row would block a differently-amounted re-accrual —
  // a later in-house ship (full amount) or a re-hand-off (print portion) is
  // silently dropped by accrueEarning's onConflictDoNothing, underpaying the
  // manufacturer. reverseEarning detaches it from any pending payout + marks
  // non-paid rows 'reversed'; deleting those reversed rows lets the next
  // completing action accrue the correct amount cleanly. An already-'paid' row
  // is left untouched (a transfer can't be undone — a rare edge, logged).
  // Bu adım iade edilmiş siparişte de koşar ve kurala aykırı değildir: hakedişi
  // GERİ ALIR, yani partnere hiçbir şey BİRİKTİRMEZ.
  await reverseEarning(id).catch((e) =>
    console.error("reverseEarning (painter decline) failed", e)
  );
  await db
    .delete(manufacturerEarnings)
    .where(
      and(
        eq(manufacturerEarnings.orderId, id),
        eq(manufacturerEarnings.status, "reversed")
      )
    )
    .catch((e) => console.error("clear reversed earning (painter decline) failed", e));

  // Tell the manufacturer their painting hand-off bounced back for re-send, or,
  // on a refunded order, that nothing more is needed.
  if (manufacturerId) {
    await notifyManufacturer({
      manufacturerId,
      type: "system_announcement",
      subject: refunded
        ? `Boyacı işi reddetti — sipariş iade edildi (${orderNumber})`
        : "Boyacı işi reddetti",
      body: refunded
        ? `${orderNumber} numaralı sipariş için gönderdiğiniz boyama işi reddedildi. ` +
          `Sipariş müşteriye iade edildiği için başka bir boyacıya göndermeniz gerekmiyor; ` +
          `bu sipariş için yapmanız gereken başka bir işlem yok.`
        : `${orderNumber} numaralı sipariş için gönderdiğiniz boyama işi reddedildi. Lütfen başka bir boyacıya gönderin.`,
      orderId: id,
    }).catch((e) => console.error("notifyManufacturer (painter decline) failed", e));
  }

  return NextResponse.json({
    success: true,
    // Dürüst cevap: iade edilmiş siparişte iş kapandı, sipariş üreticinin
    // kuyruğuna geri konmadı. `message` panelde gösterilir (jobs-client ·
    // notice): kart listeden düştüğü için bu cümleyi taşıyan başka bir yer yok.
    ...(refunded
      ? { reason: "refunded" as const, message: REFUNDED_DECLINE_MESSAGE }
      : {}),
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * Üretici ikizlerinde ölçülen hâl burada da açıktı: bir okuma/yazma fırlarsa
 * Next'in varsayılan 500'üne düşülüyor ve boyacı paneline SIFIR BAYT gidiyordu
 * (panel o zaman kendi yedek cümlesini gösterir — ekranda ne olduğuna dair tek
 * kelime yoktur). İKİ HÂL ayrılır, çünkü boyacıya verilecek öğüt bu ayrıma
 * bağlıdır:
 *  • Koparma yazılmadan patladıysa işlem geri sarılır ve iş hâlâ boyacınındır;
 *    güvenle tekrar denenebilir.
 *  • Yazıldıktan sonra patladıysa (hakediş düzeltmesi, üretici bildirimi) iş
 *    ÇOKTAN düşmüştür; "tekrar deneyin" demek olmuş bir işi ikinci kez
 *    yaptırmaya çalışmak olurdu.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const progress: DeclineProgress = { detached: false };
  try {
    return await handlePainterDecline(request, ctx, progress);
  } catch (e) {
    console.error("boyacı reddi: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.detached
          ? "İşi bıraktınız ve iş listenizden düştü, ancak sonraki adımlar (üreticiye bildirim, hakediş düzeltmesi) tamamlanamadı. Liste sayfasını yenileyin; iş listenizde görünmüyorsa işlem tamamdır."
          : "Beklenmeyen bir hata nedeniyle işi bırakma kaydedilemedi; işte hiçbir şey değişmedi ve iş hâlâ sizde. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
