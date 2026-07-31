import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { orders, adminActions, orderModelRevisions } from "@/lib/db/schema";
import { saveFile, getPublicUrl } from "@/lib/services/storage";
import {
  isValidUploadId,
  promoteStagedUpload,
  readStagedHead,
  discardStagedUpload,
} from "@/lib/services/chunked-upload";
import { nanoid } from "nanoid";
import { getRequestLocale } from "@/lib/i18n/get-request-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { emitOrderChanged } from "@/lib/realtime/emit";

// No size cap: production models are hundreds of megabytes. Large files come
// in through the chunked staging API (src/lib/services/chunked-upload.ts) and
// are never held in memory — the small multipart path below stays for small
// files and older clients.

// Admin uploads the manually-produced 3D model for a paid custom order. In the
// image-first flow there is NO automatic 3D — a paid order sits in
// `awaiting_model` until the admin sculpts + uploads the print model here, which
// advances it to `approved` (ready for self-fulfilment or manufacturer assign).
// Re-uploads on an already-approved/review order just replace the file.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = getRequestLocale(request);
  const d = getDictionary(locale);

  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id: orderId } = await params;

  const formData = await request.formData();
  const glbFile = formData.get("glb") as File | null;
  const stlFile = formData.get("stl") as File | null;
  // Chunk-staged uploads: the bytes are already on disk, the form only carries
  // the id. This is how a 350 MB model gets here without a 700 MB heap spike.
  const glbUploadId = String(formData.get("glbUploadId") ?? "");
  const stlUploadId = String(formData.get("stlUploadId") ?? "");

  if (!glbFile && !glbUploadId) {
    return NextResponse.json({ error: "Missing glb file" }, { status: 400 });
  }
  if (glbUploadId && !isValidUploadId(glbUploadId)) {
    return NextResponse.json({ error: "Geçersiz yükleme kimliği." }, { status: 400 });
  }
  if (stlUploadId && !isValidUploadId(stlUploadId)) {
    return NextResponse.json({ error: "Geçersiz yükleme kimliği." }, { status: 400 });
  }

  const order = await db.query.orders.findFirst({ where: eq(orders.id, orderId) });
  if (!order) {
    return NextResponse.json({ error: d["api.order.notFound"] }, { status: 404 });
  }
  // "paid" covers admin-fulfilled WhatsApp orders (marketplace, no seller) that
  // were created before they auto-advanced to awaiting_model — the admin can
  // still attach a model, which moves them to approved for assignment.
  const uploadable = ["awaiting_model", "approved", "review", "paid"];
  if (!uploadable.includes(order.status)) {
    return NextResponse.json(
      { error: "Order is not awaiting a model" },
      { status: 400 },
    );
  }

  // Validate the GLB header (glTF magic bytes: 0x67 0x6C 0x54 0x46 = "glTF").
  // For a staged file only the first bytes are read — never the whole model.
  const glbHead = glbUploadId
    ? await readStagedHead(glbUploadId, 4).catch(() => Buffer.alloc(0))
    : Buffer.from(await glbFile!.slice(0, 4).arrayBuffer());
  if (
    glbHead.length < 4 ||
    glbHead[0] !== 0x67 ||
    glbHead[1] !== 0x6c ||
    glbHead[2] !== 0x54 ||
    glbHead[3] !== 0x46
  ) {
    if (glbUploadId) await discardStagedUpload(glbUploadId).catch(() => {});
    return NextResponse.json({ error: "Invalid GLB file" }, { status: 400 });
  }

  const glbName = `model-${nanoid()}.glb`;
  const glbKey = glbUploadId
    ? await promoteStagedUpload(glbUploadId, `models/${orderId}`, glbName)
    : await saveFile(
        Buffer.from(await glbFile!.arrayBuffer()),
        `models/${orderId}`,
        glbName
      );
  const glbUrl = getPublicUrl(glbKey);

  let stlKey: string | null = null;
  let stlUrl: string | null = null;
  if (stlUploadId) {
    stlKey = await promoteStagedUpload(
      stlUploadId,
      `models/${orderId}`,
      `model-${nanoid()}.stl`
    );
    stlUrl = getPublicUrl(stlKey);
  } else if (stlFile) {
    const stlBuffer = Buffer.from(await stlFile.arrayBuffer());
    stlKey = await saveFile(stlBuffer, `models/${orderId}`, `model-${nanoid()}.stl`);
    stlUrl = getPublicUrl(stlKey);
  }

  // Preserve every uploaded model as a revision — old files are NEVER deleted,
  // so the admin can always download an earlier STL. The order's live
  // modelGlb*/modelStl* columns always point at the latest revision.
  const [{ maxRev }] = await db
    .select({ maxRev: sql<number>`coalesce(max(${orderModelRevisions.revision}), 0)::int` })
    .from(orderModelRevisions)
    .where(eq(orderModelRevisions.orderId, orderId));
  let nextRev = (maxRev ?? 0) + 1;
  // Backfill: an order that already had a model but no revision rows yet (uploaded
  // before this feature) gets its existing model archived as revision 1 so it
  // isn't lost when the new one lands.
  if ((maxRev ?? 0) === 0 && order.modelGlbKey && order.modelGlbUrl) {
    await db.insert(orderModelRevisions).values({
      orderId,
      revision: 1,
      glbKey: order.modelGlbKey,
      glbUrl: order.modelGlbUrl,
      stlKey: order.modelStlKey,
      stlUrl: order.modelStlUrl,
      note: "Önceki model (otomatik arşivlendi)",
      createdAt: order.modelUploadedAt ?? new Date(),
    });
    nextRev = 2;
  }
  await db.insert(orderModelRevisions).values({
    orderId,
    revision: nextRev,
    glbKey,
    glbUrl,
    stlKey,
    stlUrl,
    uploadedByEmail: a.session.user.email,
  });

  // Advance awaiting_model → approved (only from awaiting_model, so re-uploads
  // on an already-fulfilling order keep its current status).
  const newStatus = order.status === "awaiting_model" ? "approved" : order.status;
  await db
    .update(orders)
    .set({
      modelGlbKey: glbKey,
      modelGlbUrl: glbUrl,
      modelStlKey: stlKey,
      modelStlUrl: stlUrl,
      modelUploadedAt: new Date(),
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  await db.insert(adminActions).values({
    orderId,
    action: "upload_model",
    adminEmail: a.session.user.email,
    notes: stlUrl ? "Uploaded GLB + STL model" : "Uploaded GLB model",
  });

  await emitOrderChanged({
    orderId,
    orderNumber: order.orderNumber,
    userId: order.userId,
    manufacturerId: order.manufacturerId,
    status: newStatus,
  });

  return NextResponse.json({ success: true, status: newStatus, modelGlbUrl: glbUrl });
}
