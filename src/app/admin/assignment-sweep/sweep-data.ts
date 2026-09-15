import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { AWAITING_MANUFACTURER } from "@/lib/services/admin-order-sql";
import {
  autoAssignFlagFor,
  autoAssignPlacementPlan,
  autoAssignRowGate,
  classifyAutoAssignOrder,
  type AutoAssignOrderKind,
  type AutoAssignOrderShape,
  type AutoAssignPlacementPlan,
  type AutoAssignSkip,
  type FlagKey,
} from "@/lib/config/flags";
import { getAllFlags } from "@/lib/services/flags";
import {
  getCanaryPercent,
  shouldUseV2,
} from "@/lib/config/manufacturer-scoring";
import type { CandidateScore } from "@/lib/services/manufacturer-assignment";
import { rankForOrderPreview } from "@/lib/services/manufacturer-assignment-shadow";
import {
  ASSIGN_FAILURE_MESSAGES,
  orderHasPrintableContent,
} from "@/lib/services/manufacturer-assign";
import { SWEEP_KIND_LABEL_TR } from "./types";
import type {
  AutoAssignSwitches,
  SweepBlock,
  SweepCandidate,
  SweepOrderBase,
  SweepProfile,
  SweepRow,
} from "./types";

/**
 * Atama taramasının SUNUCU tarafı: üretici bekleyen siparişleri yükler ve her
 * biri için "bugün atansa kime giderdi" sorusunu cevaplar.
 *
 * Skor matematiği burada YOKTUR. Tarama, canlı atamanın sıralayıcısını
 * (`rankForOrderPreview` → `rankManufacturersForOrder`) çağırır; ikinci bir
 * kopya olsaydı ekranda gördüğünüz aday ile gerçekte atanan üretici sessizce
 * ayrışabilirdi.
 *
 * Hem sayfa (`page.tsx`) hem HTTP ucu (`/api/admin/assignment-sweep`) bu
 * modülü kullanır, böylece listelenen küme ile uygulanan küme aynı tanımdan
 * gelir (AWAITING_MANUFACTURER — nav rozeti ve sipariş listesiyle de aynı).
 */

/** Aynı anda kaç sipariş sıralansın. Her sıralama üretici başına sorgu açar. */
const SWEEP_CONCURRENCY = 4;

/**
 * Sipariş türü başına otomatik atama anahtarının durumu.
 *
 * Anahtar okuması TEK yerden gelir (`autoAssignFlagFor`), yani otomatik
 * atamanın okuduğu anahtarla ekranın gösterdiği anahtar aynıdır; ikinci bir
 * eşleme tablosu zamanla ayrışırdı. Atölyenin anahtarı YOKTUR: her zaman
 * kapalı görünür, çünkü hiçbir zaman otomatik atanmaz (sahibin kararı).
 */
export function autoAssignSwitchesFromFlags(
  flags: Record<FlagKey, boolean>
): AutoAssignSwitches {
  const kinds = Object.keys(SWEEP_KIND_LABEL_TR) as AutoAssignOrderKind[];
  const out = {} as AutoAssignSwitches;
  for (const kind of kinds) {
    const key = autoAssignFlagFor(kind);
    out[kind] = key === null ? false : flags[key];
  }
  return out;
}

/** Anahtar durumları — tek sorgu (`getAllFlags`), sipariş başına değil. */
export async function loadAutoAssignSwitches(): Promise<AutoAssignSwitches> {
  return autoAssignSwitchesFromFlags(await getAllFlags());
}

/** Yükleyicinin ürettiği çift: ekrana giden alanlar + kural motoruna giden satır. */
export interface PendingSweepOrder {
  base: SweepOrderBase;
  shape: AutoAssignOrderShape;
  /**
   * Siparişin sıralama-DIŞI yerleştirme girdileri. Tarama bunları ekrana
   * taşımaz, yalnız `sweepPlacementPlan` okur.
   */
  ownership: {
    /** Pazaryeri ürününün sahibi (satıcı atölye) — yoksa null. */
    sellerManufacturerId: string | null;
    /** Bu siparişi daha önce reddeden/iptal eden atölyeler. */
    declinedManufacturerIds: string[];
  };
}

/**
 * Bu sipariş KİME bakılarak yerleştirilir: satıcının kendi atölyesi mi,
 * sıralama mı, hiçbiri mi.
 *
 * Kural burada YENİDEN YAZILMAZ; otomatik atamanın kullandığı saf fonksiyonun
 * (`autoAssignPlacementPlan`) aynısı çağrılır. İkinci bir kopya olsaydı tarama,
 * canlı atamanın asla yapmayacağı bir yerleştirmeyi önerebilirdi — pazaryeri
 * siparişinde bu, satıcının ürününü rakibine bastırmak demektir.
 *
 * `excludeManufacturerIds` taramada BOŞTUR: o liste "atama az önce şu
 * atölyeden geri alındı" diyen tek seferlik bir dışlamadır ve taramanın
 * bağlamında karşılığı yok.
 */
export function sweepPlacementPlan(
  pending: PendingSweepOrder
): AutoAssignPlacementPlan {
  return autoAssignPlacementPlan({
    sellerManufacturerId: pending.ownership.sellerManufacturerId,
    declinedManufacturerIds: pending.ownership.declinedManufacturerIds,
    excludeManufacturerIds: [],
  });
}

/**
 * Satıcının kendi ürünü, ama kendi atölyesine de verilemiyor (atama geri
 * alındı ya da siparişi reddetti).
 */
export const SELLER_BLOCKED_TR =
  "Satıcının kendi kataloğundan çıkan sipariş: yalnız satıcının kendi atölyesine atanabilir, o atölye de şu an bu siparişi alamıyor (atama geri alınmış ya da reddetmiş). Rakip bir atölyeye atanamaz — kararı sipariş ekranından elle verin.";

/** Satıcının atölyesi aday listesinde hiç yok (hesabı aktif değil). */
export const SELLER_SHOP_UNAVAILABLE_TR =
  "Satıcının kendi kataloğundan çıkan sipariş, ama satıcının atölyesi aday listesinde yok (hesap aktif değil). Rakip bir atölyeye atanamaz — kararı sipariş ekranından elle verin.";

/** Ekrandaki aday, satıcının atölyesi değilse uygulama bunu der. */
export const SELLER_MISMATCH_TR =
  "Bu sipariş satıcının kendi kataloğundan: yalnız satıcının atölyesine atanabilir, ekranda onaylanan üretici o değil. Taramayı yenileyip tekrar bakın.";

/**
 * `autoAssignRowGate`'in verdiği sebeplerin Türkçesi. Kapıyı burada YENİDEN
 * YAZMIYORUZ: otomatik atamanın kullandığı saf kuralın aynısını çağırıp
 * cevabını çeviriyoruz, yani tarama ile otomatik atama aynı siparişe asla
 * farklı cevap veremez.
 */
export const GATE_BLOCK_TR: Record<AutoAssignSkip, string> = {
  workshop:
    "Atölye seansı siparişi: otomatik atama yok. Üreticiyi seans ekranından onaylayın.",
  // Tarama satır kapısını anahtarsız çağırır (aşağıya bakın): kapalı anahtar
  // satırı ELEMEZ, `autoAssignEnabled = false` olarak işaretler ve ekran onu
  // ayrı onaya bağlar. Bu satır yine de yazılı, çünkü küme kapalı olmalı.
  flag_off: "Bu sipariş türünün otomatik atama anahtarı kapalı.",
  refunded: "İade edilmiş sipariş: ileri işlem yapılamaz.",
  not_eligible:
    "Sipariş artık atanabilir durumda değil: durumu değişmiş ya da bu sırada bir üreticiye atanmış olabilir.",
  // Satır kapısı bu sebebi döndürmez (aday sıralaması ayrı bir adımdır), ama
  // kapalı küme tam olsun: eksik bir anahtar derlemede değil, çalışma anında
  // "undefined" olarak patlardı.
  no_candidate: "Uygun üretici yok.",
};

/** Hiç uygun aday çıkmadığında admin'e ne olduğunu söyleyen tek cümle. */
export function noCandidateMessage(candidates: readonly CandidateScore[]): string {
  if (candidates.length === 0) return "Aktif üretici yok.";
  return `${candidates.length} üreticinin hiçbiri uygun değil (kapasite / malzeme / sipariş almıyor / daha önce reddetti).`;
}

/**
 * Bu sipariş için canary'nin yetkili kıldığı profilin ADI.
 *
 * Sıralamanın kendisi `rankForOrderPreview` içinde aynı kapıdan geçer
 * (shouldUseV2 + yüzde); buradaki kopya yalnızca ekranda "hangi ağırlıklar"
 * yazabilmek içindir, karar vermez.
 *
 * Tarama neden önizleme sıralayıcısını kullanıyor: salt okunur bir işlemdir ve
 * `manufacturer_assignment_evaluations` tablosuna satır yazmamalıdır. Faz 1'in
 * kuralı budur — değerlendirme kaydı yalnızca bir sipariş ATANDIĞINDA düşer,
 * her ekran açılışında değil. Uygulama adımı (POST) bu yüzden gölge
 * sarmalayıcısını (`rankForOrderWithShadow`) çağırır.
 */
function liveProfileFor(orderId: string): SweepProfile {
  return shouldUseV2(orderId, getCanaryPercent()) ? "v2" : "v1";
}

function toSweepCandidate(
  c: CandidateScore,
  sellerOwned = false
): SweepCandidate {
  return {
    sellerOwned,
    manufacturerId: c.manufacturerId,
    companyName: c.companyName,
    city: c.city,
    district: c.district,
    totalScore: c.totalScore,
    currentLoad: c.currentLoad,
    maxConcurrentOrders: c.maxConcurrentOrders,
    reasons: c.reasons,
    scores: c.scores,
  };
}

/** Siparişin kaç gündür üretici beklediği (tam gün, aşağı yuvarlanır). */
function waitingDaysSince(createdAt: Date): number {
  const ms = Date.now() - createdAt.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

/** Yüklenen sipariş kolonlarının, iki tüketicinin de beklediği şekli. */
type OrderRow = {
  id: string;
  orderNumber: string;
  customerName: string;
  shippingAddress: TurkishAddress;
  status: string;
  paymentStatus: string;
  orderType: string;
  manufacturerId: string | null;
  manufacturerStatus: string | null;
  workshopSessionId: string | null;
  attributionChannel: string | null;
  productId: string | null;
  parentReference: string | null;
  // Pazaryeri ürününün sahibi + bu siparişi reddedenler: yerleştirmenin
  // sıralama-dışı iki girdisi. Otomatik atama da tam bu iki kolonu okur.
  sellerManufacturerId: string | null;
  declinedManufacturerIds: unknown;
  amountKurus: number;
  quantity: number;
  isBulk: boolean;
  createdAt: Date;
};

const ORDER_COLUMNS = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  customerName: orders.customerName,
  shippingAddress: orders.shippingAddress,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  orderType: orders.orderType,
  manufacturerId: orders.manufacturerId,
  manufacturerStatus: orders.manufacturerStatus,
  workshopSessionId: orders.workshopSessionId,
  attributionChannel: orders.attributionChannel,
  productId: orders.productId,
  parentReference: orders.parentReference,
  sellerManufacturerId: orders.sellerManufacturerId,
  declinedManufacturerIds: orders.declinedManufacturerIds,
  amountKurus: orders.amountKurus,
  quantity: orders.quantity,
  isBulk: orders.isBulk,
  createdAt: orders.createdAt,
};

function toPending(
  row: OrderRow,
  hasOrderItems: boolean,
  switches: AutoAssignSwitches
): PendingSweepOrder {
  const shape: AutoAssignOrderShape = {
    status: row.status,
    paymentStatus: row.paymentStatus,
    orderType: row.orderType,
    manufacturerId: row.manufacturerId,
    manufacturerStatus: row.manufacturerStatus,
    workshopSessionId: row.workshopSessionId,
    attributionChannel: row.attributionChannel,
    productId: row.productId,
    parentReference: row.parentReference,
    hasOrderItems,
  };
  const kind = classifyAutoAssignOrder(shape);
  return {
    shape,
    ownership: {
      sellerManufacturerId: row.sellerManufacturerId,
      declinedManufacturerIds: Array.isArray(row.declinedManufacturerIds)
        ? (row.declinedManufacturerIds as string[])
        : [],
    },
    base: {
      orderId: row.id,
      orderNumber: row.orderNumber,
      customerName: row.customerName,
      city: row.shippingAddress?.il ?? null,
      // Tür etiketi otomatik atamanın taksonomisinden gelir (anahtarlarla aynı
      // küme), ekrana özel ikinci bir sınıflandırma yazılmaz.
      kind,
      status: row.status,
      amountKurus: row.amountKurus,
      quantity: row.quantity,
      isBulk: row.isBulk,
      createdAt: row.createdAt.toISOString(),
      waitingDays: waitingDaysSince(row.createdAt),
      autoAssignEnabled: switches[kind],
    },
  };
}

/** Üretici bekleyen siparişlerin toplam sayısı (nav rozetiyle aynı tanım). */
export async function countPendingSweepOrders(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(AWAITING_MANUFACTURER);
  return row?.count ?? 0;
}

/**
 * Üretici bekleyen siparişler, EN ESKİSİ ÖNCE: taramanın amacı birikeni
 * eritmek, en uzun bekleyen sipariş en önce görünmeli.
 */
export async function loadPendingSweepOrders(
  limit: number,
  switches: AutoAssignSwitches
): Promise<PendingSweepOrder[]> {
  const rows = (await db
    .select(ORDER_COLUMNS)
    .from(orders)
    .where(AWAITING_MANUFACTURER)
    .orderBy(asc(orders.createdAt))
    .limit(limit)) as OrderRow[];
  if (rows.length === 0) return [];

  // Sepet alt siparişi ürünlerini satırlarında taşır (orders→items ilişkisi
  // yok). Sipariş başına sorgu yerine tek gruplu sorgu.
  const ids = rows.map((r) => r.id);
  const itemRows = await db
    .select({ orderId: orderItems.orderId })
    .from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .groupBy(orderItems.orderId);
  const withItems = new Set(itemRows.map((r) => r.orderId));

  return rows.map((r) => toPending(r, withItems.has(r.id), switches));
}

/**
 * Tek sipariş — uygulama adımı için. Burada AWAITING_MANUFACTURER filtresi
 * YOKTUR: sipariş tarama ile onay arasında değişmiş olabilir ve "artık uygun
 * değil" cevabını verebilmek için satırı okumamız gerekir.
 */
export async function loadSweepOrderById(
  orderId: string,
  switches: AutoAssignSwitches
): Promise<PendingSweepOrder | null> {
  const [row] = (await db
    .select(ORDER_COLUMNS)
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)) as OrderRow[];
  if (!row) return null;

  const [item] = await db
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .limit(1);
  return toPending(row, !!item, switches);
}

/**
 * Bir siparişin kuru taraması: hangi üreticiye giderdi, ya da neden gitmezdi.
 *
 * Sıra, otomatik atamanın sırasının aynısıdır (satır kapısı → basılabilir
 * içerik → MÜLKİYET → sıralama); yalnız TEK farkla: kapıya `flagEnabled = true` geçilir,
 * yani kapalı anahtar satırı ELEMEZ. Sebebi: kapalı bir anahtarın arkasında ne
 * biriktiğini admin'in görebilmesi gerekir. Anahtar bilgisi kaybolmaz, satırda
 * `autoAssignEnabled` olarak taşınır; ekran o satırları seçili GETİRMEZ ve
 * uygulama ucu onları ayrı bir onay olmadan atamaz.
 */
export async function evaluateSweepOrder(
  pending: PendingSweepOrder
): Promise<SweepRow> {
  const { base, shape } = pending;
  const profile = liveProfileFor(base.orderId);
  const row = (block: SweepBlock | null, extra?: Partial<SweepRow>): SweepRow => ({
    ...base,
    candidate: null,
    runnerUp: null,
    block,
    ineligible: [],
    profile,
    ...extra,
  });

  const gate = autoAssignRowGate(shape, true);
  if (gate) return row({ reason: gate, message: GATE_BLOCK_TR[gate] });

  if (!(await orderHasPrintableContent(base.orderId))) {
    // Sahibin kararı (manual-orders-without-model): modeli ya da katalog ürünü
    // olmayan sipariş üreticiye gitmez, `awaiting_model`'da bekler. Metin atama
    // servisinin kendi metnidir, böylece admin aynı cümleyi her yerde görür.
    return row({
      reason: "no_printable_content",
      message: ASSIGN_FAILURE_MESSAGES.no_printable_content,
    });
  }

  // MÜLKİYET, sıralamadan ÖNCE gelir: satıcının kendi kataloğundan çıkan bir
  // sipariş rakip bir atölyeye verilemez (bağlayıcı pazaryeri kuralı). Bu
  // adımın yokluğu, taramanın canlı atamanın asla yapmayacağı bir yerleştirmeyi
  // önermesi demekti — üstelik `cart_platform` türünün anahtarı açık olduğu için
  // satır seçili gelir ve tek onayla uygulanırdı.
  const plan = sweepPlacementPlan(pending);
  if (plan.kind === "skip") {
    return row({ reason: "seller_owned", message: SELLER_BLOCKED_TR });
  }

  let candidates: CandidateScore[];
  try {
    candidates = await rankForOrderPreview(base.orderId);
  } catch (err) {
    // Tek siparişin sıralaması patlarsa tarama devam etmeli: 40 siparişlik bir
    // tarama, bir bozuk satır yüzünden komple boş dönmemeli.
    console.error(
      `[ATAMA taraması] ${base.orderNumber} sıralanamadı`,
      err
    );
    return row({
      reason: "rank_failed",
      message:
        "Aday sıralaması yapılamadı. Sunucu günlüklerine bakın, sonra taramayı yenileyin.",
    });
  }

  if (plan.kind === "seller") {
    // Satıcının kendi ürünü: aday SIRALAMA ile değil, mülkiyetle belirlenir.
    // Skorlar yine gösterilir (admin yükü/mesafeyi görsün) ama seçmezler.
    const own = candidates.find((c) => c.manufacturerId === plan.manufacturerId);
    if (!own) {
      // Sıralayıcı yalnız AKTİF atölyeleri getirir. Satıcının atölyesi
      // listede yoksa hesabı aktif değildir: canlı otomatik atama bu durumda
      // bile satıcıya atardı, ama TOPLU bir ekrandan askıdaki bir atölyeye iş
      // yığmak sessiz bir karar olurdu — admin tek tek baksın.
      return row({ reason: "seller_owned", message: SELLER_SHOP_UNAVAILABLE_TR });
    }
    return row(null, {
      candidate: {
        ...toSweepCandidate(own, true),
        // Uygunluk gerekçesi kararı DEĞİŞTİRMEZ (mülkiyet sıralamayı ezer) ama
        // admin, kapasitesi dolu bir atölyeye iş gönderdiğini görmeli.
        reasons: [
          "Satıcının kendi ürünü — sıralama dışı",
          ...(own.eligible
            ? []
            : [`Sıralamada uygun değil: ${own.ineligibleReason ?? "gerekçe yok"}`]),
          ...own.reasons,
        ],
      },
      // İkinci aday YOKTUR: alternatif göstermek, verilmesi yasak bir seçenek
      // varmış gibi okunurdu.
      runnerUp: null,
    });
  }

  const eligible = candidates.filter((c) => c.eligible);
  if (eligible.length === 0) {
    return row(
      { reason: "no_candidate", message: noCandidateMessage(candidates) },
      {
        ineligible: candidates.slice(0, 5).map((c) => ({
          companyName: c.companyName,
          reason: c.ineligibleReason ?? "Uygun değil",
        })),
      }
    );
  }

  return row(null, {
    candidate: toSweepCandidate(eligible[0]),
    runnerUp: eligible[1] ? toSweepCandidate(eligible[1]) : null,
  });
}

/** Tarama listesi — sınırlı eşzamanlılıkla, veritabanını boğmadan. */
export async function evaluateSweepOrders(
  pending: readonly PendingSweepOrder[]
): Promise<SweepRow[]> {
  const out: SweepRow[] = [];
  for (let i = 0; i < pending.length; i += SWEEP_CONCURRENCY) {
    const chunk = pending.slice(i, i + SWEEP_CONCURRENCY);
    out.push(...(await Promise.all(chunk.map((p) => evaluateSweepOrder(p)))));
  }
  return out;
}
