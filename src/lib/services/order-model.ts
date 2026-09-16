import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderModelFiles, orderModelRevisions, orders, qcPhotos } from "@/lib/db/schema";
import { getPublicUrl } from "./storage";
import {
  QC_RESET_MANUFACTURER_STATUSES,
  modelUploadStage,
  nextModelSource,
  type ModelUploadStage,
} from "@/lib/config/order-model-policy";
import type { ManufacturerOrderStatus } from "./qc";
import { notRefundedGuard } from "./manufacturer-assign";
import {
  MAX_ORDER_MODEL_FILES,
  dedupeFileNames,
  fallbackModelKey,
  mergeRevisionFiles,
  resolveCurrentRevision,
  revisionLockedByStage,
  safeModelFileName,
  unlinkableKeys,
  type OrderModelKind,
  type RevisionFileLike,
} from "@/lib/config/order-model";

/**
 * Attach a produced 3D model to an order and archive it as a revision.
 *
 * A revision is a SET of files, not one model: some jobs are 12-13 separate
 * parts uploaded as a ZIP. Every file lands in order_model_files; the revision
 * header and the order's live modelGlb / modelStl columns point at the PRIMARY
 * file of each kind (first GLB / first STL) so every single-file consumer that
 * predates multi-part orders keeps working unchanged. GLB is no longer
 * mandatory — an STL-only (print) or GLB-only (viewing) revision is valid.
 *
 * This lives here rather than inside the admin upload route because two hands
 * write models: the admin (manual upload) and the auto-3D worker. If only the
 * route archived revisions, an automatically produced model would be invisible
 * to the revision history.
 *
 * Old files are never deleted; the order's live model columns always point at
 * the newest revision.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */

export interface OrderModelFileInput {
  key: string;
  /** Display / download name as uploaded; sanitised and de-duplicated here. */
  name: string;
  kind: OrderModelKind;
  sizeBytes?: number | null;
}

export interface AttachOrderModelFilesArgs {
  orderId: string;
  files: OrderModelFileInput[];
  /**
   * true → yeni sürüm = önceki sürümün parçaları + yüklenenler; aynı adlı parça
   * yenisiyle YERİNDE değişir (mergeRevisionFiles). false/undefined → yüklenenler
   * tüm setin yerine geçer. Önceki sürüm yoksa fark etmez.
   */
  carryForward?: boolean;
  turntableKey?: string | null;
  source: "meshy_auto" | "admin_upload";
  note?: string;
  uploadedByEmail?: string;
}

export interface AttachOrderModelFilesResult {
  revision: number;
  /** Siparişin ARTIK gösterdiği GLB (sürüm GLB taşımıyorsa önceki korunur). */
  glbUrl: string | null;
  /** Siparişin ARTIK gösterdiği STL (sürüm STL taşımıyorsa önceki korunur). */
  stlUrl: string | null;
  turntableUrl: string | null;
  fileCount: number;
  /** Önceki sürümden aynen taşınan parça sayısı. */
  carriedCount: number;
}

/** Taşınanlarla birlikte sürüm dosya tavanı aşılırsa — route bunu 400'e çevirir. */
export class TooManyModelFilesError extends Error {
  constructor(public readonly total: number) {
    super("TOO_MANY_MODEL_FILES");
  }
}

export async function attachOrderModelFiles(
  args: AttachOrderModelFilesArgs
): Promise<AttachOrderModelFilesResult> {
  if (args.files.length === 0) throw new Error("attachOrderModelFiles: no files");

  const names = dedupeFileNames(args.files.map((f) => safeModelFileName(f.name)));
  const incoming: RevisionFileLike[] = args.files.map((f, i) => ({
    name: names[i],
    kind: f.kind,
    key: f.key,
    sizeBytes: f.sizeBytes ?? null,
  }));
  // Dönme videosu (turntable) YALNIZ çağıran açıkça bir değer verdiğinde yazılır.
  //
  // Eskiden her yükleme `args.turntableKey ?? null` yazıyordu: admin otomatik
  // üretilmiş (meshy_auto) bir siparişe düzeltilmiş dosya yüklediğinde müşterinin
  // onay ekranındaki 360° video SESSİZCE siliniyordu ve onay sayfası boş kalıyordu.
  // `undefined` = "dokunma", `null` = "temizle".
  const touchesTurntable = args.turntableKey !== undefined;
  const turntableKey = args.turntableKey ?? null;

  // One transaction: a revision header without its files (or files pointing at
  // a revision that never got a header) would show the manufacturer a model
  // version that does not exist. The row lock serialises two concurrent
  // uploads on the same order so they cannot both claim revision N+1 — and so
  // a carry-forward merge always reads the revision it is building on.
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        modelGlbKey: orders.modelGlbKey,
        modelGlbUrl: orders.modelGlbUrl,
        modelStlKey: orders.modelStlKey,
        modelStlUrl: orders.modelStlUrl,
        modelUploadedAt: orders.modelUploadedAt,
        // Korunacak alanlar: dönme videosu ve model KAYNAĞI (onay kapısı).
        modelTurntableKey: orders.modelTurntableKey,
        modelTurntableUrl: orders.modelTurntableUrl,
        modelSource: orders.modelSource,
      })
      .from(orders)
      .where(eq(orders.id, args.orderId))
      .limit(1)
      .for("update");
    if (!order) throw new Error(`order ${args.orderId} not found`);

    const [{ maxRev }] = await tx
      .select({
        maxRev: sql<number>`coalesce(max(${orderModelRevisions.revision}), 0)::int`,
      })
      .from(orderModelRevisions)
      .where(eq(orderModelRevisions.orderId, args.orderId));

    let nextRev = (maxRev ?? 0) + 1;

    // Backfill: an order that already carried a model but has no revision rows
    // (uploaded before revisions existed) gets its current model archived first
    // so it is not lost when the new one lands.
    if ((maxRev ?? 0) === 0 && (order.modelGlbKey || order.modelStlKey)) {
      const archivedAt = order.modelUploadedAt ?? new Date();
      await tx.insert(orderModelRevisions).values({
        orderId: args.orderId,
        revision: 1,
        glbKey: order.modelGlbKey,
        glbUrl: order.modelGlbUrl,
        stlKey: order.modelStlKey,
        stlUrl: order.modelStlUrl,
        note: "Önceki model (otomatik arşivlendi)",
        createdAt: archivedAt,
      });
      const legacy: { kind: OrderModelKind; key: string }[] = [];
      if (order.modelGlbKey) legacy.push({ kind: "glb", key: order.modelGlbKey });
      if (order.modelStlKey) legacy.push({ kind: "stl", key: order.modelStlKey });
      await tx.insert(orderModelFiles).values(
        legacy.map((f, i) => ({
          orderId: args.orderId,
          revision: 1,
          kind: f.kind,
          fileKey: f.key,
          fileName: `model.${f.kind}`,
          sortOrder: i,
          createdAt: archivedAt,
        }))
      );
      nextRev = 2;
    }

    // Carry-forward: build on the revision being superseded, inside the same
    // locked transaction so a concurrent upload cannot slip a revision in between.
    let files = incoming;
    let carriedCount = 0;
    if (args.carryForward && nextRev > 1) {
      const prevRows = await tx
        .select()
        .from(orderModelFiles)
        .where(and(eq(orderModelFiles.orderId, args.orderId), eq(orderModelFiles.revision, nextRev - 1)))
        .orderBy(orderModelFiles.sortOrder);
      const previous: RevisionFileLike[] = prevRows.map((r) => ({
        name: r.fileName,
        kind: r.kind as OrderModelKind,
        key: r.fileKey,
        sizeBytes: r.sizeBytes,
      }));
      files = mergeRevisionFiles(previous, incoming);
      const prevKeys = new Set(previous.map((p) => p.key));
      carriedCount = files.filter((f) => prevKeys.has(f.key)).length;
    }
    if (files.length > MAX_ORDER_MODEL_FILES) throw new TooManyModelFilesError(files.length);

    // Primaries come from the FINAL list: a carried GLB keeps the viewer alive
    // when only corrected STL parts were uploaded.
    const primaryGlb = files.find((f) => f.kind === "glb") ?? null;
    const primaryStl = files.find((f) => f.kind === "stl") ?? null;
    const glbUrl = primaryGlb ? getPublicUrl(primaryGlb.key) : null;
    const stlUrl = primaryStl ? getPublicUrl(primaryStl.key) : null;

    // Sürüm BAŞLIĞI sürümün kendi birincil dosyalarını yazar (geçmiş dürüst
    // kalsın), ama siparişin CANLI kolonları sürümün TAŞIMADIĞI türü BOŞALTMAZ
    // — tıpkı dönme videosu gibi: `undefined` = "dokunma".
    //
    // NEDEN: yalnız-STL bir düzeltme (baskı dosyasını düzeltmenin olağan yolu;
    // GLB zaten zorunlu değil) GLB anahtarını null'lasaydı
    // `requiresCustomerModelApproval` false'a düşerdi — müşteri onay KAPISI o
    // kolonu okuyor — ve otomatik üretilmiş (meshy_auto) sipariş, müşteri
    // modeli hiç görmeden onaylanıp üreticiye gönderilirdi. Müşterinin onay
    // sayfası da modelsiz kalırdı. Sürümün getirmediği dosya silinmiş değildir;
    // siparişin o anki dosyası olarak durur (P2A-1).
    const liveGlbKey = primaryGlb?.key ?? order.modelGlbKey;
    const liveStlKey = primaryStl?.key ?? order.modelStlKey;
    const liveGlbUrl = primaryGlb
      ? glbUrl
      : (order.modelGlbUrl ?? (order.modelGlbKey ? getPublicUrl(order.modelGlbKey) : null));
    const liveStlUrl = primaryStl
      ? stlUrl
      : (order.modelStlUrl ?? (order.modelStlKey ? getPublicUrl(order.modelStlKey) : null));

    await tx.insert(orderModelRevisions).values({
      orderId: args.orderId,
      revision: nextRev,
      glbKey: primaryGlb?.key ?? null,
      glbUrl,
      stlKey: primaryStl?.key ?? null,
      stlUrl,
      note: args.note,
      uploadedByEmail: args.uploadedByEmail,
    });

    await tx.insert(orderModelFiles).values(
      files.map((f, i) => ({
        orderId: args.orderId,
        revision: nextRev,
        kind: f.kind,
        fileKey: f.key,
        fileName: f.name,
        sizeBytes: f.sizeBytes ?? null,
        sortOrder: i,
      }))
    );

    const turntableUrl = touchesTurntable
      ? turntableKey
        ? getPublicUrl(turntableKey)
        : null
      : (order.modelTurntableUrl ??
        (order.modelTurntableKey ? getPublicUrl(order.modelTurntableKey) : null));

    await tx
      .update(orders)
      .set({
        modelGlbKey: liveGlbKey,
        modelGlbUrl: liveGlbUrl,
        modelStlKey: liveStlKey,
        modelStlUrl: liveStlUrl,
        ...(touchesTurntable
          ? { modelTurntableKey: turntableKey, modelTurntableUrl: turntableUrl }
          : {}),
        // `meshy_auto` yapışkandır: müşteri onay kapısı bu kolonu okuyor
        // (requiresCustomerModelApproval). Admin düzeltmesi kapıyı düşürmemeli —
        // sürümü kimin yüklediği order_model_revisions.uploaded_by_email'de durur.
        modelSource: nextModelSource(order.modelSource, args.source),
        modelUploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));

    return {
      revision: nextRev,
      glbUrl: liveGlbUrl,
      stlUrl: liveStlUrl,
      turntableUrl,
      fileCount: files.length,
      carriedCount,
    };
  });
}

// ─── Single GLB(+STL) entry point — kept for the auto-3D worker ────────────

export interface AttachOrderModelArgs {
  orderId: string;
  glbKey: string;
  glbUrl?: string;
  stlKey?: string | null;
  stlUrl?: string | null;
  turntableKey?: string | null;
  source: "meshy_auto" | "admin_upload";
  note?: string;
  uploadedByEmail?: string;
}

export interface AttachOrderModelResult {
  revision: number;
  glbUrl: string;
  stlUrl: string | null;
  turntableUrl: string | null;
}

/** The pre-multi-part signature, now a thin wrapper — one code path writes models. */
export async function attachOrderModel(
  args: AttachOrderModelArgs
): Promise<AttachOrderModelResult> {
  const files: OrderModelFileInput[] = [{ key: args.glbKey, name: "model.glb", kind: "glb" }];
  if (args.stlKey) files.push({ key: args.stlKey, name: "model.stl", kind: "stl" });
  const r = await attachOrderModelFiles({
    orderId: args.orderId,
    files,
    turntableKey: args.turntableKey,
    source: args.source,
    note: args.note,
    uploadedByEmail: args.uploadedByEmail,
  });
  return {
    revision: r.revision,
    glbUrl: r.glbUrl ?? getPublicUrl(args.glbKey),
    stlUrl: r.stlUrl,
    turntableUrl: r.turntableUrl,
  };
}

// ─── Reading ───────────────────────────────────────────────────────────────

export type OrderModelFileRow = typeof orderModelFiles.$inferSelect;

/** The newest revision's files, in upload order. Empty for orders without a model. */
export async function latestModelFiles(
  orderId: string
): Promise<{ revision: number | null; files: OrderModelFileRow[] }> {
  const [row] = await db
    .select({ rev: sql<number | null>`max(${orderModelFiles.revision})::int` })
    .from(orderModelFiles)
    .where(eq(orderModelFiles.orderId, orderId));
  if (!row?.rev) return { revision: null, files: [] };
  const files = await db
    .select()
    .from(orderModelFiles)
    .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, row.rev)))
    .orderBy(orderModelFiles.sortOrder);
  return { revision: row.rev, files };
}

/** Files of one specific revision (admin history / ZIP). */
export async function revisionModelFiles(
  orderId: string,
  revision: number
): Promise<OrderModelFileRow[]> {
  return db
    .select()
    .from(orderModelFiles)
    .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, revision)))
    .orderBy(orderModelFiles.sortOrder);
}


// ─── Sürüm yönetimi: hangi sürüm GEÇERLİ, yanlış yükleme nasıl silinir ──────

/**
 * Siparişin ŞU AN geçerli sayılan sürümü: EN YÜKSEK sürüm numarası.
 *
 * "Hangi sürüm geçerli" sorusunun TEK cevabı burasıdır (kural:
 * config/order-model.ts → resolveCurrentRevision). Eskiden cevap siparişin
 * canlı model anahtarlarını sürüm başlıklarıyla EŞLEŞTİREREK aranıyordu; o
 * yöntem "önceki parçaları koru" yüzünden çalışamaz, çünkü taşınan parça aynı
 * dosya anahtarını paylaşır ve bir anahtar birden çok sürümle eşleşir. Geri
 * getirme artık en üste yeni bir sürüm yazdığı için (setCurrentModelRevision)
 * numaranın kendisi doğru cevaptır.
 */
export async function currentModelRevision(orderId: string): Promise<number | null> {
  // Karar KURALI saf modülde (resolveCurrentRevision), sorgu burada. Kuralı
  // buraya SQL olarak yazmak (max(...)) onu testten ve diğer çağıranlardan
  // koparırdı: aynı soruya cevap veren ikinci bir uygulama olurdu.
  const revs = await db
    .select({ revision: orderModelRevisions.revision })
    .from(orderModelRevisions)
    .where(eq(orderModelRevisions.orderId, orderId));
  return resolveCurrentRevision(revs);
}

export interface SetCurrentRevisionResult {
  /** Admin'in geri getirdiği KAYNAK sürüm (ekranda tıkladığı numara). */
  revision: number;
  /** Kaynağın kopyası olarak açılan yeni sürüm; sürüm zaten geçerliyse null. */
  newRevision: number | null;
  /** Çağrıdan sonra siparişin GEÇERLİ sürümü — duyuruda anılması gereken numara. */
  newCurrentRevision: number;
  glbUrl: string | null;
  stlUrl: string | null;
  fileCount: number;
}

/** İstenen sürüm siparişte yok. */
export class ModelRevisionNotFoundError extends Error {
  constructor(public readonly revision: number) {
    super("MODEL_REVISION_NOT_FOUND");
  }
}

/** Sürüm silinemez: o sürümden basılmış fiziksel bir iş birinin elinde. */
export class ModelRevisionInUseError extends Error {
  constructor(
    public readonly manufacturerStatus: string | null,
    /** Politikanın aşaması — üreticisi olmayan (admin'in bastığı) sipariş de buradan görünür. */
    public readonly stage: ModelUploadStage | null = null
  ) {
    super("MODEL_REVISION_IN_USE");
  }
}

/** Geri getirilmek istenen sürümün hiç dosyası yok (bozuk kayıt). */
export class ModelRevisionEmptyError extends Error {
  constructor(public readonly revision: number) {
    super("MODEL_REVISION_EMPTY");
  }
}

/**
 * Eski bir sürümü yeniden GEÇERLİ yapar.
 *
 * NASIL: kaynak sürümün dosya kümesini AYNI dosya anahtarlarıyla EN ÜSTE yeni
 * bir sürüm (N+1) olarak yeniden yayımlar. Diske kopya çıkmaz — yeni sürümün
 * satırları aynı `file_key`leri gösterir; maliyeti birkaç satırdır.
 *
 * NEDEN BÖYLE, "yalnız işaret değiştir" YERİNE: üreticinin indirdiği parça
 * listesi, ZIP ucu, müşterinin dijital dosya indirmesi ve QC damgası — hepsi
 * siparişin EN YÜKSEK sürümünü okur. Yalnız siparişin canlı kolonlarını
 * oynatmak bu yüzeylerin HİÇBİRİNİ değiştirmiyordu: admin ekranı, denetim
 * kaydı ve partner bildirimi "geri alındı" derken üretici terk edilmiş sürümü
 * basmaya devam ediyordu; QC de o terk edilmiş sürümü "güncel" sayıp baskıyı
 * onaylıyordu. Tek kural (en yüksek sürüm geçerlidir) ancak geri getirme de en
 * üste yazarsa işler.
 *
 * Geçmiş dürüst kalır: kaynak sürüm satırı yerinde durur, yeni sürümün notu
 * hangi sürümden geldiğini söyler ve o sürümün QC fotoğrafları kendi
 * numaralarında kalır.
 *
 * Sipariş satırı KİLİTLENİR (`for update`): yükleme yolu da aynı satırı
 * kilitler, böylece iki yol aynı N+1 numarasını iddia edemez.
 */
export async function setCurrentModelRevision(
  orderId: string,
  revision: number,
  opts?: { note?: string | null; uploadedByEmail?: string | null }
): Promise<SetCurrentRevisionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        id: orders.id,
        modelGlbKey: orders.modelGlbKey,
        modelGlbUrl: orders.modelGlbUrl,
        modelStlKey: orders.modelStlKey,
        modelStlUrl: orders.modelStlUrl,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");
    if (!order) throw new Error(`order ${orderId} not found`);

    const revs = await tx
      .select({
        revision: orderModelRevisions.revision,
        glbKey: orderModelRevisions.glbKey,
        stlKey: orderModelRevisions.stlKey,
      })
      .from(orderModelRevisions)
      .where(eq(orderModelRevisions.orderId, orderId))
      .orderBy(orderModelRevisions.revision);
    const source = revs.find((r) => r.revision === revision);
    if (!source) throw new ModelRevisionNotFoundError(revision);
    const current = resolveCurrentRevision(revs) ?? revision;

    const files = await tx
      .select()
      .from(orderModelFiles)
      .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, revision)))
      .orderBy(orderModelFiles.sortOrder);

    // Zaten geçerli olan sürüm: yazacak bir şey yok. Aksi hâlde her tıklama
    // aynı kümeyi bir kez daha yayımlar ve geçmiş kopyalarla şişerdi.
    if (revision === current) {
      return {
        revision,
        newRevision: null,
        newCurrentRevision: current,
        glbUrl: order.modelGlbUrl,
        stlUrl: order.modelStlUrl,
        fileCount: files.length,
      };
    }

    // Dosya satırı olmayan ESKİ bir sürüm (sürüm tablosu dosya tablosundan
    // önce vardı) başlığındaki birincil anahtarlardan kurtarılır. Kurtarılamıyorsa
    // yayımlamayı reddederiz: dosyasız bir "en üst sürüm" üreticinin parça
    // listesini BOŞALTIRDI.
    const carried = files.length
      ? files.map((f, i) => ({
          kind: f.kind as OrderModelKind,
          fileKey: f.fileKey,
          fileName: f.fileName,
          sizeBytes: f.sizeBytes,
          sortOrder: i,
        }))
      : ([
          source.glbKey
            ? { kind: "glb" as OrderModelKind, fileKey: source.glbKey, fileName: "model.glb", sizeBytes: null, sortOrder: 0 }
            : null,
          source.stlKey
            ? { kind: "stl" as OrderModelKind, fileKey: source.stlKey, fileName: "model.stl", sizeBytes: null, sortOrder: 1 }
            : null,
        ].filter((f) => f !== null) as {
          kind: OrderModelKind;
          fileKey: string;
          fileName: string;
          sizeBytes: number | null;
          sortOrder: number;
        }[]);
    if (carried.length === 0) throw new ModelRevisionEmptyError(revision);

    const primaryGlb = carried.find((f) => f.kind === "glb") ?? null;
    const primaryStl = carried.find((f) => f.kind === "stl") ?? null;
    const nextRev = current + 1;
    // Tek zaman damgası: sürüm satırı ile siparişin `model_uploaded_at`i
    // birbirini gösterir (hangi sürümün ne zaman canlıya alındığı okunabilsin).
    const now = new Date();

    await tx.insert(orderModelRevisions).values({
      orderId,
      revision: nextRev,
      glbKey: primaryGlb?.fileKey ?? null,
      glbUrl: primaryGlb ? getPublicUrl(primaryGlb.fileKey) : null,
      stlKey: primaryStl?.fileKey ?? null,
      stlUrl: primaryStl ? getPublicUrl(primaryStl.fileKey) : null,
      note: [`Sürüm ${revision} yeniden geçerli yapıldı`, opts?.note?.trim() || null]
        .filter(Boolean)
        .join(" — ")
        .slice(0, 1000),
      uploadedByEmail: opts?.uploadedByEmail ?? null,
      createdAt: now,
    });
    await tx.insert(orderModelFiles).values(
      carried.map((f) => ({
        orderId,
        revision: nextRev,
        kind: f.kind,
        fileKey: f.fileKey,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        sortOrder: f.sortOrder,
        createdAt: now,
      }))
    );

    // Yüklemedeki kuralın aynısı: hedef sürümün TAŞIMADIĞI tür boşaltılmaz.
    // Yalnız-STL bir sürüme dönmek GLB anahtarını silseydi müşteri onay kapısı
    // sessizce düşerdi (bkz. attachOrderModelFiles, P2A-1).
    const liveGlbKey = primaryGlb?.fileKey ?? order.modelGlbKey;
    const liveStlKey = primaryStl?.fileKey ?? order.modelStlKey;
    const glbUrl = primaryGlb
      ? getPublicUrl(primaryGlb.fileKey)
      : (order.modelGlbUrl ?? (order.modelGlbKey ? getPublicUrl(order.modelGlbKey) : null));
    const stlUrl = primaryStl
      ? getPublicUrl(primaryStl.fileKey)
      : (order.modelStlUrl ?? (order.modelStlKey ? getPublicUrl(order.modelStlKey) : null));

    const [updated] = await tx
      .update(orders)
      .set({
        modelGlbKey: liveGlbKey,
        modelGlbUrl: glbUrl,
        modelStlKey: liveStlKey,
        modelStlUrl: stlUrl,
        modelUploadedAt: now,
        updatedAt: new Date(),
      })
      // İade edilmiş siparişte model işaretini oynatmak da ileri bir işlemdir.
      .where(and(eq(orders.id, orderId), notRefundedGuard()))
      .returning({ id: orders.id });
    // Nöbetçi tuttuysa sürüm satırları da GERİ ALINIR: aksi hâlde siparişin
    // göstermediği bir sürüm en üstte kalır ve üretici onu indirirdi.
    if (!updated) throw new Error(`order ${orderId} refused the revision change (refunded)`);

    return {
      revision,
      newRevision: nextRev,
      newCurrentRevision: nextRev,
      glbUrl,
      stlUrl,
      fileCount: carried.length,
    };
  });
}

export interface DeleteRevisionResult {
  /** Diskten silinebilecek anahtarlar: BAŞKA sürümün taşımadığı dosyalar. */
  deletedKeys: string[];
  /** Silmeden sonra geçerli olan sürüm (hiç kalmadıysa null). */
  newCurrentRevision: number | null;
}

/**
 * Yanlış bir yüklemeyi siler.
 *
 * REDDEDİLDİĞİ yer: silinmek istenen sürüm siparişin GEÇERLİ sürümüyse ve o
 * sürümden basılmış fiziksel bir iş birinin elindeyse. "Baskıda mı" sorusunu
 * politikanın AŞAMASI cevaplar (revisionLockedByStage): üretici durumunu tek
 * başına okuyan eski nöbetçi, admin'in kendi bastığı siparişi (üretici yok,
 * yalnız `orders.status='printing'`) hiç görmüyordu ve o sürüm baskı sürerken
 * silinebiliyordu.
 *
 * Diskteki dosyalar dikkatle seçilir: "önceki parçaları koru" ile açılan
 * sürümler AYNI `file_key`i paylaşır ve siparişin canlı kolonları da BAŞKA bir
 * sürümün dosyasını gösteriyor olabilir (yalnız-STL sürümden sonra GLB önceki
 * sürümden korunur). Bu yüzden yalnız hiçbir yerden gösterilmeyen anahtarlar
 * silinebilir listesine girer (unlinkableKeys). Silme işinin kendisi
 * çağıranındır (route), çünkü depolama hatası veritabanı işlemini geri
 * almamalıdır.
 */
export async function deleteModelRevision(
  orderId: string,
  revision: number
): Promise<DeleteRevisionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select({
        glbKey: orders.modelGlbKey,
        stlKey: orders.modelStlKey,
        // Aşama için politikanın okuduğu ham kolonların tamamı.
        status: orders.status,
        manufacturerStatus: orders.manufacturerStatus,
        painterStatus: orders.painterStatus,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
      .for("update");
    if (!order) throw new Error(`order ${orderId} not found`);

    const revs = await tx
      .select({
        revision: orderModelRevisions.revision,
        glbKey: orderModelRevisions.glbKey,
        stlKey: orderModelRevisions.stlKey,
        createdAt: orderModelRevisions.createdAt,
      })
      .from(orderModelRevisions)
      .where(eq(orderModelRevisions.orderId, orderId))
      .orderBy(orderModelRevisions.revision);
    const target = revs.find((r) => r.revision === revision);
    if (!target) throw new ModelRevisionNotFoundError(revision);

    // Geçerli sürüm = EN YÜKSEK sürüm (tek kural, config/order-model.ts).
    const current = resolveCurrentRevision(revs) ?? target.revision;
    const stage = modelUploadStage(order);
    if (revision === current && revisionLockedByStage(stage)) {
      throw new ModelRevisionInUseError(order.manufacturerStatus, stage);
    }

    const doomed = await tx
      .select({ fileKey: orderModelFiles.fileKey })
      .from(orderModelFiles)
      .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, revision)));
    await tx
      .delete(orderModelFiles)
      .where(and(eq(orderModelFiles.orderId, orderId), eq(orderModelFiles.revision, revision)));
    await tx
      .delete(orderModelRevisions)
      .where(
        and(eq(orderModelRevisions.orderId, orderId), eq(orderModelRevisions.revision, revision))
      );

    // Diskten kaldırılamayacak anahtarlar:
    //  1) hayatta kalan sürümlerin dosya satırları ve başlıkları,
    //  2) siparişin KENDİ canlı kolonları — ama yalnız bu çağrı onları yeniden
    //     yazmayacaksa. GEÇERLİ OLMAYAN bir sürümü silmek canlı kolonlara
    //     dokunmaz; koruma eskiden yalnız "geçerli sürüm" dalının içinde
    //     yaşadığı için, siparişin hâlâ gösterdiği bir dosya (ör. yalnız-STL
    //     sürümden sonra eski sürümden korunan GLB) diskten kaldırılabiliyordu:
    //     sipariş kırık bir modeli göstermeye devam ederdi.
    const survivors = await tx
      .select({ fileKey: orderModelFiles.fileKey })
      .from(orderModelFiles)
      .where(eq(orderModelFiles.orderId, orderId));
    const stillUsed: (string | null)[] = survivors.map((f) => f.fileKey);
    for (const r of revs) {
      if (r.revision === revision) continue;
      stillUsed.push(r.glbKey, r.stlKey);
    }
    if (current !== revision) stillUsed.push(order.glbKey, order.stlKey);

    //  3) BAŞKA BİR SİPARİŞİN gösterdiği dosya.
    //
    // Yukarıdaki sayım yalnız BU siparişe bakıyordu. Oysa aynı depolama
    // anahtarı başka bir siparişin dosya satırında, sürüm başlığında ya da
    // canlı model kolonunda da durabilir (bir siparişin modeli ikinci bir
    // siparişe bağlandığında). Dosyayı o hâlde diskten kaldırmak ÖTEKİ siparişi
    // boş görüntüleyiciye ve "not_ready" müşteri indirmesine düşürür — hiçbir
    // yerde hata çıkmadan, yani sessiz veri kaybı. Fotoğraf tarafı bu soruyu
    // zaten kaydın sahibinden bağımsız soruyor (photo-file-retention.ts →
    // storageKeyReferencedBy: "bu dosyayı gösteren başka bir kayıt var mı");
    // model tarafı da aynı soruyu sorar.
    //
    // Kendi siparişimizin satırları sorgudan DIŞLANIR: onlar yukarıda zaten
    // sayıldı ve siparişin canlı kolonları bu çağrıda yeniden yazılıyor olabilir
    // (geçerli sürüm siliniyorsa), yani "hâlâ gösteriliyor" sayılmamalıdır.
    const doomedKeys = [...new Set(doomed.map((f) => f.fileKey))];
    if (doomedKeys.length > 0) {
      const otherFiles = await tx
        .select({ fileKey: orderModelFiles.fileKey })
        .from(orderModelFiles)
        .where(
          and(
            ne(orderModelFiles.orderId, orderId),
            inArray(orderModelFiles.fileKey, doomedKeys)
          )
        );
      for (const f of otherFiles) stillUsed.push(f.fileKey);

      const otherHeaders = await tx
        .select({
          glbKey: orderModelRevisions.glbKey,
          stlKey: orderModelRevisions.stlKey,
        })
        .from(orderModelRevisions)
        .where(
          and(
            ne(orderModelRevisions.orderId, orderId),
            or(
              inArray(orderModelRevisions.glbKey, doomedKeys),
              inArray(orderModelRevisions.stlKey, doomedKeys)
            )
          )
        );
      for (const h of otherHeaders) stillUsed.push(h.glbKey, h.stlKey);

      const otherLive = await tx
        .select({ glbKey: orders.modelGlbKey, stlKey: orders.modelStlKey })
        .from(orders)
        .where(
          and(
            ne(orders.id, orderId),
            or(
              inArray(orders.modelGlbKey, doomedKeys),
              inArray(orders.modelStlKey, doomedKeys)
            )
          )
        );
      for (const o of otherLive) stillUsed.push(o.glbKey, o.stlKey);
    }

    const deletedKeys = unlinkableKeys(doomedKeys, stillUsed);

    // Geçerli sürüm silindiyse işaret bir öncekine (yoksa boşa) çekilir.
    let newCurrentRevision: number | null = current === revision ? null : current;
    if (current === revision) {
      const remaining = revs.filter((r) => r.revision !== revision);
      const next = remaining[remaining.length - 1] ?? null;
      let glbKey: string | null = null;
      let stlKey: string | null = null;
      let uploadedAt: Date | null = null;
      if (next) {
        const files = await tx
          .select()
          .from(orderModelFiles)
          .where(
            and(
              eq(orderModelFiles.orderId, orderId),
              eq(orderModelFiles.revision, next.revision)
            )
          )
          .orderBy(orderModelFiles.sortOrder);
        // Geri düşülen sürümün ne gösterdiği SIRAYLA sorulur (fallbackModelKey):
        // o sürümün kendi dosya satırı → sürüm BAŞLIĞININ anahtarı → siparişin
        // o anki canlı anahtarı; hiçbiri az önce diskten kaldırılmış olamaz.
        //
        // NEDEN BAŞLIK ADIMI VAR: dosya satırı olmayan ESKİ sürümler duruyor
        // (sürüm tablosu 0031, dosya tablosu 0053). Geri düşülen sürüm
        // onlardan biriyse dosya araması boş döner; eskiden geriye tek aday
        // siparişin canlı anahtarı kalıyordu, o da SİLİNEN sürümün dosyasını
        // gösterdiği için az önce unlink edilmişti — yani hâlâ kullanılabilir
        // bir sürüm dururken siparişin modeli null'lanıyordu (boş
        // görüntüleyici, müşteri indirmesinde not_ready). setCurrentModelRevision
        // aynı eski biçimi başlıktan zaten kurtarıyor; silme yolu kurtarmıyordu.
        const unlinked = new Set(deletedKeys);
        glbKey = fallbackModelKey(
          [files.find((f) => f.kind === "glb")?.fileKey, next.glbKey, order.glbKey],
          unlinked
        );
        stlKey = fallbackModelKey(
          [files.find((f) => f.kind === "stl")?.fileKey, next.stlKey, order.stlKey],
          unlinked
        );
        uploadedAt = next.createdAt;
        newCurrentRevision = next.revision;
      }
      const [repointed] = await tx
        .update(orders)
        .set({
          modelGlbKey: glbKey,
          modelGlbUrl: glbKey ? getPublicUrl(glbKey) : null,
          modelStlKey: stlKey,
          modelStlUrl: stlKey ? getPublicUrl(stlKey) : null,
          modelUploadedAt: uploadedAt,
          updatedAt: new Date(),
        })
        .where(and(eq(orders.id, orderId), notRefundedGuard()))
        .returning({ id: orders.id });
      // Nöbetçi TUTTUYSA sessizce geçilmez: fırlat, işlem geri alınsın.
      //
      // NEDEN: iade, bu işlem satırı `for update` ile kilitlemeden hemen önce
      // işlenmiş olabilir. Sonucu okunmadığında sürüm satırları silinmiş,
      // çağıran rota dönen `deletedKeys`i diskten kaldırmış, ama siparişin
      // canlı kolonları hâlâ o kaldırılan dosyaları gösteriyor olurdu:
      // KULLANIMDAKİ dosyanın unlink edilmesi — bu fonksiyonun (unlinkableKeys
      // ile) önlemek için var olduğu kaybın ta kendisi. Fırlatmak satırları
      // geri getirir ve rota henüz hiçbir dosyaya dokunmamıştır. Kardeş
      // setCurrentModelRevision aynı nöbetçiyi aynı şekilde okur; ikisinin
      // ayrışması bu kaybı yalnız bu dalda bırakıyordu.
      if (!repointed) {
        throw new Error(`order ${orderId} refused the revision delete (refunded)`);
      }
    }

    return { deletedKeys, newCurrentRevision };
  });
}

// ─── QC sıfırlama: yeni sürüm, eski baskıyı geçersiz kılar ─────────────────

export interface QcResetResult {
  /** Sıfırlama GERÇEKTEN uygulandı mı (yarışı kaybetmiş olabilir). */
  qcReset: boolean;
  /** Sıfırlama sonrası QC turu. */
  qcRound: number | null;
  /** Reddedilen bekleyen QC fotoğrafı sayısı. */
  rejectedPhotos: number;
}

/**
 * O turun BEKLEYEN QC fotoğraflarını reddeder. Hem admin'in QC reddi hem yeni
 * bir model sürümünün açtığı sıfırlama aynı kuralı uygular: "incelenen turun
 * bekleyen fotoğrafları reddedilir, yeni yüklemeler artmış tura düşer".
 * Kuralın iki kopyası ayrışırsa bir tarafta eski fotoğraflar `pending` kalır ve
 * QC kuyruğunda hayalet satır olur.
 */
export async function rejectPendingQcPhotos(
  orderId: string,
  round: number
): Promise<number> {
  const rows = await db
    .update(qcPhotos)
    .set({ reviewStatus: "rejected" })
    .where(
      and(
        eq(qcPhotos.orderId, orderId),
        eq(qcPhotos.round, round),
        eq(qcPhotos.reviewStatus, "pending")
      )
    )
    .returning({ id: qcPhotos.id });
  return rows.length;
}

/**
 * Yeni bir model sürümü yüklendiğinde QC'yi sıfırlar: tur artar, üretici
 * `printing`e döner, o ana kadarki bekleyen QC fotoğrafları reddedilir.
 *
 * KARGOYA KARŞI ATOMİK. Üreticinin kargo rotası `manufacturerStatus =
 * 'qc_approved'` şartıyla TEK koşullu UPDATE yazıyor; buradaki UPDATE de aynı
 * satırı kilitleyerek o değeri `printing`e çeviriyor. İkisi aynı satırda
 * sıralanır: sıfırlama önce girerse kargonun WHERE'i artık eşleşmez ve ESKİ
 * modelin baskısı yola çıkamaz; kargo önce girerse durum `shipped` olur, bu
 * UPDATE hiçbir satır bulmaz ve `qcReset:false` döner — çağıran da admin'e
 * "sipariş kargolandı, yükleme yalnız kayda geçti" diyebilir. Ayrı bir ön okuma
 * + sonra yazma bu garantiyi veremezdi.
 *
 * `notRefundedGuard()`: iade edilmiş siparişte üretimi yeniden başlatmak ileri
 * bir işlemdir.
 */
export async function resetQcForNewRevision(orderId: string): Promise<QcResetResult> {
  const [updated] = await db
    .update(orders)
    .set({
      manufacturerStatus: "printing",
      // Sipariş durumu da geri alınır: submit-qc onu `quality_check` yapmıştı,
      // orada bırakmak müşteriye bitmiş gibi görünen bir aşama gösterirdi.
      status: "printing",
      qcRound: sql`${orders.qcRound} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(orders.id, orderId),
        inArray(
          orders.manufacturerStatus,
          QC_RESET_MANUFACTURER_STATUSES as readonly ManufacturerOrderStatus[] as ManufacturerOrderStatus[]
        ),
        notRefundedGuard()
      )
    )
    .returning({ qcRound: orders.qcRound });

  if (!updated) return { qcReset: false, qcRound: null, rejectedPhotos: 0 };
  // Artmış turun BİR ÖNCEKİ turu incelenen turdur.
  const rejectedPhotos = await rejectPendingQcPhotos(orderId, updated.qcRound - 1);
  return { qcReset: true, qcRound: updated.qcRound, rejectedPhotos };
}
