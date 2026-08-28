import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderModelRevisions, orders } from "@/lib/db/schema";
import { getPublicUrl } from "./storage";

/**
 * Attach a produced 3D model to an order and archive it as a revision.
 *
 * This lives here rather than inside the admin upload route because two hands
 * now write models: the admin (manual GLB upload) and the auto-3D worker. If
 * only the route archived revisions, an automatically produced model would be
 * invisible to the revision history — and the NEXT manual upload would archive
 * it under the misleading note "Önceki model (otomatik arşivlendi)".
 *
 * Old files are never deleted; the order's live model columns always point at
 * the newest revision.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */
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

export async function attachOrderModel(
  args: AttachOrderModelArgs
): Promise<AttachOrderModelResult> {
  const [order] = await db
    .select({
      modelGlbKey: orders.modelGlbKey,
      modelGlbUrl: orders.modelGlbUrl,
      modelStlKey: orders.modelStlKey,
      modelStlUrl: orders.modelStlUrl,
      modelUploadedAt: orders.modelUploadedAt,
    })
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .limit(1);
  if (!order) throw new Error(`order ${args.orderId} not found`);

  const glbUrl = args.glbUrl ?? getPublicUrl(args.glbKey);
  const stlKey = args.stlKey ?? null;
  const stlUrl = stlKey ? (args.stlUrl ?? getPublicUrl(stlKey)) : null;
  const turntableKey = args.turntableKey ?? null;
  const turntableUrl = turntableKey ? getPublicUrl(turntableKey) : null;

  const [{ maxRev }] = await db
    .select({
      maxRev: sql<number>`coalesce(max(${orderModelRevisions.revision}), 0)::int`,
    })
    .from(orderModelRevisions)
    .where(eq(orderModelRevisions.orderId, args.orderId));

  let nextRev = (maxRev ?? 0) + 1;

  // Backfill: an order that already carried a model but has no revision rows
  // (uploaded before revisions existed) gets its current model archived first
  // so it is not lost when the new one lands.
  if ((maxRev ?? 0) === 0 && order.modelGlbKey && order.modelGlbUrl) {
    await db.insert(orderModelRevisions).values({
      orderId: args.orderId,
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
    orderId: args.orderId,
    revision: nextRev,
    glbKey: args.glbKey,
    glbUrl,
    stlKey,
    stlUrl,
    note: args.note,
    uploadedByEmail: args.uploadedByEmail,
  });

  await db
    .update(orders)
    .set({
      modelGlbKey: args.glbKey,
      modelGlbUrl: glbUrl,
      modelStlKey: stlKey,
      modelStlUrl: stlUrl,
      modelTurntableKey: turntableKey,
      modelTurntableUrl: turntableUrl,
      modelSource: args.source,
      modelUploadedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, args.orderId));

  return { revision: nextRev, glbUrl, stlUrl, turntableUrl };
}
