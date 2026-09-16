import { and, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturerActions,
  manufacturers,
  orders,
  painterActions,
  painterQcPhotos,
  painters,
  qcPhotos,
  adminActions,
} from "@/lib/db/schema";
import { QC_MIN_PHOTOS } from "@/lib/config/qc";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";
import { manufacturerBaseKurus } from "@/lib/services/earning-base";
import { accrueEarning } from "@/lib/services/payouts";
import { accruePainterEarning } from "@/lib/services/painter-payouts";
import { qcNextStatus, type ManufacturerOrderStatus } from "@/lib/services/qc";
import { painterQcNextStatus, type PainterOrderStatus } from "@/lib/services/painter-qc";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
import { notifyPainter } from "@/lib/services/painter-notifications";
import { notifyCustomer } from "@/lib/services/customer-notifications";
import { sendSms } from "@/lib/services/sms";
import { getEmailQueue } from "@/lib/queue/queues";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { modelAckRefusal, readPartnerModelAck } from "@/lib/services/order-model-revision";
import {
  MANUFACTURER_ACK_BLOCKED_ACTIONS,
  MODEL_ACK_REQUIRED_ERROR,
  PAINTER_ACK_BLOCKED_ACTIONS,
  type PartnerKind,
} from "@/lib/config/partner-model-ack";
import type { Carrier } from "@/lib/services/carriers";

/**
 * P2-C4 — Admin, partnerin KENDİ adımını onun yerine yapar.
 *
 * Neden tek modül: bir partner telefonda "kabul ettim, bastım, kargoladım" der
 * ama panele girmez; sipariş kilitlenir. Admin'in bunu panelden yapabilmesi
 * gerekir. Tehlike şudur: aynı geçişi admin tarafında YENİDEN yazmak, partnerin
 * kendi rotasından bir KOPYA üretir ve kopya kaçınılmaz olarak ayrışır — en
 * pahalısı da parada ayrışır (hakediş hiç doğmaz ya da yanlış tabandan doğar).
 *
 * Bu yüzden her adım TEK bir fonksiyondur ve tutar HER İKİ yolda da aynı
 * servislerden çıkar: `manufacturerBaseKurus` + `accrueEarning` (üretici) ve
 * `accruePainterEarning` (boyacı). Bu modül hiçbir hakediş satırını KENDİSİ
 * yazmaz; para yalnız o iki servisten geçer (scripts/test-order-status-policy.ts
 * bunu ayrıca kurala bağlar).
 *
 * Her adımın kapısı partnerin kendi rotasındaki kapının aynısıdır: durum şartı
 * atomik UPDATE'in WHERE'inde durur, iade koruması (`notRefundedGuard()`) her
 * yazmada tekrarlanır (refund-end-state: iade edilmiş siparişte hiçbir ileri
 * adım yapılamaz) ve ıska hâlinde okunaklı bir Türkçe ret döner.
 *
 * Gerekçe ZORUNLUDUR: admin tıklaması bir partner hakedişi doğurabildiği için,
 * her işlem denetim kaydına (admin_actions) VE partnerin kendi zaman çizelgesine
 * (manufacturer_actions / painter_actions) admin damgasıyla yazılır; partnere
 * ayrıca bildirim gider. Partner "ben yapmadım" diyebilmeli, kimin neden yaptığı
 * kendi ekranında görünmeli.
 *
 * NOT: "server-only" İMPORT EDİLMEZ (worker zincirine girerse worker crash-loop
 * olur), ama bu modül yalnız admin rotalarından çağrılır.
 */

/**
 * C4'ün sözleşmesi: admin'in partner adına yapabileceği adımlar.
 *
 * `start_printing` SONRADAN eklendi: admin üreticinin adına işi KABUL
 * edebiliyordu ama baskıyı başlatamıyordu, çünkü listede o adım yoktu ve
 * admin'in kendi /start-printing ucu yalnız üreticisi OLMAYAN siparişi tanır.
 * Sipariş "kabul edildi"de, yani tam da bu mekanizmanın çözmesi gereken yerde
 * kilitli kalıyordu.
 */
export const ON_BEHALF_ACTIONS = [
  "accept",
  "start_printing",
  "printed",
  "submit_qc",
  "ship",
] as const;
export type OnBehalfAction = (typeof ON_BEHALF_ACTIONS)[number];

export function isOnBehalfAction(v: unknown): v is OnBehalfAction {
  return typeof v === "string" && (ON_BEHALF_ACTIONS as readonly string[]).includes(v);
}

/**
 * Gerekçe barajı. Atama devri gerekçesiyle (SELLER_OVERRIDE_REASON_MIN_LENGTH)
 * aynı sayı: admin için tek bir "gerekçe yeterince uzun mu" hissi olsun.
 */
export const ON_BEHALF_REASON_MIN_LENGTH = 10;

/** Türkçe hata metni ya da null (gerekçe geçerli). SAF: DB'ye dokunmaz. */
export function onBehalfReasonError(reason: unknown): string | null {
  if (typeof reason !== "string" || !reason.trim()) {
    return "Partner adına işlem yapmak için gerekçe zorunludur.";
  }
  if (reason.trim().length < ON_BEHALF_REASON_MIN_LENGTH) {
    return `Gerekçe en az ${ON_BEHALF_REASON_MIN_LENGTH} karakter olmalı; denetim kaydına ve partnerin zaman çizelgesine bu metin yazılır.`;
  }
  return null;
}

export type PartnerHolder = "manufacturer" | "painter" | "none";

/**
 * Siparişi ŞU AN kim tutuyor: adım onun adına yapılır.
 *
 * Boyacıya devredilmiş bir sipariş fiziksel olarak boyacıdadır, üretici payını
 * çoktan almıştır — bu yüzden boyacı önce gelir. SAF: DB'ye dokunmaz, testten
 * doğrudan çağrılır.
 */
export function partnerHoldingOrder(o: {
  manufacturerId: string | null;
  manufacturerStatus: string | null;
  painterId: string | null;
  painterStatus: string | null;
}): PartnerHolder {
  if (o.painterId && o.painterStatus && o.painterStatus !== "unassigned") return "painter";
  if (o.manufacturerId) return "manufacturer";
  return "none";
}

export interface OnBehalfArgs {
  orderId: string;
  action: OnBehalfAction;
  adminEmail: string;
  reason: string;
  /** Yalnız `ship` için. */
  trackingNumber?: string;
  carrier?: Carrier;
}

export type OnBehalfFailureCode =
  | "reason_required"
  | "not_found"
  | "refunded"
  | "no_partner"
  | "partner_inactive"
  | "wrong_state"
  | "tracking_required"
  | "carrier_required"
  | "model_ack_required"
  // Onay günlüğü OKUNAMADI: geçici arıza (503), kural ihlali değil. Ayrı kod,
  // çünkü admin'e "onay bekleniyor" demek OLMAYAN bir yüklemeyi anlatmaktı.
  | "ack_log_unreadable"
  | "unsupported_step"
  | "workshop"
  | "qc_photos_missing";

export type OnBehalfResult =
  | {
      ok: true;
      partner: "manufacturer" | "painter";
      partnerId: string;
      action: OnBehalfAction;
      status: string | null;
      partnerStatus: string | null;
    }
  | { ok: false; code: OnBehalfFailureCode; error: string; httpStatus: number };

/**
 * Ret üreticisi. Dönüş tipi bilerek birleşimin YALNIZ başarısız üyesidir:
 * ön kontrol ve onay kapısı gibi "ya devam ya ret" dönen yerler, bir ret
 * değerinin asla başarı gibi okunamayacağını tipten bilmelidir.
 */
const fail = (
  code: OnBehalfFailureCode,
  error: string,
  httpStatus: number
): Extract<OnBehalfResult, { ok: false }> => ({ ok: false, code, error, httpStatus });

/** Partnerin zaman çizelgesine yazılan admin damgası. */
export function adminStampNote(adminEmail: string, reason: string, extra?: string): string {
  const tail = extra ? ` — ${extra}` : "";
  return `[Admin adına: ${adminEmail}] Gerekçe: ${reason}${tail}`;
}

/** Denetim kaydındaki (admin_actions) not. */
function auditNote(
  partner: "manufacturer" | "painter",
  action: OnBehalfAction,
  reason: string,
  extra?: string
): string {
  const who = partner === "manufacturer" ? "Üretici" : "Boyacı";
  const label = ACTION_LABEL_TR[action];
  return `${who} adına "${label}" yapıldı. Gerekçe: ${reason}${extra ? ` — ${extra}` : ""}`;
}

const ACTION_LABEL_TR: Record<OnBehalfAction, string> = {
  accept: "işi kabul et",
  start_printing: "baskıyı başlat",
  printed: "üretimi bitir",
  submit_qc: "QC'ye gönder",
  ship: "kargola",
};

/**
 * admin_actions.action bir pg ENUM'udur ve bu faz migration açmaz; geri
 * alınamayan bir enum değeri eklemek de kural dışıdır. Bu yüzden var olan
 * değerler yeniden kullanılır ve gerçek anlam NOT alanında durur — geri alma
 * rotasının (unstart-printing) çoktan kurduğu düzen.
 */
const AUDIT_ACTION: Record<OnBehalfAction, "edit" | "print" | "ship"> = {
  accept: "edit",
  start_printing: "print",
  printed: "print",
  submit_qc: "edit",
  ship: "ship",
};

interface OrderContext {
  id: string;
  orderNumber: string;
  userId: string;
  email: string;
  phone: string | null;
  customerName: string;
  finish: string;
  status: string | null;
  paymentStatus: string | null;
  manufacturerId: string | null;
  manufacturerStatus: string | null;
  painterId: string | null;
  painterStatus: string | null;
  qcRound: number;
  painterQcRound: number;
  amountKurus: number;
  productionBaseKurus: number | null;
  paintingPriceKurus: number;
  needsPainting: boolean;
  workshopSessionId: string | null;
}

/**
 * Bozuk bir kimlik Postgres'te 22P02 fırlatır ve rotadan HTML 500 olarak kaçar.
 * Kapı BURADA duruyor ki bu servisi çağıran her uç (admin'in kargo uçları ve
 * ship-kargo dahil) aynı okunaklı "Sipariş bulunamadı." 404'ünü versin.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOrder(orderId: string): Promise<OrderContext | null> {
  if (!UUID_RE.test(orderId)) return null;
  const row = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: {
      id: true,
      orderNumber: true,
      userId: true,
      email: true,
      phone: true,
      customerName: true,
      finish: true,
      status: true,
      paymentStatus: true,
      manufacturerId: true,
      manufacturerStatus: true,
      painterId: true,
      painterStatus: true,
      qcRound: true,
      painterQcRound: true,
      amountKurus: true,
      productionBaseKurus: true,
      paintingPriceKurus: true,
      needsPainting: true,
      workshopSessionId: true,
    },
  });
  return (row as OrderContext | undefined) ?? null;
}

/**
 * Bir on-behalf adımının partnerin KENDİ rotasındaki karşılığı.
 *
 * Model onayı kapısı (config/partner-model-ack.ts) rota adlarıyla yazılmıştır;
 * eşleme tek yerde durur, yoksa kapı burada sessizce açık kalırdı. Boyacıda
 * `start_printing` yoktur (boyacının baskısı yok) ve `printed` boyamanın
 * bitmesidir — o adım onay beklemez, çünkü boyacının engellenen adımları
 * yalnız QC ve kargodur.
 */
export const PARTNER_ROUTE_ACTION: Record<
  PartnerKind,
  Partial<Record<OnBehalfAction, string>>
> = {
  manufacturer: {
    accept: "accept",
    start_printing: "start-printing",
    printed: "finish-printing",
    submit_qc: "submit-qc",
    ship: "ship",
  },
  painter: {
    accept: "accept",
    printed: "painted",
    submit_qc: "submit-qc",
    ship: "ship",
  },
};

/**
 * PARA KAPISI: onaylanmamış yeni bir model sürümü varken admin, partnerin
 * adına ileri adım atamaz.
 *
 * Partnerin kendi rotaları bu kapıyı uyguluyor (409 + aynı Türkçe cümle); bu
 * modül uygulamazsa "partner adına kargola" kapıyı aşmanın TEK yolu olur —
 * üstelik en pahalı adımda, çünkü kargo partner hakedişini tahakkuk ettirir ve
 * müşteriye "kargolandı" postası atar. Eski sürüme basılmış bir parça bu
 * yoldan çıkarsa hakediş de o yanlış işten doğar.
 */
async function modelAckGate(
  orderId: string,
  partner: { kind: PartnerKind; id: string },
  action: OnBehalfAction
): Promise<Extract<OnBehalfResult, { ok: false }> | null> {
  const routeAction = PARTNER_ROUTE_ACTION[partner.kind][action];
  if (!routeAction) return null;
  const blocked =
    partner.kind === "manufacturer"
      ? (MANUFACTURER_ACK_BLOCKED_ACTIONS as readonly string[]).includes(routeAction)
      : (PAINTER_ACK_BLOCKED_ACTIONS as readonly string[]).includes(routeAction);
  if (!blocked) return null;

  const ack = await readPartnerModelAck(orderId, partner);
  // Ret TEK kaynaktan (modelAckRefusal) — partnerin KENDİ rotalarıyla aynı
  // yardımcı. Burada eskiden yalnız `ack.pending` okunuyordu; readPartnerModelAck
  // arızada TEMKİNLE pending:true döndüğü için, onay günlüğü okunamadığında
  // admin'e "yeni bir model sürümü yüklendi, onaylayın" deniyordu: sistemin
  // BİLMEDİĞİ bir olay. Üstelik o cümlenin işaret ettiği onayı
  // recordPartnerModelAck aynı arızada reddediyor, yani admin'in önerilen
  // çıkışı yok. Kapı iki dalda da KAPALI kalır; ayrışan yalnız gerekçe ve
  // HTTP kodu (kural 409, geçici arıza 503).
  const refusal = modelAckRefusal(ack);
  if (!refusal) return null;
  if (refusal.code === "ack_log_unreadable") {
    return fail("ack_log_unreadable", refusal.error, refusal.status);
  }
  return fail("model_ack_required", MODEL_ACK_REQUIRED_ERROR, refusal.status);
}

export interface OnBehalfPreflight {
  ok: true;
  partner: "manufacturer" | "painter";
  partnerId: string;
}

/**
 * Yazmadan ÖNCEKİ okunabilirlik kapısı.
 *
 * Yurtiçi kargo ucu için şart: kargo çağrısı DIŞ bir sistemde gönderi yaratır,
 * bu yüzden "bu sipariş zaten kargolanabilir mi" sorusunun cevabı gönderi
 * yaratılmadan önce bilinmelidir. Yarışa karşı asıl kapı yine atomik UPDATE'tir.
 */
export async function onBehalfPreflight(args: {
  orderId: string;
  action: OnBehalfAction;
  reason: string;
}): Promise<OnBehalfPreflight | Extract<OnBehalfResult, { ok: false }>> {
  const reasonError = onBehalfReasonError(args.reason);
  if (reasonError) return fail("reason_required", reasonError, 400);

  const order = await loadOrder(args.orderId);
  if (!order) return fail("not_found", "Sipariş bulunamadı.", 404);
  // Refund-end-state: okunaklı ret burada; yarışa kapalı yarısı her UPDATE'in
  // WHERE'indeki notRefundedGuard().
  if (isRefunded(order)) return fail("refunded", REFUNDED_ORDER_ERROR, 409);

  const holder = partnerHoldingOrder(order);
  if (holder === "none") {
    return fail(
      "no_partner",
      "Bu siparişte üretici ya da boyacı yok; partner adına işlem yapılamaz. Platformun kendi kargoladığı siparişler için normal kargo adımını kullanın.",
      400
    );
  }
  const partnerId = holder === "painter" ? order.painterId! : order.manufacturerId!;

  if (holder === "manufacturer") {
    const m = await db.query.manufacturers.findFirst({
      where: eq(manufacturers.id, partnerId),
      columns: { id: true, status: true },
    });
    if (!m || m.status !== "active") {
      return fail(
        "partner_inactive",
        "Üretici hesabı aktif değil. Siparişi bu üreticiden geri alıp başka bir üreticiye devredin.",
        409
      );
    }
  } else {
    const p = await db.query.painters.findFirst({
      where: eq(painters.id, partnerId),
      columns: { id: true, status: true },
    });
    if (!p || p.status !== "active") {
      return fail(
        "partner_inactive",
        "Boyacı hesabı aktif değil. İşi bu boyacıdan geri alıp başka bir boyacıya devredin.",
        409
      );
    }
  }

  // Onay kapısı ön kontrolün İÇİNDE: ship-kargo ucu bu fonksiyonu Yurtiçi
  // gönderisini yaratmadan ÖNCE çağırır; kapı yalnız asıl adımda dursaydı
  // reddedilen her istek için önce dış sistemde bir gönderi yaratılıp sonra
  // iptal edilirdi.
  const ackRefusal = await modelAckGate(
    args.orderId,
    { kind: holder, id: partnerId },
    args.action
  );
  if (ackRefusal) return ackRefusal;

  return { ok: true, partner: holder, partnerId };
}

/**
 * C4: partnerin adımını partnerin KENDİ servisiyle çalıştırır, denetim satırını
 * yazar ve partnerin zaman çizelgesine admin damgasını basar.
 */
export async function onBehalfOfPartner(args: OnBehalfArgs): Promise<OnBehalfResult> {
  const pre = await onBehalfPreflight({
    orderId: args.orderId,
    action: args.action,
    reason: args.reason,
  });
  if (!("ok" in pre) || pre.ok !== true) return pre;

  const order = await loadOrder(args.orderId);
  if (!order) return fail("not_found", "Sipariş bulunamadı.", 404);

  const reason = args.reason.trim();
  const tracking = args.trackingNumber?.trim();
  if (args.action === "ship" && !tracking) {
    return fail("tracking_required", "Kargo takip numarası zorunludur.", 400);
  }
  // Kargo FİRMASI da zorunlu: firmasız bir takip numarasından müşteriye
  // gösterilecek takip bağlantısı kurulamıyor (trackingUrl firmasız null
  // döner) ve müşteri elinde açılmayan bir numarayla kalıyordu. Admin'in
  // kendi kargo ucu bunu zaten şart koşuyor; partner adına kargolarken
  // gevşetmek aynı kaydı iki türlü bırakırdı.
  if (args.action === "ship" && !args.carrier) {
    return fail(
      "carrier_required",
      "Kargo firmasını seçin; firmasız takip numarasından müşteriye takip bağlantısı kurulamıyor.",
      400
    );
  }

  const result =
    pre.partner === "manufacturer"
      ? await runManufacturerStep({
          order,
          manufacturerId: pre.partnerId,
          action: args.action,
          adminEmail: args.adminEmail,
          reason,
          trackingNumber: tracking,
          carrier: args.carrier,
        })
      : await runPainterStep({
          order,
          painterId: pre.partnerId,
          action: args.action,
          adminEmail: args.adminEmail,
          reason,
          trackingNumber: tracking,
          carrier: args.carrier,
        });

  if (!result.ok) return result;

  // Denetim kaydı: hangi admin, hangi partner adına, hangi gerekçeyle.
  await db
    .insert(adminActions)
    .values({
      orderId: order.id,
      action: AUDIT_ACTION[args.action],
      adminEmail: args.adminEmail,
      notes: auditNote(
        pre.partner,
        args.action,
        reason,
        tracking ? `Takip: ${tracking}` : undefined
      ),
    })
    .catch((e) => console.error("on-behalf: adminActions insert failed", e));

  return result;
}

interface StepArgs {
  order: OrderContext;
  action: OnBehalfAction;
  adminEmail: string;
  reason: string;
  trackingNumber?: string;
  carrier?: Carrier;
}

// ─── Üretici adımları ───────────────────────────────────────────────────────

async function runManufacturerStep(
  args: StepArgs & { manufacturerId: string }
): Promise<OnBehalfResult> {
  const { order, manufacturerId, adminEmail, reason } = args;
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, manufacturerId),
    columns: { id: true, companyName: true, paintsInHouse: true },
  });
  if (!manufacturer) return fail("not_found", "Üretici bulunamadı.", 404);

  const stamp = adminStampNote(
    adminEmail,
    reason,
    args.trackingNumber ? `Takip: ${args.trackingNumber}` : undefined
  );

  switch (args.action) {
    case "accept": {
      // Üretici rotasının kapısının aynısı: assigned → accepted, komisyon oranı
      // kabul anında dondurulur (sonradan değişen oran geçmişe işlemesin).
      const [updated] = await db
        .update(orders)
        .set({
          manufacturerStatus: "accepted",
          manufacturerAcceptedAt: new Date(),
          commissionRateBps: sql`COALESCE(${orders.commissionRateBps}, ${PLATFORM_COMMISSION_RATE_BPS})`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.manufacturerId, manufacturerId),
            eq(orders.manufacturerStatus, "assigned"),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail(
          "wrong_state",
          "Sipariş kabul edilebilir durumda değil (üretici durumu 'atandı' olmalı).",
          400
        );
      }
      await stampManufacturerTimeline(order.id, manufacturerId, "accept", stamp);
      await announceToManufacturer(manufacturerId, order, "işi kabul etti", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
        manufacturerStatus: updated.manufacturerStatus,
      }).catch(() => {});
      return okResult("manufacturer", manufacturerId, args.action, updated.status, updated.manufacturerStatus);
    }

    case "start_printing": {
      // Üretici rotasının kapısının aynısı: accepted → printing.
      const [updated] = await db
        .update(orders)
        .set({
          manufacturerStatus: "printing",
          status: "printing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.manufacturerId, manufacturerId),
            eq(orders.manufacturerStatus, "accepted"),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail(
          "wrong_state",
          "Sipariş 'kabul edildi' durumunda değil; baskı başlatılamaz.",
          400
        );
      }
      await stampManufacturerTimeline(order.id, manufacturerId, "start_printing", stamp);
      // Müşteriye "baskıya başlandı" postası, üreticinin kendi rotasındakiyle
      // aynı; geçiş yazıldığı için kuyruk arızası 500'e çevrilmez.
      await getEmailQueue()
        .add("printing", {
          type: "order_printing",
          to: updated.email,
          orderNumber: updated.orderNumber,
          customerName: updated.customerName,
        })
        .catch((e) => console.error("on-behalf printing email enqueue failed", e));
      await announceToManufacturer(manufacturerId, order, "baskıyı başlattı", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
        manufacturerStatus: updated.manufacturerStatus,
      }).catch(() => {});
      return okResult("manufacturer", manufacturerId, args.action, updated.status, updated.manufacturerStatus);
    }

    case "printed": {
      const [updated] = await db
        .update(orders)
        .set({
          manufacturerStatus: "printed",
          manufacturerPrintedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.manufacturerId, manufacturerId),
            eq(orders.manufacturerStatus, "printing"),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail(
          "wrong_state",
          "Sipariş 'baskıda' değil; üretim bitmiş olarak işaretlenemez.",
          400
        );
      }
      await stampManufacturerTimeline(order.id, manufacturerId, "finish_printing", stamp);
      await announceToManufacturer(manufacturerId, order, "üretimi bitirdi", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
        manufacturerStatus: updated.manufacturerStatus,
      }).catch(() => {});
      return okResult("manufacturer", manufacturerId, args.action, updated.status, updated.manufacturerStatus);
    }

    case "submit_qc": {
      const current = (order.manufacturerStatus ?? "") as ManufacturerOrderStatus;
      const next = qcNextStatus(current, "submit");
      if (!next) {
        return fail("wrong_state", "Sipariş QC'ye gönderilebilir durumda değil.", 400);
      }
      // Sözleşme her QC turu için en az dört fotoğraf ister; admin adına
      // göndermek bu şartı kaldırmaz, çünkü QC'nin bakacağı şey fotoğraftır.
      const [photoRow] = await db
        .select({ value: count() })
        .from(qcPhotos)
        .where(and(eq(qcPhotos.orderId, order.id), eq(qcPhotos.round, order.qcRound)));
      if (Number(photoRow?.value ?? 0) < QC_MIN_PHOTOS) {
        return fail(
          "qc_photos_missing",
          `Bu turda en az ${QC_MIN_PHOTOS} QC fotoğrafı olmadan incelemeye gönderilemez.`,
          400
        );
      }
      const [updated] = await db
        .update(orders)
        .set({ manufacturerStatus: next, status: "quality_check", updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.manufacturerId, manufacturerId),
            eq(orders.manufacturerStatus, current),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail("wrong_state", "Sipariş QC'ye gönderilebilir durumda değil.", 400);
      }
      await stampManufacturerTimeline(
        order.id,
        manufacturerId,
        "submit_qc",
        `${stamp} — tur ${order.qcRound}`
      );
      await announceToManufacturer(manufacturerId, order, "QC'ye gönderdi", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
        manufacturerStatus: updated.manufacturerStatus,
      }).catch(() => {});
      return okResult("manufacturer", manufacturerId, args.action, updated.status, updated.manufacturerStatus);
    }

    case "ship": {
      // Atölye partisi tek tek kargolanmaz (mekana tek sevkiyat gider).
      if (order.workshopSessionId) {
        return fail(
          "workshop",
          "Bu sipariş bir atölye partisine ait ve tek tek kargolanamaz; parti mekana tek sevkiyatla gönderilir.",
          409
        );
      }
      const [updated] = await db
        .update(orders)
        .set({
          manufacturerStatus: "shipped",
          status: "shipped",
          trackingNumber: args.trackingNumber!,
          carrier: args.carrier ?? null,
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.manufacturerId, manufacturerId),
            // QC kapısı: yalnız QC onayından geçmiş iş kargolanır.
            eq(orders.manufacturerStatus, "qc_approved"),
            isNull(orders.workshopSessionId),
            notRefundedGuard(),
            // Boyama payı olan sipariş ancak "kendim boyarım" üreticisinde ve
            // boyacıya DEVREDİLMEMİŞSE üreticiden çıkabilir; devredilmişse
            // kargoyu boyacı yapar. Bu şart, iki hakedişi birbirini dışlar
            // tutan invaryanttır.
            manufacturer.paintsInHouse
              ? or(eq(orders.needsPainting, false), isNull(orders.painterId))
              : eq(orders.needsPainting, false)
          )
        )
        .returning();
      if (!updated) {
        return fail(
          "wrong_state",
          "Sipariş kargolanabilir durumda değil (önce QC onayı gerekir; boyamalı sipariş boyacıdan çıkar).",
          400
        );
      }
      await stampManufacturerTimeline(order.id, manufacturerId, "ship", stamp);

      // PARA: tutar bu dosyada HESAPLANMAZ. Üreticinin kendi rotasındaki iki
      // servisin aynısı çağrılır, böylece hakediş birebir aynı doğar.
      const earningBaseKurus = manufacturerBaseKurus({
        amountKurus: updated.amountKurus,
        productionBaseKurus: updated.productionBaseKurus,
        paintingPriceKurus: updated.paintingPriceKurus,
        painterId: updated.painterId,
        paintsInHouse: manufacturer.paintsInHouse,
      });
      await accrueEarning(updated.id, manufacturerId, earningBaseKurus).catch((e) =>
        console.error("on-behalf accrueEarning failed (non-fatal)", e)
      );

      await notifyShippedCustomer(updated, args.trackingNumber!);
      await announceToManufacturer(
        manufacturerId,
        order,
        `kargoladı (takip: ${args.trackingNumber})`,
        adminEmail,
        reason
      );
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
        manufacturerStatus: updated.manufacturerStatus,
      }).catch(() => {});
      return okResult("manufacturer", manufacturerId, args.action, updated.status, updated.manufacturerStatus);
    }
  }
}

// ─── Boyacı adımları ────────────────────────────────────────────────────────

async function runPainterStep(
  args: StepArgs & { painterId: string }
): Promise<OnBehalfResult> {
  const { order, painterId, adminEmail, reason } = args;
  const stamp = adminStampNote(
    adminEmail,
    reason,
    args.trackingNumber ? `Takip: ${args.trackingNumber}` : undefined
  );

  switch (args.action) {
    // Boyacının baskısı yoktur: iş ona basılmış olarak gelir. Sıradaki adımı
    // "boyamayı bitirdi"dir (aşağıdaki `printed`).
    case "start_printing":
      return fail(
        "unsupported_step",
        "Boyacı tarafında 'baskıyı başlat' adımı yok; boyacının sıradaki adımı 'boyamayı bitirdi'dir.",
        400
      );

    case "accept": {
      const [updated] = await db
        .update(orders)
        .set({ painterStatus: "accepted", updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.painterId, painterId),
            eq(orders.painterStatus, "assigned"),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail("wrong_state", "İş kabul edilebilir durumda değil (boyacı durumu 'atandı' olmalı).", 400);
      }
      await stampPainterTimeline(order.id, painterId, "accept", stamp);
      await announceToPainter(painterId, order, "işi kabul etti", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
      }).catch(() => {});
      return okResult("painter", painterId, args.action, updated.status, updated.painterStatus);
    }

    case "printed": {
      // Boyacı tarafında "üretimi bitir"in karşılığı boyamanın bitmesidir.
      const [updated] = await db
        .update(orders)
        .set({ painterStatus: "painted", paintedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.painterId, painterId),
            inArray(orders.painterStatus, ["accepted", "painting"]),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail("wrong_state", "İş bu durumda 'boyandı' olarak işaretlenemez.", 400);
      }
      await stampPainterTimeline(order.id, painterId, "painted", stamp);
      await announceToPainter(painterId, order, "boyamayı bitirdi", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
      }).catch(() => {});
      return okResult("painter", painterId, args.action, updated.status, updated.painterStatus);
    }

    case "submit_qc": {
      const current = (order.painterStatus ?? "") as PainterOrderStatus;
      const next = painterQcNextStatus(current, "submit");
      if (!next) return fail("wrong_state", "İş QC'ye gönderilebilir durumda değil.", 400);
      const [photoRow] = await db
        .select({ value: count() })
        .from(painterQcPhotos)
        .where(
          and(
            eq(painterQcPhotos.orderId, order.id),
            eq(painterQcPhotos.round, order.painterQcRound)
          )
        );
      if (Number(photoRow?.value ?? 0) < QC_MIN_PHOTOS) {
        return fail(
          "qc_photos_missing",
          `Bu turda en az ${QC_MIN_PHOTOS} boyama QC fotoğrafı olmadan incelemeye gönderilemez.`,
          400
        );
      }
      const [updated] = await db
        .update(orders)
        .set({ painterStatus: next, updatedAt: new Date() })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.painterId, painterId),
            eq(orders.painterStatus, current),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) return fail("wrong_state", "İş QC'ye gönderilebilir durumda değil.", 400);
      await stampPainterTimeline(
        order.id,
        painterId,
        "submit_qc",
        `${stamp} — tur ${order.painterQcRound}`
      );
      await announceToPainter(painterId, order, "QC'ye gönderdi", adminEmail, reason);
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
      }).catch(() => {});
      return okResult("painter", painterId, args.action, updated.status, updated.painterStatus);
    }

    case "ship": {
      const [updated] = await db
        .update(orders)
        .set({
          painterStatus: "shipped",
          status: "shipped",
          trackingNumber: args.trackingNumber!,
          carrier: args.carrier ?? null,
          shippedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.painterId, painterId),
            // Boyacı QC kapısı: yalnız QC onaylı iş kargolanır.
            eq(orders.painterStatus, "qc_approved"),
            notRefundedGuard()
          )
        )
        .returning();
      if (!updated) {
        return fail(
          "wrong_state",
          "İş kargolanabilir durumda değil (önce boyama QC onayı gerekir).",
          400
        );
      }
      await stampPainterTimeline(order.id, painterId, "ship", stamp);

      // PARA: boyacının kendi rotasındaki servisin aynısı, aynı tabandan.
      await accruePainterEarning(updated.id, painterId, updated.paintingPriceKurus).catch((e) =>
        console.error("on-behalf accruePainterEarning failed (non-fatal)", e)
      );

      await notifyShippedCustomer(updated, args.trackingNumber!);
      await announceToPainter(
        painterId,
        order,
        `kargoladı (takip: ${args.trackingNumber})`,
        adminEmail,
        reason
      );
      await emitOrderChanged({
        orderId: updated.id,
        orderNumber: updated.orderNumber,
        userId: updated.userId,
        manufacturerId: updated.manufacturerId,
        status: updated.status,
      }).catch(() => {});
      return okResult("painter", painterId, args.action, updated.status, updated.painterStatus);
    }
  }
}

// ─── Ortak yardımcılar ──────────────────────────────────────────────────────

function okResult(
  partner: "manufacturer" | "painter",
  partnerId: string,
  action: OnBehalfAction,
  status: string | null,
  partnerStatus: string | null
): OnBehalfResult {
  return { ok: true, partner, partnerId, action, status, partnerStatus };
}

/**
 * Partnerin KENDİ zaman çizelgesine yazılır ve eylem adı partnerin kendi
 * rotasının yazdığıyla AYNIDIR — böylece üretici panelindeki çizelge satırı
 * doğru etiketle çıkar; admin damgası notta durur.
 */
async function stampManufacturerTimeline(
  orderId: string,
  manufacturerId: string,
  action: string,
  notes: string
): Promise<void> {
  await db
    .insert(manufacturerActions)
    .values({ orderId, manufacturerId, action, notes })
    .catch((e) => console.error("on-behalf manufacturerActions insert failed", e));
}

async function stampPainterTimeline(
  orderId: string,
  painterId: string,
  action: string,
  notes: string
): Promise<void> {
  await db
    .insert(painterActions)
    .values({ orderId, painterId, action, notes })
    .catch((e) => console.error("on-behalf painterActions insert failed", e));
}

async function announceToManufacturer(
  manufacturerId: string,
  order: OrderContext,
  what: string,
  adminEmail: string,
  reason: string
): Promise<void> {
  await notifyManufacturer({
    manufacturerId,
    type: "system_announcement",
    subject: `Siparişinizde sizin adınıza işlem yapıldı — ${order.orderNumber}`,
    body:
      `${order.orderNumber} numaralı siparişte Figurünica ekibi sizin adınıza "${what}" adımını kaydetti.\n` +
      `İşlemi yapan: ${adminEmail}\nGerekçe: ${reason}\n\n` +
      `Bu adımı siz yapmadıysanız lütfen hemen bize yazın.`,
    orderId: order.id,
  }).catch((e) => console.error("on-behalf notifyManufacturer failed", e));
}

async function announceToPainter(
  painterId: string,
  order: OrderContext,
  what: string,
  adminEmail: string,
  reason: string
): Promise<void> {
  await notifyPainter({
    painterId,
    type: "system_announcement",
    subject: `İşinizde sizin adınıza işlem yapıldı — ${order.orderNumber}`,
    body:
      `${order.orderNumber} numaralı işte Figurünica ekibi sizin adınıza "${what}" adımını kaydetti.\n` +
      `İşlemi yapan: ${adminEmail}\nGerekçe: ${reason}\n\n` +
      `Bu adımı siz yapmadıysanız lütfen hemen bize yazın.`,
    orderId: order.id,
  }).catch((e) => console.error("on-behalf notifyPainter failed", e));
}

/**
 * Kargo bildirimi müşteriye partnerin kendi rotasındakiyle aynı üç kanaldan
 * gider: uygulama içi bildirim, SMS ve e-posta. Hepsi geçişten SONRA koşar ve
 * tek tek yutulur — kargo yazıldıktan sonra bir kuyruk hatası 500 döndürmemeli.
 */
async function notifyShippedCustomer(
  order: {
    id: string;
    userId: string;
    orderNumber: string;
    customerName: string;
    email: string;
    phone: string | null;
    finish: string;
  },
  trackingNumber: string
): Promise<void> {
  await notifyCustomer({
    userId: order.userId,
    orderId: order.id,
    type: "order_shipped",
    title: "Siparişiniz kargolandı",
    body: `${order.orderNumber} numaralı siparişiniz kargoya verildi. Takip no: ${trackingNumber}`,
  }).catch((e) => console.error("on-behalf notifyCustomer failed", e));
  await sendSms(
    order.phone,
    `Figurünica: ${order.orderNumber} siparişiniz kargolandı. Takip: ${trackingNumber}`
  ).catch((e) => console.error("on-behalf sendSms failed", e));
  await getEmailQueue()
    .add("shipped", {
      type: "order_shipped",
      to: order.email,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      finish: order.finish,
      trackingNumber,
    })
    .catch((e) => console.error("on-behalf shipped email enqueue failed", e));
}
