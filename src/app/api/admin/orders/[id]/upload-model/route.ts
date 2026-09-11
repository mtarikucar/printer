import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions } from "@/lib/db/schema";
import { deleteFile, saveFile } from "@/lib/services/storage";
import {
  TooManyModelFilesError,
  attachOrderModelFiles,
  type OrderModelFileInput,
} from "@/lib/services/order-model";
import {
  isValidUploadId,
  promoteStagedUpload,
  readStagedHead,
  discardStagedUpload,
  stagedSize,
} from "@/lib/services/chunked-upload";
import {
  MAX_ORDER_MODEL_FILES,
  MODEL_HEAD_BYTES,
  orderModelKindOf,
  verifyModelHead,
  type OrderModelKind,
} from "@/lib/config/order-model";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";
import { REFUNDED_ORDER_ERROR, isRefunded } from "@/lib/config/order-status-policy";
import { notRefundedGuard } from "@/lib/services/manufacturer-assign";

// No size cap: production models are hundreds of megabytes. Files come in
// through the chunked staging API (src/lib/services/chunked-upload.ts) and are
// never held in memory; this POST only carries the staged ids.

/**
 * Admin uploads the model FILES for a paid order — one revision, any number
 * of STL and/or GLB parts (some jobs are 12-13 parts, often a ZIP the browser
 * already expanded). GLB is optional: STL-only and GLB-only are both valid.
 *
 * Body (multipart):
 *   files = JSON [{ uploadId, name }]   ← current client
 *   glbUploadId / stlUploadId / glb / stl ← older single-pair clients, still accepted
 *
 * Every file is checked by its first bytes BEFORE any is promoted: one bad
 * part rejects the whole batch and discards every staged upload, so a revision
 * never goes live with 12 of 13 parts.
 */

type Entry =
  | { source: "staged"; uploadId: string; name: string; kind: OrderModelKind }
  | { source: "inline"; file: File; name: string; kind: OrderModelKind };

// "paid" covers admin-fulfilled WhatsApp orders (marketplace, no seller) that
// were created before they auto-advanced to awaiting_model.
const UPLOADABLE = ["awaiting_model", "approved", "review", "paid"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id: orderId } = await params;
  const formData = await request.formData();

  const entries: Entry[] = [];
  const stagedIds: string[] = [];
  // "Önceki parçaları koru": aynı adlı parça yenisiyle yerinde değişir, diğerleri
  // önceki sürümden aynen taşınır (bkz. mergeRevisionFiles).
  const carryForward = formData.get("carryForward") === "1";
  const fail = async (status: number, error: string) => {
    await Promise.all(stagedIds.map((id) => discardStagedUpload(id).catch(() => {})));
    return NextResponse.json({ error }, { status });
  };

  const rawFiles = formData.get("files");
  if (typeof rawFiles === "string" && rawFiles.trim()) {
    let list: unknown;
    try {
      list = JSON.parse(rawFiles);
    } catch {
      return fail(400, "Geçersiz dosya listesi.");
    }
    if (!Array.isArray(list)) return fail(400, "Geçersiz dosya listesi.");
    // Register every id FIRST so a rejection further down discards them all.
    for (const item of list) {
      const uploadId = String((item as { uploadId?: unknown })?.uploadId ?? "");
      if (isValidUploadId(uploadId)) stagedIds.push(uploadId);
    }
    for (const item of list) {
      const uploadId = String((item as { uploadId?: unknown })?.uploadId ?? "");
      const name = String((item as { name?: unknown })?.name ?? "").slice(0, 300);
      if (!isValidUploadId(uploadId)) return fail(400, "Geçersiz yükleme kimliği.");
      const kind = orderModelKindOf(name);
      if (!kind) return fail(400, `${name || "Dosya"}: yalnız STL ve GLB yüklenebilir.`);
      entries.push({ source: "staged", uploadId, name, kind });
    }
  }

  // Older single-pair clients.
  for (const kind of ["glb", "stl"] as const) {
    const upId = String(formData.get(`${kind}UploadId`) ?? "");
    const file = formData.get(kind);
    if (upId) {
      if (!isValidUploadId(upId)) return fail(400, "Geçersiz yükleme kimliği.");
      stagedIds.push(upId);
      entries.push({ source: "staged", uploadId: upId, name: `model.${kind}`, kind });
    } else if (file instanceof File && file.size > 0) {
      entries.push({ source: "inline", file, name: file.name || `model.${kind}`, kind });
    }
  }

  if (entries.length === 0) return fail(400, "En az bir STL ya da GLB dosyası yükleyin.");
  if (entries.length > MAX_ORDER_MODEL_FILES) {
    return fail(400, `Bir sürümde en fazla ${MAX_ORDER_MODEL_FILES} dosya yüklenebilir.`);
  }

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) return fail(404, d["api.order.notFound"]);
  // A model upload is a forward action (refund-end-state): it advances
  // awaiting_model → approved, the assignable shape. Refused before anything is
  // promoted; `fail` discards the staged parts.
  if (isRefunded(order)) return fail(409, REFUNDED_ORDER_ERROR);
  if (!UPLOADABLE.includes(order.status)) return fail(400, "Sipariş model beklemiyor.");

  // Validate everything before promoting anything.
  const checked: { entry: Entry; sizeBytes: number | null }[] = [];
  for (const e of entries) {
    let size: number | null;
    let head: Uint8Array;
    if (e.source === "staged") {
      size = await stagedSize(e.uploadId);
      if (size === null) return fail(400, `${e.name}: yükleme bulunamadı ya da süresi doldu.`);
      head = await readStagedHead(e.uploadId, MODEL_HEAD_BYTES).catch(() => new Uint8Array(0));
    } else {
      size = e.file.size;
      head = new Uint8Array(await e.file.slice(0, MODEL_HEAD_BYTES).arrayBuffer());
    }
    const verdict = verifyModelHead(e.kind, head, size);
    if (!verdict.ok) return fail(400, `${e.name}: ${verdict.reason}.`);
    checked.push({ entry: e, sizeBytes: size });
  }

  // Disk names are ASCII nanoids; the human name lives in order_model_files.
  //
  // Everything from here on runs AFTER validation. If promotion or the DB write
  // throws (disk full, lock timeout, the merged set exceeding the cap), undo it
  // all: discard what is still staged and delete what was already promoted, so
  // a failed upload leaves neither orphaned files nor a half revision — and the
  // admin gets a readable JSON error instead of an HTML 500 page.
  const dir = `models/${orderId}`;
  const inputs: OrderModelFileInput[] = [];
  let result: Awaited<ReturnType<typeof attachOrderModelFiles>>;
  try {
    for (const { entry: e, sizeBytes } of checked) {
      const diskName = `${nanoid()}.${e.kind}`;
      const key =
        e.source === "staged"
          ? await promoteStagedUpload(e.uploadId, dir, diskName)
          : await saveFile(Buffer.from(await e.file.arrayBuffer()), dir, diskName);
      inputs.push({ key, name: e.name, kind: e.kind, sizeBytes });
    }

    // Revision archiving + the order's live model columns are written by
    // attachOrderModelFiles(), the SAME function the auto-3D worker reaches — the
    // two hands that produce a model must not keep separate copies of this logic.
    // It does not touch orders.status; that stays here.
    result = await attachOrderModelFiles({
      orderId,
      files: inputs,
      carryForward,
      source: "admin_upload",
      uploadedByEmail: a.session.user.email,
    });
  } catch (err) {
    await Promise.all(stagedIds.map((id) => discardStagedUpload(id).catch(() => {})));
    await Promise.all(inputs.map((f) => deleteFile(f.key).catch(() => {})));
    if (err instanceof TooManyModelFilesError) {
      return NextResponse.json(
        {
          error: `Önceki parçalarla birlikte ${err.total} dosya oluyor; bir sürümde en fazla ${MAX_ORDER_MODEL_FILES} dosya olabilir. "Önceki parçaları koru" kutusunu kapatıp tüm seti yükleyin.`,
        },
        { status: 400 }
      );
    }
    console.error("[upload-model] kaydedilemedi", err);
    return NextResponse.json(
      { error: "Dosyalar kaydedilemedi; sipariş değişmedi. Tekrar deneyin." },
      { status: 500 }
    );
  }

  // Advance awaiting_model → approved (only from awaiting_model, so re-uploads
  // on an already-fulfilling order keep its current status).
  const newStatus = order.status === "awaiting_model" ? "approved" : order.status;
  // Refund guard in the write too: a refund that landed while the files were
  // being promoted must not see its order advance. The revision stays attached
  // (files on a refunded order are inert) and is still audited below.
  const [advanced] = await db
    .update(orders)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(and(eq(orders.id, orderId), notRefundedGuard()))
    .returning({ id: orders.id });

  const stl = inputs.filter((f) => f.kind === "stl").length;
  const glb = inputs.length - stl;
  await db.insert(adminActions).values({
    orderId,
    action: "upload_model",
    adminEmail: a.session.user.email,
    notes: `Sürüm ${result.revision}: ${inputs.length} dosya yüklendi (${stl} STL, ${glb} GLB)${
      result.carriedCount > 0 ? `, ${result.carriedCount} parça önceki sürümden taşındı` : ""
    }; toplam ${result.fileCount} dosya`,
  });

  if (!advanced) {
    return NextResponse.json({ error: REFUNDED_ORDER_ERROR }, { status: 409 });
  }

  await emitOrderChanged({
    orderId,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: newStatus,
  });

  return NextResponse.json({
    success: true,
    status: newStatus,
    revision: result.revision,
    fileCount: result.fileCount,
    carriedCount: result.carriedCount,
    modelGlbUrl: result.glbUrl,
  });
}
