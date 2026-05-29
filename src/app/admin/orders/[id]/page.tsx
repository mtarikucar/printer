export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts, meshReports, adminActions, adminMessages, manufacturers, manufacturerActions, qcPhotos, qcReviews } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { OrderDetailClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { rankForOrderWithShadow } from "@/lib/services/manufacturer-assignment-shadow";

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
      manufacturerActions: {
        orderBy: [desc(manufacturerActions.createdAt)],
      },
      qcPhotos: {
        orderBy: [desc(qcPhotos.createdAt)],
      },
      qcReviews: {
        orderBy: [desc(qcReviews.createdAt)],
      },
    },
  });

  if (!order) notFound();

  // Query active manufacturers for the assignment dropdown
  const activeManufacturers = await db.query.manufacturers.findMany({
    where: sql`${manufacturers.status} = 'active'`,
    columns: { id: true, companyName: true },
  });

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
      email: order.email,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
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
    },
    photos: order.photos.map(p => ({
      id: p.id,
      originalUrl: normalizeFileUrl(p.originalUrl) ?? p.originalUrl,
      thumbnailUrl: normalizeFileUrl(p.thumbnailUrl),
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
    activeManufacturers: activeManufacturers.map(m => ({
      id: m.id,
      companyName: m.companyName,
    })),
    candidates,
  };

  return (
    <div className="p-8 max-w-7xl">
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
