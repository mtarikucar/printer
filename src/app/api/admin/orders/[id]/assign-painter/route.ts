import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, painterActions, painters } from "@/lib/db/schema";
import {
  accrueHandoffPrintEarning,
  notifyManufacturerOfPainterHandoff,
  notifyPainterOfNewJob,
} from "@/lib/services/painter-auto-assign";
import { recordPainterPlacementDecision } from "@/lib/services/painter-evaluation";
// Kapasitenin TEK ölçüsü. Bu uç kendi count(*)'ını sayıyordu ve iade edilmiş işi
// de yüke katıyordu: ekranın "0/1 · uygun" gösterdiği boyacıyı burası 409 ile
// reddediyordu. Ölçü artık ekranlarla aynı satırdan gelir.
import { painterCapacityGate } from "@/lib/services/painter-capacity";
import { emitOrderChanged } from "@/lib/realtime/emit";
// Koli kapısı otomatik yollarla AYNI ölçüyü kullanır (painter-auto-assign.ts).
import { painterParcelOnTheWay } from "@/lib/config/flags";
import {
  REFUNDED_ORDER_ERROR,
  formatAdminNoteLine,
  isRefunded,
} from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";

/**
 * Admin hand-off to a painter — the counterpart to the manufacturer's
 * send-to-painter.
 *
 * Without this an order could stall with nobody able to move it: the
 * manufacturer is the only party who could hand it over, so if they never do,
 * or every painter they picked declined, or an admin pulled it back from a bad
 * painter, the job sits at qc_approved forever. This is the same operation with
 * the same guards and the same money, performed by an admin.
 */

const schema = z.object({
  painterId: z.string().uuid("Boyacı seçin"),
  carrier: z
    .enum(["yurtici", "aras", "mng", "ptt", "surat", "other", "elden"])
    .optional(),
  trackingNumber: z.string().trim().max(60).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;

    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        userId: true,
        amountKurus: true,
        paintingPriceKurus: true,
        productionBaseKurus: true,
        needsPainting: true,
        manufacturerId: true,
        manufacturerStatus: true,
        painterStatus: true,
        declinedPainterIds: true,
        paymentStatus: true,
        // Kolinin nerede olduğunu söyleyen alanlar: ret (decline) siparişi
        // boyacıdan koparırken bunları BİLEREK bırakır, aşağıdaki koli kapısı
        // da tek kanıt olarak bunları okur.
        painterHandoffCarrier: true,
        painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    }
    // Refund-end-state: a refunded order keeps its status but never moves
    // forward. Handing it to a painter would also accrue the manufacturer's print
    // earning below on money that already went back to the customer.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (!order.needsPainting || order.paintingPriceKurus <= 0) {
      return NextResponse.json(
        { error: "Bu sipariş için boyama seçilmemiş." },
        { status: 400 }
      );
    }
    // Same gate as the manufacturer path: the figure must physically exist and
    // have passed QC before it can travel to a painter.
    if (order.manufacturerStatus !== "qc_approved") {
      return NextResponse.json(
        { error: "Sipariş boyacıya gönderilmeden önce üretici QC onayından geçmeli." },
        { status: 409 }
      );
    }
    if (order.painterStatus && order.painterStatus !== "unassigned") {
      return NextResponse.json(
        {
          error:
            "Bu sipariş zaten bir boyacıda. Önce 'Boyacıdan geri al' ile çıkarın.",
        },
        { status: 409 }
      );
    }

    // ── FİZİKSEL KOLİ SESSİZCE YENİDEN YÖNLENDİRİLMEZ ───────────────────────
    //
    // Ret (decline/route.ts) siparişi boyacıdan koparır ama kargo alanlarını
    // BİLEREK bırakır: kutu gerçekten yola çıktıysa tek izi odur. Bu uç o izin
    // üstüne yazıyordu — admin yeni bir takip numarası girmediğinde `null` — ve
    // kolinin nereye gittiğini söyleyen TEK kayıt siliniyordu. Aynı silme
    // otomatik yolları da kör ediyordu: iz gidince sipariş "kolisi yola
    // çıkmamış" sayılır ve sıradaki ret/24 saat sessizlik işi bir sonraki
    // boyacıya yazarken baskı hâlâ öncekinde durur.
    //
    // Ölçü otomatik yollarla AYNI (flags.ts · painterParcelOnTheWay); iki ölçü
    // ayrışsaydı aynı sipariş bir yolda korunur, diğerinde taşınırdı.
    const parcelOnTheWay = painterParcelOnTheWay(order);
    // Kolinin hesabını veren tek şey YENİ takip numarasıdır. Kargo firması
    // kanıt sayılmaz — flags.ts'in kendi kuralı: firma, paket çıkmadan da
    // seçilebilir, takip numarası ise ancak kargoya verilince doğar.
    const newTracking = parsed.data.trackingNumber?.trim() || null;
    if (parcelOnTheWay && !newTracking) {
      return NextResponse.json(
        {
          // Karar kaydı uyarısından (200 + `warning`) ayrılabilsin diye bu bir
          // REDDİR: 409 + `error` + sabit `code`.
          error:
            "Bu siparişin baz baskısı bir boyacıya gönderilmiş ya da onun elinde " +
            "görünüyor. Yeni boyacıya atamak için parçanın yeni sevkiyatını girin: " +
            "takip numarası zorunludur (elden teslimde teslim notunu yazın). " +
            "Numarasız atama, kolinin nerede olduğunu söyleyen tek kaydı silerdi.",
          code: "parcel_in_transit",
        },
        { status: 409 }
      );
    }

    // A painter who already refused this order must not be handed it again —
    // same rule the manufacturer ranking applies to declinedManufacturerIds.
    const declined = Array.isArray(order.declinedPainterIds)
      ? (order.declinedPainterIds as string[])
      : [];
    if (declined.includes(parsed.data.painterId)) {
      return NextResponse.json(
        { error: "Bu boyacı siparişi daha önce reddetti." },
        { status: 409 }
      );
    }

    const painter = await db.query.painters.findFirst({
      where: eq(painters.id, parsed.data.painterId),
      columns: {
        id: true,
        status: true,
        acceptingOrders: true,
        // maxConcurrentOrders BİLEREK OKUNMAZ: kapasiteyi ortak ölçü kendi
        // okur (painter-capacity.ts), yoksa burada ikinci bir kopya durur ve
        // bir sonraki okuyan onunla kendi eşiğini kurar.
        companyName: true,
      },
    });
    if (!painter || painter.status !== "active") {
      return NextResponse.json(
        { error: "Seçilen boyacı aktif değil." },
        { status: 400 }
      );
    }
    if (!painter.acceptingOrders) {
      return NextResponse.json(
        { error: "Seçilen boyacı şu an iş almıyor." },
        { status: 400 }
      );
    }
    // Kapasite ORTAK ölçüden sorulur: iade edilmiş iş kimsenin tezgâhını
    // doldurmaz ve cümle tek kaynaktan gelir (PAINTER_CAPACITY_FULL_ERROR).
    const gate = await painterCapacityGate(painter.id);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 409 });
    }

    // Atomic: only assign while the order is still unassigned + QC-approved, so a
    // concurrent manufacturer send-to-painter can't double-assign.
    //
    // Devir ile onu HAKLI ÇIKARAN kayıt tek işlemde, aynı tutamaçla yazılır.
    // Eylem satırı eskiden commit'ten sonra "en iyi çaba" olarak yazılıyordu ve
    // hatası yutuluyordu: bir DB tökezlemesinde sipariş boyacıya geçmiş, ama
    // devri KİMİN yaptığını söyleyen tek kayıt hiç oluşmamış oluyordu.
    // Üstüne yazılan koli kaydı KAYBOLMAZ: eski sevkiyat siparişin admin notuna
    // geçer. "Koliyi açıkça devret" kuralının yazılı yarısı budur.
    const parcelNote = parcelOnTheWay
      ? formatAdminNoteLine(
          `[BOYACI KOLİSİ] Admin ${a.session.user.email}: yeni boyacı atanırken ` +
            `önceki sevkiyat kaydı değiştirildi — ` +
            `${order.painterHandoffCarrier ?? "-"} / ` +
            `${order.painterHandoffTrackingNumber ?? "-"}` +
            `${order.receivedByPainterAt ? " (önceki boyacı teslim almıştı)" : ""} → ` +
            `${parsed.data.carrier ?? "-"} / ${newTracking}.`
        )
      : null;

    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          painterId: painter.id,
          painterStatus: "assigned",
          assignedToPainterAt: now,
          sentToPainterAt: now,
          // HAYATTA KALAN KARGO KAYDININ ÜSTÜNE `null` YAZILMAZ. Yeni sevkiyat
          // bildirildiyse yazılır; bildirilmediyse (koli de yolda değilse)
          // alanlara hiç dokunulmaz.
          ...(newTracking
            ? {
                painterHandoffCarrier: parsed.data.carrier ?? null,
                painterHandoffTrackingNumber: newTracking,
              }
            : parsed.data.carrier
              ? { painterHandoffCarrier: parsed.data.carrier }
              : {}),
          // Bu iki damga ÖNCEKİ boyacının ilerlemesini anlatır. Ret sonrası
          // hayatta kaldıklarında yeni boyacı işi "teslim alınmış" görüyor ve
          // "Teslim aldım" bir daha açılmıyordu (received rotasının isNull
          // şartı) — ortağa kendi işi hakkında doğru olmayan bir şey. Koli
          // yolda değilken ikisi de zaten NULL'dır, yani bu yazma ya
          // düzeltmedir ya da etkisizdir.
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
            eq(orders.manufacturerStatus, "qc_approved"),
            // Bölüşüm ön okumadan sonra değişebilir: kaldırılan boyama devredilmez.
            eq(orders.needsPainting, true),
            gt(orders.paintingPriceKurus, 0),
            // Re-checked here so a refund landing after the read above still wins.
            notRefundedGuard(),
            sql`(${orders.painterStatus} IS NULL OR ${orders.painterStatus} = 'unassigned')`
          )
        )
        .returning();
      if (!row) return null;
      // Partner-facing events are audited on the partner's own action log, not
      // adminActions — the same convention the revoke paths follow, and it keeps
      // the enum free of one-off values. The admin's identity rides in `notes`.
      // `admin_assigned`, otomatik atamanın `auto_assigned` satırından AYRI
      // tutulur: SLA süpürmesi yalnız kendi attığı işi geri alabilmeli, insanın
      // verdiği kararı 24 saat sonra bozmamalı.
      await tx.insert(painterActions).values({
        orderId: id,
        painterId: painter.id,
        action: "admin_assigned",
        notes: a.session.user.email,
      });
      return row;
    });
    if (!updated) {
      return NextResponse.json(
        { error: "Sipariş bu sırada başka bir işlemle değişti. Sayfayı yenileyin." },
        { status: 409 }
      );
    }

    // Devrin parası ve iki bildirimi OTOMATİK atamayla ORTAK yardımcılardan
    // gelir (painter-auto-assign.ts): admin'in elle attığı iş ile sistemin
    // attığı iş arasında para ya da haber farkı oluşamaz. Hakediş `orderId`
    // üzerinde tekildir, yani ret sonrası yeniden devir ikinci kez ödemez.
    await accrueHandoffPrintEarning({
      orderId: id,
      manufacturerId: updated.manufacturerId,
      painterId: painter.id,
      amountKurus: updated.amountKurus,
      productionBaseKurus: updated.productionBaseKurus,
      paintingPriceKurus: updated.paintingPriceKurus,
    });

    await notifyPainterOfNewJob({
      painterId: painter.id,
      orderId: id,
      orderNumber: updated.orderNumber,
    });

    // Üretici baskıyı nereye göndereceğini buradan öğrenir; boyacı kimliğinin
    // açıldığı tek yer bu bildirimdir.
    if (updated.manufacturerId) {
      await notifyManufacturerOfPainterHandoff({
        manufacturerId: updated.manufacturerId,
        painterId: painter.id,
        orderId: id,
        orderNumber: updated.orderNumber,
      });
    }

    // Elle seçim de bir KARARDIR ve kaydı ORTAK kapıdan yazılır
    // (recordPainterPlacementDecision): üç insan yolu — bu atama, yöneticinin
    // boyacı değişimi ve üreticinin kendi devri — aynı yazıcıyı kullanır, yoksa
    // bir siparişin boyacısının nasıl belirlendiği "hangi düğmeye basıldığına"
    // göre cevaplanabilir ya da cevaplanamaz olurdu.
    //
    // Aday listesi BOŞTUR, çünkü sıralayıcı hiç çalışmadı: kazananı admin seçti.
    // Daha önce reddedenler ise damgalanır — "neden yine o boyacı seçilmedi"
    // sorusunun tek cevabı odur.
    //
    // Yazıcı ASLA fırlatmaz. Yazamadığında telemetri hatası atamayı GERİ ALMAZ
    // (kural değişmedi) ama SUSMAZ: siparişe kalıcı bir [BOYACI KAYDI] notu
    // düşer ve cevap Türkçe bir `warning` taşır. Not de gerekliydi, çünkü
    // yalnız cevaba güvenmek ekranın o gövdeyi okumasına bağlıydı ve okumuyordu.
    const evaluation = await recordPainterPlacementDecision({
      orderId: id,
      trigger: "admin_manual",
      painterId: painter.id,
      excludedPainterIds: declined,
      // YALNIZ OLAN ŞEY SÖYLENİR. Burası "hakediş işlendi" diyordu, oysa
      // hakedişi yazan yardımcı (accrueHandoffPrintEarning) sonucunu
      // yutuyor: ters çevrilmiş bir satır yüzünden tahakkuk reddedilse bile
      // cümle "işlendi" demeye devam ederdi — ortağa kendi parası hakkında
      // doğrulanmamış bir söz. Atama kesin olan tek şeydir.
      doneTr: "Boyacı atandı",
    });

    await emitOrderChanged({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      userId: updated.userId,
      manufacturerId: updated.manufacturerId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
    });

    return NextResponse.json({
      success: true,
      // Uyarı, anlaşmazlık çözümündeki (disputes/[id]/resolve) kalıbın aynısı:
      // iş OLDU, ama yanında yapılamayan bir şey var ve admin bunu ekranda
      // okumalı. Ekran bu alanı düşürse bile uyarı kaybolmaz: aynı cümle
      // siparişin admin notuna da yazıldı (yazıcının kendi raporlaması).
      ...(evaluation.warningTr ? { warning: evaluation.warningTr } : {}),
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/assign-painter", ADMIN_ACTION_FAILED_ERROR);
  }
}
