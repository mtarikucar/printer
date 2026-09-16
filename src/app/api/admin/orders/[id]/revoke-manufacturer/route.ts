import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import {
  orders,
  adminActions,
  manufacturers,
  manufacturerActions,
} from "@/lib/db/schema";
import {
  revokeManufacturerAssignment,
  type RevokeResult,
} from "@/lib/services/manufacturer-revoke";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { applyStrike } from "@/lib/services/strikes";
import { emitOrderChanged } from "@/lib/realtime/emit";
import {
  ASSIGN_FAILURE_MESSAGES,
  SELLER_OVERRIDE_REASON_MIN_LENGTH,
  assignManufacturerToOrder,
  isOrderRefunded,
} from "@/lib/services/manufacturer-assign";
import {
  REFUNDED_PAYMENT_STATUS,
  isRefunded,
} from "@/lib/config/order-status-policy";
import { autoAssignPlacementPlan } from "@/lib/config/flags";
import { autoAssignIfEligible } from "@/lib/services/order-confirm";

/**
 * Take an assigned order back from a manufacturer, optionally handing it to a
 * specific one in the same call. Without this an unresponsive manufacturer
 * (neither accept nor decline) froze the order permanently.
 *
 * On a refunded order the plain revoke stays allowed, at any manufacturer
 * sub-status: it is cleanup, taking the job off a partner who should not be
 * working on money already returned. Handing it to another manufacturer is a
 * forward action and is refused.
 *
 * İade edilmiş sipariş, olağan geri almaya HİÇ girmez: yol ayrımı çağrıdan önce
 * yapılır ve koparma (`detachFromRefundedOrder`) koşar. Kural (bağlayıcı karar,
 * order-status-policy.ts): temizlik KOPARIR ve biter — durum geri sarılmaz,
 * kara listeye kayıt düşülmez, QC turu artırılmaz, güvenilirlik cezası
 * yazılmaz ve kimseye "sipariş yeniden atanacak" denmez.
 */
const schema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    targetManufacturerId: z.string().uuid().optional(),
    // Keep the ranker from handing the order straight back.
    blocklist: z.boolean().default(true),
    // Reliability penalty — opt-in, since "did not answer" may be a holiday.
    strike: z.boolean().default(false),
    // "Kuyruğumda kalsın": geri alınan sipariş hemen yeni bir üreticiye
    // YERLEŞTİRİLMESİN. Otomatik atama olmadan "hedefsiz geri alma" zaten
    // siparişi admin kuyruğunda bırakıyordu; otomatik atamayla birlikte aynı
    // tık siparişi saniyeler içinde başka bir atölyeye gönderir. Admin bazen
    // tam tersini ister (müşteriyle konuşulacak, iptal/iade düşünülüyor,
    // üretici elle seçilecek), bu yüzden o davranış açık bir seçenek oldu.
    // Varsayılan false: fazın amacı tıklama beklemeyen siparişler.
    keepInQueue: z.boolean().default(false),
    // Satıcının KENDİ katalog ürününü başka bir atölyeye devretmek için açık
    // onay. Varsayılan false: eksik gönderilen (ya da elle kurulmuş) bir istek
    // mülkiyet kuralını AŞAMAZ. Ayrı bir gerekçe alanı yok, çünkü bu uçta
    // `reason` zaten zorunlu ve denetim satırına aynen yazılıyor.
    allowSellerOverride: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Bu uçta AYRI bir gerekçe alanı yok: aşmanın gerekçesi `reason`dur. Ama
    // olağan geri alma için yeterli olan üç karakter, mülkiyet aşmasını
    // denetlenebilir kılmaz — "abc" denetim satırında hiçbir soruya cevap
    // vermez. Barajın kendisi kapıda (SELLER_OVERRIDE_REASON_MIN_LENGTH); bu
    // kontrol yalnızca aynı barajı admin'e ERKEN ve anlaşılır söyler, yoksa
    // istek kapıdan "satıcı kuralı" hatasıyla dönerdi ve ekranda eksik olanın
    // gerekçenin UZUNLUĞU olduğu hiç görünmezdi.
    if (!v.allowSellerOverride) return;
    if (v.reason.trim().length < SELLER_OVERRIDE_REASON_MIN_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: `Mülkiyet devri gerekçesi en az ${SELLER_OVERRIDE_REASON_MIN_LENGTH} karakter olmalıdır.`,
      });
    }
  });

/** 409 copy when a hand-off target is sent for a refunded order. */
const REFUNDED_HANDOFF_ERROR = "İade edilen sipariş başka bir üreticiye devredilemez.";

/**
 * Plain revoke on a REFUNDED order — every one of them, at any manufacturer
 * sub-status (shipped included). This is the ONLY path a refunded order takes;
 * the ordinary, rewinding revoke is never called for one.
 *
 * The ordinary revoke's sub-status limits exist so a revoke never strands an
 * earning a later manufacturer would then fail to accrue. A refunded order has
 * no later manufacturer (every assign path refuses it) and its earnings were
 * already reversed by the refund, so the limits protect nothing there. Refusing
 * left a legacy refunded row, attached from before refunds detached, on the
 * manufacturer's panel for good.
 *
 * It does what a refund does today: it takes the manufacturer off the order
 * and nothing else. The order status is kept (refund-end-state), no earning is
 * touched, and the WHERE matches only a refunded row, so this can never detach
 * a live order. A painter still holding the job is left to revoke-painter,
 * which detaches both partners together.
 */
async function detachFromRefundedOrder(args: {
  orderId: string;
  adminEmail: string;
  reason: string;
}): Promise<RevokeResult> {
  const { orderId, adminEmail, reason } = args;
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        manufacturerId: orders.manufacturerId,
        manufacturerStatus: orders.manufacturerStatus,
        painterStatus: orders.painterStatus,
        orderNumber: orders.orderNumber,
        userId: orders.userId,
        orderType: orders.orderType,
        status: orders.status,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) return { code: "not_found" as const };
    if (
      !order.manufacturerId ||
      !order.manufacturerStatus ||
      order.manufacturerStatus === "unassigned"
    ) {
      return { code: "not_assigned" as const };
    }
    if (order.painterStatus != null && order.painterStatus !== "unassigned") {
      return { code: "handed_to_painter" as const };
    }

    const prevManufacturerId = order.manufacturerId;
    const prevStatus = order.manufacturerStatus;
    const note = `[GERİ ALMA] Admin ${adminEmail} iade edilmiş siparişte atamayı geri aldı (önceki durum: ${prevStatus}). Sebep: ${reason}`;

    const [updated] = await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        // Koparma tam olsun: bunlar bırakılırsa sipariş üreticisiz kalır ama
        // üstünde o atölyenin kabul/baskı damgaları durur. Boyacı tarafındaki
        // iade koparması (revoke-painter) da aynısını yapıyor.
        manufacturerAcceptedAt: null,
        manufacturerPrintedAt: null,
        // KARA LİSTE BİLEREK YOK — üstelik çağıran isteseydi bile. Uç
        // `blocklist`i varsayılan TRUE alır ve admin ekranı iade edilmiş
        // siparişte kutuyu GİZLESE de o varsayılanı yine gönderir; eski hâlde
        // bu, iade edilmiş siparişte tek doğru yolun bile atölyeyi siparişin
        // kara listesine yazması demekti. Kayıt "bu atölyeye bir daha verme"
        // demektir; burada verilecek bir iş yoktur, geriye yalnız atölyenin
        // sicilindeki iz kalırdı. Bu yüzden bu yol o bayrağı hiç almaz.
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.manufacturerId, prevManufacturerId),
          // Refunded rows only: this path skips the sub-status limits, so it
          // must never reach an order that can still be worked on.
          eq(orders.paymentStatus, REFUNDED_PAYMENT_STATUS),
          or(isNull(orders.painterStatus), eq(orders.painterStatus, "unassigned"))
        )
      )
      .returning({ id: orders.id });
    if (!updated) return { code: "lost_race" as const };

    // Same free-text action as the ordinary revoke: not "decline", which the
    // ranker scores as a refusal.
    await tx.insert(manufacturerActions).values({
      orderId,
      manufacturerId: prevManufacturerId,
      action: "admin_revoked",
      notes: `[Admin geri aldı, sipariş iade edilmiş] ${reason}`.slice(0, 500),
    });

    return {
      code: "ok" as const,
      prevManufacturerId,
      prevStatus,
      orderNumber: order.orderNumber,
      userId: order.userId,
      orderType: order.orderType,
      orderStatus: order.status,
    };
  });
}

/**
 * Nereye kadar gelindi. Tek soru: GERİ ALMA YAZILDI MI? Beklenmeyen bir hatada
 * admin'e ne olduğunu söyleyebilen tek bilgi budur.
 */
type RevokeProgress = { revoked: boolean };

async function handleRevoke(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  progress: RevokeProgress
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const adminEmail = a.session.user.email ?? "admin";

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Mülkiyet aşmasının gerekçe barajı kendi cümlesiyle söylenir: admin
    // "sebebi zaten yazdım" diye bakakalmasın — eksik olan sebep değil, aşmayı
    // denetlenebilir kılacak uzunluktur.
    const overrideIssue = parsed.error.issues.find(
      (i) => i.code === "custom" && i.path[0] === "reason"
    );
    return NextResponse.json(
      { error: overrideIssue?.message ?? "Sebep zorunludur (en az 3 karakter)." },
      { status: 400 }
    );
  }
  const {
    reason,
    targetManufacturerId,
    blocklist,
    strike,
    keepInQueue,
    allowSellerOverride,
  } = parsed.data;

  const current = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      manufacturerId: true,
      customerName: true,
      paymentStatus: true,
      // Pazaryeri ürününün sahibi. Hem devir kapısı hem de kaybeden üreticiye
      // gidecek yazı bunu bilmek zorunda: satıcının kendi ürünü başka bir
      // atölyeye yönlendirilemez, o yüzden "yönlendirilecek" denemez.
      sellerManufacturerId: true,
    },
  });

  // Refused before anything moves. Revoking first and then failing the
  // hand-off left the admin with a half-done action and a client message that
  // blamed a race and invited a retry that could never succeed. The hand-off
  // UPDATE below repeats the guard for a refund landing after this read.
  if (targetManufacturerId && current && isRefunded(current)) {
    return NextResponse.json(
      { error: REFUNDED_HANDOFF_ERROR, reason: "refunded" },
      { status: 409 }
    );
  }

  // Validate the target up front so we don't revoke and then fail to reassign.
  let target: { id: string; companyName: string } | null = null;
  if (targetManufacturerId) {
    const found = await db.query.manufacturers.findFirst({
      where: and(
        eq(manufacturers.id, targetManufacturerId),
        eq(manufacturers.status, "active")
      ),
      columns: { id: true, companyName: true },
    });
    if (!found) {
      return NextResponse.json(
        { error: "Hedef üretici bulunamadı veya aktif değil." },
        { status: 400 }
      );
    }
    target = found;
  }

  if (targetManufacturerId && current?.manufacturerId === targetManufacturerId) {
    return NextResponse.json(
      { error: "Sipariş zaten bu üreticide. Farklı bir üretici seçin." },
      { status: 400 }
    );
  }

  /**
   * PAZARYERİ MÜLKİYETİ — geri alma ÇALIŞMADAN önce.
   *
   * Bağlayıcı kural: satıcının kendi kataloğundan çıkan sipariş yalnız o
   * satıcının atölyesine verilebilir. Kuralın UYGULANDIĞI yer tek atama kapısı
   * (assignManufacturerToOrder, aşağıda); buradaki okuma onun yerine geçmez,
   * iki iş yapar:
   *  1. Admin'i yarım bir işlemle bırakmaz. İade kontrolünde olduğu gibi: önce
   *     geri alıp sonra devri reddetmek siparişi üreticisiz bırakır ve admin'e
   *     bir yarış hatası gösterirdi.
   *  2. Reddi satıcının ADIYLA anlatır ve gerekçeli devir yolunu gösterir —
   *     satıcının atölyesi temelli kapandığında admin'in elinde başka çıkış
   *     kalmıyordu.
   *
   * `declined`/`exclude` listeleri BİLEREK boş: onlar "şu an OTOMATİK verme"
   * sinyalleridir. Satıcı kendi siparişini reddetmiş olsa bile admin onu yine
   * KENDİ atölyesine devredebilmelidir; yapamayacağı tek şey onaysız olarak
   * rakibe vermektir.
   */
  let sellerOverrideUsed = false;
  if (target) {
    const plan = autoAssignPlacementPlan({
      sellerManufacturerId: current?.sellerManufacturerId ?? null,
      declinedManufacturerIds: [],
      excludeManufacturerIds: [],
    });
    if (plan.kind === "seller" && plan.manufacturerId !== target.id) {
      if (!allowSellerOverride) {
        const seller = await db.query.manufacturers
          .findFirst({
            where: eq(manufacturers.id, plan.manufacturerId),
            columns: { companyName: true },
          })
          .catch(() => null);
        const sellerLabel = seller?.companyName
          ? `${seller.companyName} atölyesinin`
          : "bir satıcının";
        return NextResponse.json(
          {
            error:
              `Bu sipariş ${sellerLabel} kendi kataloğundan çıktı: normalde yalnız o atölyeye verilebilir. ` +
              `Yine de devretmek için ekrandaki mülkiyet onayını işaretleyin; yazdığınız sebep denetim kaydına geçer.`,
            reason: "seller_owned",
            requiresSellerOverride: true,
            sellerName: seller?.companyName ?? null,
          },
          { status: 409 }
        );
      }
      sellerOverrideUsed = true;
    }
  }

  // İADE EDİLMİŞ SİPARİŞTE KOPARMA ÖNCE GELİR.
  //
  // Olağan geri alma siparişi KIMILDATIR: durumu `approved`/`paid`e geri sarar,
  // QC turunu artırır ve atölyeyi siparişin kara listesine yazar. Üçü de iade
  // edilmiş siparişte yasaktır ve "önce çağır, reddederse düzelt" diye bir şey
  // yoktur — yazma bir kez olur. Eski hâlde ayrım servisin CEVABINA bakıyordu
  // (yalnız wrong_status/already_shipped dalında koparmaya düşülüyordu), oysa
  // iade edilmiş sipariş geri alınabilir bir alt durumdaysa servis "ok" diyordu:
  // sipariş geri sarılmış, QC turu artmış, atölye kara listeye yazılmış oluyordu.
  // Koparma yolu ise ancak kargolanmış siparişte açılıyordu. Ayrım artık
  // çağrıdan ÖNCE yapılır: iade edilmişse olağan servis hiç çalışmaz.
  let result: RevokeResult =
    !!current && isRefunded(current)
      ? await detachFromRefundedOrder({ orderId: id, adminEmail, reason })
      : await revokeManufacturerAssignment({
          orderId: id,
          adminEmail,
          reason,
          blocklist,
        });

  // Ön okuma ile yazma arasına düşen iade: servis kendi KİLİTLİ okumasında
  // görür ve hiçbir şey yazmadan `refunded` döner (manufacturer-revoke.ts).
  // Devir istenmişse istek tümden reddedilir — yukarıdaki kapının aynısı,
  // çünkü iade edilmiş sipariş başka bir atölyeye verilemez ve sipariş hâlâ
  // el değmemiştir. Düz geri almada koparmaya geçilir.
  if (result.code === "refunded") {
    if (targetManufacturerId) {
      return NextResponse.json(
        { error: REFUNDED_HANDOFF_ERROR, reason: "refunded" },
        { status: 409 }
      );
    }
    result = await detachFromRefundedOrder({ orderId: id, adminEmail, reason });
  }

  if (result.code !== "ok") {
    const messages: Record<string, { message: string; status: number }> = {
      not_found: { message: "Sipariş bulunamadı.", status: 404 },
      not_assigned: {
        message: "Siparişte aktif bir üretici ataması yok.",
        status: 400,
      },
      wrong_status: {
        message:
          "Bu aşamadan sonra atama geri alınamaz (QC onayı verilmiş veya kargolanmış). İade/ihtilaf akışını kullanın.",
        status: 409,
      },
      handed_to_painter: {
        message: "Bu sipariş boyacıya devredildi; üretici ataması geri alınamaz.",
        status: 409,
      },
      already_shipped: {
        message: "Sipariş kargolandı; geri alınamaz. İade akışını kullanın.",
        status: 409,
      },
      lost_race: {
        message:
          "Sipariş bu sırada başka bir işlemle değiştirildi; sayfayı yenileyin.",
        status: 409,
      },
    };
    const m = messages[result.code] ?? {
      message: "Atama geri alınamadı.",
      status: 400,
    };
    return NextResponse.json({ error: m.message }, { status: m.status });
  }

  // Buradan sonrası "GERİ ALMA OLDU" dünyası: koparma/geri alma tek bir
  // işlemde yazıldı ve commit edildi. Aşağıdaki herhangi bir adım patlarsa
  // admin'e "hiçbir şey olmadı" DENEMEZ — bayrak tam da bu ayrımı taşır.
  progress.revoked = true;

  const prevCompany = await db.query.manufacturers
    .findFirst({
      where: eq(manufacturers.id, result.prevManufacturerId),
      columns: { companyName: true },
    })
    .catch(() => null);
  const prevName = prevCompany?.companyName ?? result.prevManufacturerId;

  // İsteğe bağlı devir. Artık TEK ATAMA KAPISINDAN geçer: burada eskiden
  // kapıyı bilerek atlayan ayrı bir korumalı UPDATE vardı ve pazaryeri
  // mülkiyet kuralı yalnız o kapıda yaşadığı için, satıcının kendi katalog
  // ürünü bu uçtan tek çağrıda rakip atölyeye verilebiliyordu.
  //
  // Kapıya geçilen iki seçenek geri almanın anlamını korur:
  //  • `statusGuard: null` — siparişin durumunu geri alma zaten doğruladı ve
  //    gerekiyorsa atanabilir duruma çevirdi (manufacturer-revoke.ts). Kapının
  //    varsayılan durum şartı burada yeni bir ret kapısı açardı: "paid"de
  //    bekleyen (atölye seansı, elle açılmış) siparişlerin devri kırılırdı.
  //  • `skipPrintableCheck: true` — sipariş az önce bir üreticinin tezgâhındaydı;
  //    basılacak içeriği olduğu oradan belli.
  // İade koruması kapının İÇİNDE (notRefundedGuard) durur, yani geri alma ile
  // bu yazma arasına düşen bir iade siparişi yine tezgâha koyamaz. Denetim
  // satırını kapıya YAZDIRMIYORUZ (`adminEmail` geçilmez): aşağıda geri alma +
  // devir tek satırda, sebebiyle birlikte kaydediliyor.
  let reassigned = false;
  let handoffError: string | null = null;
  if (target) {
    try {
      const handoff = await assignManufacturerToOrder({
        orderId: id,
        manufacturerId: target.id,
        statusGuard: null,
        skipPrintableCheck: true,
        // Aşma DENETLENEBİLİR olmak zorunda: kapı bayrağın yanında işlemi yapan
        // admin'i ve gerekçeyi de ister, yoksa aşmayı yok sayıp reddeder. Zaten
        // zorunlu olan `reason` gerekçe yerine geçer. Yalnız aşmada `adminEmail`
        // geçilir: o zaman kapı satıcıyı, hedefi ve gerekçeyi adlandıran kendi
        // denetim satırını yazar (ve satıcıya bildirim gönderir); olağan devirde
        // aşağıdaki tek birleşik satır yeterlidir.
        allowSellerOverride: sellerOverrideUsed,
        ...(sellerOverrideUsed
          ? { adminEmail, sellerOverrideReason: reason }
          : {}),
        notification: {
          subject: `Yeni sipariş atandı — ${result.orderNumber}`,
          body:
            `Sayın ${target.companyName},\n\n` +
            `${result.orderNumber} numaralı sipariş size atandı.\n\n` +
            `Lütfen üretici panelinizden 24 saat içinde kabul veya reddedin.\n\n` +
            `Müşteri: ${current?.customerName ?? ""}`,
        },
      });
      reassigned = handoff.ok;
      if (!handoff.ok) handoffError = ASSIGN_FAILURE_MESSAGES[handoff.reason];
    } catch (e) {
      // Kapı yazmadan da patlayabilir, yazdıktan sonra (bildirim/SSE) da. Geri
      // alma ZATEN yapıldı, bu yüzden 500 dönmek admin'e "hiçbir şey olmadı"
      // der. Siparişin şu an kimde olduğunu okuyup gerçeği söyleriz.
      console.error("revoke: hand-off assign failed", e);
      const after = await db.query.orders
        .findFirst({
          where: eq(orders.id, id),
          columns: { manufacturerId: true },
        })
        .catch(() => null);
      reassigned = after?.manufacturerId === target.id;
      if (!reassigned) {
        handoffError =
          "Devir sırasında beklenmeyen bir hata oluştu; sipariş atanmadan kuyrukta. Sayfayı yenileyip tekrar deneyin.";
      }
    }
  }

  // Did the refund keep the order from going back to work? Either it was
  // refunded before this call (plain revoke) or a refund beat the hand-off
  // write above. A refund is terminal, so the pre-read settles it when it can.
  const refunded =
    !reassigned &&
    ((!!current && isRefunded(current)) || (await isOrderRefunded(id)));

  // Hedefsiz geri alma = sipariş kuyruğa döndü, yani yeniden "onaylı +
  // atanmamış" hâline girdi — otomatik atamanın tetiklendiği geçişlerden biri.
  // Üç durumda yerleştirilmez: admin "kuyruğumda kalsın" dediğinde, sipariş
  // iade edildiyse (ileri işlem yasağı) ve zaten elle devredildiyse.
  // `blocklist` işaretliyse geri alınan üretici declinedManufacturerIds'e
  // yazılır, bu yüzden sıralayıcı siparişi ona geri vermez.
  let autoAssigned = false;
  if (!target && !refunded && !keepInQueue) {
    const placement = await autoAssignIfEligible(id, {
      reason: "atama geri alındı",
      // Kara liste işaretlenmemiş olsa BİLE sipariş, az önce koparıldığı
      // atölyeye saniyeler içinde geri dönmemeli: `blocklist` kalıcı bir
      // "bir daha asla" kaydıdır ve admin çoğu geri almada onu istemez;
      // buradaki dışlama yalnız BU yerleştirme denemesi için geçerlidir.
      excludeManufacturerIds: [result.prevManufacturerId],
    });
    autoAssigned = placement.assigned;
  }

  // Every side effect below is isolated: the order has already moved, so a
  // failing email or Redis must not turn this into a 500 the admin reads as
  // "nothing happened".
  await db
    .insert(adminActions)
    .values({
      orderId: id,
      action: "assign_manufacturer",
      adminEmail,
      notes: reassigned
        ? `Geri alındı: ${prevName} (${result.prevStatus}) → yeniden atandı: ${target!.companyName}${
            sellerOverrideUsed
              ? " [MÜLKİYET DEVRİ: satıcının kendi katalog ürünü, admin onayıyla başka atölyeye verildi — satıcı ve gerekçe ayrı denetim satırında]"
              : ""
          }. Sebep: ${reason}`
        : refunded
          ? `Atama geri alındı: ${prevName} (${result.prevStatus}). Sipariş iade edildiği için kuyruğa dönmedi${target ? `, ${target.companyName} üreticisine devredilmedi` : ""}. Sebep: ${reason}`
          : autoAssigned
            ? `Atama geri alındı: ${prevName} (${result.prevStatus}) → otomatik olarak başka bir üreticiye atandı. Sebep: ${reason}`
            : keepInQueue
              ? `Atama geri alındı: ${prevName} (${result.prevStatus}) → admin isteğiyle kuyrukta bırakıldı (otomatik atama yapılmadı). Sebep: ${reason}`
              : `Atama geri alındı: ${prevName} (${result.prevStatus}) → kuyruğa döndü. Sebep: ${reason}`,
    })
    .catch((e) => console.error("revoke: adminActions insert failed", e));

  // Sipariş şu an satıcının KENDİ katalog ürünü mü ve kaybeden üretici o
  // satıcının kendisi mi? Öyleyse iş tanım gereği başka bir atölyeye
  // gidemez: kural "yalnız sahibi basabilir"dir ve bildirim tam da sahibine
  // gidiyor.
  const sellerManufacturerId = current?.sellerManufacturerId ?? null;
  const heldForSeller =
    !reassigned &&
    !autoAssigned &&
    !refunded &&
    !!sellerManufacturerId &&
    sellerManufacturerId === result.prevManufacturerId;

  // The losing manufacturer's copy must match what happens next. A refunded
  // order is not re-routed anywhere: the job is cancelled, and telling them it
  // goes to another manufacturer was untrue.
  //
  // Aynı şey "başka bir üreticiye yönlendirilecek" cümlesi için de geçerliydi:
  // dört durumda yerleştirme YOKTUR — admin kuyrukta bıraktığında, türün
  // otomatik atama anahtarı kapalıyken, uygun aday çıkmadığında ve satıcının
  // kendi ürününde. Denetim notu (yukarıda) bu dalları zaten ayırıyordu;
  // partnere giden yazı ayırmıyordu. Artık tek bir yerden, olan bitene göre
  // kurulur.
  const nextStepLine = reassigned
    ? "Sipariş başka bir üreticiye devredildi."
    : autoAssigned
      ? "Sipariş başka bir üreticiye yönlendirildi."
      : heldForSeller
        ? "Bu ürün sizin kataloğunuzdan çıktı ve yalnız sizin atölyenizde basılabilir; " +
          "bu yüzden sipariş başka bir atölyeye yönlendirilmeyecek. Şu an yönetici " +
          "kuyruğunda bekliyor, nasıl devam edileceğine yönetici karar verecek."
        : "Sipariş şu an yönetici kuyruğunda bekliyor; başka bir üreticiye " +
          "yönlendirilip yönlendirilmeyeceğine yönetici karar verecek.";

  await notifyManufacturer({
    manufacturerId: result.prevManufacturerId,
    type: "order_unassigned",
    subject: refunded
      ? `Sipariş iade edildi, iş iptal edildi — ${result.orderNumber}`
      : `Sipariş ataması geri alındı — ${result.orderNumber}`,
    body: refunded
      ? `${result.orderNumber} numaralı sipariş müşteriye iade edildi. Bu yüzden ataması ` +
        `yönetici tarafından geri alındı ve iş iptal edildi; bu sipariş için üretime devam etmeyin.\n\n` +
        `Sebep: ${reason}\n\n` +
        `Bu sipariş artık üretici panelinizde görünmeyecektir.`
      : `${result.orderNumber} numaralı siparişin ataması yönetici tarafından geri alındı.\n\n` +
      `${nextStepLine}\n\n` +
      `Sebep: ${reason}\n\n` +
      `Bu sipariş artık üretici panelinizde görünmeyecektir. ` +
      `Yoğunluk nedeniyle sipariş alamıyorsanız panelinizdeki "Sipariş Alıyor" anahtarını kapatabilirsiniz.`,
    orderId: id,
  }).catch((e) =>
    console.error("revoke: losing-manufacturer notify failed", e)
  );

  // Güvenilirlik cezası iade edilmiş siparişte ASLA yazılmaz: ceza "alınan işi
  // yarıda bırakmak"ın bedelidir, oysa burada işi bitiren iadedir ve atölyenin
  // bir kusuru yoktur. `refunded` birkaç satır yukarıda hesaplanıyor ama burada
  // hiç sorulmuyordu; ekran kutuyu gizlediği için (client.tsx
  // `strike: !refunded && revokeStrike`) canlıda görünmüyordu, ama uca doğrudan
  // istek atan herhangi bir istemci cezayı yazdırabiliyordu — üstelik ceza eşiğe
  // gelmiş bir atölyeyi askıya aldırabilir. Kapı sunucuda durur.
  if (strike && !refunded) {
    await applyStrike(result.prevManufacturerId).catch((e) =>
      console.error("revoke: applyStrike failed", e)
    );
  }

  // The old manufacturer's panel only listens on its own topic, so the drop
  // needs its own emit — a single event cannot reach both sides.
  await emitOrderChanged({
    orderId: id,
    orderNumber: result.orderNumber,
    userId: result.userId,
    manufacturerId: result.prevManufacturerId,
    status: result.orderStatus,
    manufacturerStatus: "unassigned",
  }).catch((e) => console.error("revoke: emit (old manufacturer) failed", e));

  // Yeni üreticinin bildirimi ve SSE yayını ARTIK BURADA YOK: ikisini de atama
  // kapısı yapıyor (yukarıdaki `notification` metniyle). Burada tekrarlamak
  // partnere aynı işi iki kez haber vermek olurdu.

  return NextResponse.json({
    success: true,
    reassigned,
    // Sipariş hedefsiz geri alındıktan sonra otomatik olarak yerleşti mi, yoksa
    // admin isteğiyle kuyrukta mı kaldı — istemci mesajı bunu söylemeli.
    autoAssigned,
    keptInQueue: keepInQueue,
    prevStatus: result.prevStatus,
    prevManufacturer: prevName,
    // Devir neden olmadı: istemci "başkası aldı" diye yarışı suçlayıp
    // tekrar denemesin, gerçek sebebi göstersin.
    ...(handoffError ? { handoffError } : {}),
    // Sipariş satıcının kendi ürünü olduğu için mi kuyrukta kaldı? Ekranın
    // "uygun aday bulunamadı ya da otomatik atama kapalı" cümlesi burada yanlış.
    ...(heldForSeller ? { heldForSeller: true as const } : {}),
    // Tells the client why the order went neither back to the queue nor to
    // the chosen manufacturer, so it does not blame a race and invite a retry.
    ...(refunded ? { reason: "refunded" as const } : {}),
  });
}

/**
 * Beklenmeyen hata = GÖVDESİ OLAN cevap.
 *
 * Rotanın bütün işi tek bir yerden geçirilir, çünkü buradaki okumalar ve geri
 * alma işlemi fırlattığında Next'in varsayılan 500'üne düşülüyordu: admin
 * ekranına SIFIR BAYT gövde, yani ne olduğuna dair tek kelime yok. (QA'da
 * görüldü: manufacturer_actions tablosu okunamazken işlemin içindeki denetim
 * satırı patladı; güvenli taraf doğruydu — işlem geri sarıldı, sipariş ve
 * hakediş bit bit aynı kaldı — ama ekranda hiçbir şey yazmıyordu.)
 *
 * Bilebildiğimiz kadarını söyleriz ve İKİ HÂLİ ayırırız, çünkü admin'e
 * verilecek öğüt bu ayrıma bağlı:
 *  • Geri alma yazılmadan patladıysa yazma tek işlemdir ve geri sarılır; o
 *    sipariş el değmemiştir, güvenle tekrar denenebilir.
 *  • Yazıldıktan sonra patladıysa (bildirim, denetim satırı, otomatik
 *    yerleştirme) sipariş KIMILDAMIŞTIR; "tekrar deneyin" demek olmuş bir işi
 *    ikinci kez yaptırmaya çalışmak olurdu.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const progress: RevokeProgress = { revoked: false };
  try {
    return await handleRevoke(request, ctx, progress);
  } catch (e) {
    console.error("revoke: beklenmeyen hata", e);
    return NextResponse.json(
      {
        error: progress.revoked
          ? "Atama geri alındı, ancak sonraki adımlar (yeniden atama, bildirim, denetim kaydı) tamamlanamadı. Sayfayı yenileyip siparişin şu anki durumunu kontrol edin."
          : "Beklenmeyen bir hata nedeniyle atama geri alınamadı; siparişte hiçbir şey değişmedi. Sayfayı yenileyip tekrar deneyin, sorun sürerse teknik ekibe bildirin.",
        reason: "unexpected_error",
      },
      { status: 500 }
    );
  }
}
