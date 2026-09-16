import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, qcPhotos, qcReviews } from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { isOrderRefunded, notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { currentOrderModelRevision } from "@/lib/services/order-model-revision";
import {
  QC_PROOF_FAILURE_LABEL_TR,
  qcPhotosMatchCurrentRevision,
  qcRoundPrintProof,
  qcRoundProofErrorTr,
  type QcRoundProof,
} from "@/lib/config/order-model-policy";
import {
  STALE_QC_OVERRIDE_REASON_ERROR,
  STALE_QC_OVERRIDE_REASON_MIN,
  STALE_QC_REVISION_CODE,
  staleQcRevisionErrorTr,
} from "@/lib/config/partner-model-ack";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Turun fotoğraf tablosu OKUNAMADIĞINDA dönen cümle.
 *
 * Ekranın kendi şeridi (admin/orders/[id]/client.tsx · readFailures.qcPhotos)
 * aynı arızayı aynı sözlerle anlatır: tur "fotoğrafsız" DEĞİL, "bilinmiyor".
 * İkisi ayrışırsa admin, kartta okuduğunun tersini düğmede duyar.
 */
const QC_PHOTOS_UNREADABLE_ERROR =
  "Bu turun QC fotoğrafları şu anda okunamadı (geçici sistem arızası): tur FOTOĞRAFSIZ DEĞİL, " +
  "kaç fotoğraf olduğu ve hangi sürümü gösterdikleri bilinmiyor. Kanıt görülemediği için onay " +
  "verilmedi, hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin; yine de onaylayacaksanız " +
  "gerekçeli onayı kullanın.";

/** Denetim kaydında bu hâlin adı (QC_PROOF_FAILURE_LABEL_TR'nin kardeşi). */
const QC_PHOTOS_UNREADABLE_LABEL = "QC fotoğrafları okunamadı";

/**
 * Onay VERİLDİ ama tur fotoğraflarının durumu damgalanamadı.
 *
 * Yalnız yönetici günlüğüne düşer: bu bir iç arıza kaydıdır, üreticinin okuduğu
 * QC gerekçesi değil.
 */
const QC_PHOTO_STAMP_FAILED_NOTE =
  "[Sistem notu] QC fotoğraflarının durumu güncellenemedi (tablo okunamadı): onay VERİLDİ ve " +
  "kargo açıldı, ancak turun fotoğraf satırları \"bekliyor\" görünmeye devam edebilir.";

/**
 * Onayın GEREKÇE KAYDI yazılamadığında dönen cümle.
 *
 * "Hiçbir şey değişmedi" diyebiliyor, çünkü karar satırı ile durum yazması TEK
 * işlemdir: kayıt düşerse UPDATE de geri sarılır. Bu cümlenin doğruluğu o
 * işlemin bütünlüğüne bağlıdır — ikisi ayrılırsa cümle yalan söylemeye başlar.
 */
const QC_DECISION_UNRECORDED_ERROR =
  "QC kararı kaydedilemedi (geçici sistem arızası): onay UYGULANMADI, sipariş QC beklemede kaldı " +
  "ve hiçbir şey değişmedi. Birkaç dakika sonra tekrar deneyin.";

// Admin approves the submitted QC photos → qc_approved (unlocks shipping).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email;
    const { id } = await params;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        manufacturerStatus: true,
        qcRound: true,
        manufacturerId: true,
        orderNumber: true,
        userId: true,
        paymentStatus: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    // Approving QC unlocks shipping, and shipping accrues a fresh earning. A
    // refunded order that still has its manufacturer attached stops here.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }

    const next = qcNextStatus(
      (order.manufacturerStatus ?? "") as ManufacturerOrderStatus,
      "approve"
    );
    if (!next) {
      return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
    }

    // ── KANITLANAMAYAN TUR QC'DEN GEÇEMEZ (migration 0055) ──────────────────
    //
    // QC onayı kargonun kapısıdır ve kargo partner hakedişini tahakkuk ettirir;
    // bu yüzden "hangi modelin baskısı onaylanıyor" sorusunun cevabı sunucuda
    // verilmek zorunda. Yeni bir sürüm QC'yi sıfırlar ama üretici yeni turda da
    // ESKİ baskının fotoğraflarını yükleyebilir: fotoğrafın yüklenirken aldığı
    // sürüm damgası bu ikisini ayırt eder.
    //
    // KURAL FAIL-CLOSED: damgasız fotoğraf "eski değil" DEĞİL, "bilinmiyor"
    // demektir. Eskiden damgasızlık kapıdan geçiyordu ve bu, kapıyı silinebilir
    // yapıyordu: 0055'in geri alınması bütün damgaları düşürüp bayat baskıların
    // kilidini açıyordu. Artık kanıtlanamayan tur (eski damga, damgasız tur,
    // fotoğrafsız tur, sürümü okunamayan sipariş) kendiliğinden onaylanmaz.
    //
    // Bilinçli istisna kapalı değil ama BEDAVA da değil: gerekçe zorunlu, gerekçe
    // ve onaylayan denetim kaydına yazılır. Ret ve not, verinin SÖYLEDİĞİNDEN
    // fazlasını iddia etmez — damgasız tura "eski baskı" denmez.
    const body = (await request.json().catch(() => ({}))) as {
      overrideStaleRevision?: unknown;
      overrideReason?: unknown;
    };
    // FOTOĞRAF TABLOSU OKUNAMAZSA TUR "FOTOĞRAFSIZ" DEĞİL, "BİLİNMİYOR".
    //
    // Bu okuma try'sızdı ve tam da ekranın gerekçeli onayı AÇTIĞI arızada
    // (qc_photos okunamıyor) fırlıyordu: sayfa tarafındaki okuma displayRead ile
    // korunduğu için kart düz "Onayla"yı kaldırıp "Yine de onayla" düğmesini
    // açıyor, o düğmenin ucu ise gövdesiz bir 500'e düşüyordu — ekranın sunduğu
    // TEK çıkış, çalışamayan çıkıştı. Kapı yine KAPALI tarafa çekilir (aşağıdaki
    // isStale); değişen, kapının artık CEVAP vermesi ve sebebini adıyla
    // söylemesidir.
    let roundPhotos: { modelRevision: number | null }[] = [];
    let photosReadFailed = false;
    try {
      roundPhotos = await db
        .select({ modelRevision: qcPhotos.modelRevision })
        .from(qcPhotos)
        .where(and(eq(qcPhotos.orderId, id), eq(qcPhotos.round, order.qcRound)));
    } catch (e) {
      console.error("qc-approve: turun QC fotoğrafları okunamadı", e);
      photosReadFailed = true;
    }
    // Sürüm okunamazsa "sürüm yok" (null) sayılmaz — bu ikisi farklı şeydir ve
    // null, kıyaslanacak bir şey olmadığı için turu SERBEST bırakırdı. Okuma
    // arızası bilinmezliktir: kapı kapalı tarafa çekilir. (Eskiden bu satır
    // try'sızdı ve arıza, admin'e boş gövdeli 500 olarak dönüyordu.)
    let currentRevision: number | null = null;
    let revisionReadFailed = false;
    try {
      currentRevision = await currentOrderModelRevision(id);
    } catch (e) {
      console.error("qc-approve: güncel model sürümü okunamadı", e);
      revisionReadFailed = true;
    }
    const proof: QcRoundProof = qcRoundPrintProof({
      photos: roundPhotos,
      currentRevision,
      revisionReadFailed,
    });
    // Kapı, admin EKRANIYLA ortaktır: sayfa da aynı turu
    // qcPhotosMatchCurrentRevision ile süzüyor (admin/orders/[id]/page.tsx ·
    // qcRevisionMismatch) ve o boole, proof.proven'in ta kendisidir — uç
    // ekrandan daha hoşgörülü olamaz. `proof` yalnız SEBEBİ taşır.
    // Okunamayan fotoğraf KANIT DEĞİLDİR: boş liste "kanıt yok" diye geçerdi.
    const isStale =
      photosReadFailed ||
      revisionReadFailed ||
      !qcPhotosMatchCurrentRevision(roundPhotos, currentRevision);
    // Uyarıda gösterilen sürüm, turun EN ESKİ damgasıdır: sorunu doğuran o.
    const stalePhotoRevision = proof.oldestStampedRevision;
    const overrideReason =
      typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
    let staleOverrideNote: string | null = null;
    // Üreticiye giden bildirimde onayın NEYE rağmen verildiği; damgasız tura
    // "daha eski baskı" demek, kaydın söylemediği bir şeyi iddia etmek olurdu.
    let partnerOverrideNotice = "";

    if (isStale) {
      if (body.overrideStaleRevision !== true) {
        // Okuma arızası GEÇİCİDİR ve kaydın söylemediği bir şey iddia edilmez:
        // `proof` okunamayan tabloyu sıfır fotoğraf sanır ("fotoğrafsız tur"),
        // oysa ortada yapılmamış bir okuma var. 503, kuralın değil arızanın
        // reddettiğini söyler; kod aynı kaldığı için ekran gerekçe kutusunu yine
        // açar ve gerekçeli onay AŞAĞIDA gerçekten çalışır.
        if (photosReadFailed) {
          return NextResponse.json(
            {
              error: QC_PHOTOS_UNREADABLE_ERROR,
              code: STALE_QC_REVISION_CODE,
              proof: "photos_unreadable",
              currentRevision,
            },
            { status: 503 }
          );
        }
        return NextResponse.json(
          {
            error:
              proof.failure === "stale"
                ? staleQcRevisionErrorTr(currentRevision, stalePhotoRevision)
                : qcRoundProofErrorTr(proof, currentRevision),
            // İstemci bunu görünce "gerekçe yaz" akışını açar; metne bakarak
            // karar vermek zorunda kalmasın. Kod TEK: dört hâlin de çıkışı aynı
            // denetimli istisnadır, yani ekranın tanımadığı bir kod yüzünden
            // admin gerekçe kutusuz kalmaz. Hangi hâl olduğu `proof` alanında.
            code: STALE_QC_REVISION_CODE,
            proof: proof.failure,
            currentRevision,
            photoRevision: stalePhotoRevision,
            unstampedCount: proof.unstampedCount,
          },
          { status: 409 }
        );
      }
      if (overrideReason.length < STALE_QC_OVERRIDE_REASON_MIN) {
        return NextResponse.json(
          { error: STALE_QC_OVERRIDE_REASON_ERROR, code: STALE_QC_REVISION_CODE },
          { status: 400 }
        );
      }
      // Denetim kaydındaki ad GERÇEKTEN olanı söyler: okunamayan bir tabloya
      // "fotoğrafsız tur" demek, yapılmamış bir okumayı olguya çevirirdi.
      const label = photosReadFailed
        ? QC_PHOTOS_UNREADABLE_LABEL
        : QC_PROOF_FAILURE_LABEL_TR[proof.failure ?? "stale"];
      const current = currentRevision != null ? `v${currentRevision}` : "bilinmiyor";
      const what = photosReadFailed
        ? `Turun QC fotoğrafları OKUNAMADI (geçici sistem arızası); siparişin güncel modeli ${current}. Kaç fotoğraf olduğu ve hangi sürümü gösterdikleri GÖRÜLMEDEN onaylandı.`
        : proof.failure === "stale"
          ? `Fotoğraflar v${stalePhotoRevision ?? "?"}, siparişin güncel modeli ${current}.`
          : proof.failure === "unstamped"
            ? `Turdaki ${proof.unstampedCount} fotoğraf sürüm damgası taşımıyor; siparişin güncel modeli ${current}. Hangi sürümün basıldığı DOĞRULANAMADI.`
            : proof.failure === "no_photos"
              ? "Turda hiç QC fotoğrafı yok; onay hiçbir fotoğrafa dayanmıyor."
              : "Siparişin güncel model sürümü okunamadı; onay, hangi sürümün basıldığı DOĞRULANAMADAN verildi.";
      staleOverrideNote = `[${label}] ${what} Onaylayan: ${adminEmail}. Gerekçe: ${overrideReason}`;
      partnerOverrideNotice = photosReadFailed
        ? "DİKKAT: Bu onay, turun QC fotoğrafları GÖRÜLMEDEN verildi."
        : proof.failure === "stale"
          ? "DİKKAT: Bu onay, GÜNCEL sürümden daha eski bir baskının fotoğraflarıyla verildi."
          : "DİKKAT: Bu onay, hangi model sürümünün basıldığı DOĞRULANAMADAN verildi.";
    }

    // ── DURUM ve ONU HAKLI ÇIKARAN KAYIT TEK İŞLEMDİR ───────────────────────
    //
    // Ölçülen kusur: qc_reviews okunamazken sipariş qc_approved'a GEÇTİ (kargo
    // açıldı, hakediş yolu başladı) ama karar satırı da denetim kaydı da hiç
    // yazılmadı; admin ise "işlem tamamlanamadı" okudu. Geriye, onayın NEYE
    // dayandığını söyleyen tek bir kaydı olmayan "onaylanmış" bir sipariş kaldı
    // — üstelik aynı onayı tekrar denemek durum kapısına takıldığı için (400)
    // eksik kayıt ekrandan tamamlanamıyordu bile.
    //
    // KURAL: bir geçiş, gerekçesini yazan işlemin DIŞINDA durum yazamaz. Karar
    // satırı yazılamıyorsa UPDATE de geri sarılır: onay ya kaydıyla birlikte
    // olur ya hiç olmaz. Sentinel iki hâli ayırır — "yazılamadı" (geçici arıza,
    // hiçbir şey değişmedi) ile "durum uymadı" (kural reddi) aynı cümleyi
    // paylaşamaz.
    const outcome = await db
      .transaction(async (tx) => {
        const [updated] = await tx
          .update(orders)
          .set({ manufacturerStatus: next, updatedAt: new Date() })
          // The guard again in the write, so a refund landing after the read wins.
          .where(and(eq(orders.id, id), eq(orders.manufacturerStatus, "qc_pending"), notRefundedGuard()))
          .returning({ id: orders.id });
        if (!updated) return null;
        // Denetim kaydı: eski sürüm bilerek onaylandıysa KİM ve NEDEN, hem QC
        // turu kaydında (üreticinin gördüğü yer) hem admin eylem günlüğünde
        // durur — ikisi de onayla AYNI işlemde, aynı tutamaçla.
        await tx.insert(qcReviews).values({
          orderId: id,
          round: order.qcRound,
          decision: "approved",
          reason: staleOverrideNote,
          adminEmail,
        });
        await tx.insert(adminActions).values({
          orderId: id,
          action: "qc_approve",
          adminEmail,
          notes: staleOverrideNote,
        });
        return true;
      })
      .catch((e) => {
        console.error("qc-approve: QC kararı kaydedilemedi, onay geri sarıldı", e);
        return "unrecorded" as const;
      });
    if (outcome === "unrecorded") {
      return NextResponse.json(
        { error: QC_DECISION_UNRECORDED_ERROR, code: "qc_decision_unrecorded" },
        { status: 503 }
      );
    }
    if (!outcome) {
      if (await isOrderRefunded(id)) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      return NextResponse.json({ error: "Order is not awaiting QC" }, { status: 400 });
    }

    // Fotoğraf satırlarını damgalamak KAYIT işidir, kapı değil — ve onayın
    // GEREKÇESİ de değildir: kanıt yukarıda OKUNDU, bu yazma yalnız o satırların
    // görünümünü günceller. O yüzden işlemin DIŞINDA, commit'ten SONRA durur:
    // okunamayan bir fotoğraf tablosu yüzünden kararı geri sarmak, kanıtı
    // görülmüş bir turu boşuna reddetmek olurdu. Korumasız hâlinde ise admin
    // "işlem tamamlanamadı" okuyordu — oysa iş YAPILMIŞTI.
    let photoStampFailed = false;
    try {
      await db
        .update(qcPhotos)
        .set({ reviewStatus: "approved" })
        .where(
          and(
            eq(qcPhotos.orderId, id),
            eq(qcPhotos.round, order.qcRound),
            eq(qcPhotos.reviewStatus, "pending")
          )
        );
    } catch (e) {
      console.error("qc-approve: QC fotoğraflarının durumu güncellenemedi", e);
      photoStampFailed = true;
    }
    if (photoStampFailed) {
      // AYRI satır, çünkü yukarıdaki notun metni üreticinin de okuduğu gerekçedir
      // (qc_reviews.reason ile birebir aynı cümle): iç arızamızı oraya karıştırmak
      // partnere bizim sistem notumuzu okuturdu. Yeni bir `action` değeri de
      // EKLENMEZ — admin_action_type bir pg enum'u ve enum'a değer eklemek geri
      // alınabilir bir migration ile temizlenemez; gerçek anlam notta durur.
      await db
        .insert(adminActions)
        .values({
          orderId: id,
          action: "qc_approve",
          adminEmail,
          notes: QC_PHOTO_STAMP_FAILED_NOTE,
        })
        .catch((e) => console.error("qc-approve: damgalama arızası kaydedilemedi", e));
    }

    if (order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: order.manufacturerId,
        type: "qc_result",
        subject: `QC onaylandı — ${order.orderNumber}`,
        body:
          `${order.orderNumber} numaralı sipariş kalite kontrolden geçti. Artık kargolayabilirsiniz.` +
          (staleOverrideNote ? `\n\n${partnerOverrideNotice}\n${staleOverrideNote}` : ""),
        orderId: id,
      }).catch((e) => console.error("notifyManufacturer qc_approve failed", e));
    }

    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      manufacturerStatus: next,
    });

    return NextResponse.json({
      success: true,
      staleRevisionApproved: isStale,
      // Hâl UYDURULMAZ: kanıt hesabı okunamayan tabloyu sıfır fotoğraf sanar.
      proof: photosReadFailed ? "photos_unreadable" : proof.failure,
      photosUnreadable: photosReadFailed,
      photoStampFailed,
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/qc-approve", ADMIN_ACTION_FAILED_ERROR);
  }
}
