/**
 * ÇERÇEVE ANLAŞMALAR — servis katmanı (0073).
 *
 * Kurumsal müşteri bir kerede büyük miktar TAAHHÜT eder, fiyat anlaşma boyunca
 * KİLİTLENİR, teslim PARTİLER hâlinde planlanır. Saf yarı
 * (`src/lib/config/quote-framework.ts`) kuralları tutar; bu dosya onları
 * veritabanına bağlar.
 *
 * ─── BİRİNCİ KURAL: ÖDEME PARTİ BAŞINADIR ───────────────────────────────────
 *
 * Anlaşma FİYATI ve TAAHHÜDÜ bağlar, PARAYI bağlamaz. Anlaşmanın kendisi bir
 * satış değildir: tahsilat yok, teslim taahhüdü parti serbest bırakılınca
 * doğar. Serbest bırakılan parti KENDİ `quotes` klonunu alır ve BUGÜNKÜ ödeme
 * yolundan (`createQuoteCheckout` → `order_drafts` → `orders`) geçer. Bu
 * dosyada tahsilat aritmetiği YOKTUR ve olmamalı.
 *
 * ─── İKİNCİ KURAL: DONMUŞ FİYAT BİR SÖZDÜR ──────────────────────────────────
 *
 * Parti, anlaşma İMZALANDIĞI GÜNDEKİ ₺ tutarını öder — `price_locked_until`
 * gününe kadar. Kilidi GERÇEK yapan üç şey:
 *
 *  1. Klonun `pricingSnapshot`ı ANLAŞMANIN snapshot'ıdır
 *     (`cloneQuoteForFrameworkBatch`; `loadActiveSnapshot()` bu dosyada HİÇ
 *     çağrılmaz — o çağrı kilidi sessizce açardı).
 *  2. Her klon parçanın manuel fiyatı anlaşmadaki kilitli birim fiyattır ve
 *     anahtarı PARTİ ADEDİYLE yeniden üretilir.
 *  3. Serbest bırakmanın ve ödemenin önünde EŞİTLİK KAPISI durur
 *     (`frameworkBatchDriftCode`): klonun bugün hesaplanan BRÜTÜ partinin
 *     kilitli tutarına eşit değilse işlem geri alınır ve 409 döner.
 *
 * ─── `quote-checkout.ts` IMPORT EDİLEMEZ ────────────────────────────────────
 *
 * O dosya `src/lib/analytics/attribution-server.ts`i çekiyor ve o, depodaki
 * TEK `server-only` dosyasıdır: standalone Node worker'ını (bakım turu bu
 * modülü import edecek) açılışta crash-loop'a sokar. Bu yüzden `freezeParts`
 * `quote-service.ts`e TAŞINDI ve buradan ORADAN import ediliyor — ikinci bir
 * dondurma yolu, kilitli fiyatın sürüklenmesinin en kısa yoludur.
 *
 * `import "server-only"` YOK ve EKLENMEYECEK (aynı gerekçe).
 *
 * ─── KAPASİTE: KAPI TEK SAHİPLİ ─────────────────────────────────────────────
 *
 * Tezgâhı `loadManufacturerCapacities` okur (`manufacturer-capacity.ts` KARAR
 * 1 + 2), kararı `manufacturerHasRoom` verir ve bu servis onu saf
 * `validateBatchPlan`a `benchHasRoom` olarak GEÇİRİR. İkinci bir `count(*)`
 * kurulmaz: ekran, ucun uygulamadığı bir ölçüyle kimseyi kapatamaz.
 *
 * ─── BAYRAK BU DOSYADA OKUNMAZ ──────────────────────────────────────────────
 *
 * `framework_orders_enabled` YÜZEYLERİ kapatır (yeni anlaşma kurma ve parti
 * serbest bırakma uçları/ekranları), servisin kendisini değil: serbest
 * bırakılmış bir partinin klon teklifi bayrak kapalıyken de ÖDENMEYE DEVAM
 * ETMEK ZORUNDA (sıradan bir `quotes` satırıdır). Kapıyı uçlara bırakmak, o
 * kapsamı iki yerde birden yanlış kurma riskini kaldırıyor.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  manufacturers,
  orderRefundAllocations,
  orderRefundRecords,
  orders,
  quoteAdminActions,
  quoteFrameworkBatchLines,
  quoteFrameworkBatches,
  quoteFrameworks,
  quoteParts,
  quotes,
  type Quote,
  type QuoteFramework,
  type QuotePart,
  type TurkishAddress,
} from "@/lib/db/schema";
import { actualReturnFacts } from "@/lib/config/order-money";
import { computeQuote } from "@/lib/config/quote-compute";
import {
  FRAMEWORK_PRICE_DRIFT_ERROR,
  frameworkBatchDriftCode,
  frameworkBatchLoadUnits,
  frameworkBatchTotals,
  frameworkProgressBuckets,
  validateBatchPlan,
  validateFrameworkAgreement,
  type FrameworkBatchLineInput,
  type FrameworkBatchStatus,
  type FrameworkCommitmentPart,
  type FrameworkLedgerLine,
  type FrameworkPartProgress,
  type FrameworkPlanRefusal,
  type FrameworkProgress,
  type FrameworkProgressLine,
  type FrameworkStatus,
} from "@/lib/config/quote-framework";
import { partPricingKey } from "@/lib/config/quote-keys";
// Parça satırını fiyat çekirdeğinin girdisine çeviren TEK dönüşüm noktası
// `quote-cache.ts`tir (manuel fiyatın aralık kapısı da orada). İkinci bir
// kopya bir gün bir alanı unutup gösterilen ile tahsil edilen fiyatı
// ayrıştırırdı; o dosya `server-only` çekmiyor, yani import güvenli.
import { toPricingPartInput } from "@/lib/services/quote-cache";
import type {
  ComputedQuote,
  FrozenQuoteAddon,
  FrozenQuotePart,
  LeadTierKey,
  PricingPartInput,
  PricingSnapshot,
} from "@/lib/config/quote-types";
import { emitFrameworkChanged, emitQuoteChanged } from "@/lib/realtime/emit";
import { loadActiveFxSnapshot } from "@/lib/services/fx-rates";
import {
  loadManufacturerCapacities,
  manufacturerHasRoom,
} from "@/lib/services/manufacturer-capacity";
import {
  QuoteServiceError,
  cloneQuoteForFrameworkBatch,
  freezeParts,
} from "@/lib/services/quote-service";

const PAGE_SIZE = 20;

/** Kilit süresi `quote-admin.ts` ve `order-money-edit.ts` ile AYNI: 5 saniye. */
const LOCK_TIMEOUT = sql`SET LOCAL lock_timeout = '5s'`;

type FrameworkTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Ortak okuma ────────────────────────────────────────────────────────────

async function lockFramework(tx: FrameworkTx, frameworkId: string): Promise<QuoteFramework> {
  const [row] = await tx
    .select()
    .from(quoteFrameworks)
    .where(eq(quoteFrameworks.id, frameworkId))
    .for("update");
  if (!row) {
    throw new QuoteServiceError("Çerçeve anlaşma bulunamadı.", 404, "framework_not_found");
  }
  return row;
}

/**
 * Anlaşmanın kaynak teklifi, KİLİTLİ.
 *
 * Kilit sırası `freezeCheckout` ile AYNI yöndedir — ÖNCE anlaşma/teklif, SONRA
 * parti. Ters yön deadlock'tur ve o deadlock para yolunda olurdu.
 */
async function lockSourceQuote(tx: FrameworkTx, quoteId: string): Promise<Quote> {
  const [row] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
  if (!row) {
    throw new QuoteServiceError(
      "Anlaşmanın kaynak teklifi bulunamadı.",
      404,
      "quote_not_found"
    );
  }
  return row;
}

async function sourceParts(tx: FrameworkTx, quoteId: string): Promise<QuotePart[]> {
  return tx
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, quoteId), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
}

/** Anlaşmanın TAAHHÜT defteri: `parts_snapshot` → parça başına adet + kilitli fiyat. */
function commitmentOf(framework: QuoteFramework): FrameworkCommitmentPart[] {
  return framework.partsSnapshot.map((p) => ({
    partId: p.partId,
    quantity: p.quantity,
    unitKurus: p.unitKurus,
  }));
}

/**
 * Anlaşmanın bugüne kadarki parti satırları + partisinin hâli.
 *
 * Taahhüt kapısının girdisi budur; `frameworkLineConsumesCommitment` hangi
 * satırın taahhüdü tükettiğine karar verir (saf çekirdek).
 */
async function ledgerOf(
  tx: FrameworkTx | typeof db,
  frameworkId: string
): Promise<FrameworkLedgerLine[]> {
  const rows = await tx
    .select({
      partId: quoteFrameworkBatchLines.partId,
      quantity: quoteFrameworkBatchLines.quantity,
      batchStatus: quoteFrameworkBatches.status,
      orderId: quoteFrameworkBatches.orderId,
    })
    .from(quoteFrameworkBatchLines)
    .innerJoin(
      quoteFrameworkBatches,
      eq(quoteFrameworkBatches.id, quoteFrameworkBatchLines.batchId)
    )
    .where(eq(quoteFrameworkBatchLines.frameworkId, frameworkId));
  return rows.map((r) => ({
    partId: r.partId,
    quantity: r.quantity,
    batchStatus: r.batchStatus,
    orderId: r.orderId,
  }));
}

/** Denetim satırı: iz VAR OLAN tabloda, anlaşmanın KAYNAK teklifinin altında. */
async function audit(
  tx: FrameworkTx,
  args: {
    quoteId: string;
    action:
      | "framework_create"
      | "framework_activate"
      | "framework_batch_plan"
      | "framework_batch_release"
      | "framework_batch_cancel"
      | "framework_cancel"
      | "framework_extend";
    adminEmail: string;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }
): Promise<void> {
  await tx.insert(quoteAdminActions).values({
    quoteId: args.quoteId,
    action: args.action,
    adminEmail: args.adminEmail,
    reason: args.reason,
    before: args.before ?? null,
    after: args.after ?? null,
  });
}

// ─── Partinin fiyatı: TEK aritmetik ─────────────────────────────────────────

/** Bir partinin fiyat gerçeği; hem plan hem serbest bırakma bunu okur. */
interface BatchPricing {
  lines: FrameworkBatchLineInput[];
  units: number;
  partsKurus: number;
  addonsKurus: number;
  /** Σ satır + ek hizmet. Asgari tamamlama BURADA YOK (plan kapısı onu yasaklıyor). */
  grossKurus: number;
  leadDays: number | null;
  computed: ComputedQuote;
}

/**
 * Partinin tutarını ANLAŞMANIN donmuş kataloğundan hesaplar.
 *
 * TUTAR HİÇBİR YERDE ELLE TOPLANMAZ: `computeQuote` çağrılır, yani parti
 * satırı, klon teklif ve DB CHECK'i (`line_kurus = unit_kurus * quantity`)
 * AYNI aritmetikten geçer. Ek hizmetlerin çarpanı da motorun kendi kuralıdır
 * (`addonLines`: `per_part → partCount`, `per_unit → unitCount`,
 * `fixed → 1`) — bu yüzden `fixed` bir ek hizmet HER PARTİDE yeniden tahsil
 * edilir ve `Σ parti tutarı`, anlaşmanın tek-sevkiyat projeksiyonundan
 * (`committed_total_kurus`) BÜYÜK olabilir. İki rakam da dürüsttür, hiçbiri
 * ötekinin yerine geçmez (`loadFrameworkDetail` ikisini AYRI alanlarda verir).
 *
 * Girdi, klonun yazacağı satırın AYNISI: kaynak parçanın konfigürasyonu +
 * parti adedi + anlaşmanın kilitli birim fiyatı + o adetle üretilmiş anahtar.
 * Klon `configForSnapshot` ile aynı snapshot'a karşı çözüldüğü için iki hesap
 * örtüşür; örtüşmediği gün EŞİTLİK KAPISI onu 409 ile yakalar — sessiz bir
 * sapma bırakmaz.
 */
function priceBatch(args: {
  snapshot: PricingSnapshot;
  leadTier: LeadTierKey;
  addonKeys: string[];
  parts: readonly QuotePart[];
  commitment: readonly FrameworkCommitmentPart[];
  lines: readonly { partId: string; quantity: number }[];
}): BatchPricing {
  const byId = new Map(args.parts.map((p) => [p.id, p]));
  const locked = new Map(args.commitment.map((c) => [c.partId, c.unitKurus]));

  const batchLines: FrameworkBatchLineInput[] = [];
  const inputs: PricingPartInput[] = [];
  for (const line of args.lines) {
    const part = byId.get(line.partId);
    const unitKurus = locked.get(line.partId);
    if (!part || unitKurus === undefined) {
      throw new QuoteServiceError(
        "Parti satırı anlaşmanın taahhüdünde olmayan bir parçaya bakıyor.",
        409,
        "part_not_in_commitment"
      );
    }
    batchLines.push({ partId: line.partId, quantity: line.quantity, unitKurus });
    const config = {
      technologyKey: part.technologyKey,
      materialKey: part.materialKey,
      colorKey: part.colorKey,
      finishKey: part.finishKey,
      layerUm: part.layerUm,
      infillPct: part.infillPct,
      // PARTİ ADEDİ — anahtar da bu adetle üretilir (`partPricingKey` adedi
      // anahtara katıyor; anlaşmanın anahtarını kullanmak manuel fiyatı
      // sessizce düşürürdü).
      quantity: line.quantity,
      units: part.units,
      scale: part.scale,
      criticalTolerance: part.criticalTolerance,
    };
    inputs.push({
      id: part.id,
      analysisStatus: part.analysisStatus,
      geometry: part.geometry,
      sourceSha256: part.sourceSha256,
      config,
      manualUnitPriceKurus: unitKurus,
      manualPriceKey: partPricingKey(
        { sourceSha256: part.sourceSha256, config },
        args.leadTier
      ),
      // Uyarı onayı MÜŞTERİNİN kaydıdır ve klona kopyalanmaz; `computeQuote`
      // onu okumaz (okuyan `checkoutBlockers`), bu yüzden burada null.
      dfmAckKey: null,
    });
  }

  const computed = computeQuote(args.snapshot, inputs, {
    leadTier: args.leadTier,
    addonKeys: args.addonKeys,
  });
  if (!computed.totals.allPriced) {
    throw new QuoteServiceError(
      "Parti tutarı hesaplanamadı: anlaşmanın kilitli fiyatı bu adette geçerli değil.",
      409,
      "price_unavailable"
    );
  }
  const totals = frameworkBatchTotals(batchLines);
  const addonsKurus = computed.totals.addonLines.reduce((sum, l) => sum + l.kurus, 0);
  return {
    lines: batchLines,
    units: totals.units,
    partsKurus: totals.partsKurus,
    addonsKurus,
    grossKurus: totals.partsKurus + addonsKurus,
    leadDays: computed.totals.leadDays,
    computed,
  };
}

/**
 * Partinin TEK atölyeye sığıp sığmadığı — kararı `manufacturerHasRoom` verir.
 *
 * Tercih edilen atölye varsa ONUN tezgâhı ölçülür. Yoksa ağdaki EN BÜYÜK
 * `maxConcurrentOrders`a sahip atölye ölçülür: soru "bu parti herhangi bir
 * atölyeye sığar mı", ve sığmıyorsa bölünmesi istenir (R3). Eşik burada
 * KURULMAZ.
 */
async function benchHasRoomFor(
  units: number,
  preferredManufacturerId: string | null
): Promise<boolean> {
  const load = frameworkBatchLoadUnits(units);
  if (preferredManufacturerId) {
    const caps = await loadManufacturerCapacities([preferredManufacturerId]);
    const bench = caps.get(preferredManufacturerId);
    if (!bench) return false;
    return manufacturerHasRoom({
      loadUnits: bench.loadUnits + load,
      maxConcurrentOrders: bench.maxConcurrentOrders,
    });
  }
  // "Ağdaki atölye" ölçüsü depodakiyle AYNI: `status = 'active'`
  // (`manufacturer-assign.ts`, `network-map.ts`, `coverage-plan.ts` hepsi bunu
  // okuyor). `acceptingOrders` BURADA aranmaz: bugün sipariş almayan bir
  // atölye, üç ay sonraki bir partinin planlanmasını engellememeli.
  const network = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(eq(manufacturers.status, "active"));
  if (network.length === 0) return false;
  const caps = await loadManufacturerCapacities(network.map((m) => m.id));
  let best: { loadUnits: number; maxConcurrentOrders: number } | null = null;
  for (const cap of caps.values()) {
    if (best === null || cap.maxConcurrentOrders > best.maxConcurrentOrders) {
      best = { loadUnits: cap.loadUnits, maxConcurrentOrders: cap.maxConcurrentOrders };
    }
  }
  if (best === null) return false;
  return manufacturerHasRoom({
    loadUnits: best.loadUnits + load,
    maxConcurrentOrders: best.maxConcurrentOrders,
  });
}

// ─── Anlaşma kurulumu ───────────────────────────────────────────────────────

export interface CreateFrameworkArgs {
  /** Anlaşmanın türeyeceği teklif; `status='quoted'` ve TÜM parçaları fiyatlı. */
  quoteId: string;
  adminEmail: string;
  reason: string;
  /** Fiyat kilidinin son günü (`YYYY-MM-DD`, İstanbul takvimi). */
  priceLockedUntil: string;
  shippingAddress: TurkishAddress;
  title?: string | null;
  preferredManufacturerId?: string | null;
  customerNote?: string | null;
  adminNote?: string | null;
  now?: Date;
}

export type CreateFrameworkOutcome =
  | { ok: true; id: string; number: string }
  | { ok: false; refusals: FrameworkPlanRefusal[] };

/**
 * Fiyatlanmış bir teklifi çerçeve anlaşmaya dönüştürür (durum `draft`).
 *
 * Kapılar (hepsi ANLAŞMA KURULMADAN ÖNCE):
 *  - kaynak teklif `status='quoted'` — anlaşma "bir insan bu fiyatı gördü"
 *    demektir,
 *  - TÜM parçalar fiyatlı (`computeQuote.totals.allPriced`),
 *  - boyama kalemi YOK (`frameworkPaintingForbidden`; bilinmeyen yüzey de
 *    reddedilir — kanıtlayamadığımız şey lehe yazılmaz),
 *  - KARIŞIK TEKNOLOJİ YOK: sipariş tek `order_material` yazıyor, müşteri
 *    `splitByTechnology` ile ayırıp iki anlaşma kurar,
 *  - `userId` NOT NULL (anonim çerçeve YOK: taahhüt bir kişiye yazılır).
 *
 * `pricing_snapshot` ve `parts_snapshot` anlaşmaya KOPYALANIR; kilit tam
 * olarak bu kopyadır. `committed_total_kurus` TEK-SEVKİYAT PROJEKSİYONUDUR
 * (bkz. `priceBatch`).
 */
export async function createFrameworkFromQuote(
  args: CreateFrameworkArgs
): Promise<CreateFrameworkOutcome> {
  const result = await db.transaction<CreateFrameworkOutcome>(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const quote = await lockSourceQuote(tx, args.quoteId);
    if (quote.userId === null) {
      throw new QuoteServiceError(
        "Anonim teklif çerçeve anlaşmaya dönüştürülemez; müşteri hesabı gerekir.",
        409,
        "anonymous_quote"
      );
    }
    if (quote.status !== "quoted") {
      throw new QuoteServiceError(
        "Yalnız fiyatlandırılmış (quoted) bir teklif çerçeve anlaşmaya dönüştürülebilir.",
        409,
        "quote_not_quoted"
      );
    }
    const [existing] = await tx
      .select({ id: quoteFrameworks.id })
      .from(quoteFrameworks)
      .where(eq(quoteFrameworks.quoteId, quote.id))
      .limit(1);
    if (existing) {
      throw new QuoteServiceError(
        "Bu teklif için zaten bir çerçeve anlaşma var.",
        409,
        "framework_exists"
      );
    }

    const parts = await sourceParts(tx, quote.id);
    if (parts.length === 0) {
      throw new QuoteServiceError("Teklifte parça yok.", 400, "no_parts");
    }
    const technologies = new Set(parts.map((p) => p.technologyKey));
    if (technologies.size > 1) {
      throw new QuoteServiceError(
        "Çerçeve anlaşma tek teknolojiyle kurulur; teklifi teknolojiye göre ayırıp " +
          "her biri için ayrı anlaşma kurun.",
        409,
        "mixed_technology"
      );
    }

    const snapshot = quote.pricingSnapshot;
    const computed = computeQuote(snapshot, parts.map(toPricingPartInput), {
      leadTier: quote.leadTier,
      addonKeys: quote.addonKeys,
    });
    if (!computed.totals.allPriced) {
      throw new QuoteServiceError(
        "Teklifin her parçası fiyatlı olmadan çerçeve anlaşma kurulamaz.",
        409,
        "price_unavailable"
      );
    }

    // Boyama yasağı + toplam tavanı: saf kapı, ikisini AYRI AYRI rapor eder.
    const refusals = validateFrameworkAgreement({
      snapshot,
      parts,
      committedTotalKurus: computed.totals.totalKurus,
    });
    if (refusals.length > 0) return { ok: false, refusals };

    const partsSnapshot: FrozenQuotePart[] = freezeParts(snapshot, parts, computed);
    const addonsSnapshot: FrozenQuoteAddon[] = computed.totals.addonLines.map((l) => ({
      key: l.key,
      name: l.name,
      kurus: l.kurus,
    }));

    const [row] = await tx
      .insert(quoteFrameworks)
      .values({
        quoteId: quote.id,
        userId: quote.userId,
        status: "draft",
        title: args.title?.trim() || null,
        leadTier: quote.leadTier,
        addonKeys: quote.addonKeys,
        partsSnapshot,
        addonsSnapshot,
        pricingSnapshot: snapshot,
        committedUnits: partsSnapshot.reduce((sum, p) => sum + p.quantity, 0),
        committedTotalKurus: computed.totals.totalKurus,
        priceLockedUntil: endOfDay(args.priceLockedUntil),
        preferredManufacturerId: args.preferredManufacturerId ?? null,
        shippingAddress: args.shippingAddress,
        customerNote: args.customerNote?.trim() || null,
        adminNote: args.adminNote?.trim() || null,
      })
      .returning({ id: quoteFrameworks.id, number: quoteFrameworks.number });

    await audit(tx, {
      quoteId: quote.id,
      action: "framework_create",
      adminEmail: args.adminEmail,
      reason: args.reason,
      after: {
        frameworkId: row.id,
        number: row.number,
        committedTotalKurus: computed.totals.totalKurus,
        priceLockedUntil: args.priceLockedUntil,
      },
    });
    return { ok: true, id: row.id, number: row.number };
  });

  if (result.ok) emitFrameworkChanged({ frameworkId: result.id });
  return result;
}

/** `YYYY-MM-DD` → o günün İstanbul sonuna denk gelen an (kilit gün SONUNA kadar). */
function endOfDay(dateKey: string): Date {
  // İstanbul UTC+3: yerel gün sonu 23:59:59.999 → UTC 20:59:59.999.
  return new Date(`${dateKey}T20:59:59.999Z`);
}

// ─── Aktifleştirme ──────────────────────────────────────────────────────────

export async function activateFramework(args: {
  frameworkId: string;
  adminEmail: string;
  reason: string;
  now?: Date;
}): Promise<{ id: string; number: string }> {
  const now = args.now ?? new Date();
  const out = await db.transaction(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    if (framework.status !== "draft") {
      throw new QuoteServiceError(
        "Yalnız taslak bir anlaşma aktifleştirilebilir.",
        409,
        "framework_not_draft"
      );
    }
    if (framework.priceLockedUntil.getTime() < now.getTime()) {
      // Süresi geçmiş bir kilidi aktifleştirmek, ilk partide reddedilecek bir
      // anlaşma kurmak olurdu (R5): `releaseBatch` `expired` anlaşmayı reddeder.
      throw new QuoteServiceError(
        "Fiyat kilidinin son günü geçmiş; önce kilidi uzatın.",
        409,
        "lock_expired"
      );
    }
    await tx
      .update(quoteFrameworks)
      .set({
        status: "active",
        activatedAt: now,
        activatedByEmail: args.adminEmail,
        updatedAt: now,
      })
      .where(eq(quoteFrameworks.id, framework.id));
    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_activate",
      adminEmail: args.adminEmail,
      reason: args.reason,
      before: { status: framework.status },
      after: { status: "active" },
    });
    return { id: framework.id, number: framework.number, userId: framework.userId };
  });
  emitFrameworkChanged({ frameworkId: out.id, userId: out.userId });
  return { id: out.id, number: out.number };
}

// ─── Parti planı ────────────────────────────────────────────────────────────

export interface PlanBatchInput {
  /** `YYYY-MM-DD`, İstanbul takvimi. */
  plannedShipDate: string;
  lines: Array<{ partId: string; quantity: number }>;
  note?: string | null;
}

export interface PlannedBatchView {
  id: string | null;
  position: number;
  plannedShipDate: string;
  units: number;
  amountKurus: number;
}

export type PlanBatchesOutcome =
  | { ok: true; batches: PlannedBatchView[] }
  | { ok: false; refusals: FrameworkPlanRefusal[] };

/**
 * Bir ya da birkaç partiyi planlar (`dryRun` ile YALNIZ ön izleme).
 *
 * Partiler SIRAYLA doğrulanır ve her biri kendinden ÖNCEKİLERİ de defterde
 * görür: aksi hâlde üç parti taahhüdün tamamını ayrı ayrı tüketebilirdi.
 *
 * Kapasite kararı ÇAĞIRANDA değil burada üretilir ve saf doğrulayıcıya
 * `benchHasRoom` olarak geçer; ekran ile uç aynı yerde döner.
 *
 * `dryRun` ekranın kendi para aritmetiğini kurmasını gereksiz kılar: tutar
 * önizlemesi de sunucudan gelir.
 */
export async function planBatches(args: {
  frameworkId: string;
  adminEmail: string;
  reason: string;
  batches: readonly PlanBatchInput[];
  dryRun?: boolean;
  now?: Date;
}): Promise<PlanBatchesOutcome> {
  const now = args.now ?? new Date();
  if (args.batches.length === 0) {
    throw new QuoteServiceError("Planlanacak parti yok.", 400, "no_batches");
  }

  // Kapasite okuması İŞLEM DIŞINDA: `loadManufacturerCapacities` kendi
  // bağlantısını alıyor ve açık bir işlemi tutarken ikinci bağlantı istemek
  // yirmi eşzamanlı istekte havuzu kilitler (`freezeCheckout` ile aynı sıra).
  const [head] = await db
    .select({ preferredManufacturerId: quoteFrameworks.preferredManufacturerId })
    .from(quoteFrameworks)
    .where(eq(quoteFrameworks.id, args.frameworkId))
    .limit(1);
  if (!head) {
    throw new QuoteServiceError("Çerçeve anlaşma bulunamadı.", 404, "framework_not_found");
  }
  const benchRoom = new Map<number, boolean>();
  for (const [index, batch] of args.batches.entries()) {
    const units = batch.lines.reduce((sum, l) => sum + l.quantity, 0);
    benchRoom.set(index, await benchHasRoomFor(units, head.preferredManufacturerId));
  }

  const result = await db.transaction<PlanBatchesOutcome>(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    if (framework.status !== "draft" && framework.status !== "active") {
      throw new QuoteServiceError(
        "Yalnız taslak ya da aktif bir anlaşmada parti planlanabilir.",
        409,
        "framework_not_plannable"
      );
    }
    const parts = await sourceParts(tx, framework.quoteId);
    const commitment = commitmentOf(framework);
    const ledger = await ledgerOf(tx, framework.id);

    const liveBatches = await tx
      .select({ position: quoteFrameworkBatches.position, status: quoteFrameworkBatches.status })
      .from(quoteFrameworkBatches)
      .where(eq(quoteFrameworkBatches.frameworkId, framework.id));
    let existingBatchCount = liveBatches.filter((b) => b.status !== "cancelled").length;
    let nextPosition =
      liveBatches.reduce((max, b) => Math.max(max, b.position), 0) + 1;

    const refusals: FrameworkPlanRefusal[] = [];
    const priced: BatchPricing[] = [];
    const running: FrameworkLedgerLine[] = [...ledger];
    for (const [index, batch] of args.batches.entries()) {
      const pricing = priceBatch({
        snapshot: framework.pricingSnapshot,
        leadTier: framework.leadTier,
        addonKeys: framework.addonKeys,
        parts,
        commitment,
        lines: batch.lines,
      });
      refusals.push(
        ...validateBatchPlan({
          snapshot: framework.pricingSnapshot,
          commitment,
          ledger: running,
          lines: pricing.lines,
          batch: {
            units: pricing.units,
            amountKurus: pricing.grossKurus,
            plannedShipDate: batch.plannedShipDate,
            benchHasRoom: benchRoom.get(index) ?? false,
          },
          addonsKurus: pricing.addonsKurus,
          leadDays: pricing.leadDays ?? 0,
          now,
          existingBatchCount: existingBatchCount + index,
        })
      );
      priced.push(pricing);
      // Sonraki parti bu partiyi de defterde GÖRÜR.
      for (const line of pricing.lines) {
        running.push({
          partId: line.partId,
          quantity: line.quantity,
          batchStatus: "planned",
          orderId: null,
        });
      }
    }
    if (refusals.length > 0) return { ok: false, refusals };

    if (args.dryRun) {
      return {
        ok: true,
        batches: priced.map((p, index) => ({
          id: null,
          position: nextPosition + index,
          plannedShipDate: args.batches[index]!.plannedShipDate,
          units: p.units,
          amountKurus: p.grossKurus,
        })),
      };
    }

    const written: PlannedBatchView[] = [];
    for (const [index, pricing] of priced.entries()) {
      const input = args.batches[index]!;
      // Motorun brütü ile bizim brütümüz AYNI sayı olmak zorunda: doğrulama
      // geçtiyse asgari tamamlama SIFIRDIR (kural 2), yani ikisi ayrışıyorsa
      // ortada bir iç tutarsızlık var ve satır YAZILMAZ.
      if (pricing.computed.totals.totalKurus !== pricing.grossKurus) {
        throw new QuoteServiceError(
          "Parti tutarı motorun hesabıyla uyuşmadı; plan yazılmadı.",
          409,
          "batch_totals_mismatch"
        );
      }
      const [row] = await tx
        .insert(quoteFrameworkBatches)
        .values({
          frameworkId: framework.id,
          position: nextPosition++,
          status: "planned",
          plannedShipDate: input.plannedShipDate,
          units: pricing.units,
          amountKurus: pricing.grossKurus,
          note: input.note?.trim() || null,
        })
        .returning({ id: quoteFrameworkBatches.id, position: quoteFrameworkBatches.position });
      let linePosition = 0;
      for (const line of pricing.lines) {
        await tx.insert(quoteFrameworkBatchLines).values({
          batchId: row.id,
          frameworkId: framework.id,
          partId: line.partId,
          position: linePosition++,
          quantity: line.quantity,
          unitKurus: line.unitKurus,
          // `frameworkLineKurus` DEĞİL, aynı kuralın tek uygulaması: saf
          // çekirdek onu `frameworkBatchTotals` içinde zaten uyguladı ve DB
          // CHECK'i (`line_kurus = unit_kurus * quantity`) üçüncü kez sınıyor.
          lineKurus: line.unitKurus * line.quantity,
        });
      }
      existingBatchCount++;
      written.push({
        id: row.id,
        position: row.position,
        plannedShipDate: input.plannedShipDate,
        units: pricing.units,
        amountKurus: pricing.grossKurus,
      });
    }

    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_batch_plan",
      adminEmail: args.adminEmail,
      reason: args.reason,
      after: { batches: written },
    });
    return { ok: true, batches: written };
  });

  if (result.ok && !args.dryRun) emitFrameworkChanged({ frameworkId: args.frameworkId });
  return result;
}

// ─── Serbest bırakma: TEK işlem, TEK klon ───────────────────────────────────

export interface ReleaseBatchResult {
  batchId: string;
  position: number;
  quoteId: string;
  quoteNumber: string;
  amountKurus: number;
}

/**
 * Planlı bir partiyi serbest bırakır: klon teklifi açar ve partiyi ona bağlar.
 *
 * TEK İŞLEM, TEK KLON. Korumalı UPDATE (`WHERE status='planned' RETURNING`)
 * yarışın kapısıdır: iki admin aynı partiyi bırakırsa İKİNCİSİ satır bulamaz
 * ve işlemi geri alınır, yani klonu da doğmaz (R4). İkinci savunma
 * `quote_framework_batches_quote_id_uq`tur (bir klon teklif = bir parti).
 *
 * Kilit sırası `freezeCheckout` ile AYNI yönde: ÖNCE anlaşma ve kaynak teklif,
 * SONRA parti. Ters yön deadlock'tur.
 *
 * EŞİTLİK KAPISI klon yazıldıktan HEMEN SONRA, aynı işlemde koşar: yarım bir
 * klon bırakmak, müşteriye ödenebilir ama YANLIŞ FİYATLI bir teklif vermek
 * olurdu.
 *
 * Anlaşma `active` değilse (özellikle `expired`) REDDEDER (R5); admin
 * `extendFrameworkLock` ile uzatır ya da yeni anlaşma kurar.
 */
export async function releaseBatch(args: {
  frameworkId: string;
  batchId: string;
  adminEmail: string;
  reason: string;
  /** Ekranın gördüğü kilitli tutar — BEYAN; uyuşmazsa 409. */
  expectedAmountKurus?: number;
  now?: Date;
}): Promise<ReleaseBatchResult> {
  const now = args.now ?? new Date();

  // Kur bülteni İŞLEM DIŞINDA okunur (`freezeCheckout`un hediye kartını işlem
  // dışında çözmesiyle aynı gerekçe: açık bir işlem tutarken ikinci bağlantı
  // istemek havuzu kilitler).
  const [head] = await db
    .select({ holidays: sql<string[]>`${quoteFrameworks.pricingSnapshot}->'settings'->'holidays'` })
    .from(quoteFrameworks)
    .where(eq(quoteFrameworks.id, args.frameworkId))
    .limit(1);
  if (!head) {
    throw new QuoteServiceError("Çerçeve anlaşma bulunamadı.", 404, "framework_not_found");
  }
  // SERBEST BIRAKMA GÜNÜNÜN bülteni: bağlayıcı tutar ₺ ve DONMUŞ, döviz
  // rakamı YALNIZ GÖSTERİM ve YAKLAŞIK. İmza günündeki kuru üç ay sonra
  // göstermek, kilitlenmemiş bir rakamı kilitli gibi sunmak olurdu.
  const fxSnapshot = await loadActiveFxSnapshot(head.holidays ?? [], now);

  const out = await db.transaction(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    if (framework.status !== "active") {
      throw new QuoteServiceError(
        framework.status === "expired"
          ? "Anlaşmanın fiyat kilidi doldu; parti serbest bırakılamaz. Kilidi uzatın ya da yeni anlaşma kurun."
          : "Yalnız aktif bir anlaşmada parti serbest bırakılabilir.",
        409,
        framework.status === "expired" ? "framework_expired" : "framework_not_active"
      );
    }
    if (framework.priceLockedUntil.getTime() < now.getTime()) {
      // Bakım turu anlaşmayı `expired`a çekmeden önce gelen istek de AYNI
      // cevabı almalı: kilidin süresi tarihe bakılarak ölçülür, bakım turunun
      // ne zaman koştuğuna bakılarak değil.
      throw new QuoteServiceError(
        "Anlaşmanın fiyat kilidi doldu; parti serbest bırakılamaz. Kilidi uzatın ya da yeni anlaşma kurun.",
        409,
        "framework_expired"
      );
    }
    const sourceQuote = await lockSourceQuote(tx, framework.quoteId);

    const [batch] = await tx
      .select()
      .from(quoteFrameworkBatches)
      .where(
        and(
          eq(quoteFrameworkBatches.id, args.batchId),
          eq(quoteFrameworkBatches.frameworkId, framework.id)
        )
      )
      .limit(1);
    if (!batch) {
      throw new QuoteServiceError("Parti bulunamadı.", 404, "batch_not_found");
    }
    if (batch.status !== "planned") {
      throw new QuoteServiceError(
        "Bu parti planlı değil; yalnız planlı bir parti serbest bırakılabilir.",
        409,
        "batch_not_planned"
      );
    }
    if (
      args.expectedAmountKurus !== undefined &&
      args.expectedAmountKurus !== batch.amountKurus
    ) {
      throw new QuoteServiceError(
        "Partinin tutarı ekranda gördüğünüzden farklı; sayfayı yenileyip tekrar deneyin.",
        409,
        "amount_mismatch"
      );
    }

    const lines = await tx
      .select({
        partId: quoteFrameworkBatchLines.partId,
        quantity: quoteFrameworkBatchLines.quantity,
        unitKurus: quoteFrameworkBatchLines.unitKurus,
      })
      .from(quoteFrameworkBatchLines)
      .where(eq(quoteFrameworkBatchLines.batchId, batch.id))
      .orderBy(asc(quoteFrameworkBatchLines.position));
    if (lines.length === 0) {
      throw new QuoteServiceError("Partide satır yok.", 409, "batch_empty");
    }

    const snapshot = framework.pricingSnapshot;
    const clone = await cloneQuoteForFrameworkBatch(tx, {
      sourceQuote,
      snapshot,
      // TANIM KAPISININ ölçüsü: klon yapılandırmayı CANLI kaynak parçadan
      // okuyor, o yüzden yazılan tanım anlaşmanın DONMUŞ tanımıyla
      // karşılaştırılır (409 `framework_part_changed`).
      partsSnapshot: framework.partsSnapshot,
      // ANLAŞMANIN snapshot damgası = kaynak teklifin `snapshot_taken_at`ı:
      // anlaşma o teklifin `pricing_snapshot`ını KOPYALADI, yani kilitli
      // kataloğun yaşı odur. `quote_frameworks` ayrı bir damga kolonu
      // TAŞIMIYOR ve taşımasına gerek de yok (bu turda migration YOK) —
      // ikinci bir kolon aynı gerçeğin bayatlayabilen bir kopyası olurdu.
      //
      // KLON TARİHİ YAZILMAZ, ÇÜNKÜ O BİR YALAN OLURDU: snapshot gerçekten
      // eski ve bu damgaya bakan her şey (bakım turu, "kataloğun yaşı")
      // klonu taze sanardı. "Katalog güncellendi — yeniden fiyatla" bandının
      // kilitli fiyatı ŞÜPHELİ göstermesi ise damgayı bozarak değil,
      // BANDI PARTİDE HİÇ ÇİZMEYEREK çözülür (`loadPresentedQuote`:
      // `catalogChanged: !isFrameworkBatch && …`). Bant bir "yeniden fiyatla"
      // ÇAĞRISIDIR ve kilitli, salt okunur bir partide yapılacak bir şey yok.
      snapshotTakenAt: sourceQuote.snapshotTakenAt,
      leadTier: framework.leadTier,
      addonKeys: framework.addonKeys,
      lines,
      // Klonun geçerliliği kilidi AŞAMAZ: min(kilit, bugün + quoteValidDays).
      expiresAt: new Date(
        Math.min(
          framework.priceLockedUntil.getTime(),
          now.getTime() + snapshot.settings.quoteValidDays * 86_400_000
        )
      ),
      fxSnapshot,
      userId: framework.userId,
      pricedByEmail: args.adminEmail,
      now,
    });

    // ─── EŞİTLİK KAPISI ───────────────────────────────────────────────────
    // BRÜT karşılaştırılır (`payableKurus` DEĞİL): hediye kartı brütü
    // düşürmez, tahsil edilen nakdi düşürür — `payableKurus` ile
    // karşılaştırmak hediye kartlı her partiyi ödenemez bir 409'a düşürürdü.
    if (
      frameworkBatchDriftCode(clone.computed.totals.totalKurus, batch.amountKurus) !== null
    ) {
      console.error(
        `[quote-framework] fiyat sapması: parti ${batch.id} (anlaşma ${framework.number}, ` +
          `sıra ${batch.position}) kilitli ${batch.amountKurus} kuruş, klon ` +
          `${clone.number} bugün ${clone.computed.totals.totalKurus} kuruş hesapladı — ` +
          "serbest bırakma GERİ ALINDI"
      );
      throw new QuoteServiceError(FRAMEWORK_PRICE_DRIFT_ERROR, 409, "framework_price_drift");
    }

    // KORUMALI UPDATE: yarışın kapısı. Satır dönmezse başka bir istek bu
    // partiyi çoktan bırakmış demektir ve BU işlem (klon dâhil) geri alınır.
    const updated = await tx
      .update(quoteFrameworkBatches)
      .set({
        status: "released",
        quoteId: clone.id,
        releasedAt: now,
        releasedByEmail: args.adminEmail,
        updatedAt: now,
      })
      .where(
        and(
          eq(quoteFrameworkBatches.id, batch.id),
          eq(quoteFrameworkBatches.status, "planned")
        )
      )
      .returning({ id: quoteFrameworkBatches.id });
    if (updated.length === 0) {
      throw new QuoteServiceError(
        "Bu parti planlı değil; yalnız planlı bir parti serbest bırakılabilir.",
        409,
        "batch_not_planned"
      );
    }

    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_batch_release",
      adminEmail: args.adminEmail,
      reason: args.reason,
      before: { batchId: batch.id, status: "planned" },
      after: {
        batchId: batch.id,
        status: "released",
        quoteId: clone.id,
        quoteNumber: clone.number,
        amountKurus: batch.amountKurus,
      },
    });

    return {
      batchId: batch.id,
      position: batch.position,
      quoteId: clone.id,
      quoteNumber: clone.number,
      amountKurus: batch.amountKurus,
      userId: framework.userId,
    };
  });

  // Yayınlar commit'ten SONRA ve BEKLEMEZ: Redis'in erişilemez olması bir para
  // işlemini düşürmemeli.
  emitFrameworkChanged({ frameworkId: args.frameworkId, userId: out.userId });
  emitQuoteChanged({ quoteId: out.quoteId, userId: out.userId });
  return {
    batchId: out.batchId,
    position: out.position,
    quoteId: out.quoteId,
    quoteNumber: out.quoteNumber,
    amountKurus: out.amountKurus,
  };
}

// ─── İptaller ───────────────────────────────────────────────────────────────

/**
 * Planlı bir partiyi iptal eder.
 *
 * YALNIZ `planned`: serbest bırakılmış bir partide ortada bir sipariş vardır ve
 * onu kapatmak iade motorunun işidir (`order-refund.ts`), bu servisin değil.
 * İptal edilmiş PLANLI bir partide para HİÇ HAREKET ETMEMİŞTİR, o yüzden
 * `cancelPaidOrder` ÇAĞRILMAZ ve taahhüt de serbest kalır (saf çekirdek:
 * `frameworkLineConsumesCommitment`).
 */
export async function cancelBatch(args: {
  frameworkId: string;
  batchId: string;
  adminEmail: string;
  reason: string;
  now?: Date;
}): Promise<{ batchId: string }> {
  const now = args.now ?? new Date();
  const out = await db.transaction(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    const updated = await tx
      .update(quoteFrameworkBatches)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: args.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(quoteFrameworkBatches.id, args.batchId),
          eq(quoteFrameworkBatches.frameworkId, framework.id),
          eq(quoteFrameworkBatches.status, "planned")
        )
      )
      .returning({ id: quoteFrameworkBatches.id });
    if (updated.length === 0) {
      throw new QuoteServiceError(
        "Yalnız planlı bir parti iptal edilebilir; serbest bırakılmış partinin iptali " +
          "sipariş iadesidir.",
        409,
        "batch_not_planned"
      );
    }
    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_batch_cancel",
      adminEmail: args.adminEmail,
      reason: args.reason,
      before: { batchId: args.batchId, status: "planned" },
      after: { batchId: args.batchId, status: "cancelled" },
    });
    return { batchId: args.batchId, userId: framework.userId };
  });
  emitFrameworkChanged({ frameworkId: args.frameworkId, userId: out.userId });
  return { batchId: out.batchId };
}

/**
 * Anlaşmayı iptal eder.
 *
 * ÖDENMİŞ PARTİLERE DOKUNMAZ (clawback YOK): onlar kendi yaşam döngüsünü
 * sürdürür, iadeleri bugünkü iade akışının işidir. İptal edilen şey
 * ANLAŞMADIR: durum `cancelled`, PLANLI partiler iptal, kilit düşer.
 * `cancelPaidOrder` çağrılmaz — iptal edilen planlı partide sipariş YOKTUR.
 */
export async function cancelFramework(args: {
  frameworkId: string;
  adminEmail: string;
  reason: string;
  now?: Date;
}): Promise<{ id: string; cancelledBatchCount: number }> {
  const now = args.now ?? new Date();
  const out = await db.transaction(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    if (framework.status === "cancelled") {
      throw new QuoteServiceError("Anlaşma zaten iptal edilmiş.", 409, "already_cancelled");
    }
    const cancelled = await tx
      .update(quoteFrameworkBatches)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: args.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(quoteFrameworkBatches.frameworkId, framework.id),
          eq(quoteFrameworkBatches.status, "planned")
        )
      )
      .returning({ id: quoteFrameworkBatches.id });
    await tx
      .update(quoteFrameworks)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: args.reason,
        updatedAt: now,
      })
      .where(eq(quoteFrameworks.id, framework.id));
    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_cancel",
      adminEmail: args.adminEmail,
      reason: args.reason,
      before: { status: framework.status },
      after: { status: "cancelled", cancelledBatchCount: cancelled.length },
    });
    return {
      id: framework.id,
      cancelledBatchCount: cancelled.length,
      userId: framework.userId,
    };
  });
  emitFrameworkChanged({ frameworkId: out.id, userId: out.userId });
  return { id: out.id, cancelledBatchCount: out.cancelledBatchCount };
}

// ─── Kilidi uzatma ──────────────────────────────────────────────────────────

/**
 * Fiyat kilidini İLERİ taşır ve süresi dolmuş bir anlaşmayı `active`a döndürür.
 *
 * Tarih GERİYE alınamaz: geri almak, bugün serbest bırakılabilir bir partiyi
 * sessizce reddedilebilir hâle getirmek olurdu. İptal edilmiş ya da tamamlanmış
 * bir anlaşmada uzatma anlamsızdır.
 */
export async function extendFrameworkLock(args: {
  frameworkId: string;
  adminEmail: string;
  reason: string;
  /** YENİ kilit sonu, `YYYY-MM-DD`. */
  priceLockedUntil: string;
  now?: Date;
}): Promise<{ id: string; priceLockedUntil: string; status: FrameworkStatus }> {
  const now = args.now ?? new Date();
  const next = endOfDay(args.priceLockedUntil);
  const out = await db.transaction(async (tx) => {
    await tx.execute(LOCK_TIMEOUT);
    const framework = await lockFramework(tx, args.frameworkId);
    if (framework.status === "cancelled" || framework.status === "completed") {
      throw new QuoteServiceError(
        "İptal edilmiş ya da tamamlanmış bir anlaşmanın fiyat kilidi uzatılamaz.",
        409,
        "framework_closed"
      );
    }
    if (next.getTime() <= framework.priceLockedUntil.getTime()) {
      throw new QuoteServiceError(
        "Yeni kilit tarihi mevcut tarihten sonra olmalı.",
        400,
        "lock_not_extended"
      );
    }
    if (next.getTime() <= now.getTime()) {
      throw new QuoteServiceError("Yeni kilit tarihi gelecekte olmalı.", 400, "lock_in_past");
    }
    // Süresi dolmuş anlaşma uzatmayla YENİDEN AKTİF olur; taslak taslak kalır
    // (aktifleştirme ayrı bir karardır).
    const status: FrameworkStatus = framework.status === "expired" ? "active" : framework.status;
    await tx
      .update(quoteFrameworks)
      .set({ priceLockedUntil: next, status, updatedAt: now })
      .where(eq(quoteFrameworks.id, framework.id));
    await audit(tx, {
      quoteId: framework.quoteId,
      action: "framework_extend",
      adminEmail: args.adminEmail,
      reason: args.reason,
      before: {
        priceLockedUntil: framework.priceLockedUntil.toISOString(),
        status: framework.status,
      },
      after: { priceLockedUntil: next.toISOString(), status },
    });
    return { id: framework.id, status, userId: framework.userId };
  });
  emitFrameworkChanged({ frameworkId: out.id, userId: out.userId });
  return { id: out.id, priceLockedUntil: args.priceLockedUntil, status: out.status };
}

// ─── Okuma yüzeyleri ────────────────────────────────────────────────────────

export interface FrameworkBatchLineView {
  partId: string;
  position: number;
  quantity: number;
  unitKurus: number;
  lineKurus: number;
}

export interface FrameworkBatchView {
  id: string;
  position: number;
  status: FrameworkBatchStatus;
  plannedShipDate: string;
  units: number;
  amountKurus: number;
  quoteId: string | null;
  quoteNumber: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  paymentStatus: string | null;
  /** Partner payı ÜRETİCİ KABULÜNDE donar; iki parti FARKLI oran taşıyabilir. */
  commissionRateBps: number | null;
  releasedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  lines: FrameworkBatchLineView[];
}

export interface FrameworkDetail {
  id: string;
  number: string;
  status: FrameworkStatus;
  title: string | null;
  quoteId: string;
  quoteNumber: string;
  userId: string;
  leadTier: LeadTierKey;
  addonKeys: string[];
  partsSnapshot: FrozenQuotePart[];
  addonsSnapshot: FrozenQuoteAddon[];
  committedUnits: number;
  /**
   * TEK-SEVKİYAT PROJEKSİYONU: taahhüdün TAMAMI tek siparişte sevk edilseydi
   * ödenecek tutar.
   *
   * `Σ batch.amountKurus` DEĞİLDİR ve genelde ondan KÜÇÜKTÜR: her parti KENDİ
   * teklifi olduğu için `fixed` ve `per_part` ek hizmetler ile asgari
   * tamamlama HER PARTİDE yeniden işler (`addonLines`). İki rakam da dürüst;
   * bunu Σ parti tutarı sanmak müşteriye yanlış bir toplam söylemektir.
   */
  committedTotalKurus: number;
  /** İptal edilmemiş partilerin tutar toplamı. Yukarıdakinin YERİNE GEÇMEZ. */
  batchesTotalKurus: number;
  priceLockedUntil: string;
  lockExpired: boolean;
  preferredManufacturerId: string | null;
  preferredManufacturerName: string | null;
  shippingAddress: TurkishAddress;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  customerNote: string | null;
  adminNote: string | null;
  activatedAt: string | null;
  activatedByEmail: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  batches: FrameworkBatchView[];
  progress: { total: FrameworkProgress; byPart: FrameworkPartProgress[] };
}

/**
 * Anlaşmanın tam hâli: taahhüt, partiler, siparişleri ve kova kırılımı.
 *
 * İPTAL GERÇEĞİ İCAT EDİLMEZ: `orders.status` "iptal" diye bir değer taşımıyor
 * (iptal `status`u `'rejected'` yapıp `payment_status`u `'succeeded'` bırakır,
 * ikinci biçimi ise `order_refunds.kind='cancellation'` satırıdır). O yüzden
 * ölçü depodaki TEK iptal ölçüsünden gelir: `actualReturnFacts(...).cancelled`
 * (`order-money.ts`). `cancellationCashUnknown` DOLDURULMAZ — o alan yalnız
 * `cashRemainingKurus`u etkiliyor ve çerçeve ekranı o rakamı göstermiyor;
 * `cancelled` ondan bağımsızdır.
 */
export async function loadFrameworkDetail(frameworkId: string): Promise<FrameworkDetail | null> {
  const [row] = await db
    .select({
      framework: quoteFrameworks,
      quoteNumber: quotes.number,
      manufacturerName: manufacturers.companyName,
    })
    .from(quoteFrameworks)
    .innerJoin(quotes, eq(quotes.id, quoteFrameworks.quoteId))
    .leftJoin(manufacturers, eq(manufacturers.id, quoteFrameworks.preferredManufacturerId))
    .where(eq(quoteFrameworks.id, frameworkId))
    .limit(1);
  if (!row) return null;
  const framework = row.framework;

  const batchRows = await db
    .select({
      batch: quoteFrameworkBatches,
      quoteNumber: quotes.number,
      orderNumber: orders.orderNumber,
      orderStatus: orders.status,
      paymentStatus: orders.paymentStatus,
      commissionRateBps: orders.commissionRateBps,
      amountKurus: orders.amountKurus,
      giftCardAmountKurus: orders.giftCardAmountKurus,
      havaleDiscountKurus: orders.havaleDiscountKurus,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(quoteFrameworkBatches)
    .leftJoin(quotes, eq(quotes.id, quoteFrameworkBatches.quoteId))
    .leftJoin(orders, eq(orders.id, quoteFrameworkBatches.orderId))
    .where(eq(quoteFrameworkBatches.frameworkId, framework.id))
    .orderBy(asc(quoteFrameworkBatches.position));

  const lineRows = await db
    .select()
    .from(quoteFrameworkBatchLines)
    .where(eq(quoteFrameworkBatchLines.frameworkId, framework.id))
    .orderBy(asc(quoteFrameworkBatchLines.position));
  const linesByBatch = new Map<string, FrameworkBatchLineView[]>();
  for (const line of lineRows) {
    const list = linesByBatch.get(line.batchId) ?? [];
    list.push({
      partId: line.partId,
      position: line.position,
      quantity: line.quantity,
      unitKurus: line.unitKurus,
      lineKurus: line.lineKurus,
    });
    linesByBatch.set(line.batchId, list);
  }

  // İade/iptal tahsisleri: `actualReturnFacts`in girdisi. Eksik veri SIFIR
  // İADE gibi görünmemeli, o yüzden okuma sessizce boşa düşmez.
  const orderIds = batchRows
    .map((b) => b.batch.orderId)
    .filter((id): id is string => id !== null);
  const refundsByOrder = new Map<
    string,
    Array<{ kind: "refund" | "cancellation" | "legacy_evidence"; cashKurus: number; giftKurus: number }>
  >();
  if (orderIds.length > 0) {
    const refundRows = await db
      .select({
        orderId: orderRefundAllocations.orderId,
        kind: orderRefundRecords.kind,
        cashKurus: orderRefundAllocations.cashKurus,
        giftKurus: orderRefundAllocations.giftKurus,
      })
      .from(orderRefundAllocations)
      .innerJoin(
        orderRefundRecords,
        and(
          eq(orderRefundRecords.id, orderRefundAllocations.refundId),
          eq(orderRefundRecords.kind, orderRefundAllocations.kind)
        )
      )
      .where(inArray(orderRefundAllocations.orderId, orderIds));
    for (const r of refundRows) {
      const list = refundsByOrder.get(r.orderId) ?? [];
      list.push({ kind: r.kind, cashKurus: r.cashKurus, giftKurus: r.giftKurus });
      refundsByOrder.set(r.orderId, list);
    }
  }

  const batches: FrameworkBatchView[] = [];
  const progressLines: FrameworkProgressLine[] = [];
  let batchesTotalKurus = 0;
  for (const r of batchRows) {
    const b = r.batch;
    const lines = linesByBatch.get(b.id) ?? [];
    batches.push({
      id: b.id,
      position: b.position,
      status: b.status,
      plannedShipDate: b.plannedShipDate,
      units: b.units,
      amountKurus: b.amountKurus,
      quoteId: b.quoteId,
      quoteNumber: r.quoteNumber ?? null,
      orderId: b.orderId,
      orderNumber: r.orderNumber ?? null,
      orderStatus: r.orderStatus ?? null,
      paymentStatus: r.paymentStatus ?? null,
      commissionRateBps: r.commissionRateBps ?? null,
      releasedAt: b.releasedAt?.toISOString() ?? null,
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      cancelReason: b.cancelReason,
      note: b.note,
      lines,
    });
    if (b.status !== "cancelled") batchesTotalKurus += b.amountKurus;

    const cancelled =
      b.orderId === null
        ? false
        : actualReturnFacts({
            amountKurus: r.amountKurus ?? 0,
            giftCardAmountKurus: r.giftCardAmountKurus ?? 0,
            havaleDiscountKurus: r.havaleDiscountKurus ?? 0,
            paymentStatus: r.paymentStatus ?? null,
            status: r.orderStatus ?? undefined,
            refunds: refundsByOrder.get(b.orderId) ?? [],
          }).cancelled;
    for (const line of lines) {
      progressLines.push({
        partId: line.partId,
        quantity: line.quantity,
        batchStatus: b.status,
        orderId: b.orderId,
        cancelled,
        paymentStatus: r.paymentStatus ?? null,
        shippedAt: r.shippedAt ?? null,
        deliveredAt: r.deliveredAt ?? null,
      });
    }
  }

  const now = new Date();
  return {
    id: framework.id,
    number: framework.number,
    status: framework.status,
    title: framework.title,
    quoteId: framework.quoteId,
    quoteNumber: row.quoteNumber,
    userId: framework.userId,
    leadTier: framework.leadTier,
    addonKeys: framework.addonKeys,
    partsSnapshot: framework.partsSnapshot,
    addonsSnapshot: framework.addonsSnapshot,
    committedUnits: framework.committedUnits,
    committedTotalKurus: framework.committedTotalKurus,
    batchesTotalKurus,
    priceLockedUntil: framework.priceLockedUntil.toISOString(),
    lockExpired: framework.priceLockedUntil.getTime() < now.getTime(),
    preferredManufacturerId: framework.preferredManufacturerId,
    preferredManufacturerName: row.manufacturerName ?? null,
    shippingAddress: framework.shippingAddress,
    termsAcceptedAt: framework.termsAcceptedAt?.toISOString() ?? null,
    termsVersion: framework.termsVersion,
    customerNote: framework.customerNote,
    adminNote: framework.adminNote,
    activatedAt: framework.activatedAt?.toISOString() ?? null,
    activatedByEmail: framework.activatedByEmail,
    cancelledAt: framework.cancelledAt?.toISOString() ?? null,
    cancelReason: framework.cancelReason,
    createdAt: framework.createdAt.toISOString(),
    batches,
    progress: frameworkProgressBuckets(commitmentOf(framework), progressLines),
  };
}

export interface FrameworkListItem {
  id: string;
  number: string;
  status: FrameworkStatus;
  title: string | null;
  quoteNumber: string;
  committedUnits: number;
  committedTotalKurus: number;
  priceLockedUntil: string;
  lockExpired: boolean;
  batchCount: number;
  plannedBatchCount: number;
  createdAt: string;
}

type FrameworkFilter = ReturnType<typeof eq> | undefined;

async function listFrameworks(
  where: FrameworkFilter,
  page: number
): Promise<{ items: FrameworkListItem[]; hasNext: boolean }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const rows = await db
    .select({
      id: quoteFrameworks.id,
      number: quoteFrameworks.number,
      status: quoteFrameworks.status,
      title: quoteFrameworks.title,
      quoteNumber: quotes.number,
      committedUnits: quoteFrameworks.committedUnits,
      committedTotalKurus: quoteFrameworks.committedTotalKurus,
      priceLockedUntil: quoteFrameworks.priceLockedUntil,
      createdAt: quoteFrameworks.createdAt,
      batchCount: sql<number>`(
        SELECT count(*)::int FROM ${quoteFrameworkBatches}
        WHERE ${quoteFrameworkBatches.frameworkId} = ${quoteFrameworks.id}
          AND ${quoteFrameworkBatches.status} <> 'cancelled'
      )`,
      plannedBatchCount: sql<number>`(
        SELECT count(*)::int FROM ${quoteFrameworkBatches}
        WHERE ${quoteFrameworkBatches.frameworkId} = ${quoteFrameworks.id}
          AND ${quoteFrameworkBatches.status} = 'planned'
      )`,
    })
    .from(quoteFrameworks)
    .innerJoin(quotes, eq(quotes.id, quoteFrameworks.quoteId))
    .where(where)
    .orderBy(desc(quoteFrameworks.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const now = Date.now();
  const items: FrameworkListItem[] = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    title: r.title,
    quoteNumber: r.quoteNumber,
    committedUnits: r.committedUnits,
    committedTotalKurus: r.committedTotalKurus,
    priceLockedUntil: r.priceLockedUntil.toISOString(),
    lockExpired: r.priceLockedUntil.getTime() < now,
    batchCount: r.batchCount,
    plannedBatchCount: r.plannedBatchCount,
    createdAt: r.createdAt.toISOString(),
  }));
  return { items, hasNext: rows.length > PAGE_SIZE };
}

/** Müşterinin kendi anlaşmaları (`/account/cerceve`). */
export async function listCustomerFrameworks(
  userId: string,
  page = 1
): Promise<{ items: FrameworkListItem[]; hasNext: boolean }> {
  return listFrameworks(eq(quoteFrameworks.userId, userId), page);
}

/** Admin listesi; `status` verilmezse hepsi (süzgeç YOK, `where` de yok). */
export async function listAdminFrameworks(
  args: { status?: FrameworkStatus; page?: number } = {}
): Promise<{ items: FrameworkListItem[]; hasNext: boolean }> {
  return listFrameworks(
    args.status ? eq(quoteFrameworks.status, args.status) : undefined,
    args.page ?? 1
  );
}

export interface ManufacturerPlannedBatch {
  batchId: string;
  frameworkNumber: string;
  position: number;
  plannedShipDate: string;
  units: number;
  /** Partinin tezgâhta kaplayacağı AĞIRLIKLI yük — GÖSTERİM, kapı değil. */
  loadUnits: number;
}

/**
 * Üreticiye İLERİYE DÖNÜK parti listesi — YALNIZ GÖSTERİM.
 *
 * FİYAT ve MÜŞTERİ KİMLİĞİ GİTMEZ: üretici ne tutarı ne müşteriyi görür.
 * Alan adlarında `…Kurus` ile biten hiçbir şey yoktur, çünkü burada hiç tutar
 * yok. `loadUnits` de bir kapı değil, okunabilir bir sayıdır
 * (`manufacturer-capacity.ts` KARAR 2): planlı parti tezgâhta yer KAPLAMAZ,
 * ortada sipariş yoktur.
 */
export async function loadManufacturerPlannedBatches(
  manufacturerId: string
): Promise<ManufacturerPlannedBatch[]> {
  const rows = await db
    .select({
      batchId: quoteFrameworkBatches.id,
      frameworkNumber: quoteFrameworks.number,
      position: quoteFrameworkBatches.position,
      plannedShipDate: quoteFrameworkBatches.plannedShipDate,
      units: quoteFrameworkBatches.units,
    })
    .from(quoteFrameworkBatches)
    .innerJoin(quoteFrameworks, eq(quoteFrameworks.id, quoteFrameworkBatches.frameworkId))
    .where(
      and(
        eq(quoteFrameworks.preferredManufacturerId, manufacturerId),
        eq(quoteFrameworks.status, "active"),
        eq(quoteFrameworkBatches.status, "planned")
      )
    )
    .orderBy(asc(quoteFrameworkBatches.plannedShipDate), asc(quoteFrameworkBatches.position));
  return rows.map((r) => ({
    batchId: r.batchId,
    frameworkNumber: r.frameworkNumber,
    position: r.position,
    plannedShipDate: r.plannedShipDate,
    units: r.units,
    loadUnits: frameworkBatchLoadUnits(r.units),
  }));
}
