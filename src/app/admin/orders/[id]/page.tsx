export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, orderModelRevisions, generationAttempts, meshReports, adminActions, adminMessages, manufacturers, manufacturerActions, qcPhotos, qcReviews, painters, painterActions, painterEarnings, painterQcPhotos, painterQcReviews } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { OrderDetailClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { rankForOrderWithShadow } from "@/lib/services/manufacturer-assignment-shadow";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";

export default async function AdminOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weights?: string }>;
}) {
  const { id } = await params;
  const { weights: weightsParam } = await searchParams;
  const locale = await getLocale();
  // Q7 escape hatch — admin can append ?weights=v1 or ?weights=v2 to
  // see the ranked list under a specific profile regardless of canary
  // percent. Skips evaluation logging.
  const forceProfile =
    weightsParam === "v1" || weightsParam === "v2" ? weightsParam : undefined;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      photos: true,
      modelRevisions: {
        orderBy: [desc(orderModelRevisions.revision)],
      },
      generationAttempts: {
        orderBy: [desc(generationAttempts.createdAt)],
        with: {
          meshReports: true,
        },
      },
      adminActions: {
        orderBy: [desc(adminActions.createdAt)],
      },
      messages: {
        orderBy: [desc(adminMessages.sentAt)],
      },
      manufacturer: true,
      painter: true,
      manufacturerActions: {
        orderBy: [desc(manufacturerActions.createdAt)],
      },
      qcPhotos: {
        orderBy: [desc(qcPhotos.createdAt)],
      },
      qcReviews: {
        orderBy: [desc(qcReviews.createdAt)],
      },
      preview: true,
    },
  });

  if (!order) notFound();

  // Query active manufacturers for the assignment dropdown
  const activeManufacturers = await db.query.manufacturers.findMany({
    where: sql`${manufacturers.status} = 'active'`,
    columns: { id: true, companyName: true },
  });

  // ─── Painting side ───────────────────────────────────────────────────────
  // Queried separately rather than through `with:` because orders has no
  // relation to these three tables, and adding one just to read them here
  // would be schema churn for a page-local need.
  //
  // Only fetched for orders that actually involve a painter — an ordinary print
  // job pays nothing for this.
  const paintingRelevant = order.needsPainting || !!order.painterId;

  const [painterActionLog, painterQc, painterQcDecisions, painterEarning] =
    paintingRelevant
      ? await Promise.all([
          db
            .select()
            .from(painterActions)
            .where(eq(painterActions.orderId, id))
            .orderBy(desc(painterActions.createdAt)),
          db
            .select()
            .from(painterQcPhotos)
            .where(eq(painterQcPhotos.orderId, id))
            .orderBy(desc(painterQcPhotos.createdAt)),
          db
            .select()
            .from(painterQcReviews)
            .where(eq(painterQcReviews.orderId, id))
            .orderBy(desc(painterQcReviews.createdAt)),
          db.query.painterEarnings.findFirst({
            where: eq(painterEarnings.orderId, id),
          }),
        ])
      : [[], [], [], undefined];

  // Painters the admin can hand this job to. Capacity is computed here (not in
  // the browser) so the dropdown can grey out a full shop instead of letting
  // the admin pick one and eat a 409.
  const declinedPainterIds = Array.isArray(order.declinedPainterIds)
    ? (order.declinedPainterIds as string[])
    : [];
  const painterCandidates = paintingRelevant
    ? await (async () => {
        const rows = await db
          .select({
            id: painters.id,
            companyName: painters.companyName,
            contactPerson: painters.contactPerson,
            phone: painters.phone,
            status: painters.status,
            acceptingOrders: painters.acceptingOrders,
            maxConcurrentOrders: painters.maxConcurrentOrders,
          })
          .from(painters)
          .where(eq(painters.status, "active"))
          .orderBy(painters.companyName);
        if (rows.length === 0) return [];
        const loads = await db
          .select({
            painterId: orders.painterId,
            load: sql<number>`count(*)::int`,
          })
          .from(orders)
          .where(
            and(
              sql`${orders.painterId} IS NOT NULL`,
              inArray(orders.painterStatus, [...ACTIVE_PAINTER_ORDER_STATUSES])
            )
          )
          .groupBy(orders.painterId);
        const loadMap = new Map(loads.map((l) => [l.painterId, l.load]));
        return rows.map((p) => {
          const currentLoad = loadMap.get(p.id) ?? 0;
          const declined = declinedPainterIds.includes(p.id);
          return {
            id: p.id,
            companyName: p.companyName,
            contactPerson: p.contactPerson,
            phone: p.phone,
            currentLoad,
            maxConcurrentOrders: p.maxConcurrentOrders,
            acceptingOrders: p.acceptingOrders,
            declined,
            eligible:
              p.acceptingOrders &&
              !declined &&
              currentLoad < p.maxConcurrentOrders,
          };
        });
      })()
    : [];

  // Names for the "already refused this job" list — an id tells the admin nothing.
  const declinedPainters =
    declinedPainterIds.length > 0
      ? await db
          .select({ id: painters.id, companyName: painters.companyName })
          .from(painters)
          .where(inArray(painters.id, declinedPainterIds))
      : [];

  // Rank candidates for the assignment recommendation UI. Goes through
  // the Q7 shadow wrapper which logs both v1/v2 winners and returns the
  // authoritative one (v1 until canary expands). ?weights=v1|v2 query
  // param bypasses canary for admin diagnostics.
  const candidates = await rankForOrderWithShadow(id, forceProfile);

  const latestGeneration = order.generationAttempts.find(
    (g) => g.status === "succeeded"
  );
  const latestReport = latestGeneration?.meshReports?.[0];

  // Serialize everything for client component
  const serialized = {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      // Revoke guards: a marketplace seller order can only be printed by its
      // owner, and an order already with a painter must not be pulled back.
      sellerManufacturerId: order.sellerManufacturerId,
      painterStatus: order.painterStatus,
      // Painting economics — the "revoke from painter" panel warns which
      // print-portion earning (amountKurus − paintingPriceKurus) gets reversed.
      needsPainting: order.needsPainting,
      paintingPriceKurus: order.paintingPriceKurus,
      productTitleSnapshot: order.productTitleSnapshot,
      email: order.email,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      material: order.material,
      finish: order.finish,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
      // Technical spec shown to the manufacturer; editable from this page.
      selectedOptions: (order.selectedOptions ?? []).map((o) => ({
        groupName: o.groupName,
        choiceName: o.choiceName,
      })),
      shippingAddress: order.shippingAddress as TurkishAddress | null,
      status: order.status,
      amountKurus: order.amountKurus,
      giftCardAmountKurus: order.giftCardAmountKurus,
      paidAt: order.paidAt?.toISOString() ?? null,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      trackingNumber: order.trackingNumber,
      adminNotes: order.adminNotes,
      failureReason: order.failureReason,
      retryCount: order.retryCount,
      createdAt: order.createdAt.toISOString(),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      havaleDiscountKurus: order.havaleDiscountKurus,
      bankTransferReceiptUrl: order.draftId
        ? `/api/admin/orders/${order.id}/receipt`
        : null,
      customerNote: order.customerNote,
      modelGlbKey: order.modelGlbKey,
      modelGlbUrl: normalizeFileUrl(order.modelGlbUrl),
      modelStlKey: order.modelStlKey,
      modelStlUrl: normalizeFileUrl(order.modelStlUrl),
      modelUploadedAt: order.modelUploadedAt?.toISOString() ?? null,
    },
    approvedImageUrl: order.preview
      ? normalizeFileUrl(order.preview.selectedStyledImageUrl)
      : null,
    photos: order.photos.map(p => ({
      id: p.id,
      originalUrl: normalizeFileUrl(p.originalUrl) ?? p.originalUrl,
      thumbnailUrl: normalizeFileUrl(p.thumbnailUrl),
    })),
    modelRevisions: order.modelRevisions.map((r) => ({
      id: r.id,
      revision: r.revision,
      glbUrl: normalizeFileUrl(r.glbUrl),
      stlUrl: normalizeFileUrl(r.stlUrl),
      uploadedByEmail: r.uploadedByEmail,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
    latestGeneration: latestGeneration ? {
      id: latestGeneration.id,
      provider: latestGeneration.provider,
      status: latestGeneration.status,
      outputGlbUrl: normalizeFileUrl(latestGeneration.outputGlbUrl),
      outputStlUrl: normalizeFileUrl(latestGeneration.outputStlUrl),
      costCents: latestGeneration.costCents,
      durationMs: latestGeneration.durationMs,
      createdAt: latestGeneration.createdAt.toISOString(),
    } : null,
    latestReport: latestReport ? {
      isWatertight: latestReport.isWatertight,
      isVolume: latestReport.isVolume,
      vertexCount: latestReport.vertexCount,
      faceCount: latestReport.faceCount,
      componentCount: latestReport.componentCount,
      boundingBox: latestReport.boundingBox,
      baseAdded: latestReport.baseAdded,
      repairsApplied: latestReport.repairsApplied as string[] | null,
    } : null,
    generationAttempts: order.generationAttempts.map(a => ({
      id: a.id,
      provider: a.provider,
      status: a.status,
      outputGlbUrl: normalizeFileUrl(a.outputGlbUrl),
      outputStlUrl: normalizeFileUrl(a.outputStlUrl),
      errorMessage: a.errorMessage,
      costCents: a.costCents,
      durationMs: a.durationMs,
      createdAt: a.createdAt.toISOString(),
    })),
    adminActions: order.adminActions.map(a => ({
      id: a.id,
      action: a.action,
      adminEmail: a.adminEmail,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    adminMessages: order.messages.map(m => ({
      id: m.id,
      subject: m.subject,
      body: m.body,
      templateKey: m.templateKey,
      adminEmail: m.adminEmail,
      sentAt: m.sentAt.toISOString(),
    })),
    manufacturer: order.manufacturer ? {
      id: order.manufacturer.id,
      companyName: order.manufacturer.companyName,
      contactPerson: order.manufacturer.contactPerson,
      status: order.manufacturer.status,
    } : null,
    painter: order.painter ? {
      id: order.painter.id,
      companyName: order.painter.companyName,
      contactPerson: order.painter.contactPerson,
      phone: order.painter.phone,
      email: order.painter.email,
      status: order.painter.status,
      acceptingOrders: order.painter.acceptingOrders,
    } : null,
    // ─── Everything the painting side of this order is doing ───
    painting: {
      needsPainting: order.needsPainting,
      paintingPriceKurus: order.paintingPriceKurus,
      painterStatus: order.painterStatus,
      qcRound: order.painterQcRound,
      assignedAt: order.assignedToPainterAt?.toISOString() ?? null,
      sentAt: order.sentToPainterAt?.toISOString() ?? null,
      receivedAt: order.receivedByPainterAt?.toISOString() ?? null,
      handoffCarrier: order.painterHandoffCarrier,
      handoffTrackingNumber: order.painterHandoffTrackingNumber,
      // What the painter is owed for this job, once it has accrued.
      earning: painterEarning
        ? {
            grossKurus: painterEarning.grossKurus,
            netKurus: painterEarning.netKurus,
            commissionKurus: painterEarning.commissionKurus,
            status: painterEarning.status,
          }
        : null,
      actions: painterActionLog.map((x) => ({
        id: x.id,
        action: x.action,
        notes: x.notes,
        createdAt: x.createdAt.toISOString(),
      })),
      // Only the live round — earlier rounds are superseded by a reject.
      qcPhotos: painterQc
        .filter((p) => p.round === order.painterQcRound)
        .map((p) => ({
          id: p.id,
          url: getPublicUrl(p.storageKey),
          reviewStatus: p.reviewStatus,
        })),
      qcReviews: painterQcDecisions.map((r) => ({
        id: r.id,
        round: r.round,
        decision: r.decision,
        reason: r.reason,
        adminEmail: r.adminEmail,
        createdAt: r.createdAt.toISOString(),
      })),
      candidates: painterCandidates,
      declined: declinedPainters,
    },
    manufacturerActions: order.manufacturerActions.map(a => ({
      id: a.id,
      action: a.action,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    manufacturerStatus: order.manufacturerStatus,
    qcRound: order.qcRound,
    qcPhotos: order.qcPhotos
      .filter((p) => p.round === order.qcRound)
      .map((p) => ({
        id: p.id,
        url: getPublicUrl(p.storageKey),
        reviewStatus: p.reviewStatus,
      })),
    qcReviews: order.qcReviews.map((r) => ({
      id: r.id,
      round: r.round,
      decision: r.decision,
      reason: r.reason,
      adminEmail: r.adminEmail,
      createdAt: r.createdAt.toISOString(),
    })),
    assignedToManufacturerAt: order.assignedToManufacturerAt?.toISOString() ?? null,
    // Computed server-side: the client must not derive it from Date.now() in an
    // effect (hydration mismatch + the set-state-in-effect lint rule).
    assignmentAgeHours: order.assignedToManufacturerAt
      ? Math.floor(
          (Date.now() - order.assignedToManufacturerAt.getTime()) / 3600000
        )
      : null,
    activeManufacturers: activeManufacturers.map(m => ({
      id: m.id,
      companyName: m.companyName,
    })),
    candidates,
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      {forceProfile && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <strong>Q7 escape hatch:</strong> ranking shown under forced
          profile <code className="text-xs bg-amber-100 px-1 rounded">
            {forceProfile}
          </code>. This view is diagnostic and is NOT logged to
          scoring-evaluations.{" "}
          <a
            href={`/admin/orders/${id}`}
            className="underline hover:text-amber-700"
          >
            Clear override
          </a>
        </div>
      )}
      <OrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
