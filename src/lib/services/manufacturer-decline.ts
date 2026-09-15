import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, manufacturerActions } from "@/lib/db/schema";
import {
  commitAssignmentEvaluation,
  discardAssignmentEvaluation,
  rankForOrderWithShadow,
} from "@/lib/services/manufacturer-assignment-shadow";
import {
  assignManufacturerToOrder,
  isOrderRefunded,
} from "@/lib/services/manufacturer-assign";
import {
  autoAssignFlagFor,
  autoAssignPlacementPlan,
  classifyAutoAssignOrder,
} from "@/lib/config/flags";
import { isFlagEnabled } from "@/lib/services/flags";
import { isRefunded } from "@/lib/config/order-status-policy";
import { getEmailQueue } from "@/lib/queue/queues";
import { emitOrderChanged } from "@/lib/realtime/emit";

const MAX_DECLINES_BEFORE_ADMIN = 3;

/**
 * Admin notunu EKLER, üzerine YAZMAZ.
 *
 * Dört ayrı çıkış (satıcı kuralı, ret üst sınırı, aday kalmadı, satıcının
 * atölyesi kapalı) aynı cümleyi kuruyor; tek yerde durması, araya giren
 * [SLA]/[ATAMA] bayraklarının ve eşzamanlı bir admin düzenlemesinin ezilmemesi
 * kuralının dördünde birden aynı kalmasını sağlıyor.
 */
async function appendAdminNote(orderId: string, note: string): Promise<void> {
  await db
    .update(orders)
    .set({
      adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = '' THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

/**
 * Best-effort admin notification when an order needs manual assignment.
 * Two trigger paths: hit the decline cap, or no eligible candidate left.
 * Email failure doesn't roll back the decline — the adminNotes flag is the
 * durable signal.
 */
async function notifyAdminManualAssignment(args: {
  orderNumber: string;
  orderId: string;
  reason: string;
  declineCount: number;
}): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
  try {
    await getEmailQueue().add("admin-manual-assignment", {
      type: "admin_custom",
      to: adminEmail,
      orderNumber: args.orderNumber,
      customerName: "Admin",
      customSubject: `Manuel atama gerekli — ${args.orderNumber}`,
      customBody:
        `Sipariş ${args.orderNumber} otomatik üretici atamasından çıktı.\n\n` +
        `Sebep: ${args.reason}\n` +
        `Reddeden üretici sayısı: ${args.declineCount}\n\n` +
        `Lütfen /admin/orders üzerinden manuel olarak bir üretici atayın.`,
      locale: "tr",
    });
  } catch (err) {
    console.error(
      `[N12] admin manual-assignment email enqueue failed for ${args.orderNumber}`,
      err
    );
  }
}

export type DeclineResult =
  | { ok: true; action: "reassigned"; newManufacturerId: string }
  | { ok: true; action: "admin_queue"; reason: string }
  // A refunded order is only detached. It goes neither to another manufacturer
  // nor to the admin queue (which leaves refunded orders out), so neither of
  // the two actions above would be true.
  | { ok: true; action: "released"; reason: "refunded" }
  | { ok: false; reason: string };

/**
 * Manufacturer-initiated decline of an assigned order (N12).
 *
 * Flow:
 *   1. Verify the order is currently `assigned` to this manufacturer. We
 *      don't permit declining an already-`accepted` order — that's abandoning
 *      a job and should go through admin.
 *   2. Atomically:
 *        - Clear manufacturerId + manufacturerStatus
 *        - Append the declining mfg id to declinedManufacturerIds
 *        - Insert a `decline` row in manufacturer_actions (used by the
 *          reliability score)
 *   2a. A refunded order stops here (`released`, reason 'refunded'): the
 *      detach is the whole job, nothing below may move it forward.
 *   3. If declines < MAX_DECLINES_BEFORE_ADMIN, re-place the order through the
 *      SHARED placement rule (`autoAssignPlacementPlan`, the same one automatic
 *      assignment uses): a seller's own catalogue product may go only back to
 *      that seller's shop, anything ownerless is ranked. Previously-declining
 *      manufacturers are ineligible inside the ranking itself.
 *   4. Otherwise (cap hit, seller's shop can't take it, no eligible candidate),
 *      leave the order unassigned with an adminNotes flag — `/admin/orders`
 *      queue picks it up.
 *
 * Returns the chosen path so the API layer can shape its response.
 */
export async function declineOrder(args: {
  orderId: string;
  manufacturerId: string;
  reason?: string;
}): Promise<DeclineResult> {
  const { orderId, manufacturerId, reason } = args;

  // Step 1+2 atomically.
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    if (!order) return { code: "not_found" as const };
    if (order.manufacturerId !== manufacturerId) {
      return { code: "not_yours" as const };
    }
    if (order.manufacturerStatus !== "assigned") {
      return { code: "wrong_status" as const, status: order.manufacturerStatus };
    }

    const declinedList = Array.isArray(order.declinedManufacturerIds)
      ? order.declinedManufacturerIds
      : [];
    // Defensive — avoid duplicate entries if the same manufacturer somehow
    // declines twice (cooldown bypass / replay).
    const nextDeclined = declinedList.includes(manufacturerId)
      ? declinedList
      : [...declinedList, manufacturerId];

    await tx
      .update(orders)
      .set({
        manufacturerId: null,
        manufacturerStatus: "unassigned",
        assignedToManufacturerAt: null,
        declinedManufacturerIds: nextDeclined,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    await tx.insert(manufacturerActions).values({
      orderId,
      manufacturerId,
      action: "decline",
      notes: reason?.slice(0, 500) ?? null,
    });

    return {
      code: "ok" as const,
      declinedCount: nextDeclined.length,
      declinedList: nextDeclined,
      orderNumber: order.orderNumber,
      userId: order.userId,
      // Pazaryeri ürününün SAHİBİ. Yeniden yerleştirme bunu bilmek ZORUNDA:
      // sıralayıcı satıcıyı bilmez, dolayısıyla bu alan olmadan satıcının kendi
      // ürünü rakip bir atölyeye basılmaya gönderilebilirdi.
      sellerManufacturerId: order.sellerManufacturerId,
      // Otomatik atama anahtarı sipariş TÜRÜNE göre seçilir ve tür bu
      // kolonlardan türetilir (classifyAutoAssignOrder). İşlemin içinden
      // taşınıyorlar ki yeniden okunmasınlar: kilit altında görülen hâl,
      // yerleştirme kararını veren hâldir.
      orderType: order.orderType,
      workshopSessionId: order.workshopSessionId,
      attributionChannel: order.attributionChannel,
      productId: order.productId,
      parentReference: order.parentReference,
      // Read under this transaction's row lock, so it is the payment state the
      // detach saw. A refund landing after the commit is caught at the assign.
      refunded: isRefunded(order),
    };
  });

  if (result.code === "not_found") {
    return { ok: false, reason: "not_found" };
  }
  if (result.code === "not_yours") {
    return { ok: false, reason: "not_yours" };
  }
  if (result.code === "wrong_status") {
    return { ok: false, reason: `wrong_status:${result.status}` };
  }

  // Unassign committed: order cleared off the OLD manufacturer. Emit with the
  // declining manufacturerId so that manufacturer's panel drops the order.
  await emitOrderChanged({
    orderId,
    orderNumber: result.orderNumber,
    userId: result.userId,
    manufacturerId,
    manufacturerStatus: "unassigned",
  });

  // A refunded order stops at the detach. Everything below either moves it
  // forward or asks a human to: the ranker writes a
  // manufacturer_assignment_evaluations row, the auto-assign is refused by
  // notRefundedGuard() (and was then reported as a lost race), and the
  // placement / cap branches email the admin to assign or refund an order
  // that is already refunded.
  if (result.refunded) {
    return { ok: true, action: "released", reason: "refunded" };
  }

  // P3 — SIRALAMA ile korumalı UPDATE arasındaki pencere kapalı tutulur.
  //
  // Buradan aşağısı sıralama yapabilir; sıralama beklemede bir değerlendirme
  // taslağı bırakır ve o taslağı yalnız "yerleştirdim"/"yerleştiremedim" kararı
  // kapatabilir. Araya bir hata FIRLARSA (DB, sıralayıcı, bildirim) taslak
  // bellekte kalıyordu ve 2,5 sn'lik gecikmeli doğrulama, o sırada siparişte
  // duran üreticiyi görüp BAŞKASININ atamasını bizim kararımız diye kaydediyordu.
  // Otomatik atama ve tarama yolları bu pencereyi çoktan kapattı; ret yolu da
  // aynı şekilde kapatır.
  try {
    // Step 3: cap check.
    if (result.declinedCount >= MAX_DECLINES_BEFORE_ADMIN) {
      // Review I4: append (don't overwrite) so a concurrent admin note
      // edit isn't clobbered. The newline keeps the audit trail readable.
      const note = `[N12] ${result.declinedCount} manufacturer(s) declined — needs manual assignment.`;
      await appendAdminNote(orderId, note);
      await notifyAdminManualAssignment({
        orderNumber: result.orderNumber,
        orderId,
        reason: `Max declines reached (${result.declinedCount})`,
        declineCount: result.declinedCount,
      });
      return {
        ok: true,
        action: "admin_queue",
        reason: `max_declines_reached:${result.declinedCount}`,
      };
    }

    // Step 3b: bu TÜRÜN otomatik atama anahtarı açık mı?
    //
    // Ret sonrası yeniden yerleştirme de bir YERLEŞTİRMEDİR ve her yerleştirme
    // gibi türünün anahtarına tabidir. Anahtarın tek anlamı "bu türü sistem
    // kendiliğinden dağıtmasın"dır; ret yolu onu okumazsa kapatılmış bir anahtar
    // arkadan dolaşılır — üretici reddeder, sistem siparişi yine kendiliğinden
    // bir başkasına verir. Atölye seansı siparişinin anahtarı YOKTUR
    // (autoAssignFlagFor → null) ve hiçbir zaman otomatik atanmaz; o da buradan
    // admin kuyruğuna düşer.
    const [lineItem] = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .limit(1);
    const kind = classifyAutoAssignOrder({
      orderType: result.orderType,
      workshopSessionId: result.workshopSessionId,
      attributionChannel: result.attributionChannel,
      productId: result.productId,
      parentReference: result.parentReference,
      hasOrderItems: !!lineItem,
    });
    const flagKey = autoAssignFlagFor(kind);
    const flagEnabled = flagKey ? await isFlagEnabled(flagKey) : false;
    if (!flagEnabled) {
      const why = flagKey
        ? `bu sipariş türünün otomatik atama anahtarı kapalı (${kind})`
        : `atölye seansı siparişi otomatik atanmaz (${kind})`;
      await appendAdminNote(
        orderId,
        `[N12] Üretici siparişi reddetti; ${why}. Sipariş atanmamış bekliyor, /admin/orders üzerinden elle üretici atayın.`
      );
      await notifyAdminManualAssignment({
        orderNumber: result.orderNumber,
        orderId,
        reason: `Otomatik atama yapılmadı: ${why}`,
        declineCount: result.declinedCount,
      });
      return {
        ok: true,
        action: "admin_queue",
        reason: flagKey ? `auto_assign_off:${kind}` : "workshop_never_auto_assigned",
      };
    }

    // Step 3a: bu sipariş KİME verilebilir — otomatik atamayla AYNI kural.
    //
    // Kural tek kaynaktan okunur (autoAssignPlacementPlan). Buradaki eski kopya
    // "pazaryeri siparişi ⇒ admin" diyordu ve iki ayrı şekilde yanlıştı: sahibi
    // OLMAYAN platform kataloğu siparişlerini gereksiz yere admin'e yığıyordu, ve
    // asıl kuralı — satıcının ürünü yalnız kendi atölyesine gider — `orderType`
    // üzerinden dolaylı anlatıyordu. Sıralayıcı satıcıyı bilmez; o kopya bir gün
    // kalksa ya da `orderType` başka bir şekil alsa, satıcının kendi ürünü rakip
    // bir atölyede basılırdı.
    //
    // SAHİPSİZ (platform) bir pazaryeri siparişi reddedildiğinde YENİDEN SIRALANIR
    // ve bu doğrudur: ortada korunacak bir satıcı yoktur, iş platformun kendi
    // kataloğundan çıkmıştır ve onu basacak atölyeyi bugüne kadar hep sıralama
    // seçmiştir. Eski kopya bu siparişleri de "pazaryeri" diye admin'e yığıyordu —
    // yani kimsenin ürünü olmadığı hâlde her ret bir insan müdahalesi doğuruyordu.
    // Korunması gereken tek şey MÜLKİYETTİR ve onu yukarıdaki anahtar değil,
    // aşağıdaki plan (ve atamanın kendi mülkiyet kapısı) korur.
    const plan = autoAssignPlacementPlan({
      sellerManufacturerId: result.sellerManufacturerId,
      // Reddeden atölye bu listeye AZ ÖNCE yazıldı: satıcı kendi siparişini
      // reddettiyse plan "skip" olur ve iş rakibe kaymaz.
      declinedManufacturerIds: result.declinedList,
      // Bu denemeye özgü EK dışlama yok: ret kalıcı listeye yazıldı ve sıralayıcı
      // onu siparişin kendi satırından okuyor. İkinci kez dışlamak, adayın
      // uygunsuzluk sebebini "iş az önce bu atölyeden geri alındı" diye yanlış
      // adlandırırdı — admin'in gördüğü gerekçe "reddetti" olmalı.
      excludeManufacturerIds: [],
    });

    if (plan.kind === "skip") {
      // Satıcının kendi katalog ürünü, ama sahibi atölye alamıyor (siparişi
      // reddetti). Sıralamaya HİÇ girilmez: girilseydi rakip bir atölye kazanır ve
      // satıcının ürünü onun tezgâhında basılırdı. Karar admin'indir.
      await appendAdminNote(
        orderId,
        `[N12] Satıcının kendi ürünü: yalnız sahibi atölye basabilir, o atölye de siparişi reddetti. Admin kararı gerekiyor (elle atama ya da iptal/iade).`
      );
      await notifyAdminManualAssignment({
        orderNumber: result.orderNumber,
        orderId,
        reason:
          "Satıcının kendi ürünü — sahibi atölye reddetti; başka atölyeye otomatik verilemez",
        declineCount: result.declinedCount,
      });
      return { ok: true, action: "admin_queue", reason: "marketplace_seller_declined" };
    }

    // Sıralamadan geçildi mi? Değerlendirme satırı (ve onun beklemedeki taslağı)
    // YALNIZ o zaman vardır: satıcının kendi atölyesine yapılan yerleştirme bir
    // sıralama kararı değildir.
    const ranked = plan.kind === "rank";
    let targetManufacturerId: string;
    if (plan.kind === "seller") {
      // Satıcının ürünü, ama reddeden başka bir atölye (admin elle atamış olabilir):
      // iş SAHİBİNE döner, sıralamaya girmez.
      targetManufacturerId = plan.manufacturerId;
    } else {
      // Q7 gölge sarmalayıcısı — admin arayüzüyle aynı otoriter seçim, üstüne
      // paralel değerlendirme. Gölge kaydı sarmalayıcının içinde ateşle-unut
      // olduğu için buradaki bir hata reddi geri almaz.
      const candidates = await rankForOrderWithShadow(orderId, {
        excludeManufacturerIds: plan.excluded,
      });
      // Reddedenleri sıralayıcı siparişin KENDİ satırından okuyup uygunsuz
      // işaretliyor (ret az önce commit edildi), bu yüzden sonradan süzmüyoruz:
      // sonradan süzmek kayda SEÇİLEMEYECEK bir "kazanan" bırakır ve sipariş
      // sayfası o ayrışmayı "iş elle atanmış olabilir" diye açıklardı.
      const next = candidates.find((c) => c.eligible);

      if (!next) {
        // Sıraladık ama hiçbir işi YERLEŞTİRMEDİK. Taslak düşürülmezse gecikmeli
        // doğrulama, bu arada siparişi başka biri atadığında o atamayı bizim
        // sıralamamızın sonucuymuş gibi kaydeder.
        discardAssignmentEvaluation(orderId);
        await appendAdminNote(
          orderId,
          `[N12] No eligible manufacturer left after ${result.declinedCount} decline(s).`
        );
        await notifyAdminManualAssignment({
          orderNumber: result.orderNumber,
          orderId,
          reason: "No eligible manufacturer remaining",
          declineCount: result.declinedCount,
        });
        return {
          ok: true,
          action: "admin_queue",
          reason: "no_eligible_candidate",
        };
      }
      targetManufacturerId = next.manufacturerId;
    }

    // Atomic re-assign via the shared service: it guards on the order still
    // being unassigned (closing the race with a concurrent admin assignment in
    // the gap since ranking), then notifies and emits. `statusGuard: null`
    // because the decline flow has already validated this order's state — the
    // service's default guard is for the admin/auto paths that start cold.
    const assigned = await assignManufacturerToOrder({
      orderId,
      manufacturerId: targetManufacturerId,
      statusGuard: null,
      skipPrintableCheck: true,
      notification: {
        subject: `Yeni sipariş atandı — ${result.orderNumber}`,
        body:
          `Size yeni bir sipariş atandı: ${result.orderNumber}\n\n` +
          `Önceki üretici siparişi reddettiği için otomatik olarak siz görevlendirildiniz.\n\n` +
          `Üretici panelinden detayları görüntüleyebilirsiniz.`,
      },
    });
    if (!assigned.ok) {
      // Sıraladık ama korumalı UPDATE eşleşmedi: ORTADA BİZİM VERDİĞİMİZ BİR KARAR
      // YOK. Taslak düşürülmezse gecikmeli doğrulama siparişte o an duran üreticiyi
      // görür ve BAŞKASININ atamasını bizim sıralamamızın sonucu sanıp kaydeder.
      if (ranked) discardAssignmentEvaluation(orderId);
      // A refund that landed after the detach committed makes the assign's
      // notRefundedGuard() refuse the write. Name that instead of blaming a race
      // with another assignment that never happened. A failed read keeps the old
      // reason rather than failing a decline that already committed.
      if (await isOrderRefunded(orderId).catch(() => false)) {
        return { ok: true, action: "released", reason: "refunded" };
      }
      if (plan.kind === "seller" && assigned.reason === "manufacturer_unavailable") {
        // Ürünün sahibi atölye kapanmış/askıya alınmış. Sipariş başka bir atölyeye
        // otomatik verilemeyeceği için bu, admin'in görmesi gereken bir çıkmazdır
        // — "yarışı kaybettik" demek sebebi gizlerdi.
        await appendAdminNote(
          orderId,
          `[N12] Satıcının kendi ürünü: ürünün sahibi atölye aktif değil, sipariş başka bir atölyeye otomatik verilemez. Admin kararı gerekiyor.`
        );
        await notifyAdminManualAssignment({
          orderNumber: result.orderNumber,
          orderId,
          reason:
            "Satıcının kendi ürünü — sahibi atölye aktif değil; başka atölyeye otomatik verilemez",
          declineCount: result.declinedCount,
        });
        return { ok: true, action: "admin_queue", reason: "seller_shop_unavailable" };
      }
      return {
        ok: true,
        action: "admin_queue",
        reason: "concurrent_assignment_lost_race",
      };
    }

    // Korumalı UPDATE geçti: kararı yaratan sıralama ile kararın kendisi ancak
    // BURADA birbirine bağlanır. Satırı 2,5 sn'lik doğrulama zamanlayıcısına
    // bırakmıyoruz: o zamanlayıcı unref'li (kısa ömürlü süreçte hiç çalışmaz) ve
    // pencere içinde başka birinin atamasını bize mal edebilir.
    if (ranked) await commitAssignmentEvaluation(orderId, targetManufacturerId);

    return { ok: true, action: "reassigned", newManufacturerId: targetManufacturerId };
  } catch (err) {
    // Koşulsuz düşür: sıralama hiç yapılmadıysa sessiz bir no-op'tur, başarılı
    // bir atamadan sonra fırlayan hatada ise taslağı `commit` çoktan almıştır.
    discardAssignmentEvaluation(orderId);
    console.error(`[N12] ret sonrası yerleştirme hata verdi: ${orderId}`, err);
    // Retin KENDİSİ commit oldu (sipariş üreticiden koptu, ret sayıldı): burada
    // hata döndürmek üreticiye "reddedemedin" yalanını söylerdi. Yerleştirme
    // yapılamadığına göre doğru cevap admin kuyruğudur; not en iyi çabadır.
    await appendAdminNote(
      orderId,
      `[N12] Ret sonrası otomatik yerleştirme hata verdi; sipariş atanmamış bekliyor. /admin/orders üzerinden elle üretici atayın.`
    ).catch(() => {});
    return { ok: true, action: "admin_queue", reason: "placement_error" };
  }
}
