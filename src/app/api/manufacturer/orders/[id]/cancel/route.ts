import { NextRequest, NextResponse } from "next/server";
import { eq, and, or, sql, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { applyStrike, strikeSkipNoticeTr } from "@/lib/services/strikes";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { getEmailQueue } from "@/lib/queue/queues";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";
import { isRefunded } from "@/lib/config/order-status-policy";

// Manufacturer cancels an order they already accepted (printer broke, out of
// material, etc.). Unlike "decline" (only allowed while `assigned`), this is
// post-acceptance: the order returns to the admin queue (unassigned), the
// manufacturer is skipped on reassignment, a strike is recorded, and qcRound is
// bumped so any QC photos they uploaded don't leak to the next manufacturer.
//
// İADE EDİLMİŞ SİPARİŞTE BUNLARIN HEPSİ DÜŞER. Orada iptal bir TEMİZLİKTİR:
// sipariş üreticiden koparılır ve BAŞKA HİÇBİR ŞEY yapılmaz. Durum geri
// sarılmaz (refund-end-state), güvenilirlik cezası yazılmaz, kara listeye kayıt
// düşülmez ve üreticiye "sipariş yeniden atanacak" denmez — iade edilmiş
// siparişi hiçbir atama yolu kabul etmiyor. Kuralın tek kaynağı:
// src/lib/config/order-status-policy.ts.
const CANCELLABLE = [
  "accepted",
  "printing",
  "printed",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
] as const;

// Tek kaynak: aynı metin SQL CASE'in iki dalında da geçiyor. "Manuel atama
// gerekli" demiyor, çünkü sipariş artık kuyruğa girer girmez otomatik atamaya
// sokuluyor; yerleştirme yapılamazsa [ATAMA] notunu autoAssignIfEligible yazar.
const CANCEL_NOTE =
  "[İPTAL] Üretici kabul sonrası iptal etti — sipariş atama kuyruğuna döndü.";

// İade edilmiş siparişin notu AYRI, çünkü olan biten de ayrı: sipariş kuyruğa
// DÖNMEZ. Aynı cümleyi yazmak, admin'i var olmayan bir kuyruk satırını aramaya
// yollardı. Puana giren eylem satırı bu durumda yazılmadığı için (aşağıya
// bakın) üreticinin işi bıraktığının kalıcı kaydı bu nottur.
const CANCEL_NOTE_REFUNDED =
  "[İPTAL] Üretici kabul sonrası işi bıraktı — sipariş iade edilmiş olduğu için atama kuyruğuna DÖNMEDİ, iş kapandı. Güvenilirlik cezası uygulanmadı.";

// Üreticiye dönen cevap: iade edilmiş siparişte "kuyruğa döndü / yeniden
// atanacak" demek yalan olurdu.
const REFUNDED_CANCEL_MESSAGE =
  "Bu sipariş iade edilmiş. İşi bıraktınız ve sipariş panelinizden düştü; başka bir üreticiye yönlendirilmeyecek ve bu iptal güvenilirlik puanınıza işlenmedi.";

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Nereye kadar gelindi. Tek soru: İPTAL YAZILDI MI? Beklenmeyen bir hatada
  // atölyeye ne diyeceğimizi bu ayrım belirler. (Rota BÖLÜNMÜYOR: otomatik
  // atama tetikleyicisinin POST'un İÇİNDE durduğu scripts/test-auto-assign.ts
  // tarafından pinlenmiş durumda.)
  let cancelled = false;
  try {
    const session = await getManufacturerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
      columns: { status: true, companyName: true },
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : undefined;

    // Tek işlem, KİLİTLİ okuma: yükü (durum geri sarma, kara liste, yeni QC turu)
    // iade durumu belirliyor, bu yüzden o durumun okunması ile yazılması arasına
    // bir iade giremez. Kilitsiz bir ön okuma bunu kapatmazdı: araya düşen iade,
    // siparişi yine `approved` + atanmamış hâle sokan yükün işlenmesi demekti.
    const outcome = await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          declinedManufacturerIds: orders.declinedManufacturerIds,
          painterStatus: orders.painterStatus,
          paymentStatus: orders.paymentStatus,
        })
        .from(orders)
        .where(
          and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId))
        )
        .for("update");
      if (!order) return { code: "not_found" as const };

      // Once the order has been handed off to a painter, the manufacturer's print +
      // QC work is already done and their print-portion earning has accrued. Letting
      // them "cancel" now would fork the order (the painter still holds it while it
      // re-enters the admin queue) AND strand a payable earning on the abandoning
      // manufacturer while the UNIQUE(orderId) constraint zeroes out the replacement
      // manufacturer's accrual. So cancel is only valid before hand-off — a bounced
      // painting job comes back through the painter's own decline flow instead.
      const handedToPainter =
        order.painterStatus != null && order.painterStatus !== "unassigned";
      if (handedToPainter) return { code: "handed_to_painter" as const };

      const refunded = isRefunded(order);
      const declined = Array.isArray(order.declinedManufacturerIds)
        ? (order.declinedManufacturerIds as string[])
        : [];
      const note = refunded ? CANCEL_NOTE_REFUNDED : CANCEL_NOTE;

      const [updated] = await tx
        .update(orders)
        .set({
          manufacturerId: null,
          manufacturerStatus: "unassigned",
          assignedToManufacturerAt: null,
          manufacturerAcceptedAt: null,
          // İade edilmiş siparişte koparma HEPSİ budur:
          //  • durum geri sarılmaz — iade edilen sipariş durumunu KORUR,
          //  • kara listeye kayıt düşülmez — sipariş zaten kimseye verilmeyecek,
          //    kayıt yalnız atölyenin siciline iz bırakırdı,
          //  • yeni QC turu açılmaz — fotoğrafların sızacağı bir "sıradaki
          //    üretici" yok.
          ...(refunded
            ? {}
            : {
                status: "approved" as const,
                declinedManufacturerIds: Array.from(
                  new Set([...declined, session.manufacturerId])
                ),
                // Fresh QC round for the next manufacturer; prior photos stay as audit.
                qcRound: sql`${orders.qcRound} + 1`,
              }),
          // Durable admin flag so the order is visibly back in the manual queue even
          // if ADMIN_EMAIL is unset / the alert email fails (mirrors decline's N12
          // adminNotes). Append, don't overwrite a concurrent note.
          adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, id),
            eq(orders.manufacturerId, session.manufacturerId),
            inArray(orders.manufacturerStatus, [...CANCELLABLE]),
            // Race-safe mirror of the hand-off guard above: never cancel an order a
            // painter is (or was) actively holding.
            or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
          )
        )
        .returning();
      if (!updated) return { code: "not_cancellable" as const };

      // Puana giren eylem satırı. İade edilmiş siparişte YAZILMAZ:
      // `cancel_after_accept` güvenilirlik puanını düşüren eylemlerden biridir
      // (manufacturer-assignment.ts BAD_ACTIONS) ve parası zaten geri verilmiş bir
      // işi bırakan atölyeyi cezalandırmak olurdu. Kayıt kaybolmaz: yukarıdaki
      // [İPTAL] notu aynı olayı admin'in gördüğü yere yazar.
      if (!refunded) {
        await tx.insert(manufacturerActions).values({
          orderId: id,
          manufacturerId: session.manufacturerId,
          action: "cancel_after_accept",
          notes: reason ?? null,
        });
      }

      return { code: "ok" as const, refunded, updated };
    });

    if (outcome.code === "not_found") {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (outcome.code === "handed_to_painter") {
      return NextResponse.json(
        { error: "Bu sipariş boyacıya devredildi; artık iptal edilemez." },
        { status: 400 }
      );
    }
    if (outcome.code === "not_cancellable") {
      return NextResponse.json(
        { error: "Order is not in a cancellable status" },
        { status: 400 }
      );
    }
    const { refunded, updated } = outcome;

    // Buradan sonrası "İPTAL YAZILDI" dünyası: kilitli işlem commit oldu,
    // sipariş atölyeden koptu. Aşağıdaki bir adım patlarsa atölyeye "iptal
    // edilemedi" DENMEZ.
    cancelled = true;

    // Reliability strike — auto-suspends past the threshold (Faz 3). İade edilmiş
    // siparişte uygulanmaz: ceza, "alınan işi yarıda bırakmak"ın bedelidir; iade
    // edilmiş bir siparişte bırakılacak iş kalmamıştır ve ceza, eşiğe gelmiş bir
    // atölyeyi yapmadığı bir hatadan askıya aldırabilirdi.
    //
    // İKİ KATMAN, boyacı ikiziyle (revoke-painter) aynı:
    //  • buradaki `!refunded` kapısı — kilitli işlemde okunan iade durumu;
    //  • `orderId` — onsuz strikes.ts'in KENDİ iade kapısı hiç çalışmıyordu
    //    (yalnız `opts.orderId` verildiğinde açılır) ve yukarıdaki okuma ile
    //    cezanın yazıldığı an arasına düşen bir iade cezayı yine yazdırırdı.
    //
    // SONUÇ ATILMAZ. Ceza istendiği hâlde yazılmadıysa (araya giren iade,
    // okunamayan sipariş, bulunamayan atölye, yazma hatası) bunu kimse
    // öğrenemiyordu: `StrikeOutcome` olduğu gibi çöpe gidiyor, cevap yalnız
    // "success" diyordu. Cümle tek kaynaktan (strikes.ts · STRIKE_SKIP_LABELS_TR)
    // gelir ve cevabın gövdesine konur — ekran göstermese bile cevabın kendisi
    // olan biteni doğru anlatır (bu rotanın zaten kendi kuralı).
    //
    // `.catch` bilerek: ceza son adım DEĞİL. Fırlatmasına izin vermek, iptal
    // yazılmışken atölyeye "sonraki adımlar tamamlanamadı" dedirtir ve canlı
    // yayın, admin e-postası, otomatik yerleştirme hiç çalışmazdı.
    let strikeApplied = false;
    let strikeNoticeTr: string | null = null;
    if (!refunded) {
      const strikeOutcome = await applyStrike(session.manufacturerId, {
        orderId: id,
      }).catch((e) => {
        console.error("üretici iptali: applyStrike patladı", e);
        return null;
      });
      if (!strikeOutcome) {
        strikeNoticeTr = strikeSkipNoticeTr("write_failed");
      } else if (strikeOutcome.skipped) {
        strikeNoticeTr = strikeSkipNoticeTr(strikeOutcome.skipped);
      } else {
        strikeApplied = true;
      }
    } else {
      strikeNoticeTr = strikeSkipNoticeTr("refunded");
    }

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
    });

    // Alert admin by email — admin has no inbox; the realtime emit above already
    // returns the order to the admin queue live, this adds the offline reach.
    //
    // İADE EDİLMİŞ SİPARİŞTE GÖNDERİLMEZ. Şablonun cümlesi sabit ve burada olanın
    // TAM TERSİ: "Sipariş yeniden atama için yönetici kuyruğuna döndü"
    // (email.ts → manufacturer_cancelled). Oysa iade edilmiş sipariş kuyruğa
    // DÖNMEDİ, iş kapandı — bu e-posta admin'i var olmayan bir kuyruk satırını
    // aramaya yollardı, üstelik yukarıdaki [İPTAL] notu ve kilitli işlemdeki
    // koparma tam tersini kaydetmişken. Kural gereği ya doğrusu söylenir ya
    // hiçbir şey: olayın kalıcı kaydı zaten siparişin üstündeki
    // CANCEL_NOTE_REFUNDED notu ve canlı yayın (emitOrderChanged). Şablona bir
    // iade dalı eklenirse burası onu çağırabilir.
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && !refunded) {
      await getEmailQueue()
        .add("manufacturer-cancelled", {
          type: "manufacturer_cancelled",
          to: adminEmail,
          adminEmail,
          orderNumber: updated.orderNumber,
          customerName: manufacturer.companyName,
          companyName: manufacturer.companyName,
          cancelReason: reason,
          locale: "tr",
        })
        .catch((e) => console.error("manufacturer-cancelled email enqueue failed", e));
    }

    // İptal, siparişi "onaylı + atanmamış" hâline sokan geçişlerden biridir —
    // yani otomatik atamanın tetiklendiği yerlerden. Bu olmadan üretici iptal
    // ettiğinde sipariş, sahibi fark edene kadar kimsenin tezgâhında olmadan
    // beklerdi. Kapılar (tür anahtarı, iade, basılabilir içerik) fonksiyonun
    // kendi içinde; burada yalnız iptal eden atölyenin dışlanması var.
    //
    // İade edilmiş siparişte de KOŞULSUZ çağrılır ve bu güvenlidir: satır kapısı
    // (autoAssignRowGate) iadeyi kendisi eliyor, `skipped: "refunded"` dönüyor —
    // ne yerleştirme yapılır ne not yazılır. Koşulu buraya kopyalamak, kapının
    // tek yerde durması kuralını bozardı.
    const placement = await autoAssignIfEligible(id, {
      reason: "üretici kabul sonrası iptal etti",
      excludeManufacturerIds: [session.manufacturerId],
    });

    return NextResponse.json({
      success: true,
      autoAssigned: placement.assigned,
      // Ceza gerçekten yazıldı mı, yazılmadıysa NEDEN. Atölyeye kendi
      // siparişinde olan bitenin doğrusu söylenir.
      strikeApplied,
      ...(strikeNoticeTr ? { strikeWarning: strikeNoticeTr } : {}),
      ...(placement.skipped ? { autoAssignSkipped: placement.skipped } : {}),
      // Ne olduğunu söyleyen dürüst cevap: sipariş kuyruğa dönmedi, ceza da
      // yazılmadı. Ekran bu alanları göstermezse bile cevabın kendisi yalan
      // söylememeli.
      ...(refunded
        ? { reason: "refunded" as const, message: REFUNDED_CANCEL_MESSAGE }
        : {}),
    });
  } catch (e) {
    // Beklenmeyen hata = GÖVDESİ OLAN cevap.
    //
    // QA'da ölçülen hâl: eylem günlüğü yazılamazken iptal işlemi patlıyor,
    // Next'in varsayılan 500'üne düşülüyor ve atölyeye SIFIR BAYT gidiyordu.
    // Güvenli taraf doğruydu (işlem geri sarıldı, sipariş el değmedi) ama panel
    // ekranda tek kelime gösteremiyordu: atölyenin iade/arıza sırasındaki TEK
    // çıkışı, basılabilir ama alınamayan bir düğmeye dönüşüyordu.
    //
    // İKİ HÂL ayrılır, çünkü atölyeye verilecek öğüt buna bağlıdır:
    //  • İptal yazılmadan patladıysa işlem geri sarılır ve iş hâlâ atölyededir;
    //    güvenle tekrar denenebilir.
    //  • Yazıldıktan sonra patladıysa (ceza, canlı yayın, admin e-postası,
    //    otomatik yerleştirme) sipariş ÇOKTAN düşmüştür; "tekrar deneyin" demek
    //    olmuş bir işi ikinci kez yaptırmaya çalışmak olurdu.
    console.error("üretici iptali: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: cancelled
          ? "İptal kaydedildi ve sipariş panelinizden düştü, ancak sonraki adımlar (bildirim, yeniden atama) tamamlanamadı. Sipariş listenizi yenileyin; sipariş listenizde görünmüyorsa işlem tamamdır."
          : "Beklenmeyen bir hata nedeniyle sipariş iptal edilemedi; siparişte hiçbir şey değişmedi ve iş hâlâ sizde. Birkaç dakika sonra tekrar deneyin, sorun sürerse yöneticiye bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
