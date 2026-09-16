import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  adminActions,
  orders,
  painterActions,
  painterEarnings,
  painters,
} from "@/lib/db/schema";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { emitOrderChanged } from "@/lib/realtime/emit";
// Kapasitenin TEK ölçüsü (ham count(*) yerine): iade edilmiş iş kimsenin
// tezgâhını doldurmaz ve bu uç, ekranın uygun gösterdiği boyacıyı reddedemez.
import { painterCapacityGate } from "@/lib/services/painter-capacity";
import { PAINTER_REVOCABLE_STATUSES } from "@/lib/services/revoke-after-painter";
// Koli kapısı: otomatik yolların kullandığı ölçünün AYNISI.
import { painterParcelOnTheWay } from "@/lib/config/flags";
import { REFUNDED_ORDER_ERROR, formatAdminNoteLine, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { handleRouteFailure, ADMIN_ACTION_FAILED_ERROR } from "@/lib/api/route-error";
import { recordPainterPlacementDecision } from "@/lib/services/painter-evaluation";

/**
 * YALNIZ BOYACIYI DEĞİŞTİR.
 *
 * Bugün tek çıkış yolu "boyacıdan geri al"dı (revoke-after-painter): o yol
 * ÜRETİCİYİ de koparır, üreticinin devirde tahakkuk etmiş baskı hakedişini
 * geri alır ve siparişi atama kuyruğuna düşürür. Oysa vakaların çoğunda
 * üreticide bir sorun yoktur — boyacı işi bırakmıştır, cevap vermemektedir ya
 * da kalitesi tutmamıştır. O durumda üreticiyi cezalandırmak, işini bitirmiş
 * bir atölyenin parasını geri almak demekti.
 *
 * Bu uç yalnız boyacıyı değiştirir:
 *   - üretici, üretici durumu ve TAHAKKUK ETMİŞ baskı hakedişi aynen kalır,
 *   - boyacı QC turu artırılır (eski boyacının fotoğrafları yenisine düşmez),
 *   - devir izleri (kargo/teslim/boyandı damgaları) sıfırlanır,
 *   - istenirse eski boyacı bu siparişin kara listesine eklenir
 *     (declinedPainterIds — revoke ucunun zaten desteklediği seçenek).
 *
 * PARA SINIRI: boyacı hakedişi yalnız KARGOLAMADA tahakkuk eder ve
 * `painter_earnings.order_id` UNIQUE'tir. Sipariş için herhangi bir boyacı
 * hakediş satırı varsa değişim reddedilir: aksi halde yeni boyacının
 * tahakkuku onConflictDoNothing yüzünden sessizce düşer ve boyacı ₺0 alırdı.
 * Kargolanmış bir işte ise çıkış yolu iade/ihtilaftır.
 *
 * FİZİKSEL PARÇA: baskı hâlâ eski boyacının elindedir. Bu uç parayı
 * hareket ettirmez; devir kargosu ve (gerekirse) yeniden baskı bugün ELLE
 * mutabakatla kapatılır (reprint-cost kararı: düzeltme kaydı Faz 6'da gelir).
 * Ekrana ve bildirimlere bu yazılır — para sözü verilmez.
 */
/**
 * HER dal Türkçe bir mesaj taşır — mesaj doğrudan admin ekranına basılıyor.
 *
 * `.uuid(...)`/`.min(...)` metinleri yalnız alan VARSA ama bozuksa devreye
 * girer; alan hiç gönderilmediğinde zod varsayılan İngilizce metnini
 * döndürürdü. `z.string({ error })` eksik alanı da kapsar; nesne düzeyindeki
 * `error` ise bilinmeyen alan (strict) ve gövdenin hiç nesne olmaması (bozuk
 * JSON → null) dallarını Türkçeleştirir.
 */
const schema = z.strictObject(
  {
    painterId: z
      .string({ error: "Yeni boyacıyı seçin" })
      .uuid("Yeni boyacıyı seçin"),
    reason: z
      .string({ error: "Sebep zorunludur (en az 3 karakter)" })
      .trim()
      .min(3, "Sebep zorunludur (en az 3 karakter)")
      .max(500, "Sebep en fazla 500 karakter olabilir"),
    /** Eski boyacı bu siparişe bir daha atanmasın. Varsayılan kapalı. */
    blocklistPainter: z.boolean({ error: "Geçersiz istek" }).default(false),
    /** Parçanın yeni boyacıya gidiş kargosu (biliniyorsa). */
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const a = await requireAdmin();
    if ("response" in a) return a.response;
    const adminEmail = a.session.user.email ?? "admin";

    const { id } = await params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
        { status: 400 }
      );
    }
    const { painterId: nextPainterId, reason, blocklistPainter } = parsed.data;

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, id),
      columns: {
        id: true,
        orderNumber: true,
        userId: true,
        status: true,
        paymentStatus: true,
        manufacturerId: true,
        manufacturerStatus: true,
        painterId: true,
        painterStatus: true,
        declinedPainterIds: true,
        shippedAt: true,
        needsPainting: true,
        // Kolinin nerede olduğunu söyleyen üç alan; koli kapısı bunları okur.
        painterHandoffCarrier: true,
        painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
      },
    });
    if (!order) return NextResponse.json({ error: "Sipariş bulunamadı" }, { status: 404 });
    // İade kararı (refund-end-state): iade edilmiş siparişte hiçbir ileri adım
    // yok — yeni bir boyacıya iş vermek de bunlardan biridir.
    if (isRefunded(order)) {
      return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
    }
    if (!order.painterId || !order.painterStatus || order.painterStatus === "unassigned") {
      return NextResponse.json(
        { error: "Bu sipariş bir boyacıda değil. Boyacı atamak için 'Boyacı ata'yı kullanın." },
        { status: 400 }
      );
    }
    if (order.painterId === nextPainterId) {
      return NextResponse.json(
        { error: "Sipariş zaten bu boyacıda." },
        { status: 400 }
      );
    }
    if (order.shippedAt != null || order.painterStatus === "shipped") {
      return NextResponse.json(
        { error: "Sipariş kargolandı; boyacı değiştirilemez. İade/ihtilaf akışını kullanın." },
        { status: 409 }
      );
    }
    if (!(PAINTER_REVOCABLE_STATUSES as readonly string[]).includes(order.painterStatus)) {
      return NextResponse.json(
        { error: "Boyacı bu durumdayken değiştirilemez." },
        { status: 409 }
      );
    }

    // ── FİZİKSEL KOLİ SESSİZCE YENİDEN YÖNLENDİRİLMEZ ───────────────────────
    //
    // Bu ucun koli kapısı HİÇ YOKTU ve önkoşulu (PAINTER_REVOCABLE_STATUSES +
    // kargolanmamış olmak) kutunun eski boyacının ELİNDE olduğu durumları da
    // kapsıyor: accepted/painting/painted/qc_pending/qc_approved. Değişim
    // yazması teslim/boyandı damgalarını sıfırlıyor, kargo/takip alanlarını da
    // isteğin (çoğu zaman boş) alanlarıyla eziyordu — yani takip numarası
    // verilmeyen bir değişim, kolinin nereye gittiğini söyleyen TEK kaydı
    // siliyordu. Üstelik o kayıt gidince sipariş otomatik yolların gözünde
    // "kolisi yola çıkmamış" hâle geliyor ve sıradaki ret ya da 24 saatlik
    // sessizlik işi bir sonraki boyacıya yazarken baskı hâlâ İLK boyacıda
    // kalıyordu (ölçülen P4E-1).
    //
    // Karar: koli yoldayken değişim YASAK DEĞİL ama SESSİZ DE DEĞİL — admin
    // parçanın yeni sevkiyatını bildirmek zorunda. Otomatik yollar aynı ölçüyle
    // (flags.ts · painterParcelOnTheWay) kendi başlarına asla taşımaz; orada
    // karar adminindir, burası da o kararın yazıldığı yerdir.
    const parcelOnTheWay = painterParcelOnTheWay(order);
    // Kanıt yalnız takip numarasıdır; kargo firması paket çıkmadan da
    // seçilebildiği için flags.ts onu bilerek kanıt saymaz.
    const newTracking = parsed.data.trackingNumber?.trim() || null;
    if (parcelOnTheWay && !newTracking) {
      return NextResponse.json(
        {
          // Bu bir REDDİR (409 + `error` + sabit `code`); karar kaydı uyarısı
          // ise 200 + `warning` olarak döner. İkisi karışmasın.
          error:
            "Bu siparişin baskısı boyacıya gönderilmiş ya da onun elinde görünüyor. " +
            "Boyacıyı değiştirmek için parçanın yeni sevkiyatını girin: takip " +
            "numarası zorunludur (elden teslimde teslim notunu yazın). Numarasız " +
            "değişim, kolinin nerede olduğunu söyleyen tek kaydı silerdi.",
          code: "parcel_in_transit",
        },
        { status: 409 }
      );
    }

    // Para sınırı (yukarıdaki nota bakın): açık bir boyacı hakedişi varsa dur.
    const existingEarning = await db
      .select({ id: painterEarnings.id })
      .from(painterEarnings)
      .where(eq(painterEarnings.orderId, id))
      .limit(1);
    if (existingEarning.length > 0) {
      return NextResponse.json(
        {
          error:
            "Bu sipariş için boyacı hakedişi oluşmuş; boyacı değiştirilemez (yeni boyacı ₺0 alırdı). İade/ihtilaf akışını kullanın.",
        },
        { status: 409 }
      );
    }

    const nextPainter = await db.query.painters.findFirst({
      where: eq(painters.id, nextPainterId),
      columns: {
        id: true,
        status: true,
        acceptingOrders: true,
        // maxConcurrentOrders BİLEREK OKUNMAZ: eşiği ortak ölçü kendi okur
        // (painter-capacity.ts); buradaki ikinci kopya ikinci bir kural olurdu.
        companyName: true,
      },
    });
    if (!nextPainter || nextPainter.status !== "active") {
      return NextResponse.json({ error: "Seçilen boyacı aktif değil." }, { status: 400 });
    }
    if (!nextPainter.acceptingOrders) {
      return NextResponse.json({ error: "Seçilen boyacı şu an iş almıyor." }, { status: 400 });
    }
    const declined = Array.isArray(order.declinedPainterIds)
      ? (order.declinedPainterIds as string[])
      : [];
    if (declined.includes(nextPainterId)) {
      return NextResponse.json(
        { error: "Bu boyacı siparişi daha önce reddetti." },
        { status: 409 }
      );
    }
    // Kapasite ORTAK ölçüden: ham iş sayısı değil ağırlıklı yük, ve iade
    // edilmiş iş sayılmaz. Cümle de tek kaynaktan gelir.
    const gate = await painterCapacityGate(nextPainterId);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: 409 });
    }

    const prevPainterId = order.painterId;
    const prevPainterStatus = order.painterStatus;
    const prevPainter = await db.query.painters
      .findFirst({ where: eq(painters.id, prevPainterId), columns: { companyName: true } })
      .catch(() => null);

    // Üstüne yazılan koli kaydı KAYBOLMAZ: eski sevkiyat da bu nota geçer.
    // "Koliyi açıkça devret" kuralının yazılı yarısı budur — kapı yalnız yeni
    // numarayı ZORUNLU kılar, notu da hangi kutunun nereden geldiğini yazar.
    const parcelClause = parcelOnTheWay
      ? ` Önceki sevkiyat: ${order.painterHandoffCarrier ?? "-"} / ` +
        `${order.painterHandoffTrackingNumber ?? "-"}` +
        `${order.receivedByPainterAt ? " (önceki boyacı teslim almıştı)" : ""} → ` +
        `yeni sevkiyat: ${parsed.data.carrier ?? "-"} / ${newTracking}.`
      : "";
    const note = formatAdminNoteLine(
      `[BOYACI DEĞİŞİMİ] Admin ${adminEmail}: ${prevPainter?.companyName ?? prevPainterId} (${prevPainterStatus}) → ${nextPainter.companyName}. Üretici ve baskı hakedişi korundu.${parcelClause} Sebep: ${reason}`
    );

    const now = new Date();
    const [updated] = await db
      .update(orders)
      .set({
        painterId: nextPainterId,
        painterStatus: "assigned",
        assignedToPainterAt: now,
        sentToPainterAt: now,
        // Parça eski boyacıdadır: teslim/boyama damgaları yeni boyacı için
        // sıfırlanır, yoksa yeni boyacı "teslim alınmış" bir işe devam ederdi.
        receivedByPainterAt: null,
        paintedAt: null,
        // HAYATTA KALAN KARGO KAYDININ ÜSTÜNE `null` YAZILMAZ: yeni sevkiyat
        // bildirildiyse yazılır, bildirilmediyse (koli de yolda değilse)
        // alanlara hiç dokunulmaz. Eski davranış, takip numarası girilmeyen her
        // değişimde bu iki alanı siliyordu.
        ...(newTracking
          ? {
              painterHandoffCarrier: parsed.data.carrier ?? null,
              painterHandoffTrackingNumber: newTracking,
            }
          : parsed.data.carrier
            ? { painterHandoffCarrier: parsed.data.carrier }
            : {}),
        // Eski boyacının QC fotoğrafları yenisine görünmesin.
        painterQcRound: sql`${orders.painterQcRound} + 1`,
        ...(blocklistPainter
          ? { declinedPainterIds: Array.from(new Set([...declined, prevPainterId])) }
          : {}),
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                      THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(orders.id, id),
          // Eşzamanlılık kilidi: boyacı bu arada kargoladıysa/reddettiyse ya da
          // başka bir admin dokunduysa 0 satır eşleşir.
          eq(orders.painterId, prevPainterId),
          inArray(orders.painterStatus, [...PAINTER_REVOCABLE_STATUSES]),
          isNull(orders.shippedAt),
          notRefundedGuard()
        )
      )
      .returning();
    if (!updated) {
      return NextResponse.json(
        { error: "Sipariş bu sırada başka bir işlemle değişti; sayfayı yenileyin." },
        { status: 409 }
      );
    }

    // Partner olayları partnerin KENDİ günlüğüne yazılır (revoke/assign ile aynı
    // düzen); admin kimliği notta taşınır. "decline" DEĞİL: güvenilirlik skorunu
    // bozmamalı.
    await db
      .insert(painterActions)
      .values({
        orderId: id,
        painterId: prevPainterId,
        action: "admin_swapped_out",
        notes: `[Admin boyacıyı değiştirdi → ${nextPainter.companyName}] ${reason}`.slice(0, 500),
      })
      .catch((e) => console.error("swap-painter: prev painterActions insert failed", e));
    await db
      .insert(painterActions)
      .values({
        orderId: id,
        painterId: nextPainterId,
        action: "admin_assigned",
        notes: `${adminEmail} — boyacı değişimi: ${reason}`.slice(0, 500),
      })
      .catch((e) => console.error("swap-painter: new painterActions insert failed", e));

    // admin_action_type bir pg ENUM: yeni değer eklenemez (geri alma migration'ı
    // temiz kaldıramaz), bu yüzden bu fazın uçları NÖTR 'edit' değerini yazıp
    // gerçek anlamı nota bırakır. 'assign_manufacturer' YAZILAMAZ: o değeri
    // gerçek üretici atamaları kullanıyor (assignment-sweep, revoke-manufacturer)
    // ve denetim kaydını eyleme göre süzen biri, burada hiç yapılmamış bir
    // üretici ataması görürdü — oysa bu sipariş üreticiyi hiç değiştirmedi.
    await db
      .insert(adminActions)
      .values({
        orderId: id,
        action: "edit",
        adminEmail,
        notes:
          `Boyacı değiştirildi: ${prevPainter?.companyName ?? prevPainterId} (${prevPainterStatus}) → ` +
          `${nextPainter.companyName}. Üretici ve baskı hakedişi korundu` +
          `${blocklistPainter ? ", eski boyacı bu siparişe kara listeye alındı" : ""}. Sebep: ${reason}`,
      })
      .catch((e) => console.error("swap-painter: adminActions insert failed", e));

    // DEĞİŞİM DE BİR YERLEŞTİRMEDİR ve kaydı aynı ortak kapıdan yazılır.
    //
    // Eskiden bu yol yalnız eylem günlüğüne yazıyordu: sipariş yeni bir
    // boyacıya geçiyor, QC turu artıyor, devir damgaları sıfırlanıyor ama
    // "bu iş neden bu boyacıya gitti" dökümünde bu karar hiç görünmüyordu.
    //
    // Dışlananlar: siparişi daha önce reddedenler + İŞİ ELİNDEN ALINAN boyacı.
    // Kara listeye alınmasa bile o boyacı bu kararın dışındadır; listede
    // görünmesi "neden yine o seçilmedi" sorusunu cevapsız bırakırdı.
    const evaluation = await recordPainterPlacementDecision({
      orderId: id,
      trigger: "admin_swap",
      painterId: nextPainterId,
      excludedPainterIds: Array.from(new Set([...declined, prevPainterId])),
      doneTr: "Boyacı değiştirildi",
    });

    // Bildirimler: her biri izole — sipariş çoktan değişti, bir e-posta hatası
    // bunu admin'e "hiçbir şey olmadı" gibi göstermemeli.
    await notifyPainter({
      painterId: prevPainterId,
      type: "system_announcement",
      subject: `Boyama işi başka bir boyacıya devredildi — ${order.orderNumber}`,
      body:
        `${order.orderNumber} numaralı boyama işi yönetici tarafından başka bir boyacıya devredildi ` +
        `ve bu iş artık panelinizde görünmeyecek.\n\nSebep: ${reason}\n\n` +
        `Baskı hâlâ sizdeyse LÜTFEN BOYAMAYA DEVAM ETMEYİN; parçanın nereye gönderileceğini ` +
        `yönetici sizinle ayrıca netleştirecek. Kargo ve yapılan iş bedeli elle mutabakatla kapatılır.`,
      orderId: id,
    }).catch((e) => console.error("swap-painter: prev painter notify failed", e));

    await notifyPainter({
      painterId: nextPainterId,
      type: "order_assigned",
      subject: `Yeni boyama işi atandı — ${order.orderNumber}`,
      body:
        `${order.orderNumber} numaralı sipariş için yeni bir boyama işiniz var (önceki boyacıdan devralındı). ` +
        `Panelinizden inceleyip kabul edebilirsiniz.\n\n` +
        `DİKKAT: parça şu an önceki boyacıda olabilir. Elinize ulaştığında "Teslim aldım" ile ` +
        `işaretleyin; ulaşmadıysa yönetici ile mesajlaşmadan iletişime geçin.`,
      orderId: id,
    }).catch((e) => console.error("swap-painter: new painter notify failed", e));

    if (order.manufacturerId) {
      await notifyManufacturer({
        manufacturerId: order.manufacturerId,
        type: "system_announcement",
        subject: `Boyacı değişti — ${order.orderNumber}`,
        body:
          `${order.orderNumber} numaralı siparişin boyacısı yönetici tarafından değiştirildi. ` +
          `Sizin için değişen bir şey yok: iş sizde değil ve baskı hakedişiniz aynen duruyor.\n\n` +
          `Sebep: ${reason}`,
        orderId: id,
      }).catch((e) => console.error("swap-painter: manufacturer notify failed", e));
    }

    // Her iki boyacının paneli de anında tazelensin: olay iki boyacı konusuna
    // ayrı ayrı basılır (bir olayın konuları tek bir boyacıyı taşır).
    await emitOrderChanged({
      orderId: id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      manufacturerId: order.manufacturerId,
      painterId: nextPainterId,
      status: updated.status,
      manufacturerStatus: updated.manufacturerStatus,
      painterStatus: updated.painterStatus,
    }).catch((e) => console.error("swap-painter: emit (new painter) failed", e));
    await emitOrderChanged({
      orderId: id,
      orderNumber: order.orderNumber,
      painterId: prevPainterId,
      status: updated.status,
      painterStatus: "unassigned",
    }).catch((e) => console.error("swap-painter: emit (prev painter) failed", e));

    return NextResponse.json({
      success: true,
      // Gerekçe kaydı yazılamadıysa admin bunu ekranda okur; ekran alanı
      // düşürse bile aynı cümle siparişin admin notuna yazıldı.
      ...(evaluation.warningTr ? { warning: evaluation.warningTr } : {}),
      prevPainter: prevPainter?.companyName ?? prevPainterId,
      prevPainterStatus,
      newPainter: nextPainter.companyName,
      painterQcRound: updated.painterQcRound,
      manufacturerKept: order.manufacturerId != null,
      // Ekran bunu aynen göstermeli: para burada hareket etmez.
      settlementNote:
        "Parçanın yeni boyacıya ulaştırılması ve (gerekirse) yeniden baskı bedeli bu ekrandan ödenmez; elle mutabakatla kapatılır.",
    });
  } catch (e) {
    return handleRouteFailure(e, "POST /api/admin/orders/[id]/swap-painter", ADMIN_ACTION_FAILED_ERROR);
  }
}
