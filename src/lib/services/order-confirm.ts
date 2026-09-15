import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, users } from "@/lib/db/schema";
import { getEmailQueue } from "@/lib/queue/queues";
import type { Locale } from "@/lib/i18n/types";
import { issueGuestClaimToken } from "@/lib/services/password-reset";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import {
  assignManufacturerToOrder,
  isOrderRefunded,
  orderHasPrintableContent,
} from "@/lib/services/manufacturer-assign";
import {
  commitAssignmentEvaluation,
  discardAssignmentEvaluation,
  rankForOrderWithShadow,
} from "@/lib/services/manufacturer-assignment-shadow";
import { EXCLUDED_THIS_ATTEMPT_REASON } from "@/lib/services/manufacturer-assignment";
import { getModelGenerationQueue } from "@/lib/queue/queues";
import { isFlagEnabled } from "@/lib/services/flags";
import {
  autoAssignFlagFor,
  autoAssignPlacementPlan,
  autoAssignRowGate,
  classifyAutoAssignOrder,
  type AutoAssignSkip,
} from "@/lib/config/flags";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { reserveSpend, releaseSpend } from "@/lib/services/spend-guard";
import { resolveTargetHeightMm } from "@/lib/config/sizes";
import { CONTENT_CONSENT_VERSION_MESHY } from "@/lib/config/content-consent";
import { getCreditBalance, MESHY_CREDITS_PER_ORDER } from "@/lib/services/meshy";

/**
 * Kick off post-payment processing for an order that is already in `status='paid'`.
 *
 * A paid custom order takes one of two roads:
 *
 *  - `generating` when the auto-3D pipeline is eligible (see
 *    `autoModelEligibility`), which hands it to the Meshy worker chain.
 *  - `awaiting_model` otherwise. That is TODAY's behaviour, byte for byte, and
 *    it is also the kill switch: flipping `auto_model_enabled` off puts every
 *    new order back on the manual road with no code path removed.
 *
 * Upload orders (customer supplied their own mesh) go straight to `review` for
 * manufacturer assignment, as before.
 *
 * Idempotent: only the first caller transitioning from `paid` succeeds; the
 * rest are no-ops. No queue work, so no crash-revert dance is needed.
 */
/**
 * Why an order may or may not take the automatic road.
 *
 * Returned as a reason rather than a boolean so the fallback is explainable in
 * the admin panel: "this one went manual because the size is bespoke" is a
 * different operational fact from "we were out of Meshy credit".
 */
export async function autoModelEligibility(order: {
  orderType: string | null;
  previewId: string | null;
  uploadedModelId: string | null;
  figurineSize: string | null;
  contentConsentVersion: string | null;
}): Promise<{ eligible: true } | { eligible: false; reason: string }> {
  if (!(await isFlagEnabled("auto_model_enabled"))) {
    return { eligible: false, reason: "auto_model_disabled" };
  }
  if (order.orderType !== "custom") return { eligible: false, reason: "not_custom" };
  if (!order.previewId) return { eligible: false, reason: "no_preview" };
  if (order.uploadedModelId) return { eligible: false, reason: "customer_supplied_model" };

  if (!resolveTargetHeightMm(order.figurineSize).ok) {
    return { eligible: false, reason: "bespoke_size" };
  }

  // Consent given for the OLD processor list does not cover Meshy. KVKK art. 3
  // requires açık rıza to be specific; an order whose consent predates the
  // Meshy disclosure goes down the manual road rather than being sent abroad
  // under a permission its buyer never gave.
  if (
    !order.contentConsentVersion ||
    order.contentConsentVersion < CONTENT_CONSENT_VERSION_MESHY
  ) {
    return { eligible: false, reason: "consent_predates_meshy" };
  }

  const minBalance = Number(process.env.MESHY_MIN_CREDIT_BALANCE ?? 60);
  const balance = await getCreditBalance().catch(() => -1);
  if (balance >= 0 && balance < Math.max(minBalance, MESHY_CREDITS_PER_ORDER)) {
    return { eligible: false, reason: "low_meshy_balance" };
  }

  return { eligible: true };
}

export async function kickOffOrderProcessing(orderId: string, locale: Locale) {
  const result = await db.transaction(async (tx) => {
    // Row-lock to serialize concurrent kickoff calls (admin replay + webhook race).
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) {
      throw new Error("Order not found");
    }

    // Idempotency: only kick off from the freshly-paid state.
    if (order.status !== "paid") {
      return { order, action: "noop" as const };
    }

    // Upload orders: the model is already a print-ready mesh — skip straight to
    // review for manufacturer assignment.
    if (order.uploadedModelId) {
      await tx
        .update(orders)
        .set({ status: "review", updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      return { order, action: "upload" as const };
    }

    // Custom orders: either the automatic pipeline or today's manual road.
    // The eligibility check runs OUTSIDE this transaction (it makes a network
    // call), so it is decided before the lock is taken — see below.
    await tx
      .update(orders)
      .set({ status: "awaiting_model", updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    return { order, action: "awaiting_model" as const };
  });

  if (result.action === "noop") return;

  // Promote awaiting_model -> generating when the auto-3D road is open. Done
  // after the transaction so a slow provider call never holds a row lock, and
  // guarded on the status we just wrote so a concurrent admin action wins.
  let finalStatus: string = result.action === "upload" ? "review" : "awaiting_model";
  if (result.action === "awaiting_model") {
    const eligibility = await autoModelEligibility(result.order);
    if (eligibility.eligible) {
      const round = (result.order.modelGenerationRound ?? 0) + 1;
      // Reserve before enqueueing: a job that cannot afford its provider call
      // should never be created.
      const reservation = await reserveSpend("meshy", 0, {
        kind: "order",
        id: result.order.id,
      });
      const promoted = await db
        .update(orders)
        .set({ status: "generating", modelGenerationRound: round, updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.status, "awaiting_model")))
        .returning({ id: orders.id });

      if (promoted.length > 0) {
        try {
          await getModelGenerationQueue().add(
            "step",
            { orderId, round, stage: "create" as const },
            { jobId: `model-gen:${orderId}:${round}` }
          );
          finalStatus = "generating";
        } catch (err) {
          // Enqueue failed after the status write: put it back on the manual
          // road rather than leaving a paid order stuck in `generating` with
          // no job behind it.
          console.error(`[order-confirm] enqueue failed for ${orderId}; reverting`, err);
          await db
            .update(orders)
            .set({ status: "awaiting_model", updatedAt: new Date() })
            .where(and(eq(orders.id, orderId), eq(orders.status, "generating")));
        }
      }
      if (reservation.ok) await releaseSpend(reservation.reservationId);
    } else {
      console.info(
        `[order-confirm] order=${orderId} stays manual: ${eligibility.reason}`
      );
    }
  }

  await emitOrderChanged({
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
    userId: result.order.userId,
    manufacturerId: result.order.manufacturerId,
    status: finalStatus,
  });

  await sendOrderConfirmationEmails(result.order, locale);
}

/**
 * Best-effort customer emails after an order is confirmed: the order
 * confirmation, plus a guest "claim your account" link if the buyer checked out
 * without a password. Shared by the custom kickoff and the marketplace kickoff.
 * Never throws — email failures must not roll back order processing.
 */
export async function sendOrderConfirmationEmails(
  order: {
    id: string;
    email: string;
    orderNumber: string;
    customerName: string;
    userId: string;
  },
  locale: Locale
) {
  try {
    await getEmailQueue().add("confirmation", {
      type: "order_confirmation",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      locale,
    });
  } catch (err) {
    console.error(
      `sendOrderConfirmationEmails: confirmation enqueue failed for ${order.id}`,
      err
    );
  }

  // Q6: if the buyer placed this order as a guest (no password set), send
  // them a separate "claim your account" email with a 30-day token that
  // lets them set a password and access /account.
  try {
    const buyer = await db.query.users.findFirst({
      where: eq(users.id, order.userId),
      columns: { id: true, isGuest: true, email: true, fullName: true },
    });
    if (buyer?.isGuest) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
      const { claimUrl } = await issueGuestClaimToken(buyer.id, appUrl);
      await getEmailQueue().add("guest-claim", {
        type: "guest_account_claim",
        to: buyer.email,
        orderNumber: order.orderNumber,
        customerName: buyer.fullName,
        claimUrl,
        locale,
      });
    }
  } catch (err) {
    console.error(
      `sendOrderConfirmationEmails: guest claim enqueue failed for ${order.id}`,
      err
    );
  }
}

/**
 * Marketplace counterpart to kickOffOrderProcessing. A marketplace order skips
 * AI generation / mesh entirely — the product to print already exists. Three
 * shapes land here:
 *
 *  1. Seller-owned product — the seller was auto-assigned at promotion
 *     (manufacturerStatus='assigned'); we just notify them.
 *  2. Platform (admin-owned) catalogue product — nobody is assigned yet, but
 *     the product HAS print files (enforced at product approval). It stays at
 *     `paid`, which is an assignable status, and we try to auto-assign the
 *     best-scoring manufacturer right away.
 *  3. Admin-typed WhatsApp order — no productId, no order_items, so there is
 *     genuinely nothing to print yet. It goes to `awaiting_model` so the admin
 *     can upload a model, exactly as before.
 *
 * Shapes 2 and 3 used to be conflated: every seller-less marketplace order was
 * pushed to `awaiting_model`, which is NOT an assignable status — so a paid
 * platform-product order could never reach a manufacturer at all, and the
 * customer's tracker claimed "Modeliniz Hazırlanıyor" for a stock item.
 *
 * Idempotent at the notification layer (best-effort).
 */
export async function kickOffMarketplaceOrder(
  order: {
    id: string;
    email: string;
    orderNumber: string;
    customerName: string;
    userId: string;
    sellerManufacturerId: string | null;
    productTitleSnapshot: string | null;
  },
  locale: Locale
) {
  if (order.sellerManufacturerId) {
    try {
      const productLine = order.productTitleSnapshot
        ? `\nÜrün: ${order.productTitleSnapshot}`
        : "";
      await notifyManufacturer({
        manufacturerId: order.sellerManufacturerId,
        type: "order_assigned",
        subject: `Yeni pazaryeri siparişi: ${order.orderNumber}`,
        body: `${order.orderNumber} numaralı pazaryeri siparişiniz var.${productLine}\n\nMüşteri: ${order.customerName}\n\nLütfen ürünü hazırlayıp kargolayın.`,
        orderId: order.id,
      });
    } catch (err) {
      console.error(
        `kickOffMarketplaceOrder: seller notify failed for ${order.id}`,
        err
      );
    }
  } else if (await orderHasPrintableContent(order.id)) {
    // Shape 2. Leave the status at `paid` — it is already assignable — and try
    // to place it. A failure here is never fatal: the order simply stays
    // unassigned and shows up in the admin's "atanmamış" bucket.
    // Never throws (see autoAssignIfEligible), so no try/catch is needed here.
    await autoAssignIfEligible(order.id, { reason: "ödeme alındı" });
  } else {
    // Shape 3.
    await db
      .update(orders)
      .set({ status: "awaiting_model", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await emitOrderChanged({
      orderId: order.id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      status: "awaiting_model",
    });
  }

  await sendOrderConfirmationEmails(order, locale);
}

/**
 * [ATAMA] notunu siparişe EKLER ve admin'e e-posta atar.
 *
 * Neden yalnız console.warn olmaz: uygun üretici bulunamayan sipariş sessizce
 * atanmamış kalır ve kimse haberdar olmaz — otomatik atamanın tek görünür
 * başarısızlığı budur. Üretici reddi akışı (manufacturer-decline.ts) aynı iki
 * şeyi yapar; burada da aynısı yapılır ki sahibi tek bir yerde
 * ("siparişin admin notu" + posta kutusu) her iki sebebi de görsün.
 *
 * Not SQL'de birleştirilir (araya giren [SLA]/[N12] bayrakları kaybolmasın) ve
 * satır biçimi tek kaynaktan gelir (formatAdminNoteLine).
 */
async function flagManualAssignment(args: {
  orderId: string;
  orderNumber: string;
  reason: string;
}): Promise<void> {
  const note = formatAdminNoteLine(`[ATAMA] Otomatik atama yapılamadı: ${args.reason}. Sipariş atanmamış bekliyor; /admin/orders üzerinden elle üretici atayın.`);
  try {
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));
  } catch (err) {
    console.error(`[ATAMA] not yazılamadı: ${args.orderNumber}`, err);
  }

  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
  try {
    await getEmailQueue().add("admin-auto-assign-failed", {
      type: "admin_custom",
      to: adminEmail,
      orderNumber: args.orderNumber,
      customerName: "Admin",
      customSubject: `Otomatik atama yapılamadı — ${args.orderNumber}`,
      customBody:
        `${args.orderNumber} numaralı sipariş otomatik olarak bir üreticiye atanamadı.\n\n` +
        `Sebep: ${args.reason}\n\n` +
        `Sipariş atanmamış olarak bekliyor. /admin/orders üzerinden elle üretici atayın ` +
        `ya da üretici kapasitesi/etki alanı ayarlarını gözden geçirin.`,
      locale: "tr",
    });
  } catch (err) {
    console.error(`[ATAMA] admin e-postası kuyruğa alınamadı: ${args.orderNumber}`, err);
  }
}

/**
 * P1-C1 — "onaylı + atanmamış" hâline giren HER sipariş için otomatik üretici
 * ataması. Tek giriş noktasıdır: admin onayı, admin model yükleme, müşteri
 * model onayı, onay SLA'sının otomatik onayı, toplu onay, atamanın geri
 * alınması ve ödeme sonrası pazaryeri akışı hepsi bunu çağırır.
 *
 * HER sipariş üzerinde çağrılması güvenlidir: siparişi yeniden okur, türünün
 * anahtarına bakar, iade korumasını ve "onaylı + atanmamış" şartını uygular,
 * sıralar, atomik atar. Uygun aday yoksa [ATAMA] notu yazıp admin'e posta atar.
 *
 * İKİ SIRALAMA-DIŞI KURAL (autoAssignPlacementPlan):
 *  - Satıcının kendi katalog ürünü (`sellerManufacturerId` dolu) YALNIZ kendi
 *    atölyesine atanır; kendi atölyesi alamıyorsa sipariş admin'e bırakılır.
 *    Sıralamaya hiç girmez, çünkü orada rakip bir atölye kazanabilirdi.
 *  - `excludeManufacturerIds`, o denemeye özgü dışlamadır (geri alınan atölye).
 *
 * ASLA fırlatmaz: çağıranların çoğu (onay, model yükleme, toplu işlem) zaten
 * COMMIT olmuş bir geçişin ardından çağırır; burada atılan bir hata o geçişi
 * geri almaz, yalnızca admin'e "işlem başarısız" yalanını söylerdi. Çağıran
 * isterse `.catch` ile ateşle-unut da yapabilir.
 *
 * Sıralama ham sıralayıcıya değil Q7 gölge sarmalayıcısına gider, böylece
 * otomatik atamalar admin arayüzü ve red-yeniden atama ile AYNI telemetriye
 * düşer (ranker-rollout kararı: skor değişiklikleri önce gölgede).
 */
export async function autoAssignIfEligible(
  orderId: string,
  opts?: {
    reason?: string;
    /**
     * Bu atama denemesinde HARİÇ tutulacak atölyeler. Siparişin kalıcı
     * reddedenler listesinden (declinedManufacturerIds) ayrıdır: geri alma
     * "kara listeye ekle" işaretlenmeden yapıldığında bile sipariş az önce
     * koparıldığı atölyeye anında geri dönmemelidir.
     */
    excludeManufacturerIds?: string[];
  }
): Promise<{
  assigned: boolean;
  manufacturerId?: string;
  skipped?: AutoAssignSkip;
}> {
  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        orderType: true,
        manufacturerId: true,
        manufacturerStatus: true,
        workshopSessionId: true,
        attributionChannel: true,
        productId: true,
        parentReference: true,
        // Pazaryeri ürününün sahibi. Otomatik atama bunu bilmek ZORUNDA:
        // satıcının kendi ürünü rakip bir atölyeye gönderilemez.
        sellerManufacturerId: true,
        declinedManufacturerIds: true,
      },
    });
    if (!order) return { assigned: false, skipped: "not_eligible" };

    // Sepet alt siparişi ürünlerini satırlarında taşır (orders→items ilişkisi
    // yok), tür kararı bunu bilmek zorunda.
    const [lineItem] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .limit(1);
    const shape = { ...order, hasOrderItems: !!lineItem };

    const kind = classifyAutoAssignOrder(shape);
    const flagKey = autoAssignFlagFor(kind);
    // Atölye siparişinde anahtar YOKTUR: bayrak okumadan çıkılır, böylece
    // kapalı olmayan bir anahtar "açık" diye yorumlanamaz.
    const flagEnabled = flagKey ? await isFlagEnabled(flagKey) : false;

    const gate = autoAssignRowGate(shape, flagEnabled);
    if (gate) return { assigned: false, skipped: gate };

    if (!(await orderHasPrintableContent(orderId))) {
      // Elle yazılmış, modeli henüz yüklenmemiş sipariş buraya düşer. Bu bir
      // arıza değil, beklenen hâldir (sipariş `awaiting_model`'da bekler), bu
      // yüzden not/e-posta YOKTUR — model yüklendiğinde upload-model rotası
      // aynı fonksiyonu yeniden çağırır.
      return { assigned: false, skipped: "not_eligible" };
    }

    // Kime bakılacak: satıcının kendi atölyesi mi, sıralama mı, hiçbiri mi.
    const plan = autoAssignPlacementPlan({
      sellerManufacturerId: order.sellerManufacturerId,
      declinedManufacturerIds: Array.isArray(order.declinedManufacturerIds)
        ? (order.declinedManufacturerIds as string[])
        : [],
      excludeManufacturerIds: opts?.excludeManufacturerIds ?? [],
    });
    if (plan.kind === "skip") {
      // Satıcının kendi ürünü, ama kendi atölyesine verilemiyor. Sıralamaya
      // HİÇ girilmez (girilse rakip atölye kazanırdı): sipariş atanmamış kalır
      // ve admin elle karar verir.
      return { assigned: false, skipped: "not_eligible" };
    }

    let targetManufacturerId: string;
    // Sıralamadan geçildi mi? Değerlendirme satırı YALNIZ o zaman yazılır:
    // satıcının kendi atölyesine yapılan yerleştirme bir sıralama kararı
    // değildir ve beklemede bir taslağı da yoktur.
    const ranked = plan.kind === "rank";
    if (plan.kind === "seller") {
      targetManufacturerId = plan.manufacturerId;
    } else {
      // Dışlama SIRALAMANIN İÇİNDE uygulanır, sonrasında süzülerek değil:
      // sonradan süzmek, kaydedilen kazanan olarak SEÇİLEMEYECEK bir atölyeyi
      // bırakıyordu. Sipariş sayfası da o ayrışmayı gördüğünde "iş elle atanmış
      // olabilir" diyordu — hiç yapılmamış bir insan kararını suçlayarak.
      const candidates = await rankForOrderWithShadow(orderId, {
        excludeManufacturerIds: plan.excluded,
      });
      const best = candidates.find((c) => c.eligible);
      if (!best) {
        // Dışlananlar artık sıralamada "uygun değil" olarak işaretli; sebebi
        // metinden değil sıralayıcının kendi sabitinden okuyoruz.
        const excludedCount = candidates.filter(
          (c) => c.ineligibleReason === EXCLUDED_THIS_ATTEMPT_REASON
        ).length;
        const why =
          candidates.length === 0
            ? "aktif üretici yok"
            : excludedCount > 0
              ? `${excludedCount} atölye bu deneme için dışlandı (atama az önce onlardan geri alındı); kalan ${candidates.length - excludedCount} üreticinin hiçbiri uygun değil`
              : `${candidates.length} üreticinin hiçbiri uygun değil (kapasite / malzeme / sipariş almıyor / daha önce reddetti)`;
        // Sıraladık ama hiçbir işi YERLEŞTİRMEDİK. Taslak düşürülmezse
        // gecikmeli doğrulama, bu arada siparişi başka biri atadığında o
        // atamayı bizim sıralamamızın sonucuymuş gibi kaydeder.
        discardAssignmentEvaluation(orderId);
        await flagManualAssignment({
          orderId,
          orderNumber: order.orderNumber,
          reason: why,
        });
        return { assigned: false, skipped: "no_candidate" };
      }
      targetManufacturerId = best.manufacturerId;
    }

    const trigger = opts?.reason ? ` (${opts.reason})` : "";
    const result = await assignManufacturerToOrder({
      orderId,
      manufacturerId: targetManufacturerId,
      // Az önce kanıtlandı, sıralayıcı da aynı siparişi okudu.
      skipPrintableCheck: true,
      notification: {
        subject: `Yeni sipariş atandı: ${order.orderNumber}`,
        body: `${order.orderNumber} numaralı sipariş otomatik olarak size atandı${trigger}.\n\nÜretici panelinizden 24 saat içinde kabul veya reddedin.`,
      },
    });
    if (!result.ok) {
      // Yarışı kaybettik: ORTADA BİZİM VERDİĞİMİZ BİR KARAR YOK, dolayısıyla
      // hiçbir değerlendirme satırı yazılmamalı. Taslak düşürülmezse gecikmeli
      // doğrulama siparişte o an duran üreticiyi görür ve BAŞKASININ atamasını
      // bizim sıralamamızın sonucuymuş gibi kaydederdi.
      if (ranked) discardAssignmentEvaluation(orderId);
      // Atomik UPDATE eşleşmedi: ya araya bir iade girdi (ileri işlem yasağı)
      // ya da bu sırada başkası siparişi aldı. İkincisi bir arıza değil —
      // sipariş zaten bir üreticide — bu yüzden admin'e posta atılmaz.
      if (await isOrderRefunded(orderId).catch(() => false)) {
        return { assigned: false, skipped: "refunded" };
      }
      if (plan.kind === "seller" && result.reason === "manufacturer_unavailable") {
        // Satıcının atölyesi kapanmış/askıya alınmış. Başka atölyeye otomatik
        // verilemeyeceği için bu, admin'in görmesi gereken bir çıkmazdır.
        await flagManualAssignment({
          orderId,
          orderNumber: order.orderNumber,
          reason:
            "ürünün sahibi olan atölye aktif değil; satıcının kendi ürünü başka bir atölyeye otomatik verilemez",
        });
        return { assigned: false, skipped: "no_candidate" };
      }
      console.info(
        `[ATAMA] ${order.orderNumber} atanamadı (${result.reason}); sipariş bu sırada başka bir işlemle değişmiş olabilir`
      );
      return { assigned: false, skipped: "not_eligible" };
    }

    // Korumalı UPDATE geçti: kararı yaratan sıralama ile kararın kendisi ancak
    // BURADA birbirine bağlanır. Satırı 2,5 sn'lik doğrulama zamanlayıcısına
    // bırakmıyoruz: o zamanlayıcı unref'li, yani kısa ömürlü bir süreçte (betik,
    // tek işlik worker) hiç çalışmadan kaybolur ve karar hiç kaydedilmez.
    if (ranked) await commitAssignmentEvaluation(orderId, targetManufacturerId);

    return { assigned: true, manufacturerId: targetManufacturerId };
  } catch (err) {
    // Beklemedeki değerlendirme taslağını HER durumda düşür. Atama çağırısı
    // "ok değil" dönmek yerine FIRLATIRSA taslak bellekte kalıyor ve gecikmeli
    // doğrulama, bu arada siparişi alan BAŞKA bir aktörün atamasını bizim
    // sıralamamızın sonucu sanarak kaydediyordu. Koşulsuzdur: `ranked` bu kapsamda
    // okunamaz ve okunmasına gerek de yok — sıralama hiç yapılmadıysa düşürme
    // sessiz bir no-op'tur, başarılı atamadan sonra fırlayan hatada ise taslağı
    // commit çoktan almıştır.
    discardAssignmentEvaluation(orderId);
    // Sıralayıcı/DB hatası çağıranın işlemini bozmamalı: geçiş zaten yazıldı,
    // sipariş atanmamış kalır ve admin kuyruğunda görünür.
    console.error(`[ATAMA] otomatik atama hata verdi: ${orderId}`, err);
    return { assigned: false };
  }
}
