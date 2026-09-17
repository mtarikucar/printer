import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, manufacturers, painters, manufacturerActions } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { accrueEarning } from "@/lib/services/payouts";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { notifyPainter } from "@/lib/services/painter-notifications";
// Kapasitenin TEK ölçüsü. Buradaki ham count(*) iade edilmiş işi de sayıyordu:
// panelin "0/1 · uygun" diye SUNDUĞU boyacıyı bu uç 400 ile reddediyordu.
import { painterCapacityGate } from "@/lib/services/painter-capacity";
import { emitOrderChanged } from "@/lib/realtime/emit";
// Koli kapısı: otomatik yolların kullandığı ölçünün AYNISI.
import { painterParcelOnTheWay } from "@/lib/config/flags";
import {
  REFUNDED_ORDER_ERROR,
  formatAdminNoteLine,
  isRefunded,
} from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { isPartnerOrderRefunded } from "@/lib/services/partner-order-refund";
import { modelAckRefusal, readPartnerModelAck } from "@/lib/services/order-model-revision";
import { handleRouteFailure, PARTNER_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { recordPainterPlacementDecision } from "@/lib/services/painter-evaluation";

/**
 * HER dal Türkçe bir mesaj taşır.
 *
 * Mesaj doğrudan üreticinin ekranına basılıyor. Alan HİÇ gönderilmediğinde
 * zod kendi varsayılan İngilizce metnini üretiyordu ("Invalid input: expected
 * string, received undefined") ve partner panelinde İngilizce bir hata
 * görünüyordu; `.uuid(...)` mesajı yalnız alan VARSA ama bozuksa devreye
 * giriyor. `z.string({ error })` eksik/boş alanı da kapsar, nesne düzeyindeki
 * `error` ise gövde hiç nesne değilse (bozuk JSON) cevabı Türkçe tutar.
 */
const schema = z.object(
  {
    painterId: z.string({ error: "Boyacı seçin" }).uuid("Boyacı seçin"),
    // Courier record for the physical hand-off. Optional — some partners hand
    // over in person — but without it a lost parcel has no owner.
    carrier: z
      .enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"], {
        error: "Geçersiz kargo firması",
      })
      .optional(),
    trackingNumber: z
      .string({ error: "Takip numarası geçersiz" })
      .trim()
      .max(60, "Takip numarası en fazla 60 karakter olabilir")
      .optional(),
  },
  { error: "Geçersiz istek" }
);

// Manufacturer hands a QC-approved, painting-required order to a painter instead
// of shipping it. The manufacturer's part is done here, so their earning accrues
// now on the PRINT portion (amountKurus − paintingPriceKurus); the painter earns
// the painting portion when they later ship. Order → status 'painting'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getManufacturerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const manufacturer = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, session.manufacturerId),
    });
    if (!manufacturer || manufacturer.status !== "active") {
      return NextResponse.json({ error: "Your account is not active" }, { status: 403 });
    }

    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    // The order must be this manufacturer's, need painting, be QC-approved, and
    // not already handed off.
    const order = await db.query.orders.findFirst({
      where: and(eq(orders.id, id), eq(orders.manufacturerId, session.manufacturerId)),
      columns: {
        id: true, orderNumber: true, userId: true, amountKurus: true,
        paintingPriceKurus: true, productionBaseKurus: true,
        needsPainting: true, manufacturerStatus: true,
        painterStatus: true, declinedPainterIds: true, paymentStatus: true,
        // Kolinin nerede olduğunu söyleyen alanlar; koli kapısı bunları okur.
        painterHandoffCarrier: true, painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    // A hand-off accrues the print earning and gives a painter paid work, both
    // on money already returned. Readable refusal here; the race-proof half is
    // notRefundedGuard() in the UPDATE below.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    // Onaylanmamış yeni model sürümü varsa bu adım kapalıdır.
    //
    // Admin, iş üretimdeyken yeni bir model sürümü yükleyebilir
    // (late-model-upload kararı); üreticinin yeni dosyayı GÖRDÜĞÜNÜ onaylaması
    // gerekir. Üretici ekranı bu kapıyı zaten uyguluyor — burası sunucu
    // tarafıdır, çünkü ekranı atlayan bir istek eski modelle üretime devam
    // edebilirdi; eski baskı QC'den geçip kargoya çıkarsa hakediş de oradan
    // tahakkuk ederdi. Kabul ve ret bilerek serbest bırakıldı: işi hiç almamış
    // bir atölyeyi onaya zorlamak onu kilitler (config/partner-model-ack.ts).
    const ack = await readPartnerModelAck(id, {
      kind: "manufacturer",
      id: session.manufacturerId,
    });
    // Ret TEK kaynaktan gelir (modelAckRefusal): onay bekleyen sürüm 409, onay
    // günlüğü OKUNAMADIYSA 503 + "geçici arıza" cümlesi. Burada eskiden yalnız
    // `ack.pending` okunuyordu; arıza dalı (readFailed) o okumada görünmediği için
    // üretici, sistemin BİLMEDİĞİ bir olayı ("yeni bir model sürümü yüklendi,
    // onaylayın") gerekçe diye okuyup o cümlenin gösterdiği onay düğmesine basıyor
    // ve boş gövdeli bir 500 alıyordu. Kapı iki dalda da KAPALI kalır; değişen
    // yalnız gerekçe ve tekrar deneme tavsiyesi.
    const ackRefusal = modelAckRefusal(ack);
    if (ackRefusal) {
      return NextResponse.json(
        { error: ackRefusal.error, code: ackRefusal.code },
        { status: ackRefusal.status }
      );
    }

    if (!order.needsPainting || order.paintingPriceKurus <= 0) {
      return NextResponse.json({ error: "Bu sipariş için boyama seçilmemiş" }, { status: 400 });
    }
    if (order.manufacturerStatus !== "qc_approved") {
      return NextResponse.json(
        { error: "Sipariş boyacıya gönderilmeden önce QC onayından geçmeli" },
        { status: 400 }
      );
    }
    // 409, not 400: the request is valid but the order is already in the state
    // it would create — the same answer admin assign-painter and this route's own
    // lost-race branch give, so clients handle both paths alike.
    if (order.painterStatus && order.painterStatus !== "unassigned") {
      return NextResponse.json({ error: "Bu sipariş zaten bir boyacıya gönderildi" }, { status: 409 });
    }

    // ── FİZİKSEL KOLİ SESSİZCE YENİDEN YÖNLENDİRİLMEZ ───────────────────────
    //
    // Boyacı reddettiğinde sipariş yeniden "boyacısız" olur ama kargo alanları
    // BİLEREK durur: kutu yola çıktıysa tek izi odur. Bu uç o izin üstüne
    // yazıyordu (takip numarası girilmezse `null`), yani baskı hâlâ ilk
    // boyacıdayken ikinci bir devir kolinin kaydını siliyordu. Ret bildirimi
    // üreticiye zaten "Yeni bir kargo çıkarmayın" diyor; kapı o cümlenin
    // sunucu tarafıdır.
    const parcelOnTheWay = painterParcelOnTheWay(order);
    // Kanıt yalnız takip numarasıdır (flags.ts: kargo firması kanıt sayılmaz).
    const newTracking = parsed.data.trackingNumber?.trim() || null;
    if (parcelOnTheWay && !newTracking) {
      return NextResponse.json(
        {
          // REDDİR (`error` + `code`); karar kaydı uyarısı ise 200 + `warning`.
          error:
            "Bu siparişin baskısı daha önce bir boyacıya gönderilmiş görünüyor ve " +
            "kargo kaydı duruyor. Paket size geri ulaştıysa yeni kargo firması ve " +
            "takip numarasını girerek gönderebilirsiniz; ulaşmadıysa yeni bir kargo " +
            "çıkarmayın ve yöneticiyle iletişime geçin.",
          code: "parcel_in_transit",
        },
        { status: 409 }
      );
    }

    // A painter who already refused this job must not be handed it again. The
    // admin path (assign-painter) always checked this; this one did not, so a job
    // could bounce straight back to the painter who just turned it down. A
    // pre-check is enough: a painter can only decline while assigned, and this
    // route only runs while the order is unassigned.
    const declined = Array.isArray(order.declinedPainterIds)
      ? (order.declinedPainterIds as string[])
      : [];
    if (declined.includes(parsed.data.painterId)) {
      return NextResponse.json(
        { error: "Bu boyacı bu siparişi daha önce reddetti. Lütfen başka bir boyacı seçin." },
        { status: 409 }
      );
    }

    // Selected painter must be active + accepting + under capacity.
    const painter = await db.query.painters.findFirst({
      where: eq(painters.id, parsed.data.painterId),
      // maxConcurrentOrders BİLEREK OKUNMAZ: eşiği ortak ölçü kendi okur.
      columns: { id: true, status: true, acceptingOrders: true, companyName: true },
    });
    if (!painter || painter.status !== "active" || !painter.acceptingOrders) {
      return NextResponse.json({ error: "Seçilen boyacı uygun değil" }, { status: 400 });
    }
    // Kapasite ORTAK ölçüden sorulur. HTTP kodu bu ucun kendi kodudur (400);
    // ortak olan yalnız ölçü ve Türkçe cümledir.
    const gate = await painterCapacityGate(painter.id);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 400 });
    }

    // Üstüne yazılan koli kaydı KAYBOLMAZ: eski sevkiyat siparişin admin notuna
    // geçer (üretici panelinde admin notu görünmez, ama bu kayıt yöneticinin
    // "kutu nerede" sorusunu cevapladığı yerdir).
    const parcelNote = parcelOnTheWay
      ? formatAdminNoteLine(
          `[BOYACI KOLİSİ] Üretici yeni bir boyacıya devretti; önceki sevkiyat ` +
            `kaydı değiştirildi — ${order.painterHandoffCarrier ?? "-"} / ` +
            `${order.painterHandoffTrackingNumber ?? "-"}` +
            `${order.receivedByPainterAt ? " (önceki boyacı teslim almıştı)" : ""} → ` +
            `${parsed.data.carrier ?? "-"} / ${newTracking}.`
        )
      : null;

    // Atomic hand-off.
    const now = new Date();
    const [updated] = await db
      .update(orders)
      .set({
        painterId: painter.id,
        painterStatus: "assigned",
        assignedToPainterAt: now,
        sentToPainterAt: now,
        // HAYATTA KALAN KARGO KAYDININ ÜSTÜNE `null` YAZILMAZ: yeni sevkiyat
        // bildirildiyse yazılır, bildirilmediyse (koli de yolda değilse)
        // alanlara hiç dokunulmaz.
        ...(newTracking
          ? {
              painterHandoffCarrier: parsed.data.carrier ?? null,
              painterHandoffTrackingNumber: newTracking,
            }
          : parsed.data.carrier
            ? { painterHandoffCarrier: parsed.data.carrier }
            : {}),
        // Bu iki damga ÖNCEKİ boyacının ilerlemesini anlatır; ret sonrası
        // hayatta kalırlarsa yeni boyacı işi "teslim alınmış" görür ve "Teslim
        // aldım" bir daha açılmaz. Koli yolda değilken ikisi de zaten NULL'dır.
        receivedByPainterAt: null,
        paintedAt: null,
        ...(parcelNote
          ? {
              adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${parcelNote} ELSE ${orders.adminNotes} || E'\n' || ${parcelNote} END`,
            }
          : {}),
        status: "painting",
        updatedAt: now,
      })
      .where(
        and(
          eq(orders.id, id),
          eq(orders.manufacturerId, session.manufacturerId),
          eq(orders.manufacturerStatus, "qc_approved"),
          // Bölüşüm ön okumadan sonra değişebilir: kaldırılan boyama devredilmez.
          eq(orders.needsPainting, true),
          gt(orders.paintingPriceKurus, 0),
          notRefundedGuard(),
          // No painter yet: the condition admin assign-painter writes with. The
          // painter check above reads before this write, so without it a
          // concurrent admin hand-off was overwritten by a second painter, and
          // the painter the admin picked (already notified) silently lost the job.
          or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
        )
      )
      .returning();
    if (!updated) {
      if (await isPartnerOrderRefunded(id, { manufacturerId: session.manufacturerId })) {
        return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
      }
      // A lost race, not a bad request: the order moved between the checks above
      // and this write. 409 with a reason the manufacturer can act on (reload),
      // instead of a bare "İşlem başarısız".
      return NextResponse.json(
        {
          error:
            "Sipariş bu sırada değişti: boyama payı kaldırılmış, bir boyacıya atanmış ya da QC durumu değişmiş olabilir. Sayfayı yenileyin.",
        },
        { status: 409 }
      );
    }

    await db
      .insert(manufacturerActions)
      .values({ orderId: id, manufacturerId: session.manufacturerId, action: "send_to_painter", notes: painter.companyName })
      .catch((e) => console.error("manufacturerActions send_to_painter failed", e));

    // BU YERLEŞTİRMENİN DE KARAR KAYDI VAR.
    //
    // Bu yol uzun süre hiçbir gerekçe kaydı yazmadı: iş boyacıya geçiyor ama
    // "neden bu boyacıya gitti" sorusu yalnız üretici devrettiğinde
    // cevapsız kalıyordu — yani kaydın varlığı, yerleştirmeyi KİMİN yaptığına
    // bağlıydı. Sahibin kararı bunun tersi: her yerleştirme kendi kaydını yazar.
    //
    // Aday listesi boştur (sıralayıcı çalışmadı, boyacıyı üretici seçti), daha
    // önce reddedenler damgalanır. Yazıcı fırlatmaz: hata hâlinde siparişe
    // [BOYACI KAYDI] notu düşer ve cevap Türkçe uyarı taşır — devir GEÇERLİDİR,
    // telemetri onu geri alamaz.
    const evaluation = await recordPainterPlacementDecision({
      orderId: id,
      trigger: "manufacturer_handoff",
      painterId: painter.id,
      excludedPainterIds: declined,
      doneTr: "Sipariş boyacıya gönderildi",
    });

    // Manufacturer's earning accrues now on the print portion (idempotent).
    // `painterId` is set (we just handed off), so the base is the production
    // kalem total — never the painting share, which is the painter's.
    const printBaseKurus = manufacturerBaseKurus({
      amountKurus: order.amountKurus,
      productionBaseKurus: order.productionBaseKurus,
      paintingPriceKurus: order.paintingPriceKurus,
      painterId: painter.id,
      paintsInHouse: false,
    });
    await accrueEarning(order.id, session.manufacturerId, printBaseKurus).catch(
      (e) => console.error("accrueEarning (print portion) failed (non-fatal)", e)
    );

    await notifyPainter({
      painterId: painter.id,
      type: "order_assigned",
      subject: "Yeni boyama işi atandı",
      body: `${order.orderNumber} numaralı sipariş için yeni bir boyama işiniz var. Panelinizden inceleyip kabul edebilirsiniz.`,
      orderId: order.id,
    }).catch((e) => console.error("notifyPainter (assigned) failed", e));

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
    });

    // Uyarı düşse bile kaybolmaz: aynı cümle siparişin admin notundadır.
    return NextResponse.json({
      success: true,
      ...(evaluation.warningTr ? { warning: evaluation.warningTr } : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/manufacturer/orders/[id]/send-to-painter", PARTNER_ACTION_FAILED_ERROR);
  }
}
