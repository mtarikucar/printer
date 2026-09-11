import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderModelFiles, orderModelRevisions, orders } from "@/lib/db/schema";
import { getPublicUrl } from "./storage";
import {
  MAX_ORDER_MODEL_FILES,
  dedupeFileNames,
  mergeRevisionFiles,
  safeModelFileName,
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
  glbUrl: string | null;
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
  const turntableKey = args.turntableKey ?? null;
  const turntableUrl = turntableKey ? getPublicUrl(turntableKey) : null;

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

    await tx
      .update(orders)
      .set({
        modelGlbKey: primaryGlb?.key ?? null,
        modelGlbUrl: glbUrl,
        modelStlKey: primaryStl?.key ?? null,
        modelStlUrl: stlUrl,
        modelTurntableKey: turntableKey,
        modelTurntableUrl: turntableUrl,
        modelSource: args.source,
        modelUploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, args.orderId));

    return {
      revision: nextRev,
      glbUrl,
      stlUrl,
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
