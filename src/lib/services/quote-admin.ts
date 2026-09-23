/**
 * Teklifin ADMIN tarafı: kuyruk, manuel fiyat, hedef fiyat kararı, süre
 * uzatma, yeniden açma.
 *
 * Dört kural bütün dosyayı biçimlendirir:
 *
 * 1. **Admin'in girdiği her tutar YAZILMADAN ÖNCE doğrulanır.**
 *    `computeQuote` saklanan değere güvenir ve `presentQuote` bozuk bir değeri
 *    ancak SESSİZCE düşürebilir; negatif, ondalık ya da ₺2.000.000 üstü bir
 *    sayı buradan geçerse ya müşteriye yanlış bir tutar gösterilir ya da
 *    admin'in girdiği fiyat hiç görünmez. Kapı tek yerde: `validateAdminUnitPrice`.
 * 2. **Manuel fiyat, ANAHTARIYLA birlikte yazılır.** Anahtar
 *    `partPricingKey(part, quote.leadTier)`tir; fiyat çekirdeği aynı işlevi
 *    çağırıp eşitliğe bakar. Anahtarı elle kurmak (ya da kademeyi unutmak)
 *    hata vermez, fiyatı SESSİZCE düşürür.
 * 3. **Kuyruk sekmeleri DURUMA bakar.** `repriceQuote` teklifi `draft`a çeker
 *    ama `review_kind`/`review_note` kolonlarını temizlemez ve
 *    `splitByTechnology` inceleme durumunu yeni teklife hiç taşımaz: bu
 *    kolonlara bakan bir kuyruk, cevaplanmış bir teklifi sonsuza dek "inceleme
 *    bekliyor" gösterirdi.
 * 4. **Müşteriye YALAN söylenmez.** Bir teklif ancak HER parçası fiyatlıyken
 *    `quoted` olur ve "teklifiniz hazır" bildirimi ancak o zaman gider; aksi
 *    hâlde teklif incelemede kalır ve ekran hangi parçanın eksik olduğunu
 *    yazar.
 *
 * Yazma iskeleti `order-money-edit.ts`ten alınmıştır: `SET LOCAL lock_timeout`,
 * `FOR UPDATE`, `expectedUpdatedAt` karşılaştırması, korumalı UPDATE ve
 * denetim satırı AYNI işlemde.
 */
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  quoteAdminActions,
  quoteParts,
  quotes,
  users,
  type Quote,
  type QuotePart,
} from "@/lib/db/schema";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { computeQuote } from "@/lib/config/quote-compute";
import { partPricingKey } from "@/lib/config/quote-keys";
import type {
  AdminQuoteListItem,
  AnalysisStatus,
  ComputedPart,
  DfmIssue,
  InvoiceType,
  LeadTierKey,
  PartConfig,
  QuoteAdminAction,
  QuoteSourceFormat,
  QuoteStatus,
  ReviewKind,
  Vec3,
} from "@/lib/config/quote-types";
import { scaledGeometry } from "@/lib/config/quote-units";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { emitQuoteChanged } from "@/lib/realtime/emit";
import { recomputeQuoteCache, type QuoteCacheTx } from "@/lib/services/quote-cache";
import { notifyManualQuoteReady, notifyTargetDecision } from "@/lib/services/quote-notify";
import { toPricingInputs } from "@/lib/services/quote-present";
import { liveDraftForQuote } from "@/lib/services/quote-service";
import { getPublicUrl } from "@/lib/services/storage";

// ─── Hata ve sonuç şekli ────────────────────────────────────────────────────

/**
 * Rotanın olduğu gibi cevaba çevirebileceği, Türkçe cümleli admin hatası.
 *
 * Beklenen retler DEĞER olarak döner (`adminQuoteOutcome`), `throw` ile değil:
 * depo genelindeki "boş gövdeli 500 imkânsız" taraması rotaların `catch`inde
 * yalnız `handleRouteFailure` görmek ister (ev örneği: `order-money-edit.ts`).
 */
export class AdminQuoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "AdminQuoteError";
  }
}

/**
 * Yazma sonucu.
 *
 * `quoted` alanı "müşterinin ödeyebileceği bir teklif çıktı mı" sorusunun
 * cevabıdır: brief'in mutlu yolu (durum `quoted`) ancak HER parça fiyatlıyken
 * gerçekleşir. `blockers` eksik kalan parçaları adıyla sayar, böylece admin
 * ekranda ne yapacağını görür.
 */
export interface AdminQuoteWriteResult {
  ok: true;
  quoted: boolean;
  blockers: string[];
}

export type AdminQuoteOutcome =
  | AdminQuoteWriteResult
  | { ok: false; status: number; code: string; error: string };

/** Beklenen retleri değere çevirir; geri kalanı olduğu gibi yukarı bırakır. */
export async function adminQuoteOutcome(
  run: () => Promise<AdminQuoteWriteResult>
): Promise<AdminQuoteOutcome> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof AdminQuoteError) {
      return { ok: false, status: e.status, code: e.code, error: e.message };
    }
    throw e;
  }
}

// ─── Saf doğrulayıcılar (DB yok — testler bunları doğrudan çağırır) ─────────

export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 2000;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 365;
export const ADMIN_QUOTE_PAGE_SIZE = 25;
/** Tek bir yazımda kaç parça satırı kabul edilir (teklif sınırının üstü). */
const MAX_PRICE_ROWS = 200;

const INVALID_BODY = "İstek gövdesi geçersiz.";

/**
 * Admin'in girdiği TEK para kapısı (carry-forward (a)).
 *
 * `quote_parts.manual_unit_price_kurus` düz bir `integer`dır: aralık kontrolü
 * veritabanında YOKTUR. `presentQuote` bozuk bir değeri yok sayar, yani yanlış
 * bir sayı burada geçerse admin fiyatı girdiğini sanır, müşteri "manuel fiyat
 * bekliyor" görür — ya da (sınırı aşmayan bir hatada) yanlış tutarı öder.
 */
export function validateAdminUnitPrice(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_AMOUNT_KURUS
  ) {
    throw new AdminQuoteError(
      "invalid_price",
      `Birim fiyat kuruş cinsinden tam sayı olmalı ve 1 ile ${MAX_AMOUNT_KURUS} arasında kalmalı.`,
      400
    );
  }
  return value;
}

function asRows(raw: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PRICE_ROWS) {
    throw new AdminQuoteError("invalid_body", `${label} listesi geçersiz.`, 400);
  }
  const seen = new Set<string>();
  return raw.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new AdminQuoteError("invalid_body", INVALID_BODY, 400);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.partId !== "string" || row.partId.length === 0) {
      throw new AdminQuoteError("invalid_body", "Parça kimliği eksik.", 400);
    }
    if (seen.has(row.partId)) {
      throw new AdminQuoteError("invalid_body", "Aynı parça listede iki kez var.", 400);
    }
    seen.add(row.partId);
    return row;
  });
}

export interface ManualPriceRow {
  partId: string;
  /** `null` = bu parçanın manuel fiyatını KALDIR (otomatik fiyata dön). */
  unitKurus: number | null;
}

export function parseManualPriceRows(raw: unknown): ManualPriceRow[] {
  return asRows(raw, "Parça fiyatı").map((row) => ({
    partId: row.partId as string,
    unitKurus:
      row.unitKurus === null || row.unitKurus === undefined
        ? null
        : validateAdminUnitPrice(row.unitKurus),
  }));
}

export interface TargetCounterRow {
  partId: string;
  unitKurus: number;
}

/** Karşı teklifte boş fiyat YOKTUR: "karşı teklif" bir tutar demektir. */
export function parseTargetCounters(raw: unknown): TargetCounterRow[] {
  return asRows(raw, "Karşı teklif").map((row) => {
    if (row.unitKurus === null || row.unitKurus === undefined) {
      throw new AdminQuoteError(
        "invalid_body",
        "Karşı teklifte her parçaya birim fiyat yazılmalı.",
        400
      );
    }
    return { partId: row.partId as string, unitKurus: validateAdminUnitPrice(row.unitKurus) };
  });
}

/**
 * Gerekçe en az on karakter.
 *
 * Müşterinin inceleme talebiyle AYNI alt sınır: kararın neden verildiği
 * denetim izine yazılır ve altı ay sonra "iskonto yaptık" satırının sebebini
 * okuyabilmek gerekir.
 */
export function requireReason(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.length < MIN_REASON_LENGTH) {
    throw new AdminQuoteError(
      "reason_too_short",
      `Gerekçeyi en az ${MIN_REASON_LENGTH} karakterle yazın.`,
      400
    );
  }
  return text.slice(0, MAX_REASON_LENGTH);
}

export function parseExtendDays(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < MIN_EXPIRY_DAYS ||
    raw > MAX_EXPIRY_DAYS
  ) {
    throw new AdminQuoteError(
      "invalid_body",
      `Geçerlilik süresi ${MIN_EXPIRY_DAYS} ile ${MAX_EXPIRY_DAYS} gün arasında tam sayı olmalı.`,
      400
    );
  }
  return raw;
}

/**
 * Manuel fiyatın bağlı olduğu anahtar.
 *
 * Tek satırlık sarmalayıcı BİLEREK var: yazma yolunun anahtarı, fiyat
 * çekirdeğinin okuduğu anahtarla AYNI işlevden gelsin. İkinci bir çağrı yeri
 * (ve bir gün unutulan bir `leadTier` argümanı) manuel fiyatı sessizce
 * düşürürdü.
 */
export function adminManualPriceKey(
  part: { sourceSha256: string | null; config: PartConfig },
  leadTier: LeadTierKey
): string {
  return partPricingKey(part, leadTier);
}

/** Anahtar üretiminin girdisi: parçanın dosyası + fiyatı belirleyen konfigürasyon. */
function keyInputOf(part: QuotePart): { sourceSha256: string | null; config: PartConfig } {
  return { sourceSha256: part.sourceSha256, config: configOf(part) };
}

function configOf(part: QuotePart): PartConfig {
  return {
    technologyKey: part.technologyKey,
    materialKey: part.materialKey,
    colorKey: part.colorKey,
    finishKey: part.finishKey,
    layerUm: part.layerUm,
    infillPct: part.infillPct,
    quantity: part.quantity,
    units: part.units,
    scale: part.scale,
    criticalTolerance: part.criticalTolerance,
  };
}

// ─── Kuyruk sekmeleri ───────────────────────────────────────────────────────

export const ADMIN_QUOTE_TABS = [
  "review",
  "target",
  "rfq",
  "quoted",
  "ordered",
  "expired",
  "all",
] as const;
export type AdminQuoteTab = (typeof ADMIN_QUOTE_TABS)[number];

export const ADMIN_QUOTE_TAB_LABELS: Record<AdminQuoteTab, string> = {
  review: "İnceleme bekleyen",
  target: "Hedef fiyat",
  rfq: "RFQ",
  quoted: "Fiyatlandı",
  ordered: "Sipariş",
  expired: "Süresi dolan",
  all: "Tümü",
};

export function parseAdminQuoteTab(raw: unknown): AdminQuoteTab | null {
  if (raw === undefined || raw === null || raw === "") return "review";
  if (typeof raw !== "string") return null;
  return (ADMIN_QUOTE_TABS as readonly string[]).includes(raw) ? (raw as AdminQuoteTab) : null;
}

/** Sekme filtresinin baktığı alanlar — satırın tamamı gerekmez. */
export interface QuoteTabRow {
  status: QuoteStatus;
  reviewKind: ReviewKind | null;
  expiresAt: Date;
}

/**
 * `review_kind` dolu ama teklif artık incelemede DEĞİL.
 *
 * `repriceQuote` durumu `draft`a çekerken bu kolonu bırakır. Ekran bunu
 * gösterir ("müşteri bir zamanlar manuel fiyat istemişti") ama kuyruk buna
 * GÖRE FİLTRELEMEZ.
 */
export function isStaleReviewKind(row: Pick<QuoteTabRow, "status" | "reviewKind">): boolean {
  return row.reviewKind !== null && row.status !== "needs_review";
}

/**
 * Satır bu sekmeye düşer mi?
 *
 * SQL ile birebir aynı kuralı taşır (aşağıdaki `tabCondition`); ikisinin
 * ayrışmaması için test bu saf işlevi çağırır ve SQL aynı satırları seçer.
 */
export function quoteMatchesTab(row: QuoteTabRow, tab: AdminQuoteTab, now: Date): boolean {
  const expired = row.expiresAt.getTime() <= now.getTime();
  switch (tab) {
    case "review":
      return row.status === "needs_review" && (row.reviewKind === null || row.reviewKind === "manual");
    case "target":
      return row.status === "needs_review" && row.reviewKind === "target_price";
    case "rfq":
      return row.status === "needs_review" && row.reviewKind === "rfq";
    case "quoted":
      return row.status === "quoted" && !expired;
    case "ordered":
      return row.status === "ordered";
    case "expired":
      // Terk edilmiş bir TASLAĞIN süresinin dolması admin işi değildir; bu
      // sekme "cevaplanmış ama kaçırılmış" teklifleri toplar.
      return (
        row.status === "expired" ||
        (expired && (row.status === "quoted" || row.status === "needs_review"))
      );
    case "all":
      return true;
  }
}

function tabCondition(tab: AdminQuoteTab, now: Date) {
  switch (tab) {
    case "review":
      return and(
        eq(quotes.status, "needs_review"),
        or(isNull(quotes.reviewKind), eq(quotes.reviewKind, "manual"))
      );
    case "target":
      return and(eq(quotes.status, "needs_review"), eq(quotes.reviewKind, "target_price"));
    case "rfq":
      return and(eq(quotes.status, "needs_review"), eq(quotes.reviewKind, "rfq"));
    case "quoted":
      return and(eq(quotes.status, "quoted"), gt(quotes.expiresAt, now));
    case "ordered":
      return eq(quotes.status, "ordered");
    case "expired":
      return or(
        eq(quotes.status, "expired"),
        and(
          lt(quotes.expiresAt, now),
          inArray(quotes.status, ["quoted", "needs_review"] satisfies QuoteStatus[])
        )
      );
    case "all":
      return undefined;
  }
}

/** `%` ve `_` ILIKE'ta joker: arama kutusuna yazılan metin joker OLMAMALI. */
function likeTerm(raw: string): string {
  return `%${raw.replace(/([\\%_])/g, "\\$1")}%`;
}

/**
 * Kuyruk sayfası (disputes deseni: `limit pageSize + 1` → `hasNext`).
 *
 * Parça sayıları AYRI bir sorguda, yalnız görünen satırlar için okunur: her
 * sayfalama için bütün `quote_parts` tablosunu gruplamak gereksiz.
 */
export async function listAdminQuotes(args: {
  tab: AdminQuoteTab;
  page: number;
  q?: string;
}): Promise<{ items: AdminQuoteListItem[]; hasNext: boolean }> {
  const now = new Date();
  const page = Number.isSafeInteger(args.page) && args.page >= 1 ? args.page : 1;
  const offset = (page - 1) * ADMIN_QUOTE_PAGE_SIZE;
  const search = (args.q ?? "").trim();

  const conditions = [tabCondition(args.tab, now)];
  if (search.length > 0) {
    const term = likeTerm(search);
    conditions.push(
      or(
        ilike(quotes.number, term),
        ilike(quotes.title, term),
        ilike(users.email, term),
        ilike(users.fullName, term)
      )
    );
  }
  const where = conditions.filter((c) => c !== undefined);

  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      reviewKind: quotes.reviewKind,
      title: quotes.title,
      userId: quotes.userId,
      customerName: users.fullName,
      customerEmail: users.email,
      totalKurus: quotes.totalKurus,
      leadDays: quotes.leadDays,
      reviewRequestedAt: quotes.reviewRequestedAt,
      reviewedAt: quotes.reviewedAt,
      createdAt: quotes.createdAt,
      updatedAt: quotes.updatedAt,
      expiresAt: quotes.expiresAt,
      orderNumber: orders.orderNumber,
    })
    .from(quotes)
    .leftJoin(users, eq(users.id, quotes.userId))
    .leftJoin(orders, eq(orders.id, quotes.orderId))
    .where(where.length > 0 ? and(...where) : undefined)
    // "En son ne oldu" sırası. Düz `review_requested_at DESC` olmaz: Postgres
    // DESC'te NULL'ları ÖNE koyar, yani hiç inceleme istenmemiş taslaklar
    // "Tümü" sekmesinin tepesine çıkar ve bekleyen işi aşağı iterdi.
    .orderBy(
      desc(sql`coalesce(${quotes.reviewRequestedAt}, ${quotes.createdAt})`),
      desc(quotes.id)
    )
    .limit(ADMIN_QUOTE_PAGE_SIZE + 1)
    .offset(offset);

  const visible = rows.slice(0, ADMIN_QUOTE_PAGE_SIZE);
  const counts = await partCounts(visible.map((r) => r.id));

  return {
    hasNext: rows.length > ADMIN_QUOTE_PAGE_SIZE,
    items: visible.map((r) => {
      const count = counts.get(r.id);
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        reviewKind: r.reviewKind,
        staleReviewKind: isStaleReviewKind(r),
        title: r.title,
        customerName: r.customerName,
        customerEmail: r.customerEmail,
        anonymous: r.userId === null,
        partCount: count?.partCount ?? 0,
        unitCount: count?.unitCount ?? 0,
        totalKurus: r.totalKurus,
        leadDays: r.leadDays,
        reviewRequestedAt: r.reviewRequestedAt?.toISOString() ?? null,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        expired: r.expiresAt.getTime() <= now.getTime(),
        orderNumber: r.orderNumber,
      };
    }),
  };
}

async function partCounts(
  quoteIds: string[]
): Promise<Map<string, { partCount: number; unitCount: number }>> {
  if (quoteIds.length === 0) return new Map();
  const rows = await db
    .select({
      quoteId: quoteParts.quoteId,
      partCount: sql<number>`count(*)::int`,
      unitCount: sql<number>`coalesce(sum(${quoteParts.quantity}), 0)::int`,
    })
    .from(quoteParts)
    .where(and(inArray(quoteParts.quoteId, quoteIds), isNull(quoteParts.deletedAt)))
    .groupBy(quoteParts.quoteId);
  return new Map(rows.map((r) => [r.quoteId, { partCount: r.partCount, unitCount: r.unitCount }]));
}

/** Kenar çubuğu rozeti: inceleme bekleyen teklif sayısı. */
export function needsReviewCountQuery() {
  return db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotes)
    .where(eq(quotes.status, "needs_review"));
}

// ─── Detay görünümü ─────────────────────────────────────────────────────────

export interface AdminQuotePartView {
  id: string;
  position: number;
  name: string;
  fileName: string;
  sourceFormat: QuoteSourceFormat;
  sourceBytes: number;
  analysisStatus: AnalysisStatus;
  /** Ham kod DEĞİL, Türkçe cümle (kodu da yanında). */
  analysisErrorText: string | null;
  thumbnailUrl: string | null;
  previewGlbUrl: string | null;
  drawingUrl: string | null;
  drawingName: string | null;
  dimensionsMm: Vec3 | null;
  volumeCm3: number | null;
  areaCm2: number | null;
  bodyCount: number | null;
  config: PartConfig;
  technologyName: string;
  materialName: string;
  colorName: string;
  finishName: string;
  note: string | null;
  dfm: DfmIssue[];
  /** Katalogtan hesaplanan birim fiyat (manuel fiyat yokmuş gibi). */
  computedUnitKurus: number | null;
  computedRefusal: string | null;
  /** Yürürlükteki birim fiyat (manuel varsa o). */
  effectiveUnitKurus: number | null;
  effectiveSource: "auto" | "manual" | null;
  lineKurus: number | null;
  manualUnitPriceKurus: number | null;
  /** Saklanan anahtar bugünkü konfigürasyonla TUTUYOR mu? */
  manualPriceStale: boolean;
  manualPricedAt: string | null;
  manualPricedByEmail: string | null;
  targetUnitPriceKurus: number | null;
}

export interface AdminQuoteAuditRow {
  id: string;
  action: QuoteAdminAction;
  adminEmail: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminQuoteDetail {
  id: string;
  number: string;
  status: QuoteStatus;
  reviewKind: ReviewKind | null;
  staleReviewKind: boolean;
  reviewNote: string | null;
  reviewRequestedAt: string | null;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  title: string | null;
  leadTier: LeadTierKey;
  leadTierName: string;
  addonKeys: string[];
  customerNote: string | null;
  poNumber: string | null;
  invoiceType: InvoiceType;
  companyName: string | null;
  taxId: string | null;
  taxOffice: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  anonymous: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expired: boolean;
  quoteValidDays: number;
  /** Bekleyen ödeme taslağının referansı — varsa fiyat YAZILAMAZ. */
  liveDraftReference: string | null;
  orderId: string | null;
  orderNumber: string | null;
  parts: AdminQuotePartView[];
  quoteIssues: DfmIssue[];
  partsKurus: number;
  addonsKurus: number;
  minOrderTopUpKurus: number;
  totalKurus: number | null;
  kdvKurus: number | null;
  leadDays: number | null;
  allPriced: boolean;
  blockers: string[];
  audit: AdminQuoteAuditRow[];
}

/**
 * Analiz hatası kodunun Türkçe karşılığı.
 *
 * `quote_parts.analysis_error` YALNIZ kaba kodu saklar (`MeshProcessError.code`);
 * python'un kendi gerekçesi yalnız sunucu günlüğündedir. Kolonu genişletmek
 * analiz yazma yolunu (Task 2.3) değiştirmek demekti ve bu görevin dosya
 * haritasında yok; bunun yerine admin ekranda çıplak `exit_nonzero` yerine ne
 * yapması gerektiğini söyleyen bir cümle görür (kod parantez içinde durur).
 */
const ANALYSIS_ERROR_TEXT: Record<string, string> = {
  python_missing: "Analiz ortamı çalışmıyor (python bulunamadı) — sunucuyu kontrol edin.",
  timeout: "Analiz zaman aşımına uğradı; dosya çok ağır olabilir.",
  exit_nonzero: "Analiz betiği dosyayı işleyemedi (bozuk ya da desteklenmeyen model).",
  bad_report: "Analiz çıktısı okunamadı; parçayı yeniden yükletin.",
  unknown: "Analiz beklenmeyen bir hatayla düştü.",
};

function analysisErrorText(code: string | null): string | null {
  if (!code) return null;
  const text = ANALYSIS_ERROR_TEXT[code] ?? ANALYSIS_ERROR_TEXT.unknown;
  return `${text} (kod: ${code}; ayrıntısı sunucu günlüğünde)`;
}

function refusalText(reason: "not_ready" | "dfm_error" | "config_invalid"): string {
  if (reason === "not_ready") return "Analiz tamamlanmadı ya da başarısız — fiyat hesaplanamaz.";
  if (reason === "config_invalid") return "Konfigürasyon bu teklifin kataloğuna uymuyor.";
  return "Üretilebilirlik uyarısı fiyatı engelliyor — manuel fiyat girin.";
}

/** Fiyatlanamayan parçaların Türkçe listesi (ekranın "neden quoted olmadı"sı). */
function unpricedBlockers(parts: QuotePart[], computed: ComputedPart[]): string[] {
  const byId = new Map(computed.map((c) => [c.id, c]));
  const out: string[] = [];
  parts.forEach((part, index) => {
    const price = byId.get(part.id)?.price;
    if (!price || price.ok) return;
    out.push(`P${String(index + 1).padStart(2, "0")} ${part.name}: ${refusalText(price.reason)}`);
  });
  return out;
}

const QUOTE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadAdminQuoteDetail(id: string): Promise<AdminQuoteDetail | null> {
  // `quotes.id` bir uuid kolonu: uuid olmayan bir segment sorguyu `22P02` ile
  // düşürür ve sayfa gövdesiz bir 500 verirdi. Burada 404'e çevrilir.
  if (!QUOTE_ID_RE.test(id.trim())) return null;
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, id.trim())).limit(1);
  if (!quote) return null;

  const [parts, customer, order, audit, live] = await Promise.all([
    db
      .select()
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)))
      .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt)),
    quote.userId
      ? db
          .select({ name: users.fullName, email: users.email, phone: users.phone })
          .from(users)
          .where(eq(users.id, quote.userId))
          .limit(1)
      : Promise.resolve([]),
    quote.orderId
      ? db
          .select({ orderNumber: orders.orderNumber })
          .from(orders)
          .where(eq(orders.id, quote.orderId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(quoteAdminActions)
      .where(eq(quoteAdminActions.quoteId, quote.id))
      .orderBy(desc(quoteAdminActions.createdAt))
      .limit(50),
    liveDraftForQuote(quote.id),
  ]);

  const snapshot = quote.pricingSnapshot;
  const inputs = toPricingInputs(parts);
  const computed = computeQuote(snapshot, inputs, {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });
  // "Katalog bu parçaya ne derdi": manuel fiyatlar düşürülerek İKİNCİ bir
  // hesap. Admin'in gördüğü "hesaplanan vs manuel" karşılaştırması budur;
  // ikinci bir fiyat yolu açmaz, aynı `computeQuote`tur.
  const autoComputed = computeQuote(
    snapshot,
    inputs.map((p) => ({ ...p, manualUnitPriceKurus: null, manualPriceKey: null })),
    { leadTier: quote.leadTier, addonKeys: quote.addonKeys }
  );
  const autoById = new Map(autoComputed.parts.map((p) => [p.id, p]));
  const byId = new Map(computed.parts.map((p) => [p.id, p]));

  const now = new Date();
  const nameOf = <T extends { key: string; name: string }>(rows: T[], key: string) =>
    rows.find((r) => r.key === key)?.name ?? key;

  return {
    id: quote.id,
    number: quote.number,
    status: quote.status,
    reviewKind: quote.reviewKind,
    staleReviewKind: isStaleReviewKind(quote),
    reviewNote: quote.reviewNote,
    reviewRequestedAt: quote.reviewRequestedAt?.toISOString() ?? null,
    reviewedAt: quote.reviewedAt?.toISOString() ?? null,
    reviewedByEmail: quote.reviewedByEmail,
    title: quote.title,
    leadTier: quote.leadTier,
    leadTierName: snapshot.settings.leadTiers.find((t) => t.key === quote.leadTier)?.name ?? quote.leadTier,
    addonKeys: quote.addonKeys,
    customerNote: quote.customerNote,
    poNumber: quote.poNumber,
    invoiceType: quote.invoiceType,
    companyName: quote.companyName,
    taxId: quote.taxId,
    taxOffice: quote.taxOffice,
    customerName: customer[0]?.name ?? null,
    customerEmail: customer[0]?.email ?? null,
    customerPhone: customer[0]?.phone ?? null,
    anonymous: quote.userId === null,
    version: quote.version,
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    expiresAt: quote.expiresAt.toISOString(),
    expired: quote.expiresAt.getTime() <= now.getTime(),
    quoteValidDays: snapshot.settings.quoteValidDays,
    liveDraftReference: live?.reference ?? null,
    orderId: quote.orderId,
    orderNumber: order[0]?.orderNumber ?? null,
    parts: parts.map((part, index) => {
      const config = configOf(part);
      const scaled = part.geometry ? scaledGeometry(part.geometry, config.units, config.scale) : null;
      const current = byId.get(part.id);
      const auto = autoById.get(part.id);
      const material = snapshot.materials.find(
        (m) => m.technologyKey === config.technologyKey && m.key === config.materialKey
      );
      return {
        id: part.id,
        position: index + 1,
        name: part.name,
        fileName: part.fileName,
        sourceFormat: part.sourceFormat,
        sourceBytes: part.sourceBytes,
        analysisStatus: part.analysisStatus,
        analysisErrorText: analysisErrorText(part.analysisError),
        thumbnailUrl: part.thumbnailKey ? getPublicUrl(part.thumbnailKey) : null,
        previewGlbUrl: part.previewGlbKey ? getPublicUrl(part.previewGlbKey) : null,
        drawingUrl: part.drawingKey ? getPublicUrl(part.drawingKey) : null,
        drawingName: part.drawingName,
        dimensionsMm: scaled?.extentsMm ?? null,
        volumeCm3: scaled?.volumeMm3 != null ? scaled.volumeMm3 / 1000 : null,
        areaCm2: scaled?.areaMm2 != null ? scaled.areaMm2 / 100 : null,
        bodyCount: part.geometry?.bodyCount ?? null,
        config,
        technologyName: nameOf(snapshot.technologies, config.technologyKey),
        materialName: material?.name ?? config.materialKey,
        colorName: material?.colors.find((c) => c.key === config.colorKey)?.name ?? config.colorKey,
        finishName: nameOf(snapshot.finishes, config.finishKey),
        note: part.note,
        dfm: current?.dfm.issues ?? [],
        computedUnitKurus: auto?.price.ok ? auto.price.unitKurus : null,
        computedRefusal: auto && !auto.price.ok ? refusalText(auto.price.reason) : null,
        effectiveUnitKurus: current?.price.ok ? current.price.unitKurus : null,
        effectiveSource: current?.price.ok ? current.price.source : null,
        lineKurus: current?.price.ok ? current.price.lineKurus : null,
        manualUnitPriceKurus: part.manualUnitPriceKurus,
        manualPriceStale:
          part.manualUnitPriceKurus !== null &&
          part.manualPriceKey !== adminManualPriceKey(keyInputOf(part), quote.leadTier),
        manualPricedAt: part.manualPricedAt?.toISOString() ?? null,
        manualPricedByEmail: part.manualPricedByEmail,
        targetUnitPriceKurus: part.targetUnitPriceKurus,
      };
    }),
    quoteIssues: computed.quoteIssues,
    partsKurus: computed.totals.partsKurus,
    addonsKurus: computed.totals.addonsKurus,
    minOrderTopUpKurus: computed.totals.minOrderTopUpKurus,
    totalKurus: computed.totals.allPriced ? computed.totals.totalKurus : null,
    kdvKurus: computed.totals.allPriced ? computed.totals.kdvKurus : null,
    leadDays: computed.totals.leadDays,
    allPriced: computed.totals.allPriced,
    blockers: unpricedBlockers(parts, computed.parts),
    audit: audit.map((a) => ({
      id: a.id,
      action: a.action,
      adminEmail: a.adminEmail,
      reason: a.reason,
      before: a.before,
      after: a.after,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

// ─── Yazma iskeleti ─────────────────────────────────────────────────────────

const LIVE_DRAFT_REFUSAL =
  "Bu teklif için açık bir ödeme var; önce ödeme süresinin dolmasını bekleyin.";

interface WriteContext {
  tx: QuoteCacheTx;
  quote: Quote;
  parts: QuotePart[];
}

/**
 * Her admin yazımının ortak kapısı.
 *
 * Sıra önemli: kilit → kayıt var mı → siparişe dönmüş/iptal mi → bayat damga
 * mı → açık ödeme var mı. Açık ödeme kontrolü EN SONA değil, yazımdan önce
 * gelir: `/pay/<ref>` bağlantısı ESKİ tutarı taşır ve fiyatı değiştirmek o
 * bağlantıyı sessizce yanlış yapar.
 */
async function openWrite(
  tx: QuoteCacheTx,
  args: { quoteId: string; expectedUpdatedAt?: string; allowLiveDraft?: boolean }
): Promise<WriteContext> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, args.quoteId)).for("update");
  if (!quote) throw new AdminQuoteError("not_found", "Teklif bulunamadı.", 404);
  if (quote.status === "ordered" || quote.orderId !== null) {
    throw new AdminQuoteError("quote_ordered", "Bu teklif siparişe dönüştü.", 409);
  }
  if (args.expectedUpdatedAt !== undefined && quote.updatedAt.toISOString() !== args.expectedUpdatedAt) {
    throw new AdminQuoteError(
      "stale",
      "Teklif bu sırada değişti. Sayfayı yenileyip kararınızı tekrar uygulayın.",
      409
    );
  }
  if (!args.allowLiveDraft && (await liveDraftForQuote(quote.id, tx)) !== null) {
    throw new AdminQuoteError("live_draft", LIVE_DRAFT_REFUSAL, 409);
  }
  const parts = await tx
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
  return { tx, quote, parts };
}

/** Denetim izinin gövdesi: tarihler ISO dizgiye çevrilir. */
function auditValue(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function writeAudit(
  tx: QuoteCacheTx,
  args: {
    quoteId: string;
    action: QuoteAdminAction;
    adminEmail: string;
    reason: string;
    before: unknown;
    after: unknown;
  }
): Promise<void> {
  await tx.insert(quoteAdminActions).values({
    quoteId: args.quoteId,
    // Karar TEKLİF düzeyindedir (tek yazımda birden çok parça fiyatlanır);
    // parça ayrıntısı `before`/`after` gövdesinde satır satır durur.
    quotePartId: null,
    action: args.action,
    adminEmail: args.adminEmail,
    reason: args.reason,
    before: auditValue(args.before),
    after: auditValue(args.after),
  });
}

/** Parçanın fiyat/anahtar özeti — denetim izinin before/after gövdesi. */
function priceSnapshot(parts: QuotePart[]) {
  return parts.map((p) => ({
    partId: p.id,
    name: p.name,
    quantity: p.quantity,
    manualUnitPriceKurus: p.manualUnitPriceKurus,
    targetUnitPriceKurus: p.targetUnitPriceKurus,
  }));
}

/** Yazımdan sonraki her şey: bildirim, canlı olay, admin rozeti. */
function afterCommit(args: {
  quoteId: string;
  userId: string | null;
  notify?: () => Promise<void>;
}): void {
  emitQuoteChanged({ quoteId: args.quoteId, userId: args.userId });
  void publishRealtime([topics.admin()], { kind: "badge" }).catch(() => {
    /* rozet en iyi çaba */
  });
  if (args.notify) void args.notify();
}

function partById(parts: QuotePart[], partId: string): QuotePart {
  const part = parts.find((p) => p.id === partId);
  if (!part) throw new AdminQuoteError("part_not_found", "Parça bu teklifte yok.", 404);
  return part;
}

/**
 * Manuel fiyatları parçalara yazar; anahtar HER ZAMAN
 * `partPricingKey(part, quote.leadTier)`.
 */
async function applyManualPrices(
  ctx: WriteContext,
  rows: ManualPriceRow[],
  adminEmail: string
): Promise<void> {
  const now = new Date();
  for (const row of rows) {
    const part = partById(ctx.parts, row.partId);
    if (row.unitKurus === null) {
      await ctx.tx
        .update(quoteParts)
        .set({
          manualUnitPriceKurus: null,
          manualPriceKey: null,
          manualPricedAt: null,
          manualPricedByEmail: null,
          updatedAt: now,
        })
        .where(eq(quoteParts.id, part.id));
      continue;
    }
    await ctx.tx
      .update(quoteParts)
      .set({
        manualUnitPriceKurus: row.unitKurus,
        manualPriceKey: adminManualPriceKey(keyInputOf(part), ctx.quote.leadTier),
        manualPricedAt: now,
        manualPricedByEmail: adminEmail,
        updatedAt: now,
      })
      .where(eq(quoteParts.id, part.id));
  }
}

/**
 * Fiyatlama yazımının ortak kuyruğu: yeniden hesapla, SONUCA göre durumu
 * belirle, denetim satırını yaz.
 *
 * Durum ancak HER parça fiyatlıyken `quoted` olur (kural 4): "teklifiniz
 * hazır" diyen bir bildirimin ardından ödeme düğmesinin kapalı olması,
 * müşteriye yalan söylemektir.
 */
async function finishPricing(
  ctx: WriteContext,
  args: {
    action: QuoteAdminAction;
    adminEmail: string;
    reason: string;
    before: unknown;
    expiresInDays: number;
  }
): Promise<{ quoted: boolean; blockers: string[] }> {
  const recomputed = await recomputeQuoteCache(ctx.quote.id, ctx.tx);
  const fresh = await ctx.tx
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, ctx.quote.id), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
  const allPriced = recomputed?.computed.totals.allPriced ?? false;
  const blockers = recomputed ? unpricedBlockers(fresh, recomputed.computed.parts) : [];

  const now = new Date();
  const expiresAt = new Date(now.getTime() + args.expiresInDays * 86_400_000);
  if (allPriced) {
    await ctx.tx
      .update(quotes)
      .set({
        status: "quoted",
        expiresAt,
        reviewedAt: now,
        reviewedByEmail: args.adminEmail,
        updatedAt: now,
      })
      .where(eq(quotes.id, ctx.quote.id));
  }

  const [after] = await ctx.tx.select().from(quotes).where(eq(quotes.id, ctx.quote.id)).limit(1);
  await writeAudit(ctx.tx, {
    quoteId: ctx.quote.id,
    action: args.action,
    adminEmail: args.adminEmail,
    reason: args.reason,
    before: args.before,
    after: {
      status: after?.status ?? ctx.quote.status,
      expiresAt: after?.expiresAt ?? ctx.quote.expiresAt,
      totalKurus: recomputed?.totalKurus ?? null,
      quoted: allPriced,
      blockers,
      parts: priceSnapshot(fresh),
    },
  });

  return { quoted: allPriced, blockers };
}

// ─── Admin kararları ────────────────────────────────────────────────────────

/**
 * Manuel fiyatlama: parça başına birim fiyat (ya da `null` ile fiyatı kaldır).
 *
 * Fiyat KDV DAHİL nihai birim fiyattır ve yalnız teklifin O ANKİ teslim
 * kademesi için geçerlidir (anahtar kademeyi taşır): müşteri kademeyi
 * değiştirirse fiyat düşer ve teklif yeniden incelemeye gelir.
 */
export async function priceQuoteManually(args: {
  quoteId: string;
  adminEmail: string;
  expectedUpdatedAt: string;
  parts: Array<{ partId: string; unitKurus: number | null }>;
  expiresInDays: number;
  reason: string;
}): Promise<AdminQuoteOutcome> {
  return adminQuoteOutcome(async () => {
    const rows = parseManualPriceRows(args.parts);
    const reason = requireReason(args.reason);
    const expiresInDays = parseExtendDays(args.expiresInDays);

    const result = await db.transaction(async (tx) => {
      const ctx = await openWrite(tx, {
        quoteId: args.quoteId,
        expectedUpdatedAt: args.expectedUpdatedAt,
      });
      if (ctx.parts.length === 0) {
        throw new AdminQuoteError("no_parts", "Teklifte parça yok; fiyatlanacak bir şey de yok.", 409);
      }
      const before = {
        status: ctx.quote.status,
        expiresAt: ctx.quote.expiresAt,
        totalKurus: ctx.quote.totalKurus,
        parts: priceSnapshot(ctx.parts),
      };
      await applyManualPrices(ctx, rows, args.adminEmail);
      const done = await finishPricing(ctx, {
        action: "manual_price",
        adminEmail: args.adminEmail,
        reason,
        before,
        expiresInDays,
      });
      return { ...done, userId: ctx.quote.userId };
    });

    afterCommit({
      quoteId: args.quoteId,
      userId: result.userId,
      notify: result.quoted ? () => notifyManualQuoteReady(args.quoteId) : undefined,
    });
    return { ok: true, quoted: result.quoted, blockers: result.blockers };
  });
}

/**
 * Hedef fiyat kararı.
 *
 * `accept` = müşterinin yazdığı hedefi manuel fiyat yapar (parça başına, ayrı
 * bir sayı girilmez); `counter` = admin'in yazdığı karşı teklifleri yazar;
 * `reject` = teklif taslağa döner ve gerekçe `review_note` olarak müşterinin
 * sayfasında durur.
 */
export async function decideTargetPrice(args: {
  quoteId: string;
  adminEmail: string;
  decision: "accept" | "counter" | "reject";
  counters?: Array<{ partId: string; unitKurus: number }>;
  reason: string;
  expectedUpdatedAt: string;
}): Promise<AdminQuoteOutcome> {
  return adminQuoteOutcome(async () => {
    if (!["accept", "counter", "reject"].includes(args.decision)) {
      throw new AdminQuoteError("invalid_body", "Geçersiz karar.", 400);
    }
    const reason = requireReason(args.reason);
    const counters = args.decision === "counter" ? parseTargetCounters(args.counters) : [];

    const result = await db.transaction(async (tx) => {
      const ctx = await openWrite(tx, {
        quoteId: args.quoteId,
        expectedUpdatedAt: args.expectedUpdatedAt,
      });
      if (ctx.quote.status !== "needs_review" || ctx.quote.reviewKind !== "target_price") {
        throw new AdminQuoteError(
          "not_target_review",
          "Bu teklif bekleyen bir hedef fiyat talebi değil.",
          409
        );
      }
      const before = {
        status: ctx.quote.status,
        expiresAt: ctx.quote.expiresAt,
        totalKurus: ctx.quote.totalKurus,
        decision: args.decision,
        parts: priceSnapshot(ctx.parts),
      };

      if (args.decision === "reject") {
        const now = new Date();
        await tx
          .update(quotes)
          .set({
            status: "draft",
            reviewNote: reason,
            reviewedAt: now,
            reviewedByEmail: args.adminEmail,
            updatedAt: now,
          })
          .where(eq(quotes.id, ctx.quote.id));
        await recomputeQuoteCache(ctx.quote.id, tx);
        await writeAudit(tx, {
          quoteId: ctx.quote.id,
          action: "target_reject",
          adminEmail: args.adminEmail,
          reason,
          before,
          after: { status: "draft", reviewNote: reason },
        });
        return { quoted: false, blockers: [], userId: ctx.quote.userId };
      }

      const rows: ManualPriceRow[] =
        args.decision === "accept"
          ? ctx.parts
              .filter((p) => p.targetUnitPriceKurus !== null)
              .map((p) => ({
                partId: p.id,
                // Müşterinin yazdığı sayı da aynı kapıdan geçer: kolon düz bir
                // `integer` ve hedef fiyat müşteri girdisidir.
                unitKurus: validateAdminUnitPrice(p.targetUnitPriceKurus),
              }))
          : counters;
      if (rows.length === 0) {
        throw new AdminQuoteError(
          "no_targets",
          "Kabul edilecek bir hedef fiyat yok; parçalara hedef fiyat yazılmamış.",
          409
        );
      }
      await applyManualPrices(ctx, rows, args.adminEmail);
      const done = await finishPricing(ctx, {
        action: args.decision === "accept" ? "target_accept" : "target_counter",
        adminEmail: args.adminEmail,
        reason,
        before,
        expiresInDays: ctx.quote.pricingSnapshot.settings.quoteValidDays,
      });
      return { ...done, userId: ctx.quote.userId };
    });

    afterCommit({
      quoteId: args.quoteId,
      userId: result.userId,
      notify:
        args.decision === "reject" || result.quoted
          ? () => notifyTargetDecision(args.quoteId, args.decision)
          : undefined,
    });
    return { ok: true, quoted: result.quoted, blockers: result.blockers };
  });
}

/**
 * Süre uzatma.
 *
 * Süresi GEÇMİŞ bir teklifte "bugünden itibaren" sayılır: geçmiş bir tarihe
 * gün eklemek, uzattığını sanan admin'e hâlâ süresi dolmuş bir teklif
 * bırakırdı. Açık bir ödeme varken de ÇALIŞIR: süre uzatmak tutarı
 * değiştirmez, tam tersine ödemesi süren müşterinin ihtiyacı budur.
 */
export async function extendQuoteExpiry(args: {
  quoteId: string;
  adminEmail: string;
  days: number;
  reason: string;
}): Promise<AdminQuoteOutcome> {
  return adminQuoteOutcome(async () => {
    const days = parseExtendDays(args.days);
    const reason = requireReason(args.reason);

    const userId = await db.transaction(async (tx) => {
      const ctx = await openWrite(tx, { quoteId: args.quoteId, allowLiveDraft: true });
      if (ctx.quote.status === "cancelled") {
        throw new AdminQuoteError("quote_cancelled", "Bu teklif iptal edildi.", 409);
      }
      const now = new Date();
      const from = Math.max(now.getTime(), ctx.quote.expiresAt.getTime());
      const expiresAt = new Date(from + days * 86_400_000);
      // Süresi dolmuş olarak İŞARETLENMİŞ bir teklif yeniden fiyatlıya döner:
      // yeni bir bitiş tarihi varken "expired" durumu yalan olurdu.
      const status: QuoteStatus = ctx.quote.status === "expired" ? "quoted" : ctx.quote.status;
      await tx
        .update(quotes)
        .set({ expiresAt, status, updatedAt: now })
        .where(eq(quotes.id, ctx.quote.id));
      await writeAudit(tx, {
        quoteId: ctx.quote.id,
        action: "extend_expiry",
        adminEmail: args.adminEmail,
        reason,
        before: { status: ctx.quote.status, expiresAt: ctx.quote.expiresAt },
        after: { status, expiresAt, days },
      });
      return ctx.quote.userId;
    });

    afterCommit({ quoteId: args.quoteId, userId });
    return { ok: true, quoted: false, blockers: [] };
  });
}

/**
 * İncelemeyi kapatır: teklif taslağa döner, gerekçe müşterinin sayfasındaki
 * nota yazılır.
 *
 * `review_kind` BİLEREK temizlenmez: müşterinin ne istediği tarihçenin
 * parçasıdır ve kuyruk sekmeleri zaten DURUMA bakar (kural 3).
 */
export async function rejectReview(args: {
  quoteId: string;
  adminEmail: string;
  reason: string;
}): Promise<AdminQuoteOutcome> {
  return adminQuoteOutcome(async () => {
    const reason = requireReason(args.reason);

    const userId = await db.transaction(async (tx) => {
      const ctx = await openWrite(tx, { quoteId: args.quoteId });
      if (ctx.quote.status !== "needs_review") {
        throw new AdminQuoteError("not_in_review", "Bu teklif incelemede değil.", 409);
      }
      const now = new Date();
      await tx
        .update(quotes)
        .set({
          status: "draft",
          reviewNote: reason,
          reviewedAt: now,
          reviewedByEmail: args.adminEmail,
          updatedAt: now,
        })
        .where(eq(quotes.id, ctx.quote.id));
      await recomputeQuoteCache(ctx.quote.id, tx);
      await writeAudit(tx, {
        quoteId: ctx.quote.id,
        action: "review_reject",
        adminEmail: args.adminEmail,
        reason,
        before: { status: ctx.quote.status, reviewNote: ctx.quote.reviewNote },
        after: { status: "draft", reviewNote: reason },
      });
      return ctx.quote.userId;
    });

    afterCommit({ quoteId: args.quoteId, userId });
    return { ok: true, quoted: false, blockers: [] };
  });
}

/**
 * Süresi dolmuş / iptal edilmiş teklifi yeniden açar.
 *
 * Teklif TASLAĞA döner (fiyat verilmiş sayılmaz) ve kataloğun geçerlilik
 * süresi kadar yeni bir bitiş tarihi alır; müşteri düzenleyip yeniden
 * fiyatlatabilir. Siparişe dönmüş teklif açılmaz (`openWrite` reddeder).
 */
export async function reopenQuote(args: {
  quoteId: string;
  adminEmail: string;
  reason: string;
}): Promise<AdminQuoteOutcome> {
  return adminQuoteOutcome(async () => {
    const reason = requireReason(args.reason);

    const userId = await db.transaction(async (tx) => {
      const ctx = await openWrite(tx, { quoteId: args.quoteId });
      if (ctx.quote.status !== "expired" && ctx.quote.status !== "cancelled") {
        throw new AdminQuoteError(
          "not_closed",
          "Bu teklif zaten açık; yeniden açmaya gerek yok.",
          409
        );
      }
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + ctx.quote.pricingSnapshot.settings.quoteValidDays * 86_400_000
      );
      await tx
        .update(quotes)
        .set({ status: "draft", expiresAt, updatedAt: now })
        .where(eq(quotes.id, ctx.quote.id));
      await recomputeQuoteCache(ctx.quote.id, tx);
      await writeAudit(tx, {
        quoteId: ctx.quote.id,
        action: "reopen",
        adminEmail: args.adminEmail,
        reason,
        before: { status: ctx.quote.status, expiresAt: ctx.quote.expiresAt },
        after: { status: "draft", expiresAt },
      });
      return ctx.quote.userId;
    });

    afterCommit({ quoteId: args.quoteId, userId });
    return { ok: true, quoted: false, blockers: [] };
  });
}

/**
 * Admin sohbet ucunun varlık kontrolü.
 *
 * Sohbet uçları teklifi kimliğiyle alır ve YAZMAZ; yine de var olmayan bir
 * teklife mesaj yazılmasına izin verilmez (`quote_messages.quote_id` FK'si
 * zaten reddeder, ama 404 cümlesi 500'den iyidir).
 */
export async function adminQuoteExists(quoteId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row !== undefined;
}
