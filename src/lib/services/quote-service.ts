/**
 * Teklif üzerindeki her müşteri yazımının TEK yeri.
 *
 * Üç kural bütün dosyayı biçimlendirir:
 *
 * 1. **Her mutasyon teklifi kilitler.** `quotes … FOR UPDATE` olmadan parça
 *    sayısı sayılamaz (20'lik tavan yirmi eşzamanlı yüklemede delinir),
 *    sürüm çakışması yakalanamaz ve önbellek bayat yazılır.
 * 2. **Kural motoru ekranın değil, buranın.** Ne yapılabileceğini
 *    `quotePermissions`, ödemeye neyin engel olduğunu `checkoutBlockers`
 *    söyler; uç bunları YENİDEN YORUMLAMAZ, yalnız uygular.
 * 3. **Seçenekler teklifin kendi snapshot'ından doğrulanır**, canlı
 *    katalogdan değil: açık teklif dondurulmuş katalogla bağlayıcıdır, ve
 *    katalogdan kalkmış bir malzeme yarın gelen bir PATCH ile teklife
 *    giremez.
 *
 * `import "server-only"` YOK: teklif zinciri (bakım işi, sipariş köprüsü) bu
 * modülü worker sürecinden de görebilmeli.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  orderDrafts,
  orders,
  quoteCheckouts,
  quoteParts,
  quotes,
  type Quote,
  type QuotePart,
} from "@/lib/db/schema";
import { DISTANCE_CONTRACT_VERSION } from "@/lib/config/distance-contract";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { computeQuote, defaultPartConfig } from "@/lib/config/quote-compute";
import { quotePermissions } from "@/lib/config/quote-policy";
import {
  QUOTE_UNITS,
  REVIEW_KINDS,
  type CustomerQuoteListItem,
  type InvoiceType,
  type LeadTierKey,
  type LibraryPart,
  type PresentedQuote,
  type PricingSnapshot,
  type QuoteUnits,
  type ReviewKind,
  type SnapshotTechnology,
} from "@/lib/config/quote-types";
import { scaledGeometry } from "@/lib/config/quote-units";
import { enqueuePartAnalysis } from "@/lib/queue/quote-queues";
import { emitQuoteChanged } from "@/lib/realtime/emit";
import {
  getStagedUploadMeta,
  promoteStagedUpload,
  uploadOwnerKey,
} from "@/lib/services/chunked-upload";
import { UUID_RE, type QuoteAccess } from "@/lib/services/quote-access";
import { recomputeQuoteCache, type QuoteCacheTx } from "@/lib/services/quote-cache";
import { catalogUpdatedAt, loadActiveSnapshot } from "@/lib/services/quote-catalog";
import { validateStagedQuoteModel } from "@/lib/services/quote-model-validation";
import { notifyReviewRequested } from "@/lib/services/quote-notify";
import { presentQuote, toPricingInputs } from "@/lib/services/quote-present";
import {
  deleteFile,
  getPublicUrl,
  linkOrCopyStoredFile,
  saveFile,
} from "@/lib/services/storage";
import { parseTaxId } from "@/lib/services/tax-id";
import type { TurkishAddress } from "@/lib/db/schema";

/**
 * Müşteriye AYNEN gösterilecek hata. `status` ucun döneceği kod, `code` ise
 * istemcinin dallanabileceği makine-okur etiket (örn. `version_conflict`).
 */
export class QuoteServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "QuoteServiceError";
  }
}

const INVALID_OPTION = "Geçersiz seçenek.";
const PART_NOT_FOUND = "Parça bulunamadı.";
const PAGE_SIZE = 20;
const DRAWING_MAX_BYTES = 20 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_NOTE_LENGTH = 2000;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://figurunica.com";
}

// ─── İşlem iskeleti ─────────────────────────────────────────────────────────

async function lockQuote(tx: QuoteCacheTx, quoteId: string): Promise<Quote> {
  const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
  if (!quote) throw new QuoteServiceError("Teklif bulunamadı.", 404, "quote_not_found");
  return quote;
}

/** Hem havuzun kendisi hem açık bir işlem okuyabilsin diye en dar arayüz. */
type QuoteReader = Pick<QuoteCacheTx, "select">;

/**
 * Bekleyen ödeme taslağı: teklif ↔ `order_drafts`.
 *
 * `tx` verilirse ÇAĞIRANIN işleminde okunur. Bu bir incelik değil: havuzda
 * beş bağlantı var ve kendi işlemini tutarken ikinci bir bağlantı isteyen her
 * çağrı, yirmi eşzamanlı istekte havuzu kilitler.
 */
export async function liveDraftForQuote(
  quoteId: string,
  tx?: QuoteReader
): Promise<{ draftId: string; reference: string } | null> {
  const [row] = await (tx ?? db)
    .select({ draftId: orderDrafts.id, reference: orderDrafts.reference })
    .from(quoteCheckouts)
    .innerJoin(orderDrafts, eq(quoteCheckouts.draftId, orderDrafts.id))
    .where(
      and(
        eq(quoteCheckouts.quoteId, quoteId),
        inArray(orderDrafts.status, ["pending", "awaiting_review"])
      )
    )
    .orderBy(desc(quoteCheckouts.createdAt))
    .limit(1);
  return row ?? null;
}

async function assertEditable(tx: QuoteCacheTx, quote: Quote): Promise<void> {
  const live = await liveDraftForQuote(quote.id, tx);
  const permissions = quotePermissions(
    { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
    { hasLiveDraft: live !== null, now: new Date() }
  );
  if (!permissions.canEdit) {
    throw new QuoteServiceError(
      permissions.blockedReason ?? "Bu teklif düzenlenemez.",
      409,
      "quote_locked"
    );
  }
}

/**
 * Mutasyon iskeleti: kilitle → izin kontrolü → yaz → önbelleği yeniden hesapla
 * → değişikliği duyur.
 *
 * `recomputeQuoteCache` sürümü BİR ARTIRIR; ekranın "sürüm çakışması" uyarısı
 * ve ödemedeki `expectedVersion` kontrolü buna dayanır, bu yüzden fiyatı
 * etkilemeyen düzenlemeler de (ad, not) sürümü artırır: iki sekmede açık aynı
 * teklifte "benim gördüğüm hâl" değişmiştir.
 */
async function mutateQuote<T>(
  access: QuoteAccess,
  run: (tx: QuoteCacheTx, quote: Quote) => Promise<T>,
  opts: { requireEdit?: boolean } = {}
): Promise<T> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const quote = await lockQuote(tx, access.quote.id);
    if (opts.requireEdit !== false) await assertEditable(tx, quote);
    const value = await run(tx, quote);
    await recomputeQuoteCache(quote.id, tx);
    return value;
  });
  emitQuoteChanged({ quoteId: access.quote.id, userId: access.quote.userId });
  return result;
}

/** drizzle 0.45 pg hatasını sarar: gerçek kod `.cause` üzerindedir. */
export function pgErrorCode(err: unknown): string | undefined {
  const direct = (err as { code?: unknown } | null)?.code;
  if (typeof direct === "string") return direct;
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === "string" ? cause : undefined;
}

// ─── Teklif oluşturma ───────────────────────────────────────────────────────

export async function createQuote(args: {
  userId: string | null;
  anonymousId: string | null;
  termsAccepted: true;
}): Promise<{ id: string; number: string }> {
  if (!args.userId && !args.anonymousId) {
    throw new QuoteServiceError("Teklif açmak için ziyaretçi kimliği gerekiyor.", 400, "no_identity");
  }
  const snapshot = await loadActiveSnapshot();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + snapshot.settings.quoteValidDays * 86_400_000);

  const [row] = await db
    .insert(quotes)
    .values({
      userId: args.userId,
      // `anonymous_id` YALNIZ sahipsiz teklifte anlamlıdır (şema notu): girişli
      // müşteride çerez kimliği saklamak, teklifi aynı tarayıcıyı kullanan
      // ikinci bir kişiye açardı.
      anonymousId: args.userId ? null : args.anonymousId,
      pricingSnapshot: snapshot,
      snapshotTakenAt: now,
      expiresAt,
      termsAcceptedAt: now,
      termsVersion: DISTANCE_CONTRACT_VERSION,
    })
    .returning({ id: quotes.id, number: quotes.number });

  return row;
}

/**
 * Anonim teklifi giriş yapan kullanıcıya devreder.
 *
 * Koşul teklifin SAHİPSİZ olması ve çerezin tutmasıdır: bağlantıya sahip
 * olmak (paylaşım token'ı dahil) asla devralma hakkı vermez.
 */
export async function claimQuote(
  quoteId: string,
  userId: string,
  anonymousId: string
): Promise<boolean> {
  const claimed = await db
    .update(quotes)
    .set({ userId, updatedAt: new Date() })
    .where(
      and(
        eq(quotes.id, quoteId),
        isNull(quotes.userId),
        eq(quotes.anonymousId, anonymousId)
      )
    )
    .returning({ id: quotes.id });
  if (claimed.length > 0) emitQuoteChanged({ quoteId, userId });
  return claimed.length > 0;
}

// ─── Parça ekleme ───────────────────────────────────────────────────────────

/** Dosya adından okunur bir parça adı; uzantı atılır, uzunluk sınırlanır. */
function partNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (base || fileName).slice(0, MAX_NAME_LENGTH);
}

export async function addPartFromUpload(
  access: QuoteAccess,
  args: { uploadId: string; fileName: string }
): Promise<{ partId: string }> {
  const snapshot = access.quote.pricingSnapshot;

  // TEKRAR İSTEĞİ EN BAŞTA karşılanır: ilk çağrı sahnelenmiş dosyayı kalıcı
  // yerine TAŞIDIĞI için (rename) ikinci çağrının doğrulayacak bir dosyası
  // yoktur — "yükleme bulunamadı" derdik, oysa parça duruyor. İstemcinin ağ
  // hatasından sonra yeniden denemesi bir hata değil, aynı isteğin kendisidir.
  const already = await db
    .select({ id: quoteParts.id })
    .from(quoteParts)
    .where(
      and(
        eq(quoteParts.uploadId, args.uploadId),
        eq(quoteParts.quoteId, access.quote.id),
        isNull(quoteParts.deletedAt)
      )
    )
    .limit(1);
  if (already[0]) return { partId: already[0].id };

  // Yükleme sahipliği: sahnelenmiş dosya yalnız onu yükleyen kimliğin
  // teklifine bağlanabilir. Kayıt yoksa dosya da güvenilmezdir (süresi dolmuş
  // ya da başkasının oturumundan kalmış olabilir).
  //
  // Sahiplik TEK bir anahtar değil, bir ADAY KÜMESİDİR. Sahneleme kimliği PUT
  // anında donar (`a:<çerez>`), oysa fiyat kapısı bir modaldır: müşteri dosya
  // yüklenirken kayıt olabilir ve o andan sonra `u:<id>` olur. Tek anahtara
  // bakmak, müşteriye KENDİ dosyası için "size ait değil" demek olurdu.
  // `quotes.anonymous_id` devralmada bilerek yerinde bırakılır (`claimQuote`) —
  // o kolon "bu tarayıcı bu teklifi açtı"nın kanıtıdır, burada da o işi görür.
  //
  // Küme çağıranın PANEL kimliklerini de taşır (`uploadOwnerKeys`): aynı
  // tarayıcıda açık bir üretici/boyacı/admin oturumu varsa sahneleme onun
  // anahtarıyla kaydedilir (`/api/uploads/chunk` ilk eşleşeni seçer), müşteri
  // oturumuyla değil.
  const candidates = [
    access.sessionUserId && uploadOwnerKey({ userId: access.sessionUserId }),
    access.quote.anonymousId && uploadOwnerKey({ anonymousId: access.quote.anonymousId }),
    ...(access.uploadOwnerKeys ?? []),
  ].filter(Boolean) as string[];
  const meta = await getStagedUploadMeta(args.uploadId);
  if (!meta) {
    throw new QuoteServiceError(
      "Yükleme oturumu bulunamadı; dosyayı tekrar yükleyin.",
      404,
      "unknown_upload"
    );
  }
  if (candidates.length === 0 || !candidates.includes(meta.owner)) {
    throw new QuoteServiceError("Bu yükleme size ait değil.", 403, "upload_not_owned");
  }

  // Doğrulama (sha256 dahil) işlem DIŞINDA yapılır: dosyayı baştan sona okumak
  // saniyeler sürebilir ve o süre boyunca teklifi kilitli tutmak, müşterinin
  // öteki sekmesini dondururdu.
  const validation = await validateStagedQuoteModel(
    args.uploadId,
    args.fileName,
    snapshot.settings.maxFileBytes
  );
  if (!validation.ok) throw new QuoteServiceError(validation.error, 400, validation.code);

  const { partId, position } = await mutateQuote(access, async (tx, quote) => {
    // Kilit altında İKİNCİ kontrol: iki istek aynı anda geldiyse yalnız biri
    // satırı yazar, öteki onu burada bulur. `position: -1` "yeni iş yok" der.
    const existing = await tx
      .select({ id: quoteParts.id })
      .from(quoteParts)
      .where(
        and(
          eq(quoteParts.uploadId, args.uploadId),
          eq(quoteParts.quoteId, quote.id),
          isNull(quoteParts.deletedAt)
        )
      )
      .limit(1);
    if (existing[0]) return { partId: existing[0].id, position: -1 };

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)));
    if (total >= snapshot.settings.maxPartsPerQuote) {
      throw new QuoteServiceError(
        `Bir teklifte en fazla ${snapshot.settings.maxPartsPerQuote} parça olabilir. Kalan parçalar için yeni bir teklif açın.`,
        409,
        "part_limit"
      );
    }

    const newId = randomUUID();
    // Taşıma (rename) işlemin İÇİNDE: kimlik önce üretilir ki dosya kendi
    // parçasının klasörüne gitsin. İşlem geri alınırsa dosya sahipsiz kalır —
    // saklama süpürmesi onu toplar; ters sıra (önce satır, sonra taşıma) ise
    // dosyasız bir parça bırakırdı ve o müşteriye "fiyat hesaplanamadı" olurdu.
    const sourceKey = await promoteStagedUpload(
      args.uploadId,
      `quote-parts/${newId}`,
      `source.${validation.format}`
    );
    const config = defaultPartConfig(snapshot, null);
    try {
      await tx.insert(quoteParts).values({
        id: newId,
        quoteId: quote.id,
        sortOrder: total,
        name: partNameFromFile(args.fileName),
        fileName: args.fileName.slice(0, 255),
        sourceKey,
        sourceFormat: validation.format,
        sourceBytes: validation.size,
        sourceSha256: validation.sha256,
        uploadId: args.uploadId,
        technologyKey: config.technologyKey,
        materialKey: config.materialKey,
        colorKey: config.colorKey,
        finishKey: config.finishKey,
        layerUm: config.layerUm,
        infillPct: config.infillPct,
        quantity: config.quantity,
        units: config.units,
        scale: config.scale,
        criticalTolerance: config.criticalTolerance,
      });
    } catch (err) {
      if (pgErrorCode(err) === "23505") {
        throw new QuoteServiceError(
          "Bu dosya başka bir teklifte kullanılıyor.",
          409,
          "upload_already_used"
        );
      }
      throw err;
    }
    // Parça KÜMESİNİ değiştirmek, tek bir parçanın ayarını değiştirmekten daha
    // büyük bir düzenlemedir: verilen fiyat artık bu parça kümesine ait değil.
    await demoteQuotedToDraft(tx, quote);
    return { partId: newId, position: total };
  });

  if (position >= 0) {
    // Sıra önceliği: yirmi parçalık tek bir teklif, arkasındaki müşterinin ilk
    // parçasını bekletmesin (büyük sayı = düşük öncelik; 0 "önceliksiz"
    // anlamına geldiği için sayım birden başlar).
    await enqueuePartAnalysis(partId, 0, position + 1);
  }
  return { partId };
}

// ─── Parça yapılandırması ───────────────────────────────────────────────────

export interface PartPatch {
  name?: string;
  technologyKey?: string;
  materialKey?: string;
  colorKey?: string;
  finishKey?: string;
  layerUm?: number | null;
  infillPct?: number | null;
  quantity?: number;
  units?: QuoteUnits;
  scale?: number;
  criticalTolerance?: boolean;
  note?: string | null;
  dfmAckKey?: string | null;
  targetUnitPriceKurus?: number | null;
}

/** Fiyatı/DfM'i etkileyen alanlar: biri değişirse `quoted` teklif taslağa döner. */
const CONFIG_FIELDS = [
  "technologyKey",
  "materialKey",
  "colorKey",
  "finishKey",
  "layerUm",
  "infillPct",
  "quantity",
  "units",
  "scale",
  "criticalTolerance",
] as const;

const PART_PATCH_KEYS = [
  ...CONFIG_FIELDS,
  "name",
  "note",
  "dfmAckKey",
  "targetUnitPriceKurus",
] as const;

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new QuoteServiceError("İstek gövdesi okunamadı.", 400, "invalid_body");
  }
  return raw as Record<string, unknown>;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  return trimmed;
}

function catalogKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,64}$/.test(value)) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  return value;
}

function integerIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  return value;
}

/**
 * Gövdeyi yamaya çevirir. TANIMADIĞI ANAHTAR HATADIR: sessizce yutulan bir
 * alan, ekranda "kaydedildi" görünen ama hiç yazılmayan bir düzenlemedir.
 */
export function parsePartPatch(raw: unknown): PartPatch {
  const body = asObject(raw);
  const patch: PartPatch = {};
  for (const key of Object.keys(body)) {
    if (!(PART_PATCH_KEYS as readonly string[]).includes(key)) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "unknown_field");
    }
  }
  if ("name" in body) {
    const name = optionalText(body.name, MAX_NAME_LENGTH);
    if (name === null) throw new QuoteServiceError("Parça adı boş olamaz.", 400, "invalid_option");
    patch.name = name;
  }
  if ("technologyKey" in body) patch.technologyKey = catalogKey(body.technologyKey);
  if ("materialKey" in body) patch.materialKey = catalogKey(body.materialKey);
  if ("colorKey" in body) patch.colorKey = catalogKey(body.colorKey);
  if ("finishKey" in body) patch.finishKey = catalogKey(body.finishKey);
  if ("layerUm" in body) {
    patch.layerUm = body.layerUm === null ? null : integerIn(body.layerUm, 1, 10_000);
  }
  if ("infillPct" in body) {
    patch.infillPct = body.infillPct === null ? null : integerIn(body.infillPct, 0, 100);
  }
  if ("quantity" in body) patch.quantity = integerIn(body.quantity, 1, 100_000);
  if ("units" in body) {
    if (!QUOTE_UNITS.includes(body.units as QuoteUnits)) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    patch.units = body.units as QuoteUnits;
  }
  if ("scale" in body) {
    const scale = body.scale;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0.01 || scale > 100) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    patch.scale = scale;
  }
  if ("criticalTolerance" in body) {
    if (typeof body.criticalTolerance !== "boolean") {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    patch.criticalTolerance = body.criticalTolerance;
  }
  if ("note" in body) patch.note = optionalText(body.note, MAX_NOTE_LENGTH);
  if ("dfmAckKey" in body) patch.dfmAckKey = optionalText(body.dfmAckKey, 300);
  if ("targetUnitPriceKurus" in body) {
    patch.targetUnitPriceKurus =
      body.targetUnitPriceKurus === null
        ? null
        : integerIn(body.targetUnitPriceKurus, 1, MAX_AMOUNT_KURUS);
  }
  return patch;
}

function technologyOrFail(snapshot: PricingSnapshot, key: string): SnapshotTechnology {
  const tech = snapshot.technologies.find((t) => t.key === key);
  if (!tech) throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  return tech;
}

/**
 * Teknoloji değişince malzeme/renk/yüzey/katman/doluluk O TEKNOLOJİNİN
 * varsayılanlarına döner.
 *
 * Aksi hâlde "SLA + PLA" gibi bir birleşim kalırdı: fiyat çekirdeği bunu
 * `config_invalid` ile reddeder ve müşteri, kendi yapmadığı bir hatayı
 * düzeltmek zorunda kalırdı.
 */
function technologyDefaults(snapshot: PricingSnapshot, tech: SnapshotTechnology) {
  const material = snapshot.materials
    .filter((m) => m.technologyKey === tech.key)
    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const finishes = snapshot.finishes.filter(
    (f) => f.technologyKey === null || f.technologyKey === tech.key
  );
  const finish = finishes.find((f) => f.key === "ham") ?? finishes[0];
  return {
    materialKey: material?.key ?? "",
    colorKey: material?.colors[0]?.key ?? "",
    finishKey: finish?.key ?? "",
    layerUm: tech.defaultLayerUm,
    infillPct: tech.defaultInfillPct,
  };
}

interface ResolvedPartConfig {
  technologyKey: string;
  materialKey: string;
  colorKey: string;
  finishKey: string;
  layerUm: number | null;
  infillPct: number | null;
  quantity: number;
  units: QuoteUnits;
  scale: number;
  criticalTolerance: boolean;
}

/** Yamayı parçanın mevcut hâline uygular ve SNAPSHOT'A karşı doğrular. */
function resolveConfig(
  part: QuotePart,
  patch: PartPatch,
  snapshot: PricingSnapshot
): ResolvedPartConfig {
  let next: ResolvedPartConfig = {
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

  if (patch.technologyKey !== undefined && patch.technologyKey !== part.technologyKey) {
    const tech = technologyOrFail(snapshot, patch.technologyKey);
    next = { ...next, technologyKey: tech.key, ...technologyDefaults(snapshot, tech) };
  }
  // Açıkça gönderilen alanlar varsayılanların ÜZERİNE yazılır: istemci
  // teknoloji ve malzemeyi tek istekte değiştirebilsin.
  if (patch.materialKey !== undefined) next.materialKey = patch.materialKey;
  if (patch.colorKey !== undefined) next.colorKey = patch.colorKey;
  if (patch.finishKey !== undefined) next.finishKey = patch.finishKey;
  if (patch.layerUm !== undefined) next.layerUm = patch.layerUm;
  if (patch.infillPct !== undefined) next.infillPct = patch.infillPct;
  if (patch.quantity !== undefined) next.quantity = patch.quantity;
  if (patch.units !== undefined) next.units = patch.units;
  if (patch.scale !== undefined) next.scale = patch.scale;
  if (patch.criticalTolerance !== undefined) next.criticalTolerance = patch.criticalTolerance;

  const tech = technologyOrFail(snapshot, next.technologyKey);
  const material = snapshot.materials.find(
    (m) => m.key === next.materialKey && m.technologyKey === tech.key
  );
  if (!material) throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  if (!material.colors.some((c) => c.key === next.colorKey)) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  const finish = snapshot.finishes.find(
    (f) => f.key === next.finishKey && (f.technologyKey === null || f.technologyKey === tech.key)
  );
  if (!finish) throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  if (next.layerUm === null || !tech.layerOptionsUm.includes(next.layerUm)) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  if (tech.infillOptionsPct === null) {
    // Katı baskıda (SLA) doluluk seçeneği YOKTUR; gönderilen değer yok sayılmaz,
    // sessizce null'a çekilir ki "%20 seçtim ama fiyat değişmedi" olmasın.
    next.infillPct = null;
  } else if (next.infillPct === null || !tech.infillOptionsPct.includes(next.infillPct)) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  return next;
}

function configChanged(part: QuotePart, next: ResolvedPartConfig): boolean {
  return CONFIG_FIELDS.some((field) => part[field] !== next[field]);
}

/**
 * `quoted` bir teklifte fiyatı etkileyen bir düzenleme onu `draft`'a döndürür:
 * verilen fiyat artık o konfigürasyona ait değildir. `needs_review` KALIR —
 * müşteri beklerken parçasını düzeltebilir, ama inceleme sırası düşmez.
 *
 * PARÇA EKLEME/ÇOĞALTMA/SİLME de buraya uğrar: `recomputeQuoteCache` toplamı
 * yeniden yazdığı hâlde durum `quoted` kalsaydı, teklif kimsenin fiyatlamadığı
 * bir parça kümesi için "fiyat verildi" demeye devam ederdi.
 */
async function demoteQuotedToDraft(tx: QuoteCacheTx, quote: Quote): Promise<void> {
  if (quote.status !== "quoted") return;
  await tx
    .update(quotes)
    .set({ status: "draft", updatedAt: new Date() })
    .where(eq(quotes.id, quote.id));
}

async function loadPart(tx: QuoteCacheTx, quoteId: string, partId: string): Promise<QuotePart> {
  // Biçimi uuid OLMAYAN kimlik sorguya hiç gitmez: Postgres onu `22P02` ile
  // patlatır ve müşteriye "parça bulunamadı" yerine gövdesiz bir 500 döner.
  // Daha kötüsü, bu satırın ÖNÜNDE çalışan her şey (bir zamanlar çizim
  // yazımı) o ham kimliği zaten kullanmış olur.
  if (!UUID_RE.test(partId)) throw new QuoteServiceError(PART_NOT_FOUND, 404, "part_not_found");
  const [part] = await tx
    .select()
    .from(quoteParts)
    .where(
      and(
        eq(quoteParts.id, partId),
        eq(quoteParts.quoteId, quoteId),
        isNull(quoteParts.deletedAt)
      )
    )
    .limit(1);
  if (!part) throw new QuoteServiceError(PART_NOT_FOUND, 404, "part_not_found");
  return part;
}

async function applyPartPatch(
  tx: QuoteCacheTx,
  quote: Quote,
  part: QuotePart,
  patch: PartPatch
): Promise<boolean> {
  const next = resolveConfig(part, patch, quote.pricingSnapshot);
  const changed = configChanged(part, next);
  await tx
    .update(quoteParts)
    .set({
      ...next,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.dfmAckKey !== undefined ? { dfmAckKey: patch.dfmAckKey } : {}),
      ...(patch.targetUnitPriceKurus !== undefined
        ? { targetUnitPriceKurus: patch.targetUnitPriceKurus }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(quoteParts.id, part.id));
  return changed;
}

/**
 * Parçanın yapılandırmasını değiştirir.
 *
 * Birim ve ölçek değişikliği YENİDEN ANALİZ KUYRUĞA ALMAZ: worker'ın raporu
 * dosya birimindedir ve milimetreye çeviri saf matematiktir (`scaledGeometry`,
 * bkz. quote-types.ts birim kuralı). Dosyayı ikinci kez ölçmek aynı sayıları
 * verir, yalnız müşteriyi bekletirdi.
 */
export async function updatePart(
  access: QuoteAccess,
  partId: string,
  patch: PartPatch
): Promise<void> {
  await mutateQuote(access, async (tx, quote) => {
    const part = await loadPart(tx, quote.id, partId);
    const changed = await applyPartPatch(tx, quote, part, patch);
    if (changed) await demoteQuotedToDraft(tx, quote);
  });
}

export async function bulkUpdateParts(
  access: QuoteAccess,
  partIds: string[],
  patch: PartPatch | { delete: true }
): Promise<void> {
  if (partIds.length === 0) {
    throw new QuoteServiceError("Hiç parça seçilmedi.", 400, "no_parts");
  }
  await mutateQuote(access, async (tx, quote) => {
    if ("delete" in patch) {
      await tx
        .update(quoteParts)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(quoteParts.quoteId, quote.id),
            inArray(quoteParts.id, partIds),
            isNull(quoteParts.deletedAt)
          )
        );
      await demoteQuotedToDraft(tx, quote);
      return;
    }
    let changed = false;
    for (const partId of partIds) {
      const part = await loadPart(tx, quote.id, partId);
      changed = (await applyPartPatch(tx, quote, part, patch)) || changed;
    }
    if (changed) await demoteQuotedToDraft(tx, quote);
  });
}

export async function deletePart(access: QuoteAccess, partId: string): Promise<void> {
  await mutateQuote(access, async (tx, quote) => {
    const part = await loadPart(tx, quote.id, partId);
    // YUMUŞAK silme: analiz worker'ı aynı anda bu parçanın üzerinde olabilir
    // ve koşullu güncellemesi `deleted_at IS NULL` arar (quote-analysis.ts).
    await tx
      .update(quoteParts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(quoteParts.id, part.id));
    await demoteQuotedToDraft(tx, quote);
  });
}

/**
 * Parçayı çoğaltır.
 *
 * Analiz SONUCU da kopyalanır: aynı dosyayı ikinci kez ölçmek tek çekirdeği
 * boşa harcar ve müşteriyi bekletir. Manuel fiyat da kopyalanır, çünkü
 * `manual_price_key` dosya özeti + konfigürasyon + teslim kademesine bağlıdır:
 * kopya BİREBİR aynı şeydir, ve müşteri adedi artırarak zaten aynı birim
 * fiyatı alırdı. Kopyanın konfigürasyonu değişir değişmez anahtar tutmaz ve
 * fiyat kendiliğinden düşer.
 */
export async function duplicatePart(
  access: QuoteAccess,
  partId: string
): Promise<{ partId: string }> {
  const { newId, needsAnalysis, position } = await mutateQuote(access, async (tx, quote) => {
    const part = await loadPart(tx, quote.id, partId);
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)));
    if (total >= quote.pricingSnapshot.settings.maxPartsPerQuote) {
      throw new QuoteServiceError(
        `Bir teklifte en fazla ${quote.pricingSnapshot.settings.maxPartsPerQuote} parça olabilir.`,
        409,
        "part_limit"
      );
    }

    const copyId = randomUUID();
    const analysisReady = part.analysisStatus === "ready" || part.analysisStatus === "failed";
    await tx.insert(quoteParts).values({
      id: copyId,
      quoteId: quote.id,
      sortOrder: total,
      name: `${part.name} (kopya)`.slice(0, MAX_NAME_LENGTH),
      fileName: part.fileName,
      // Depolama anahtarı PAYLAŞILIR: aynı teklifin, aynı sahibin iki satırı.
      sourceKey: part.sourceKey,
      sourceFormat: part.sourceFormat,
      sourceBytes: part.sourceBytes,
      sourceSha256: part.sourceSha256,
      // `upload_id` TEKİLDİR ve kopyada BOŞ kalır: staging kaydı bir kez bağlanır.
      uploadId: null,
      analysisStatus: analysisReady ? part.analysisStatus : "queued",
      analysisError: analysisReady ? part.analysisError : null,
      geometry: part.geometry,
      canonicalStlKey: part.canonicalStlKey,
      previewGlbKey: part.previewGlbKey,
      thumbnailKey: part.thumbnailKey,
      units: part.units,
      scale: part.scale,
      technologyKey: part.technologyKey,
      materialKey: part.materialKey,
      colorKey: part.colorKey,
      finishKey: part.finishKey,
      layerUm: part.layerUm,
      infillPct: part.infillPct,
      quantity: part.quantity,
      note: part.note,
      drawingKey: part.drawingKey,
      drawingName: part.drawingName,
      criticalTolerance: part.criticalTolerance,
      dfmAckKey: part.dfmAckKey,
      manualUnitPriceKurus: part.manualUnitPriceKurus,
      manualPriceKey: part.manualPriceKey,
      manualPricedAt: part.manualPricedAt,
      manualPricedByEmail: part.manualPricedByEmail,
    });
    await demoteQuotedToDraft(tx, quote);
    return { newId: copyId, needsAnalysis: !analysisReady, position: total };
  });

  if (needsAnalysis) await enqueuePartAnalysis(newId, 0, position + 1);
  return { partId: newId };
}

// ─── Teknik çizim (PDF) ─────────────────────────────────────────────────────

/** Dosya adını depolama/indirme için güvenli hâle getirir. */
function safeDrawingName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "cizim.pdf";
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "cizim.pdf";
}

export async function setDrawing(
  access: QuoteAccess,
  partId: string,
  file: File | null
): Promise<void> {
  // Baytlar burada DOĞRULANIR ama HENÜZ YAZILMAZ.
  //
  // Depolama yolu ham `partId`den kurulur; yazma sahiplik kanıtından önce
  // yürürse `../../` taşıyan bir kimlik dosyayı UPLOAD_DIR'in dışına koyar
  // (ve `mkdir -p` klasörü açar), ardından sorgu patlar. Yazma bu yüzden
  // `loadPart`ın ARDINDA, teklif kilidinin altında.
  let pending: { bytes: Buffer; name: string } | null = null;
  if (file) {
    if (file.size <= 0 || file.size > DRAWING_MAX_BYTES) {
      throw new QuoteServiceError("Teknik çizim en fazla 20 MB olabilir.", 400, "drawing_too_large");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    // Uzantıya değil İÇERİĞE bakılır: `.pdf` adı taşıyan bir yürütülebilir
    // dosya üreticinin eline geçmemeli.
    if (bytes.length < 5 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new QuoteServiceError("Teknik çizim yalnız PDF olabilir.", 400, "drawing_not_pdf");
    }
    pending = { bytes, name: safeDrawingName(file.name || "cizim.pdf") };
  }

  const { previousKey, stored } = await mutateQuote(access, async (tx, quote) => {
    const part = await loadPart(tx, quote.id, partId);
    const next = pending
      ? {
          key: await saveFile(
            pending.bytes,
            `quote-parts/${part.id}`,
            `drawing-${nanoid(8)}.pdf`
          ),
          name: pending.name,
        }
      : null;
    await tx
      .update(quoteParts)
      .set({
        drawingKey: next?.key ?? null,
        drawingName: next?.name ?? null,
        updatedAt: new Date(),
      })
      .where(eq(quoteParts.id, part.id));
    return { previousKey: part.drawingKey, stored: next };
  });

  // Eski dosya ancak satır yazıldıktan SONRA silinir: işlem geri alınsaydı
  // müşterinin çizimi diskten gitmiş olurdu.
  if (previousKey && previousKey !== stored?.key) await deleteFile(previousKey).catch(() => {});
}

/** İndirme ucu için çizim anahtarı; parça teklife ait değilse null. */
export async function drawingKeyFor(
  quoteId: string,
  partId: string
): Promise<{ key: string; name: string } | null> {
  const [part] = await db
    .select({ key: quoteParts.drawingKey, name: quoteParts.drawingName })
    .from(quoteParts)
    .where(
      and(
        eq(quoteParts.id, partId),
        eq(quoteParts.quoteId, quoteId),
        isNull(quoteParts.deletedAt)
      )
    )
    .limit(1);
  if (!part?.key) return null;
  return { key: part.key, name: part.name ?? "cizim.pdf" };
}

// ─── Teklif düzeyi düzenleme ────────────────────────────────────────────────

export interface QuotePatch {
  title?: string | null;
  leadTier?: LeadTierKey;
  addonKeys?: string[];
  customerNote?: string | null;
  poNumber?: string | null;
  invoiceType?: InvoiceType;
  companyName?: string | null;
  taxId?: string | null;
  taxOffice?: string | null;
  billingAddress?: TurkishAddress | null;
  expectedVersion?: number;
}

const QUOTE_PATCH_KEYS = [
  "title",
  "leadTier",
  "addonKeys",
  "customerNote",
  "poNumber",
  "invoiceType",
  "companyName",
  "taxId",
  "taxOffice",
  "billingAddress",
  "expectedVersion",
] as const;

const ADDRESS_FIELDS = ["adres", "ilce", "il", "postaKodu", "telefon"] as const;

function parseBillingAddress(value: unknown): TurkishAddress | null {
  if (value === null) return null;
  const raw = asObject(value);
  const address: TurkishAddress = {
    adres: "",
    ilce: "",
    il: "",
    postaKodu: "",
    telefon: "",
  };
  for (const field of ADDRESS_FIELDS) {
    const text = optionalText(raw[field], 300);
    if (text === null) throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_address");
    address[field] = text;
  }
  const mahalle = optionalText(raw.mahalle ?? null, 300);
  if (mahalle) address.mahalle = mahalle;
  return address;
}

export function parseQuotePatch(raw: unknown): QuotePatch {
  const body = asObject(raw);
  for (const key of Object.keys(body)) {
    if (!(QUOTE_PATCH_KEYS as readonly string[]).includes(key)) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "unknown_field");
    }
  }
  const patch: QuotePatch = {};
  if ("title" in body) patch.title = optionalText(body.title, MAX_NAME_LENGTH);
  if ("leadTier" in body) patch.leadTier = catalogKey(body.leadTier) as LeadTierKey;
  if ("addonKeys" in body) {
    if (!Array.isArray(body.addonKeys)) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    patch.addonKeys = [...new Set(body.addonKeys.map(catalogKey))];
  }
  if ("customerNote" in body) patch.customerNote = optionalText(body.customerNote, MAX_NOTE_LENGTH);
  if ("poNumber" in body) patch.poNumber = optionalText(body.poNumber, 64);
  if ("invoiceType" in body) {
    if (body.invoiceType !== "individual" && body.invoiceType !== "corporate") {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    patch.invoiceType = body.invoiceType;
  }
  if ("companyName" in body) patch.companyName = optionalText(body.companyName, 200);
  if ("taxId" in body) patch.taxId = optionalText(body.taxId, 32);
  if ("taxOffice" in body) patch.taxOffice = optionalText(body.taxOffice, 120);
  if ("billingAddress" in body) patch.billingAddress = parseBillingAddress(body.billingAddress);
  if ("expectedVersion" in body) {
    patch.expectedVersion = integerIn(body.expectedVersion, 1, Number.MAX_SAFE_INTEGER);
  }
  return patch;
}

export async function updateQuote(access: QuoteAccess, patch: QuotePatch): Promise<void> {
  await mutateQuote(access, async (tx, quote) => {
    if (patch.expectedVersion !== undefined && patch.expectedVersion !== quote.version) {
      throw new QuoteServiceError(
        "Teklif başka bir sekmede değişti; sayfayı yenileyip tekrar deneyin.",
        409,
        "version_conflict"
      );
    }
    const snapshot = quote.pricingSnapshot;
    const update: Partial<typeof quotes.$inferInsert> = { updatedAt: new Date() };
    let priceAffecting = false;

    if (patch.title !== undefined) update.title = patch.title;
    if (patch.customerNote !== undefined) update.customerNote = patch.customerNote;
    if (patch.poNumber !== undefined) update.poNumber = patch.poNumber;
    if (patch.invoiceType !== undefined) update.invoiceType = patch.invoiceType;
    if (patch.companyName !== undefined) update.companyName = patch.companyName;
    if (patch.taxOffice !== undefined) update.taxOffice = patch.taxOffice;
    if (patch.billingAddress !== undefined) update.billingAddress = patch.billingAddress;
    if (patch.taxId !== undefined) {
      if (patch.taxId === null) {
        update.taxId = null;
        update.taxIdType = null;
      } else {
        const parsed = parseTaxId(patch.taxId);
        if (!parsed.ok) {
          throw new QuoteServiceError(
            "VKN 10, TCKN 11 haneli olmalı ve doğrulama basamağı tutmalı.",
            400,
            "invalid_tax_id"
          );
        }
        update.taxId = parsed.normalized;
        update.taxIdType = parsed.type;
      }
    }
    if (patch.leadTier !== undefined) {
      if (!snapshot.settings.leadTiers.some((t) => t.key === patch.leadTier)) {
        throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
      }
      priceAffecting = priceAffecting || patch.leadTier !== quote.leadTier;
      update.leadTier = patch.leadTier;
    }
    if (patch.addonKeys !== undefined) {
      for (const key of patch.addonKeys) {
        if (!snapshot.addons.some((a) => a.key === key)) {
          throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
        }
      }
      priceAffecting =
        priceAffecting ||
        patch.addonKeys.length !== quote.addonKeys.length ||
        patch.addonKeys.some((k) => !quote.addonKeys.includes(k));
      update.addonKeys = patch.addonKeys;
    }
    if (priceAffecting && quote.status === "quoted") update.status = "draft";

    await tx.update(quotes).set(update).where(eq(quotes.id, quote.id));
  });
}

// ─── Yeniden fiyatlama ──────────────────────────────────────────────────────

/**
 * Bugünün kataloğuyla yeni bir snapshot ve yeni bir geçerlilik süresi.
 *
 * `canEdit` ARANMAZ ve bu bilerekdir: yeniden fiyatlama tam olarak SÜRESİ
 * DOLMUŞ teklifin çıkış yoludur, oysa süre dolumu `canEdit`'i kapatır. Kapalı
 * olan tek şey siparişe dönmüş / iptal edilmiş teklif ve bekleyen ödemedir.
 *
 * Manuel fiyatlar DÜŞER: admin onları eski katalog ve eski geçerlilik
 * penceresi için vermişti.
 */
export async function repriceQuote(access: QuoteAccess): Promise<void> {
  const snapshot = await loadActiveSnapshot();
  await mutateQuote(
    access,
    async (tx, quote) => {
      if (quote.status === "ordered" || quote.orderId !== null) {
        throw new QuoteServiceError("Bu teklif siparişe dönüştü.", 409, "quote_ordered");
      }
      if (quote.status === "cancelled") {
        throw new QuoteServiceError("Bu teklif iptal edildi.", 409, "quote_cancelled");
      }
      if ((await liveDraftForQuote(quote.id, tx)) !== null) {
        throw new QuoteServiceError("Bu teklif için bekleyen bir ödeme var.", 409, "quote_locked");
      }
      const now = new Date();
      await tx
        .update(quotes)
        .set({
          pricingSnapshot: snapshot,
          snapshotTakenAt: now,
          expiresAt: new Date(now.getTime() + snapshot.settings.quoteValidDays * 86_400_000),
          status: "draft",
          updatedAt: now,
        })
        .where(eq(quotes.id, quote.id));
      await tx
        .update(quoteParts)
        .set({
          manualUnitPriceKurus: null,
          manualPriceKey: null,
          manualPricedAt: null,
          manualPricedByEmail: null,
          updatedAt: now,
        })
        .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)));
    },
    { requireEdit: false }
  );
}

// ─── İnceleme talebi (manuel / RFQ / hedef fiyat) ───────────────────────────

export interface ReviewRequest {
  kind: ReviewKind;
  note: string;
  /** Yalnız `target_price`: parça başına müşterinin önerdiği birim fiyat. */
  targets?: Array<{ partId: string; unitKurus: number }>;
}

const MIN_REVIEW_NOTE = 10;
const MAX_TARGETS = 100;

/**
 * İnceleme talebinin gövdesi. Not en az on karakter: "fiyat verin" diyen boş
 * bir talep admini ekranın karşısında tahmin yürütmeye bırakır (admin tarafının
 * gerekçe alt sınırıyla aynı kural).
 */
export function parseReviewRequest(raw: unknown): ReviewRequest {
  const body = asObject(raw);
  for (const key of Object.keys(body)) {
    if (!["kind", "note", "targets"].includes(key)) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "unknown_field");
    }
  }
  if (!REVIEW_KINDS.includes(body.kind as ReviewKind)) {
    throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
  }
  const note = optionalText(body.note, MAX_NOTE_LENGTH);
  if (note === null || note.length < MIN_REVIEW_NOTE) {
    throw new QuoteServiceError(
      `Talebinizi en az ${MIN_REVIEW_NOTE} karakterle anlatın.`,
      400,
      "note_too_short"
    );
  }
  const request: ReviewRequest = { kind: body.kind as ReviewKind, note };
  if ("targets" in body && body.targets !== undefined && body.targets !== null) {
    if (!Array.isArray(body.targets) || body.targets.length > MAX_TARGETS) {
      throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
    }
    request.targets = body.targets.map((entry) => {
      const target = asObject(entry);
      if (typeof target.partId !== "string") {
        throw new QuoteServiceError(INVALID_OPTION, 400, "invalid_option");
      }
      return {
        partId: target.partId,
        unitKurus: integerIn(target.unitKurus, 1, MAX_AMOUNT_KURUS),
      };
    });
  }
  return request;
}

/**
 * "Manuel teklif iste" / "RFQ" / "Hedef fiyat öner".
 *
 * `quotePermissions.canRequestReview` KAPIYI TUTAR: `canEdit` açık olduğu hâlde
 * zaten incelemede olan bir teklif ikinci kez sıraya girmemeli (admin aynı işi
 * iki kez görür ve müşteriye iki kez cevap yazılır).
 *
 * Hedef fiyat, parçaların `target_unit_price_kurus` kolonuna yazılır: admin
 * kabul ederse aynı sayı manuel fiyat olur, bu yüzden notun içinde değil
 * kolonda durur.
 */
export async function requestReview(access: QuoteAccess, args: ReviewRequest): Promise<void> {
  await mutateQuote(access, async (tx, quote) => {
    const live = await liveDraftForQuote(quote.id, tx);
    const permissions = quotePermissions(
      { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
      { hasLiveDraft: live !== null, now: new Date() }
    );
    if (!permissions.canRequestReview) {
      throw new QuoteServiceError(
        permissions.blockedReason ?? "Bu teklif için inceleme istenemez.",
        409,
        "review_blocked"
      );
    }

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)));
    if (total === 0) {
      throw new QuoteServiceError(
        "Teklifte parça yok — önce bir model yükleyin.",
        400,
        "no_parts"
      );
    }

    if (args.kind === "target_price") {
      if (!args.targets || args.targets.length === 0) {
        throw new QuoteServiceError(
          "Hedef fiyat için en az bir parçaya birim fiyat yazın.",
          400,
          "no_targets"
        );
      }
      for (const target of args.targets) {
        // `loadPart` parçanın BU teklife ait olduğunu doğrular: başka bir
        // teklifin parçasına hedef fiyat yazılamaz.
        const part = await loadPart(tx, quote.id, target.partId);
        await tx
          .update(quoteParts)
          .set({ targetUnitPriceKurus: target.unitKurus, updatedAt: new Date() })
          .where(eq(quoteParts.id, part.id));
      }
    }

    const now = new Date();
    await tx
      .update(quotes)
      .set({
        status: "needs_review",
        reviewKind: args.kind,
        reviewNote: args.note,
        reviewRequestedAt: now,
        // Yeni talep, eski kararı geçersiz kılar: admin ekranı "cevaplandı"
        // görünen bir satırı sıraya geri almalı.
        reviewedAt: null,
        reviewedByEmail: null,
        updatedAt: now,
      })
      .where(eq(quotes.id, quote.id));
  });

  // Bildirim EN İYİ ÇABA: e-posta sunucusu düşse de talep kaydedilmiş olmalı.
  void notifyReviewRequested(access.quote.id);
}

// ─── Teknolojiye göre bölme ─────────────────────────────────────────────────

/** Yeni teklife kopyalanan, teklif düzeyindeki müşteri alanları. */
function inheritedQuoteFields(quote: Quote) {
  return {
    title: quote.title,
    customerNote: quote.customerNote,
    poNumber: quote.poNumber,
    invoiceType: quote.invoiceType,
    companyName: quote.companyName,
    taxId: quote.taxId,
    taxIdType: quote.taxIdType,
    taxOffice: quote.taxOffice,
    billingAddress: quote.billingAddress,
    termsAcceptedAt: quote.termsAcceptedAt,
    termsVersion: quote.termsVersion,
  };
}

/** Bölmenin PARA etkisi — yalnız fiyat görebilen izleyiciye döner. */
export interface SplitTotals {
  /** Bölmeden önceki teklif toplamı; parçaların hepsi fiyatlanamıyorsa `null`. */
  beforeKurus: number | null;
  /** Bölmeden sonra ORTAYA ÇIKAN TÜM tekliflerin toplamı (kaynak dahil). */
  afterKurus: number | null;
  /** `afterKurus - beforeKurus`; ikisinden biri bilinmiyorsa `null`. */
  deltaKurus: number | null;
}

export interface SplitResult {
  newQuoteNumbers: string[];
  /** YALNIZ `viewer.canSeePrices` iken vardır. */
  totals?: SplitTotals;
}

/** Bir parça kümesinin teklif toplamı — fiyatlanamıyorsa `null`. */
function groupTotalKurus(quote: Quote, group: QuotePart[]): number | null {
  const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(group), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });
  return computed.totals.allPriced ? computed.totals.totalKurus : null;
}

/**
 * Teklifi teknolojiye göre böler: İLK teknoloji yerinde kalır, her diğer
 * teknoloji kendi teklifine TAŞINIR.
 *
 * Neden taşınır (kopyalanmaz): parçanın dosyası, analizi ve manuel fiyatı
 * aynen geçerlidir ve iki teklifte birden durması, müşterinin aynı parçayı iki
 * kez ödemesine açık bir kapı olurdu.
 *
 * PARÇA fiyatları değişmez: yeni teklifler kaynağın SNAPSHOT'INI, kademesini ve
 * geçerlilik süresini devralır — bölme bir yeniden fiyatlama değildir.
 *
 * Ama TEKLİF BAŞINA işleyen iki kalem, bölmeden sonra her teklifte AYRICA
 * işler ve toplam BÜYÜR:
 *   - sabit ücretli ek hizmetler (`priceType: "fixed"` — sertifika, ölçüm
 *     raporu, veri sayfası; `addonLines` çarpanı 1'dir),
 *   - asgari sipariş tamamlaması (`minOrderKurus`).
 * Bu bilerek böyledir ve bölmenin amacının doğal sonucudur: bölünen her teklif
 * AYRI bir siparişe, ayrı bir üreticiye gider (spec §"Sahip kararları" 1);
 * belgeyi o siparişi basan üretici düzenler ve her sipariş asgari tutarı
 * ayrıca karşılamak zorundadır. Seçilen ek hizmetleri yeni teklife hiç
 * taşımamak, müşterinin istediği sertifikayı sessizce düşürürdü — daha kötüsü.
 *
 * Bu yüzden fark SESSİZ BIRAKILMAZ: `totals` bölmeden önceki ve sonraki
 * toplamı da taşır, ekran artışı gösterebilsin. `totals` yalnız
 * `viewer.canSeePrices` iken vardır — anonim sahip de bölebilir ama fiyat
 * göremez (global kısıt: fiyat, kapıyı geçmemiş izleyiciye hiç çıkmaz).
 */
export async function splitByTechnology(access: QuoteAccess): Promise<SplitResult> {
  const canSeePrices = access.viewer.canSeePrices;
  return mutateQuote(access, async (tx, quote) => {
    const parts = await tx
      .select()
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)))
      .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));

    const groups = new Map<string, QuotePart[]>();
    for (const part of parts) {
      const group = groups.get(part.technologyKey);
      if (group) group.push(part);
      else groups.set(part.technologyKey, [part]);
    }
    if (groups.size < 2) {
      throw new QuoteServiceError(
        "Teklifteki parçaların hepsi aynı teknolojide; bölünecek bir şey yok.",
        400,
        "single_technology"
      );
    }

    const [staying, ...moving] = [...groups.values()];

    // Para etkisi, yazımdan ÖNCE ve saf `computeQuote` ile ölçülür: aynı
    // hesap birazdan her teklifin önbelleğine yazılacak, ikinci bir sayı
    // üretmiyoruz.
    const beforeKurus = groupTotalKurus(quote, parts);
    const afterParts = [staying, ...moving].map((group) => groupTotalKurus(quote, group));
    const afterKurus = afterParts.every((t) => t !== null)
      ? afterParts.reduce((sum, t) => sum + (t ?? 0), 0)
      : null;

    const newQuoteNumbers: string[] = [];
    for (const group of moving) {
      const [created] = await tx
        .insert(quotes)
        .values({
          userId: quote.userId,
          anonymousId: quote.userId ? null : quote.anonymousId,
          leadTier: quote.leadTier,
          addonKeys: quote.addonKeys,
          pricingSnapshot: quote.pricingSnapshot,
          snapshotTakenAt: quote.snapshotTakenAt,
          expiresAt: quote.expiresAt,
          sourceQuoteId: quote.id,
          ...inheritedQuoteFields(quote),
        })
        .returning({ id: quotes.id, number: quotes.number });

      let sortOrder = 0;
      for (const part of group) {
        await tx
          .update(quoteParts)
          .set({ quoteId: created.id, sortOrder: sortOrder++, updatedAt: new Date() })
          .where(eq(quoteParts.id, part.id));
      }
      await recomputeQuoteCache(created.id, tx);
      newQuoteNumbers.push(created.number);
    }

    // Kalan parçaların sırası delikli kalmasın (ekran `sort_order` ile çizer).
    let sortOrder = 0;
    for (const part of staying) {
      await tx
        .update(quoteParts)
        .set({ sortOrder: sortOrder++, updatedAt: new Date() })
        .where(eq(quoteParts.id, part.id));
    }
    // Kaynak teklifin parça kümesi küçüldü: verilen fiyat artık ona ait değil.
    await demoteQuotedToDraft(tx, quote);

    if (!canSeePrices) return { newQuoteNumbers };
    return {
      newQuoteNumbers,
      totals: {
        beforeKurus,
        afterKurus,
        deltaKurus:
          beforeKurus !== null && afterKurus !== null ? afterKurus - beforeKurus : null,
      },
    };
  });
}

// ─── Paylaşım bağlantısı ────────────────────────────────────────────────────

const SHARE_TOKEN_LENGTH = 32;

/**
 * Paylaşım token'ını üretir / yeniler / iptal eder.
 *
 * YALNIZ SAHİP: "bu teklifi bağlantısı olan herkese açıyorum" kararı admin'in
 * ya da paylaşım izleyicisinin değil, müşterinin kararıdır (sunucu da
 * `shareUrl`'ü yalnız sahibe gönderiyor).
 *
 * `requireEdit: false` bilerek: paylaşım bir OKUMA izni verir, düzenleme
 * değil. Süresi dolmuş ya da siparişe dönmüş bir teklifi patronuna göstermek
 * tam da müşterinin isteyeceği şeydir.
 */
export async function setShareToken(
  access: QuoteAccess,
  action: "create" | "rotate" | "revoke"
): Promise<string | null> {
  if (!access.viewer.isOwner) {
    throw new QuoteServiceError(
      "Paylaşım bağlantısını yalnız teklif sahibi yönetebilir.",
      403,
      "not_owner"
    );
  }
  return mutateQuote(
    access,
    async (tx, quote) => {
      if (action === "revoke") {
        await tx
          .update(quotes)
          .set({ shareToken: null, updatedAt: new Date() })
          .where(eq(quotes.id, quote.id));
        return null;
      }
      // `create` İKİ KEZ çağrılabilir olmalı: müşteri bağlantıyı yeniden
      // kopyalamak için düğmeye bastığında eskisi geçersizleşmemeli.
      if (action === "create" && quote.shareToken) return quote.shareToken;

      for (let attempt = 0; attempt < 5; attempt++) {
        const token = nanoid(SHARE_TOKEN_LENGTH);
        try {
          // İç içe işlem = SAVEPOINT. Tekil indeks çakışması dış işlemi
          // iptal ederdi ve sıradaki deneme "current transaction is aborted"
          // alırdı; savepoint yalnız başarısız denemeyi geri alır.
          await tx.transaction(async (sp) => {
            await sp
              .update(quotes)
              .set({ shareToken: token, updatedAt: new Date() })
              .where(eq(quotes.id, quote.id));
          });
          return token;
        } catch (err) {
          if (pgErrorCode(err) !== "23505") throw err;
        }
      }
      throw new QuoteServiceError(
        "Paylaşım bağlantısı üretilemedi; tekrar deneyin.",
        500,
        "share_token_failed"
      );
    },
    { requireEdit: false }
  );
}

// ─── Parça kopyalama (yeniden teklif + kütüphaneden ekleme) ─────────────────

/** Depolama anahtarının dosya adı; kopya aynı adla yeni parçanın klasörüne gider. */
function storedFileName(key: string): string {
  return key.split("/").pop() || "dosya";
}

/**
 * Parçanın yapılandırmasını HEDEF snapshot'a göre çözer.
 *
 * Kaynak parçanın malzemesi yeni katalogda yoksa (pasifleştirilmiş) kopya
 * varsayılan yapılandırmayla açılır: geçersiz bir konfigürasyonla açılan teklif
 * müşteriye ilk açılışta `config_invalid` gösterirdi. Adet/birim/ölçek ve
 * kritik tolerans korunur — onlar katalogdan bağımsız müşteri kararlarıdır.
 */
function configForSnapshot(part: QuotePart, snapshot: PricingSnapshot): ResolvedPartConfig {
  try {
    return resolveConfig(part, {}, snapshot);
  } catch {
    const fallback = defaultPartConfig(snapshot, part.geometry);
    return {
      ...fallback,
      quantity: part.quantity,
      units: part.units,
      scale: part.scale,
      criticalTolerance: part.criticalTolerance,
    };
  }
}

/**
 * Kaynak parçayı hedef teklife kopyalar.
 *
 * Dosyalar `linkOrCopyStoredFile` ile ÇOĞALTILIR (aynı diskte sabit bağ):
 * anahtarı paylaşmak, kaynak teklifin saklama süpürmesi dosyayı silince yeni
 * teklifi de dosyasız bırakırdı. Analizi biten parça yeniden ANALİZ EDİLMEZ —
 * aynı dosyanın geometrisi aynıdır; müşteri kopyayı anında fiyatlı görür.
 */
async function copyPartInto(
  tx: QuoteCacheTx,
  quoteId: string,
  source: QuotePart,
  sortOrder: number,
  snapshot: PricingSnapshot
): Promise<{ partId: string; needsAnalysis: boolean }> {
  const newId = randomUUID();
  const subdir = `quote-parts/${newId}`;
  const copyKey = async (key: string | null): Promise<string | null> =>
    key ? linkOrCopyStoredFile(key, subdir, storedFileName(key)) : null;

  const analysisReady =
    source.analysisStatus === "ready" && source.geometry !== null && source.canonicalStlKey !== null;

  const sourceKey = await linkOrCopyStoredFile(
    source.sourceKey,
    subdir,
    storedFileName(source.sourceKey)
  );
  const canonicalStlKey = analysisReady ? await copyKey(source.canonicalStlKey) : null;
  const previewGlbKey = analysisReady ? await copyKey(source.previewGlbKey) : null;
  const thumbnailKey = analysisReady ? await copyKey(source.thumbnailKey) : null;
  const drawingKey = await copyKey(source.drawingKey);

  const config = configForSnapshot(source, snapshot);
  await tx.insert(quoteParts).values({
    id: newId,
    quoteId,
    sortOrder,
    name: source.name,
    fileName: source.fileName,
    sourceKey,
    sourceFormat: source.sourceFormat,
    sourceBytes: source.sourceBytes,
    sourceSha256: source.sourceSha256,
    // `upload_id` TEKİLDİR: sahnelenmiş yükleme kaydı yalnız ilk parçaya aittir.
    uploadId: null,
    analysisStatus: analysisReady ? "ready" : "queued",
    geometry: analysisReady ? source.geometry : null,
    canonicalStlKey,
    previewGlbKey,
    thumbnailKey,
    ...config,
    note: source.note,
    drawingKey,
    drawingName: drawingKey ? source.drawingName : null,
    // Manuel fiyat KOPYALANMAZ: admin onu kaynak teklifin kataloğu ve
    // geçerlilik penceresi için vermişti.
  });
  return { partId: newId, needsAnalysis: !analysisReady };
}

// ─── Yeniden teklif al ──────────────────────────────────────────────────────

/**
 * Kaynak teklifin parçalarıyla BUGÜNÜN kataloğundan yeni bir teklif açar.
 *
 * `repriceQuote`'tan farkı: kaynak teklife dokunulmaz. Siparişe dönmüş ya da
 * süresi dolmuş bir teklif bu yolla tekrar alınabilir — tek koşul sahiplik.
 */
export async function requote(access: QuoteAccess): Promise<{ number: string }> {
  if (!access.viewer.isOwner) {
    throw new QuoteServiceError(
      "Yeniden teklif yalnız teklif sahibine açıktır.",
      403,
      "not_owner"
    );
  }
  const snapshot = await loadActiveSnapshot();
  const sourceParts = await loadQuoteParts(access.quote.id);
  if (sourceParts.length === 0) {
    throw new QuoteServiceError("Teklifte kopyalanacak parça yok.", 400, "no_parts");
  }
  if (sourceParts.some((p) => p.filesPurgedAt !== null)) {
    throw new QuoteServiceError(
      "Bu teklifin dosyaları saklama süresi dolduğu için silindi; modelleri yeniden yükleyin.",
      409,
      "files_purged"
    );
  }

  const now = new Date();
  const quote = access.quote;
  // Teslim kademesi ve ek hizmetler YENİ katalogda doğrulanır: katalogdan
  // kalkmış bir ek hizmet sessizce düşer, geçersiz bir kademe varsayılana döner.
  const leadTier = snapshot.settings.leadTiers.some((t) => t.key === quote.leadTier)
    ? quote.leadTier
    : "standard";
  const addonKeys = quote.addonKeys.filter((key) => snapshot.addons.some((a) => a.key === key));

  const { created, queued } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(quotes)
      .values({
        userId: quote.userId,
        anonymousId: quote.userId ? null : quote.anonymousId,
        leadTier,
        addonKeys,
        pricingSnapshot: snapshot,
        snapshotTakenAt: now,
        expiresAt: new Date(now.getTime() + snapshot.settings.quoteValidDays * 86_400_000),
        sourceQuoteId: quote.id,
        ...inheritedQuoteFields(quote),
      })
      .returning({ id: quotes.id, number: quotes.number });

    const queuedIds: string[] = [];
    let sortOrder = 0;
    for (const part of sourceParts) {
      const copy = await copyPartInto(tx, row.id, part, sortOrder++, snapshot);
      if (copy.needsAnalysis) queuedIds.push(copy.partId);
    }
    await recomputeQuoteCache(row.id, tx);
    return { created: row, queued: queuedIds };
  });

  for (const [index, partId] of queued.entries()) {
    await enqueuePartAnalysis(partId, 0, index + 1);
  }
  return { number: created.number };
}

// ─── Kütüphaneden parça ekleme ──────────────────────────────────────────────

/**
 * Müşterinin parça kütüphanesinden bu teklife parça kopyalar.
 *
 * Sahiplik KAYNAK TARAFINDA da aranır: parça, `userId`'nin kendi tekliflerinden
 * birine ait olmalı. Aksi hâlde kütüphane ucu, parça kimliğini tahmin eden
 * birine başkasının dosyasını kopyalama yolu açardı.
 */
export async function importParts(
  access: QuoteAccess,
  sourcePartIds: string[],
  userId: string
): Promise<number> {
  const wanted = [...new Set(sourcePartIds)];
  if (wanted.length === 0) {
    throw new QuoteServiceError("Hiç parça seçilmedi.", 400, "no_parts");
  }
  if (wanted.length > access.quote.pricingSnapshot.settings.maxPartsPerQuote) {
    throw new QuoteServiceError(
      `Tek seferde en fazla ${access.quote.pricingSnapshot.settings.maxPartsPerQuote} parça eklenebilir.`,
      400,
      "part_limit"
    );
  }

  const rows = await db
    .select({ part: quoteParts })
    .from(quoteParts)
    .innerJoin(quotes, eq(quotes.id, quoteParts.quoteId))
    .where(
      and(
        inArray(quoteParts.id, wanted),
        eq(quotes.userId, userId),
        isNull(quoteParts.deletedAt),
        isNull(quoteParts.filesPurgedAt)
      )
    );
  if (rows.length !== wanted.length) {
    throw new QuoteServiceError(
      "Seçilen parçalardan bazıları bulunamadı.",
      404,
      "part_not_found"
    );
  }
  // İstemcinin sıralaması korunur: müşteri kütüphanede seçtiği sırayı teklifte
  // görmeli.
  const sources = wanted.map((id) => rows.find((r) => r.part.id === id)!.part);

  const queued: string[] = [];
  const imported = await mutateQuote(access, async (tx, quote) => {
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(quoteParts)
      .where(and(eq(quoteParts.quoteId, quote.id), isNull(quoteParts.deletedAt)));
    const max = quote.pricingSnapshot.settings.maxPartsPerQuote;
    if (total + sources.length > max) {
      throw new QuoteServiceError(
        `Bir teklifte en fazla ${max} parça olabilir. Kalan parçalar için yeni bir teklif açın.`,
        409,
        "part_limit"
      );
    }

    let sortOrder = total;
    for (const source of sources) {
      const copy = await copyPartInto(
        tx,
        quote.id,
        source,
        sortOrder++,
        quote.pricingSnapshot
      );
      if (copy.needsAnalysis) queued.push(copy.partId);
    }
    await demoteQuotedToDraft(tx, quote);
    return sources.length;
  });

  for (const [index, partId] of queued.entries()) {
    await enqueuePartAnalysis(partId, 0, index + 1);
  }
  return imported;
}

// ─── Okuma ──────────────────────────────────────────────────────────────────

export async function loadQuoteParts(quoteId: string): Promise<QuotePart[]> {
  return db
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, quoteId), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
}

/**
 * Teklifin müşteriye gidecek TEK gövdesi.
 *
 * Fiyat hesabı burada TAZE yapılır; `quotes.total_kurus` yalnız liste
 * önbelleğidir (bkz. quote-cache.ts).
 */
export async function loadPresentedQuote(access: QuoteAccess): Promise<PresentedQuote> {
  const quote = access.quote;
  // Okumalar SIRAYLA: havuzda beş bağlantı var ve tek bir sayfa görüntülemesi
  // için üçünü birden tutmak, iki eşzamanlı ziyaretçide havuzu tüketirdi.
  const parts = await loadQuoteParts(quote.id);
  const live = await liveDraftForQuote(quote.id);
  const catalogAt = await catalogUpdatedAt();

  let orderNumber: string | null = null;
  if (quote.orderId) {
    const [row] = await db
      .select({ orderNumber: orders.orderNumber })
      .from(orders)
      .where(eq(orders.id, quote.orderId))
      .limit(1);
    orderNumber = row?.orderNumber ?? null;
  }

  const computed = computeQuote(quote.pricingSnapshot, toPricingInputs(parts), {
    leadTier: quote.leadTier,
    addonKeys: quote.addonKeys,
  });

  return presentQuote({
    quote,
    parts,
    snapshot: quote.pricingSnapshot,
    computed,
    viewer: access.viewer,
    liveDraftReference: live?.reference ?? null,
    orderNumber,
    catalogChanged: catalogAt.getTime() > quote.snapshotTakenAt.getTime(),
    now: new Date(),
    sign: getPublicUrl,
    shareBaseUrl: `${appUrl()}/teklif/${quote.number}`,
  });
}

export async function listCustomerQuotes(
  userId: string,
  page: number
): Promise<{ items: CustomerQuoteListItem[]; hasNext: boolean }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      title: quotes.title,
      totalKurus: quotes.totalKurus,
      leadDays: quotes.leadDays,
      createdAt: quotes.createdAt,
      updatedAt: quotes.updatedAt,
      expiresAt: quotes.expiresAt,
      orderNumber: orders.orderNumber,
    })
    .from(quotes)
    .leftJoin(orders, eq(quotes.orderId, orders.id))
    .where(eq(quotes.userId, userId))
    .orderBy(desc(quotes.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset(offset);

  const page_ = rows.slice(0, PAGE_SIZE);
  const counts = new Map<string, { parts: number; units: number }>();
  if (page_.length > 0) {
    const rowsWithCounts = await db
      .select({
        quoteId: quoteParts.quoteId,
        parts: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${quoteParts.quantity}), 0)::int`,
      })
      .from(quoteParts)
      .where(
        and(
          inArray(
            quoteParts.quoteId,
            page_.map((q) => q.id)
          ),
          isNull(quoteParts.deletedAt)
        )
      )
      .groupBy(quoteParts.quoteId);
    for (const row of rowsWithCounts) counts.set(row.quoteId, { parts: row.parts, units: row.units });
  }

  const now = Date.now();
  return {
    items: page_.map((q) => ({
      id: q.id,
      number: q.number,
      status: q.status,
      title: q.title,
      partCount: counts.get(q.id)?.parts ?? 0,
      unitCount: counts.get(q.id)?.units ?? 0,
      totalKurus: q.totalKurus,
      leadDays: q.leadDays,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      expiresAt: q.expiresAt.toISOString(),
      expired: q.status === "expired" || q.expiresAt.getTime() < now,
      orderNumber: q.orderNumber,
    })),
    hasNext: rows.length > PAGE_SIZE,
  };
}

interface LibraryRow extends Record<string, unknown> {
  part_id: string;
  name: string;
  file_name: string;
  source_format: LibraryPart["sourceFormat"];
  source_sha256: string;
  thumbnail_key: string | null;
  geometry: QuotePart["geometry"];
  units: QuoteUnits;
  scale: number;
  material_name: string | null;
  quote_id: string;
  quote_number: string;
  created_at: Date;
  use_count: number;
}

/**
 * Parça kütüphanesi: aynı DOSYA (sha256) tek satır.
 *
 * Tekilleştirme `DISTINCT ON` ile en son yüklenen kopyayı seçer; `use_count`
 * müşteriye "bunu 3 teklifte kullandın" der. Depolama anahtarları asla
 * kullanıcılar arasında paylaşılmaz: sorgu yalnız BU kullanıcının
 * tekliflerine bakar.
 */
export async function listCustomerParts(
  userId: string,
  page: number
): Promise<{ items: LibraryPart[]; hasNext: boolean }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const result = await db.execute<LibraryRow>(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (p.source_sha256)
        p.id AS part_id, p.name, p.file_name, p.source_format, p.source_sha256,
        p.thumbnail_key, p.geometry, p.units, p.scale,
        q.id AS quote_id, q.number AS quote_number, p.created_at,
        (
          SELECT m ->> 'name'
          FROM jsonb_array_elements(q.pricing_snapshot -> 'materials') AS m
          WHERE m ->> 'key' = p.material_key
            AND m ->> 'technologyKey' = p.technology_key
          LIMIT 1
        ) AS material_name,
        count(*) OVER (PARTITION BY p.source_sha256)::int AS use_count
      FROM ${quoteParts} p
      JOIN ${quotes} q ON q.id = p.quote_id
      WHERE q.user_id = ${userId}
        AND p.deleted_at IS NULL
        AND p.files_purged_at IS NULL
      ORDER BY p.source_sha256, p.created_at DESC
    ) t
    ORDER BY t.created_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `);

  const rows = result.rows.slice(0, PAGE_SIZE);
  const items: LibraryPart[] = rows.map((row) => {
    // Milimetreye çeviri TEK yerden (`scaledGeometry`): ikinci bir birim
    // aritmetiği, kütüphanede başka, teklifte başka ölçü gösterirdi.
    const scaled = row.geometry ? scaledGeometry(row.geometry, row.units, row.scale) : null;
    return {
      partId: row.part_id,
      name: row.name,
      fileName: row.file_name,
      sourceFormat: row.source_format,
      sha256: row.source_sha256,
      thumbnailUrl: row.thumbnail_key ? getPublicUrl(row.thumbnail_key) : null,
      dimensionsMm: scaled?.extentsMm ?? null,
      volumeCm3: scaled?.volumeCm3 ?? null,
      // Malzeme adı teklifin KENDİ anlık görüntüsünden çözülür: bugünün
      // kataloğuna bakmak, kaldırılmış bir malzemeyi "bilinmiyor" göstermek
      // ya da adı değişmiş bir malzemeyi geçmişe dönük yeniden adlandırmak
      // olurdu. Snapshot'ta eşleşme yoksa alan null kalır.
      lastMaterialName: row.material_name,
      quoteId: row.quote_id,
      quoteNumber: row.quote_number,
      createdAt: new Date(row.created_at).toISOString(),
      useCount: row.use_count,
    };
  });

  return { items, hasNext: result.rows.length > PAGE_SIZE };
}
