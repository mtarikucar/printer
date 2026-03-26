export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderPhotos, generationAttempts, meshReports, adminActions, adminMessages, manufacturers, manufacturerActions } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { OrderDetailClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();

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
    },
  });

  if (!order) notFound();

  // Query active manufacturers for the assignment dropdown
  const activeManufacturers = await db.query.manufacturers.findMany({
    where: sql`${manufacturers.status} = 'active'`,
    columns: { id: true, companyName: true },
  });

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
    },
    photos: order.photos.map(p => ({
      id: p.id,
      originalUrl: p.originalUrl,
      thumbnailUrl: p.thumbnailUrl,
    })),
    latestGeneration: latestGeneration ? {
      id: latestGeneration.id,
      provider: latestGeneration.provider,
      status: latestGeneration.status,
      outputGlbUrl: latestGeneration.outputGlbUrl,
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
      outputGlbUrl: a.outputGlbUrl,
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
      channel: m.channel,
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
    assignedToManufacturerAt: order.assignedToManufacturerAt?.toISOString() ?? null,
    activeManufacturers: activeManufacturers.map(m => ({
      id: m.id,
      companyName: m.companyName,
    })),
  };

  return (
    <div className="p-8 max-w-7xl">
      <OrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
