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
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import {
  orderDrafts,
  orders,
  quoteCheckouts,
  quoteFrameworkBatches,
  quoteFrameworks,
  quoteParts,
  quotes,
  users,
  type Quote,
  type QuotePart,
} from "@/lib/db/schema";
import { DISTANCE_CONTRACT_VERSION } from "@/lib/config/distance-contract";
import { MAX_AMOUNT_KURUS } from "@/lib/config/prices";
import { computeQuote, defaultPartConfig } from "@/lib/config/quote-compute";
import { partPricingKey } from "@/lib/config/quote-keys";
import {
  QUOTE_FRAMEWORK_BATCH_REASON,
  QUOTE_FRAMEWORK_SOURCE_REASON,
  quotePermissions,
} from "@/lib/config/quote-policy";
import { canEditTeamQuote, canShareQuote } from "@/lib/config/quote-team";
import {
  QUOTE_UNITS,
  REVIEW_KINDS,
  type ComputedQuote,
  type CustomerQuoteListItem,
  type DfmCode,
  type FrozenQuotePart,
  type InvoiceType,
  type LeadTierKey,
  type LibraryPart,
  type PresentedQuote,
  type PricingSnapshot,
  type QuoteFxSnapshot,
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
import { isFlagEnabled } from "@/lib/services/flags";
import { loadActiveFxSnapshot } from "@/lib/services/fx-rates";
import type { TeamMembership } from "@/lib/services/customer-team";
import {
  resolveUserTeam,
  stepUploadsEnabled,
  UUID_RE,
  type QuoteAccess,
} from "@/lib/services/quote-access";
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

/**
 * Müşteri OKUMALARININ kapsamı: "benim teklifler" + (varsa) "takımımın
 * teklifleri" (0072). Üç çağıranı var: `listCustomerQuotes`,
 * `listCustomerParts` ve `importParts`in KAYNAK sahipliği.
 *
 * TAKIMI OLMAYAN KULLANICIDA İFADE BUGÜNKÜNÜN BİREBİR KENDİSİDİR
 * (`eq(quotes.userId, userId)`) — ikinci dal HİÇ KURULMAZ. Bir `or(…, eq(teamId,
 * null))` yazmak iki şeyi birden bozardı: SQL'de `team_id = NULL` hiçbir satırı
 * döndürmez (ve `IS NULL` yazılsa BAŞKA müşterilerin anonim tekliflerini
 * kapsardı), ayrıca takımsız müşterinin sorgu PLANI da bugünkü kalmak zorunda
 * (birincil kısıt: "takımı olmayan müşteri için bugünkü davranış bit bit aynı").
 *
 * `team` da döner çünkü iki çağıran ADI da istiyor ("Takım" kolonu) ve üyelik
 * zaten okundu; ikinci bir sorgu açmanın gereği yok.
 */
async function teamScope(
  userId: string
): Promise<{ team: TeamMembership | null; condition: SQL }> {
  const team = await resolveUserTeam(userId);
  const own = eq(quotes.userId, userId);
  if (team === null) return { team: null, condition: own };
  // `or` tipi `undefined` de döndürebilir (tüm argümanları undefined olan
  // çağrı); burada ikisi de dolu. Yedek DARALTAN yönde: kapsamın `undefined`a
  // düşmesi "WHERE yok" demek olurdu.
  return { team, condition: or(own, eq(quotes.teamId, team.teamId)) ?? own };
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

/**
 * Bu teklif bir çerçeve anlaşmanın partisinin KLONU mu?
 *
 * Ölçü tek kolondur: `quote_framework_batches.quote_id`. Parti durumuna
 * BAKILMAZ — klonun manuel fiyatı anlaşmanın kilitli fiyatıdır ve partinin
 * sonraki hâli o kilidi geçersiz kılmaz. `quote_framework_batches_quote_id_uq`
 * en fazla bir satır garanti ediyor (bir klon teklif = bir parti).
 *
 * `tx` verilirse ÇAĞIRANIN işleminde okunur (`liveDraftForQuote` ile aynı
 * gerekçe: havuzda beş bağlantı var).
 */
export async function quoteIsFrameworkBatch(
  quoteId: string,
  tx?: QuoteReader
): Promise<boolean> {
  const [row] = await (tx ?? db)
    .select({ id: quoteFrameworkBatches.id })
    .from(quoteFrameworkBatches)
    .where(eq(quoteFrameworkBatches.quoteId, quoteId))
    .limit(1);
  return row !== undefined;
}

/**
 * Bu teklif, KAPANMAMIŞ bir çerçeve anlaşmanın KAYNAK teklifi mi?
 *
 * Ölçü tek kolondur: `quote_frameworks.quote_id`. `cancelled` ve `completed`
 * anlaşmalar SAYILMAZ — ikisinden de yeni parti doğmaz (`releaseBatch` yalnız
 * `active` anlaşmada çalışır ve `extendFrameworkLock` bu ikisini reddeder),
 * yani kaynağın kilidi onlarla birlikte DÜŞER. `expired` SAYILIR: uzatma onu
 * `active`a geri döndürüyor, yani tanımı hâlâ bir partiyi üretebilir.
 *
 * `tx` verilirse ÇAĞIRANIN işleminde okunur (`liveDraftForQuote` ile aynı
 * gerekçe: havuzda beş bağlantı var).
 */
export async function quoteHasLiveFramework(
  quoteId: string,
  tx?: QuoteReader
): Promise<boolean> {
  const [row] = await (tx ?? db)
    .select({ id: quoteFrameworks.id })
    .from(quoteFrameworks)
    .where(
      and(
        eq(quoteFrameworks.quoteId, quoteId),
        notInArray(quoteFrameworks.status, ["cancelled", "completed"])
      )
    )
    .limit(1);
  return row !== undefined;
}

async function assertEditable(tx: QuoteCacheTx, quote: Quote): Promise<void> {
  const live = await liveDraftForQuote(quote.id, tx);
  const permissions = quotePermissions(
    { status: quote.status, expiresAt: quote.expiresAt, orderId: quote.orderId },
    {
      hasLiveDraft: live !== null,
      now: new Date(),
      // R1'in kapısı: parti klonunu düzenlemek `demoteQuotedToDraft`i
      // çağırırdı ve kilitli fiyat canlı katalog fiyatına dönerdi.
      isFrameworkBatch: await quoteIsFrameworkBatch(quote.id, tx),
      // İKİNCİ kapsam: anlaşmanın KAYNAK teklifi. Kilitlenen şey yalnız fiyat
      // değil TANIM — gerekçe `QUOTE_FRAMEWORK_SOURCE_REASON`da.
      hasLiveFramework: await quoteHasLiveFramework(quote.id, tx),
    }
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
  // Kur teklifin AÇILIŞINDA donar ve teklifle birlikte yaşar; `null` dönerse
  // (kur hiç çekilememiş ya da BAYAT) kolon `null` KALIR — yarım bir snapshot
  // yazmak, ekrana bir gün yanlış kurla çevrilmiş rakam basmak demekti. Tatil
  // listesi teklifin kendi kataloğundan gelir; ikinci bir takvim yok.
  const fxSnapshot = await loadActiveFxSnapshot(snapshot.settings.holidays, now);
  // TAKIMI OLAN MÜŞTERİNİN AÇTIĞI TEKLİF DOĞRUDAN TAKIM TEKLİFİDİR (tasarım
  // §1.1.4): kurumsal müşteride işin görünür olması varsayılan, gizli kalması
  // istisnadır — teklifi her seferinde elle bağlamak, meslektaşın göremediği
  // bir dosyayı "bağlamayı unuttum" hâlinde bırakırdı.
  //
  // Anonim teklif ASLA takıma bağlanmaz (`userId === null` → `resolveUserTeam`
  // hiç sormaz): `quotes_team_requires_user_chk` zaten reddeder, ama çağrıyı
  // yapmamak girişsiz ziyaretçinin teklif açma yoluna tek bir sorgu bile
  // eklememektir. Bayrak KAPALIYSA da hiç sorulmaz ve kolon null kalır.
  const team = await resolveUserTeam(args.userId);

  const [row] = await db
    .insert(quotes)
    .values({
      userId: args.userId,
      teamId: team?.teamId ?? null,
      // `anonymous_id` YALNIZ sahipsiz teklifte anlamlıdır (şema notu): girişli
      // müşteride çerez kimliği saklamak, teklifi aynı tarayıcıyı kullanan
      // ikinci bir kişiye açardı.
      anonymousId: args.userId ? null : args.anonymousId,
      pricingSnapshot: snapshot,
      snapshotTakenAt: now,
      fxSnapshot,
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

  // GÜVENLİK SINIRI BURADIR. İstemcinin biçim listesi (`acceptedFormats` →
  // dropzone `accept`) yalnız bir KOLAYLIKTIR; gövde elle de kurulabilir.
  //
  // Ve bayrak kapalıyken gelen `.step` SESSİZCE YOK SAYILMAZ: 400 + kod.
  // Sessizce yok saymak (ya da 200 dönmek) müşteriye dosyasının alındığını
  // sandırırdı — teklifinde olmayan bir parçayı beklemeye başlardı.
  if (validation.format === "step" && !(await stepUploadsEnabled(access.viewer))) {
    throw new QuoteServiceError(
      "STEP dosyaları şu an kabul edilmiyor; parçayı STL, OBJ ya da 3MF olarak dışa aktarıp yükleyin.",
      400,
      "step_disabled"
    );
  }

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
    // parçasının klasörüne gitsin. Ters sıra (önce satır, sonra taşıma)
    // dosyasız bir parça bırakırdı ve o müşteriye "fiyat hesaplanamadı" olurdu.
    //
    // BEDELİ: işlem geri alınırsa dosya `quote-parts/<id>/` altında SAHİPSİZ
    // kalır — `purgeExpiredQuoteFiles` onu bulamaz (o yalnız `quote_parts`
    // SATIRLARINDAN okuduğu anahtarları siler), `sweepStagedUploads` de bulamaz
    // (o yalnız `uploads/staging/` dizinini tarar).
    // TOPLAYICISI VAR: `sweepOrphanQuotePartDirs` (`quote-maintenance.ts`,
    // saatlik tur) satırı olmayan `quote-parts/<uuid>/` dizinlerini siler —
    // `ORPHAN_DIR_GRACE_HOURS` bekleme süresiyle, yani BU işlem hâlâ açıkken
    // dosyaya dokunmaz. Sızıntının ömrü en kötü hâlde yarım gündür.
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
  if (patch.units !== undefined) {
    // STEP'İN BİRİM KİLİDİ. Dosya kendi birimini taşır ve çekirdek onu mm'ye
    // uygular; "cm" seçmek parçayı 10× büyütür, hacmi (yani fiyatı) 1000×
    // şişirirdi. Kilidin yeri BURASI: yamayı ayrıştıran `parsePartPatch`
    // parçayı hiç görmez, oysa buradan HEM tek parça (`updatePart`) HEM toplu
    // (`bulkUpdateParts`) yol geçer — tek noktada yazmak iki ucu birden kapar.
    //
    // Bu ret 0070'in `quote_parts_step_units_chk` CHECK'inin TS tarafındaki
    // EŞİDİR ve "daha anlaşılır mesaj" değil, 500'ü engelleyen tek şeydir:
    // olmasaydı UPDATE 23514 ile düşer, rota Türkçe cümle yerine BOŞ GÖVDELİ
    // bir 500 döndürürdü. `scale` bilerek serbest kalır (tasarım §1.4:
    // kilitli olan birim, ölçek değil).
    if (part.sourceFormat === "step" && patch.units !== "mm") {
      throw new QuoteServiceError(
        "Ölçü birimi STEP dosyasından okundu (mm) ve değiştirilemez.",
        400,
        "invalid_option"
      );
    }
    next.units = patch.units;
  }
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

/**
 * Parçayı teklifin İÇİNDEN yükler; bulunamazsa 404 `part_not_found`.
 *
 * Kod adı bilerek `part_not_found`, `quote_not_found` DEĞİL: buraya gelindiğinde
 * teklif bulunmuştur, eksik olan yalnız parçadır — ve bu gövde `updatePart`,
 * `duplicatePart`, `deletePart`, `setDrawing` tarafından paylaşılır, dördü de
 * bugün `part_not_found` döner. İKİ KATMANLI sözleşme:
 *   • uç (route) — biçimi uuid olmayan `partId` servise hiç ulaşmaz, uç
 *     `quote_not_found` 404 kalıbını döner (teklif ucunun ortak kalıbı);
 *   • servis (burası) — biçim doğruysa ama parça yoksa/başkasınınsa
 *     `part_not_found` 404.
 * İkisi de gövdesinde Türkçe cümle taşıyan 404'tür, yani hiçbiri kimlik
 * saydırmaz. Pinler: `scripts/test-quote-cutover.ts` (uç kalıbı, kaynaktan) ve
 * `scripts/test-quote-service-db.ts` (servis kodu, çalışır hâlde).
 */
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
 * ÇERÇEVE KAPILARI BU YÜZDEN BURADA, ELLE KURULUR. `assertEditable`
 * koşmadığı için (`requireEdit: false`) `quotePermissions`ın iki çerçeve
 * kapısı bu yola HİÇ uğramaz, oysa yeniden fiyatlamanın çerçeveye verdiği
 * zarar düzenlemeden BÜYÜKTÜR:
 *  - **Parti klonunda:** `pricing_snapshot` CANLI kataloğa döner, `status`
 *    `draft` olur, `expires_at` kilidi AŞAR ve manuel fiyatlar NULL'lanır —
 *    yani anlaşmanın kilitli fiyatı o parti için tamamen kaybolur. Eşitlik
 *    kapısı parayı korur ama parti KALICI olarak ödenemez hâle gelir
 *    (`releaseBatch` `planned` olmayan partiyi bırakmaz, ikinci bir klon yolu
 *    yoktur).
 *  - **Anlaşmanın kaynak teklifinde:** `snapshot_taken_at` BUGÜNE döner, oysa
 *    klonun damgası oradan okunuyor (`releaseBatch`) — sonraki her parti,
 *    anlaşmanın ESKİ kataloğunu taşırken TAZE damgalı görünürdü. Ayrıca
 *    kaynağın tanımı anlaşmanın `parts_snapshot`ından ayrışırdı.
 *
 * Manuel fiyatlar DÜŞER: admin onları eski katalog ve eski geçerlilik
 * penceresi için vermişti.
 */
export async function repriceQuote(access: QuoteAccess): Promise<void> {
  const snapshot = await loadActiveSnapshot();
  // Yeni fiyat, YENİ kur. Okuma işlemin DIŞINDA: `mutateQuote` teklif satırını
  // kilitliyor ve havuzda beş bağlantı var — kilidi tutarken ikinci bir
  // bağlantıdan okumak iki eşzamanlı ziyaretçide havuzu tüketirdi.
  const fxSnapshot = await loadActiveFxSnapshot(snapshot.settings.holidays);
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
      if (await quoteIsFrameworkBatch(quote.id, tx)) {
        throw new QuoteServiceError(QUOTE_FRAMEWORK_BATCH_REASON, 409, "quote_locked");
      }
      if (await quoteHasLiveFramework(quote.id, tx)) {
        throw new QuoteServiceError(QUOTE_FRAMEWORK_SOURCE_REASON, 409, "quote_locked");
      }
      const now = new Date();
      await tx
        .update(quotes)
        .set({
          pricingSnapshot: snapshot,
          snapshotTakenAt: now,
          fxSnapshot,
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
      {
        hasLiveDraft: live !== null,
        now: new Date(),
        // Parti klonu için inceleme İSTENMEZ: fiyatı anlaşma belirledi ve bir
        // inceleme talebi teklifi `needs_review`a çekip ödemeyi kapatırdı.
        isFrameworkBatch: await quoteIsFrameworkBatch(quote.id, tx),
        // Anlaşmanın kaynak teklifi de öyle: inceleme yeni bir manuel fiyata
        // çıkar ve anlaşmanın DONMUŞ tanımıyla ayrışır.
        hasLiveFramework: await quoteHasLiveFramework(quote.id, tx),
      }
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
    /**
     * TAKIM BAĞI DA DEVRALINIR (0072) ve bu TEK satır üç yolu birden kapatıyor:
     * `requote`, teklif bölme (`splitByTechnology`) ve çerçeve partisinin
     * klonu (`cloneQuoteForFrameworkBatch`).
     *
     * Unutulması SESSİZ bir erişim hatasıdır: yeniden fiyatlanan teklif
     * takımdan DÜŞER, üye kendi işini kaybeder ve kimse bir hata görmez — yeni
     * teklif numarası vardır, sahibi vardır, yalnız meslektaşları yoktur.
     *
     * `quotes_team_requires_user_chk` güvende: üç yolun üçü de `userId`yi
     * kaynaktan (ya da anlaşmanın sahibinden) yazıyor ve takım teklifinde
     * `user_id` daima dolu.
     */
    teamId: quote.teamId,
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
          // Ebeveynin kuru KOPYALANIR, yeniden ÇEKİLMEZ: bölünen parçalar aynı
          // teklifin devamıdır (snapshot ve geçerlilik süresi de devralınıyor)
          // ve müşteri açtığı gün gördüğü rakamı görmeye devam etmeli. Yeniden
          // çekmek, bölme düğmesine basmayı sessiz bir yeniden fiyatlamaya
          // çevirirdi — oysa bölme bir yeniden fiyatlama DEĞİLDİR.
          fxSnapshot: quote.fxSnapshot,
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
 * MÜŞTERİ TARAFI: "bu teklifi bağlantısı olan herkese açıyorum" kararı admin'in
 * ya da paylaşım izleyicisinin değil, müşterinin kararıdır (sunucu da
 * `shareUrl`'ü yalnız `canSeeOwnerFields` geçen izleyiciye gönderiyor).
 * Takımda bu karar düzenleyebilen üyelerin; salt okunur `viewer` rolü dışarıda
 * (`canShareQuote`).
 *
 * `requireEdit: false` bilerek: paylaşım bir OKUMA izni verir, düzenleme
 * değil. Süresi dolmuş ya da siparişe dönmüş bir teklifi patronuna göstermek
 * tam da müşterinin isteyeceği şeydir.
 */
export async function setShareToken(
  access: QuoteAccess,
  action: "create" | "rotate" | "revoke"
): Promise<string | null> {
  if (!canShareQuote(access.viewer)) {
    throw new QuoteServiceError(
      "Paylaşım bağlantısını yönetme yetkiniz yok.",
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

/**
 * Ödeme anında DONDURULAN parça tanımları.
 *
 * Üretici ve admin ekranları ile dosya bağlama işi bu satırı okur, canlı
 * `quote_parts`'ı değil: müşteri ödedikten sonra teklifini düzenleyemez ama
 * katalog ve adlar değişebilir, ve basılan şeyin tanımı ödenen tanım olmalı.
 */
export function freezeParts(
  snapshot: PricingSnapshot,
  parts: QuotePart[],
  computed: ComputedQuote
): FrozenQuotePart[] {
  const priced = new Map(computed.parts.map((p) => [p.id, p]));
  return parts.map((part, index) => {
    const c = priced.get(part.id);
    if (!c || !c.price.ok || c.dfm.scaled === null) {
      // Buraya düşmek imkânsız: `checkoutBlockers` fiyatlanamayan parçayı
      // zaten durdurur. Yine de sessiz bir sıfır fiyat dondurmayalım.
      throw new QuoteServiceError(
        "Teklifin fiyatı hesaplanamadı — sayfayı yenileyip tekrar deneyin.",
        409,
        "price_unavailable"
      );
    }
    if (!part.canonicalStlKey) {
      throw new QuoteServiceError(
        "Bazı parçaların baskı dosyası henüz hazır değil — birkaç saniye sonra tekrar deneyin.",
        409,
        "canonical_missing"
      );
    }
    const tech = snapshot.technologies.find((t) => t.key === part.technologyKey);
    const material = snapshot.materials.find(
      (m) => m.key === part.materialKey && m.technologyKey === part.technologyKey
    );
    const color = material?.colors.find((c2) => c2.key === part.colorKey);
    const finish = snapshot.finishes.find(
      (f) =>
        f.key === part.finishKey &&
        (f.technologyKey === null || f.technologyKey === part.technologyKey)
    );
    const warnings: DfmCode[] = c.dfm.issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.code);

    return {
      partId: part.id,
      position: index,
      name: part.name,
      fileName: part.fileName,
      sourceFormat: part.sourceFormat,
      canonicalStlKey: part.canonicalStlKey,
      thumbnailKey: part.thumbnailKey,
      drawingKey: part.drawingKey,
      drawingName: part.drawingName,
      scaleFactor: c.dfm.scaled.factor,
      technologyKey: part.technologyKey,
      // Ad çözülemezse anahtarın kendisi yazılır: boş bir hücre, üreticinin
      // neyi basacağını bilmemesi demektir.
      technologyName: tech?.name ?? part.technologyKey,
      materialKey: part.materialKey,
      materialName: material?.name ?? part.materialKey,
      colorName: color?.name ?? part.colorKey,
      colorHex: color?.hex ?? "#000000",
      finishKey: part.finishKey,
      finishName: finish?.name ?? part.finishKey,
      layerUm: part.layerUm,
      infillPct: part.infillPct,
      quantity: part.quantity,
      dimensionsMm: c.dfm.scaled.extentsMm,
      volumeCm3: c.dfm.scaled.volumeCm3,
      // Hangi sapmayla ölçüldüğü ödeme anında DONAR: üretici/admin görünümleri
      // ve sonraki bir uygunluk tartışması bu kaydı okur. Tutar hesabına
      // girmez — bir nitelik, bir fiyat değil.
      tessellationMm: part.geometry?.tessellation?.deflectionMm ?? null,
      unitKurus: c.price.unitKurus,
      lineKurus: c.price.lineKurus,
      note: part.note,
      dfmWarnings: warnings,
    };
  });
}

// ─── Yeniden teklif al ──────────────────────────────────────────────────────

/**
 * Kaynak teklifin parçalarıyla BUGÜNÜN kataloğundan yeni bir teklif açar.
 *
 * `repriceQuote`'tan farkı: kaynak teklife dokunulmaz. Siparişe dönmüş ya da
 * süresi dolmuş bir teklif bu yolla tekrar alınabilir — tek koşul DÜZENLEME
 * yetkisi (`canEditTeamQuote`: kişisel sahip ya da takımın salt-okunur olmayan
 * üyesi). Yeni teklif AYNI `team_id` ile doğar (`inheritedQuoteFields`).
 */
export async function requote(access: QuoteAccess): Promise<{ number: string }> {
  if (!canEditTeamQuote(access.viewer)) {
    throw new QuoteServiceError(
      "Yeniden teklif alma yetkiniz yok.",
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
  // Yeni teklif, yeni kur: kaynağa dokunulmuyor ve fiyat BUGÜNÜN kataloğundan
  // çıkıyor, dolayısıyla kur da bugünün bülteninden çıkmak zorunda.
  const fxSnapshot = await loadActiveFxSnapshot(snapshot.settings.holidays, now);

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
        fxSnapshot,
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

// ─── Çerçeve partisinin klonu ───────────────────────────────────────────────

/**
 * Anlaşmanın DONMUŞ tanımıyla klonun tanımının karşılaştırıldığı alanlar.
 *
 * "Ne üretilecek" sorusunun cevabı bunlardır. DIŞARIDA BIRAKILANLAR ve
 * gerekçeleri:
 *  - `quantity`/`lineKurus`/`unitKurus`: adet PARTİNİN kararıdır (tasarımın
 *    kendisi), fiyat da parti satırından gelir.
 *  - `partId`/`position`/`canonicalStlKey`/`thumbnailKey`/`drawingKey`: kimlik
 *    ve depolama anahtarları; klon kendi satırlarını ve kendi hardlink'lerini
 *    taşır.
 *  - `name`/`note`/`fileName`/`drawingName`: METİN. Bir parçanın adını
 *    değiştirmek üretileni değiştirmez ve bir partiyi bu yüzden ödenemez hâle
 *    getirmek zararın kendisinden büyük olurdu.
 *  - `technologyName`/`materialName`/`finishName`: anahtarlardan ve AYNI
 *    snapshot'tan türüyor, yani anahtar eşitse bunlar da eşittir.
 *  - `dfmWarnings`: uyarı listesi adede bağlı (`dfmWarningKey`); parti adedi
 *    bilerek farklıdır.
 *
 * `colorName` + `colorHex`, `colorKey`in ölçülebilen izidir: `FrozenQuotePart`
 * anahtarı taşımıyor (sözleşme tipi, YALNIZ eklenerek genişletilir) ama ad ve
 * kod anlaşmanın snapshot'ından çözülüyor, yani renk değişince ikisi de sapar.
 * `scaleFactor` = `unitFactor(units) × scale`, yani birim ve ölçek bir sayıda.
 */
const FRAMEWORK_DEFINITION_FIELDS = [
  "sourceFormat",
  "scaleFactor",
  "technologyKey",
  "materialKey",
  "colorName",
  "colorHex",
  "finishKey",
  "layerUm",
  "infillPct",
  "tessellationMm",
] as const;

/** Sapan İLK alanın adı, yoksa null. */
function frameworkPartDrift(agreed: FrozenQuotePart, clone: FrozenQuotePart): string | null {
  for (const field of FRAMEWORK_DEFINITION_FIELDS) {
    if (agreed[field] !== clone[field]) return field;
  }
  return null;
}

/** Klonlanacak parti satırı: KAYNAK teklifin parçası, parti adedi, kilitli fiyat. */
export interface FrameworkBatchCloneLine {
  /** `quote_framework_batch_lines.part_id` = anlaşmanın kaynak teklifindeki parça. */
  partId: string;
  quantity: number;
  /** Anlaşmadan gelen KİLİTLİ birim fiyat (KDV dâhil nihai birim fiyat). */
  unitKurus: number;
}

export interface FrameworkBatchCloneArgs {
  /** Anlaşmanın kaynak teklifi; teklif düzeyindeki alanlar ORADAN devralınır. */
  sourceQuote: Quote;
  /** ANLAŞMANIN dondurduğu katalog — `loadActiveSnapshot()` DEĞİL. */
  snapshot: PricingSnapshot;
  /**
   * ANLAŞMANIN dondurduğu parça TANIMI (`quote_frameworks.parts_snapshot`).
   *
   * Kilidin ikinci yarısı: klon yapılandırmayı CANLI kaynak parçadan okuyor
   * (`copyPartInto` → `configForSnapshot`), o yüzden yazılan tanım anlaşmada
   * donmuş tanımla KARŞILAŞTIRILIR (`frameworkPartDrift`).
   */
  partsSnapshot: readonly FrozenQuotePart[];
  /** Anlaşmanın `snapshot_taken_at`ı; klon tarihi DEĞİL (gerekçe aşağıda). */
  snapshotTakenAt: Date;
  leadTier: LeadTierKey;
  addonKeys: string[];
  lines: readonly FrameworkBatchCloneLine[];
  /** `min(price_locked_until, now + settings.quoteValidDays)`. */
  expiresAt: Date;
  /** SERBEST BIRAKMA GÜNÜNÜN bülteni; yoksa null (gerekçe aşağıda). */
  fxSnapshot: QuoteFxSnapshot | null;
  /** Anlaşmanın sahibi (`quote_frameworks.user_id`; anonim çerçeve YOK). */
  userId: string;
  /** Manuel fiyatı yazan admin — denetim izi kolonu. */
  pricedByEmail: string;
  now: Date;
}

export interface FrameworkBatchClone {
  id: string;
  number: string;
  /** Klonun BUGÜN hesaplanan hâli; eşitlik kapısının girdisi. */
  computed: ComputedQuote;
}

/**
 * Bir çerçeve partisinin ödenebilir KLON teklifini açar.
 *
 * `requote`'un kardeşidir ve gövdesini onunla paylaşır (`copyPartInto`,
 * `inheritedQuoteFields`, `recomputeQuoteCache`) — tek fark, snapshot'ı
 * ARGÜMANDAN almasıdır. İkinci bir klonlama yolu yazmak, teklif zincirinin en
 * pahalı kopyası olurdu.
 *
 * ─── BEŞ FARK, HER BİRİ BİR PARA KARARI ────────────────────────────────────
 *
 * 1. `pricingSnapshot` ANLAŞMANIN snapshot'ıdır ve `snapshotTakenAt` da
 *    anlaşmanınki. `loadActiveSnapshot()` BURADA ÇAĞRILMAZ: kilidi gerçek
 *    yapan tek şey budur. Tarih de anlaşmanınki, çünkü aksi hâlde
 *    `catalogChangedSinceSnapshot` müşteriye "Katalog güncellendi, yeniden
 *    fiyatla" bandını yakar ve o bant kilitli fiyatı ŞÜPHELİ gösterir.
 * 2. Her parça `quantity` = parti satırının adedi, `manualUnitPriceKurus` =
 *    kilitli birim fiyat, `manualPriceKey` = PARTİ ADEDİYLE yeniden üretilmiş
 *    anahtar. `copyPartInto` manuel fiyatı KASITLI olarak kopyalamıyor (kendi
 *    yorumu: "admin onu kaynak teklifin kataloğu ve geçerlilik penceresi için
 *    vermişti"), yani çerçevenin tam olarak dayandığı şeyi söküyor — bu yüzden
 *    burada AÇIKÇA yazılır. Anahtar KOPYALANAMAZ: `partPricingKey` adedi
 *    anahtara katıyor, dolayısıyla anlaşmanın anahtarı parti adedinde TUTMAZ ve
 *    `computeQuote` sessizce canlı katalog fiyatına dönerdi.
 * 3. `status = 'quoted'`: `checkoutBlockers`in `adminPriced` muafiyeti bundan
 *    türüyor. Parça düzeyindeki `qty_over_auto`yu kapatan şey ise GEÇERLİ
 *    MANUEL FİYATTIR (`quote-compute.ts`: `manualValid` → `hasHardBlocker`) —
 *    fark #2 tutmazsa parti büyük adetlerde ÖDENEMEZ hâle gelir.
 * 4. `fxSnapshot` SERBEST BIRAKMA GÜNÜNÜN bültenidir (`requote` ile aynı
 *    seçim). Bağlayıcı tutar ₺'dir ve DONMUŞTUR; döviz rakamı YALNIZ GÖSTERİM
 *    ve YAKLAŞIKTIR (32 Sayılı Karar m.4/g — `quote-currency.ts`). İmza
 *    günündeki kuru üç ay sonra göstermek, müşteriye KİLİTLENMEMİŞ bir rakamı
 *    kilitli gibi sunmak olurdu. `null` ise ikinci kolon hiç çizilmez ve fiyat
 *    KIPIRDAMAZ.
 * 5. `teamId` YOK: `quotes` bugün `team_id` kolonu TAŞIMIYOR (T/0072 bu dalda
 *    birleşmedi). Birleştiğinde tek yer `inheritedQuoteFields`tir.
 *
 * `dfm_ack_key` de KOPYALANMAZ ve bu DOĞRUDUR: uyarı onayı MÜŞTERİNİN
 * kaydıdır, admin onu müşteri adına yazamaz. Üstelik `dfmWarningKey` de adedi
 * anahtara katıyor, yani kopyalamak zaten tutmazdı. Sonuç müşteriye yazılı
 * olarak söylenir: üretim uyarısı olan bir parçada uyarılar HER PARTİDE
 * yeniden onaylanır.
 *
 * `linkOrCopyStoredFile` dosyaları HARDLINK'ler (sıfır disk maliyeti) ve
 * analizi biten parça yeniden ANALİZ EDİLMEZ — klon anında fiyatlı görünür.
 *
 * TANIM KAPISI (gövdenin sonunda): yapılandırma CANLI kaynak parçadan geldiği
 * için yazılan tanım, anlaşmanın `parts_snapshot`ıyla ALAN ALAN karşılaştırılır
 * ve saparsa 409 `framework_part_changed` döner. Kilit yalnız FİYATI değil
 * TANIMI da kapsar; gerekçe kapının başındaki yorumda.
 */
export async function cloneQuoteForFrameworkBatch(
  tx: QuoteCacheTx,
  args: FrameworkBatchCloneArgs
): Promise<FrameworkBatchClone> {
  if (args.lines.length === 0) {
    throw new QuoteServiceError("Partide satır yok.", 400, "no_parts");
  }
  const sourceParts = await tx
    .select()
    .from(quoteParts)
    .where(
      and(eq(quoteParts.quoteId, args.sourceQuote.id), isNull(quoteParts.deletedAt))
    )
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
  const byId = new Map(sourceParts.map((p) => [p.id, p]));

  const wanted: QuotePart[] = [];
  for (const line of args.lines) {
    const part = byId.get(line.partId);
    if (!part) {
      throw new QuoteServiceError(
        "Anlaşmanın kaynak teklifinde bu parça bulunamadı; parti serbest bırakılamaz.",
        409,
        "part_not_found"
      );
    }
    wanted.push(part);
  }
  // R2'nin ucu: saklama süpürmesi kaynak teklifin dosyalarını sildiyse
  // `copyPartInto` hardlink'i kuramaz ve planlı partiler serbest bırakılamaz.
  // Hatayı ADIYLA vermek, ortada yarım bir klon bırakmaktan iyidir.
  if (wanted.some((p) => p.filesPurgedAt !== null)) {
    throw new QuoteServiceError(
      "Anlaşmanın kaynak teklifinin dosyaları saklama süresi dolduğu için silindi; " +
        "parti serbest bırakılamaz.",
      409,
      "files_purged"
    );
  }
  // Çerçeve HİÇBİR parçayı yeniden analiz etmez (kural: klon anında fiyatlı).
  // Analizi bitmemiş bir parça klonlanırsa `analysis_pending` kapısına düşer ve
  // parti ödenemez hâle gelirdi.
  if (
    wanted.some(
      (p) => p.analysisStatus !== "ready" || p.geometry === null || p.canonicalStlKey === null
    )
  ) {
    throw new QuoteServiceError(
      "Anlaşmanın kaynak teklifinde analizi tamamlanmamış parça var; parti serbest bırakılamaz.",
      409,
      "analysis_not_ready"
    );
  }

  const [created] = await tx
    .insert(quotes)
    .values({
      userId: args.userId,
      anonymousId: null,
      status: "quoted",
      leadTier: args.leadTier,
      addonKeys: args.addonKeys,
      pricingSnapshot: args.snapshot,
      snapshotTakenAt: args.snapshotTakenAt,
      fxSnapshot: args.fxSnapshot,
      expiresAt: args.expiresAt,
      sourceQuoteId: args.sourceQuote.id,
      ...inheritedQuoteFields(args.sourceQuote),
    })
    .returning({ id: quotes.id, number: quotes.number });

  let sortOrder = 0;
  for (const [index, line] of args.lines.entries()) {
    const copy = await copyPartInto(tx, created.id, wanted[index]!, sortOrder++, args.snapshot);
    // Anahtar YAZILAN satırın ÇÖZÜLMÜŞ konfigürasyonundan üretilir, kaynak
    // parçanın ham kolonlarından değil: `configForSnapshot` katalogdan kalkmış
    // bir seçeneği varsayılana çekebilir ve o hâlde ham konfigden üretilen
    // anahtar `computeQuote`un okuduğuyla TUTMAZ (manuel fiyat sessizce düşer).
    const [written] = await tx
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.id, copy.partId))
      .limit(1);
    if (!written) {
      throw new QuoteServiceError(
        "Parti parçası yazılamadı; tekrar deneyin.",
        409,
        "part_write_failed"
      );
    }
    const manualPriceKey = partPricingKey(
      {
        sourceSha256: written.sourceSha256,
        config: {
          technologyKey: written.technologyKey,
          materialKey: written.materialKey,
          colorKey: written.colorKey,
          finishKey: written.finishKey,
          layerUm: written.layerUm,
          infillPct: written.infillPct,
          // PARTİ ADEDİ: anahtarın anlaşma adedinden ayrıldığı tek nokta.
          quantity: line.quantity,
          units: written.units,
          scale: written.scale,
          criticalTolerance: written.criticalTolerance,
        },
      },
      args.leadTier
    );
    await tx
      .update(quoteParts)
      .set({
        quantity: line.quantity,
        manualUnitPriceKurus: line.unitKurus,
        manualPriceKey,
        manualPricedAt: args.now,
        manualPricedByEmail: args.pricedByEmail,
        updatedAt: args.now,
      })
      .where(eq(quoteParts.id, copy.partId));
  }

  // Önbellek AYNI işlemde yazılır ve sonucu eşitlik kapısının girdisidir:
  // ikinci bir `computeQuote` çağrısı, kapının sınadığı sayıyla müşteriye
  // gösterilen sayının ayrışmasına kapı açardı.
  const cache = await recomputeQuoteCache(created.id, tx);
  if (!cache) {
    throw new QuoteServiceError("Parti teklifi yazılamadı; tekrar deneyin.", 409, "clone_failed");
  }

  // ─── TANIM KAPISI ─────────────────────────────────────────────────────────
  //
  // Eşitlik kapısı (`frameworkBatchDriftCode`) PARAYI sınıyor ve tam da bu
  // sapmayı GÖREMEZ: yapılandırma kaynak parçadan geldiği için manuel anahtar
  // YAZILAN konfigürasyondan yeniden üretilir ve toplam yine `amount_kurus`a
  // EŞİT çıkar. Yani kaynak parçanın malzemesi imzadan sonra değişirse parti
  // BAŞKA bir ürünü ESKİ kilitli fiyattan üretirdi — müşteri lehine ya da
  // aleyhine, ikisi de anlaşmanın ihlali.
  //
  // Birinci savunma kaynak teklifi salt okunur yapan kapıdır
  // (`QUOTE_FRAMEWORK_SOURCE_REASON`); bu ikinci savunma, tanımı BAŞKA bir
  // yolla (elle SQL, ileride bir admin ucu) değişen anlaşmada serbest
  // bırakmanın SESSİZCE geçmesini engeller. Kıyasın ölçüsü TEK DONDURMA
  // YOLUDUR (`freezeParts`) — anlaşmanın `parts_snapshot`ı da o işlevden
  // doğdu, yani iki taraf aynı gözle ölçülüyor.
  const clonedParts = await tx
    .select()
    .from(quoteParts)
    .where(and(eq(quoteParts.quoteId, created.id), isNull(quoteParts.deletedAt)))
    .orderBy(asc(quoteParts.sortOrder), asc(quoteParts.createdAt));
  const cloneFrozen = freezeParts(args.snapshot, clonedParts, cache.computed);
  const agreedByPartId = new Map(args.partsSnapshot.map((p) => [p.partId, p]));
  for (const [index, line] of args.lines.entries()) {
    const agreed = agreedByPartId.get(line.partId);
    const written = cloneFrozen[index];
    if (!agreed || !written) {
      throw new QuoteServiceError(
        "Parti satırı anlaşmanın donmuş parça tanımıyla eşleşmiyor; parti serbest bırakılamaz.",
        409,
        "framework_part_changed"
      );
    }
    const field = frameworkPartDrift(agreed, written);
    if (field !== null) {
      throw new QuoteServiceError(
        `Anlaşmanın kaynak teklifindeki "${agreed.name}" parçasının yapılandırması ` +
          `anlaşmada donmuş hâlinden farklı (${field}); parti serbest bırakılamaz. ` +
          "Anlaşmanın tanımını geri alın ya da yeni bir anlaşma kurun.",
        409,
        "framework_part_changed"
      );
    }
  }
  return { id: created.id, number: created.number, computed: cache.computed };
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

  // KAYNAK sahipliği takım tekliflerini de kapsar (0072): üye, meslektaşının
  // açtığı takım teklifindeki parçayı kendi teklifine aktarabilir — kütüphane
  // ekranı o parçayı ona ZATEN gösteriyor (`listCustomerParts`) ve
  // göstermediğini aktaramamak değil, gösterdiğini aktaramamak tutarsızlıktır.
  //
  // HEDEF teklife yazma yetkisi BURADAN GELMEZ: `mutateQuote` kilidi ve ucun
  // `forEdit` kapısı onu ayrıca tutuyor, yani takımın `viewer` rolü içe
  // aktaramaz.
  const sourceScope = await teamScope(userId);
  const rows = await db
    .select({ part: quoteParts })
    .from(quoteParts)
    .innerJoin(quotes, eq(quotes.id, quoteParts.quoteId))
    .where(
      and(
        inArray(quoteParts.id, wanted),
        sourceScope.condition,
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

  // Bayrak okuması sunum katmanına DEĞİL buraya düşer (quote-present saf ve
  // senkron kalmalı). Sunucu kapısı (`addPartFromUpload`) ile AYNI işlevden
  // okunur, yani müşteriye seçtirilen biçim ile ucun kabul ettiği biçim
  // ayrışamaz. Maliyet: Redis önbellekli (10 s) bir bayrak okuması.
  const stepEnabled = await stepUploadsEnabled(access.viewer);
  // Aynı gerekçe döviz bayrağı için de geçerli: `presentQuote` SAF ve
  // SENKRONDUR, bayrağı KENDİSİ okuyamaz. DÖRDÜNCÜ BİR SORGU EKLENMEDİ —
  // `quote.fxSnapshot` `quotes` satırının kendi kolonudur ve `access.quote`
  // üzerinden bedava geliyor; eklenen tek şey Redis önbellekli (10 s) bir
  // bayrak okumasıdır.
  const fxDisplayEnabled = await isFlagEnabled("quote_fx_display_enabled");
  // Parti klonu SALT OKUNUR gösterilmeli: ekranın açtığı bir düzenleme düğmesi
  // `demoteQuotedToDraft`e giden yoldur ve anlaşmanın kilitli fiyatını düşürür.
  // Ekran ile uç AYNI cevabı verir (uç tarafı: `assertEditable`).
  const isFrameworkBatch = await quoteIsFrameworkBatch(quote.id);
  // Anlaşmanın KAYNAK teklifi de salt okunur: ekranda açık kalan bir düzenleme
  // düğmesi, ucun 409'uyla biten bir düğmedir (kural motorunun dosya başlığı:
  // "ekranın uygulamadığı bir kuralı ucun yazması buradan imkânsızdır").
  const hasLiveFramework = await quoteHasLiveFramework(quote.id);

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
    // "Katalog güncellendi — yeniden fiyatla" bandı bir ÇAĞRIDIR ve çerçevenin
    // İKİ tarafında da yapılacak bir şey yok: `repriceQuote` hem parti klonunu
    // hem anlaşmanın kaynak teklifini 409 ile REDDEDİYOR (gerekçesi orada) ve
    // fiyat anlaşmayla KİLİTLİDİR. Bandı orada çizmek, müşteriye hiç
    // basamayacağı bir düğme göstermek ve kilitli fiyatı ŞÜPHELİ göstermek
    // olurdu. Damga BOZULMAZ (klon anlaşmanın `snapshot_taken_at`ını taşımaya
    // devam eder — bkz. `cloneQuoteForFrameworkBatch`); susan şey yalnız
    // banttır.
    catalogChanged:
      !isFrameworkBatch &&
      !hasLiveFramework &&
      catalogAt.getTime() > quote.snapshotTakenAt.getTime(),
    now: new Date(),
    sign: getPublicUrl,
    shareBaseUrl: `${appUrl()}/teklif/${quote.number}`,
    stepEnabled,
    fxDisplayEnabled,
    isFrameworkBatch,
    hasLiveFramework,
    // Takım üyeliği ERİŞİM KABUĞUNDA okundu (`resolveQuoteTeam`); burada
    // yalnız geçiriliyor. Dördüncü/beşinci bir sorgu EKLENMEDİ: `access.team`
    // teklifin açılışında zaten elde.
    team: access.team,
  });
}

export async function listCustomerQuotes(
  userId: string,
  page: number
): Promise<{ items: CustomerQuoteListItem[]; hasNext: boolean }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const scope = await teamScope(userId);
  const rows = await db
    .select({
      id: quotes.id,
      number: quotes.number,
      status: quotes.status,
      title: quotes.title,
      // Takım kolonları için JOIN YOK ve olmayacak: bir kullanıcı EN FAZLA BİR
      // takımda (`customer_team_members_user_uq`), yani adı zaten elde olan
      // `scope.team`den okunur; satırda sorulacak tek şey hangi satırın o
      // takıma ait olduğudur. "Kim açtı" ise aşağıda TEK ek sorguyla, yalnız
      // takımı OLAN kullanıcıda çözülür (`partCounts` deseni) — takımsız
      // müşterinin sorgusu bugünkünün birebir kendisi kalsın.
      userId: quotes.userId,
      teamId: quotes.teamId,
      totalKurus: quotes.totalKurus,
      leadDays: quotes.leadDays,
      createdAt: quotes.createdAt,
      updatedAt: quotes.updatedAt,
      expiresAt: quotes.expiresAt,
      // Teklifin KENDİ dondurduğu kur: listedeki tutar, açıldığında teklif
      // sayfasında görünecek rakamla birebir aynı olmalı. Bugünün bülteniyle
      // çevirmek iki ekranda iki farklı sayı demekti. AYNI sorguda geliyor,
      // ek bir okuma yok.
      fxSnapshot: quotes.fxSnapshot,
      orderNumber: orders.orderNumber,
      // ÇERÇEVE ROZETİ: bu teklif bir anlaşmanın partisi mi? LEFT JOIN, çünkü
      // teklifler ezici çoğunlukla parti DEĞİLDİR ve bir `exists` yalnız
      // "evet/hayır" derdi — rozet anlaşma NUMARASINI ve parti SIRASINI
      // yazıyor. Tekillik `quote_framework_batches_quote_id_uq` ile garanti
      // (bir klon teklif = bir parti), yani join satır ÇOĞALTMAZ.
      frameworkNumber: quoteFrameworks.number,
      frameworkBatchPosition: quoteFrameworkBatches.position,
    })
    .from(quotes)
    .leftJoin(orders, eq(quotes.orderId, orders.id))
    .leftJoin(quoteFrameworkBatches, eq(quoteFrameworkBatches.quoteId, quotes.id))
    .leftJoin(quoteFrameworks, eq(quoteFrameworks.id, quoteFrameworkBatches.frameworkId))
    .where(scope.condition)
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

  // Bayrak kapalıyken kur gövdeye HİÇ girmez: tarayıcıda kalmış eski bir
  // "EUR" tercihi listeyi dövize çeviremesin (kapatma yolunun "bütün yüzeyler
  // ₺'ye döner" sözü buraya da bağlı). `loadPresentedQuote` ile aynı okuma,
  // Redis önbellekli.
  const fxDisplayEnabled = await isFlagEnabled("quote_fx_display_enabled");
  // "KİM AÇTI" kolonu YALNIZ takımı olan kullanıcıda doldurulur: takımsız
  // listede kolon hiç çizilmez (tasarım §4) ve bu sorgu da hiç açılmaz.
  const ownerNames = new Map<string, string | null>();
  if (scope.team !== null) {
    const ownerIds = [...new Set(page_.map((q) => q.userId).filter((id): id is string => id !== null))];
    if (ownerIds.length > 0) {
      for (const row of await db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, ownerIds))) {
        ownerNames.set(row.id, row.fullName);
      }
    }
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
      // Takımsız listede İKİSİ DE null ve ekran kolonu hiç çizmez. Takım adı
      // satırın takımı GERÇEKTEN okuyanın takımı iken yazılır: bir kullanıcı
      // tek takımda olduğu için eşitlik yetiyor ve başka bir takımın adı bu
      // listeye hiçbir yoldan giremez.
      teamName: scope.team !== null && q.teamId === scope.team.teamId ? scope.team.team.name : null,
      ownerName: scope.team === null || q.userId === null ? null : ownerNames.get(q.userId) ?? null,
      fxSnapshot: fxDisplayEnabled ? q.fxSnapshot : null,
      // Rozet ya TAM ya HİÇ: numara ve sıra birlikte gelir (ikisi de aynı
      // join'den), yarısı dolu bir rozet "Çerçeve · Parti undefined" yazardı.
      frameworkBatch:
        q.frameworkNumber !== null && q.frameworkBatchPosition !== null
          ? { number: q.frameworkNumber, position: q.frameworkBatchPosition }
          : null,
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
  // HAM SQL: `tsc` burada hiçbir şey ölçmez, kapsam parçası elle yazılır ve
  // vakası testle çivilenir (`scripts/test-quote-service-db.ts`). Takımı
  // olmayan kullanıcıda metin BUGÜNKÜNÜN birebir kendisi: `q.user_id = $1`.
  const { team } = await teamScope(userId);
  const scopeSql =
    team === null
      ? sql`q.user_id = ${userId}`
      : sql`(q.user_id = ${userId} OR q.team_id = ${team.teamId})`;
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
      WHERE ${scopeSql}
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
