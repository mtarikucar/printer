export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { eq, and, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderPhotos,
  generationAttempts,
  manufacturerActions,
  manufacturers,
  qcPhotos,
  qcReviews,
} from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { ManufacturerOrderDetailClient } from "./client";

export default async function ManufacturerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getManufacturerSession();
  if (!session) {
    redirect("/manufacturer/login");
  }

  // Verify manufacturer is active
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });

  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const { id } = await params;
  const locale = await getLocale();

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.id, id),
      eq(orders.manufacturerId, session.manufacturerId)
    ),
    with: {
      photos: {
        columns: { id: true, originalUrl: true },
      },
      generationAttempts: {
        where: eq(generationAttempts.status, "succeeded"),
        columns: { id: true, outputGlbUrl: true, outputStlUrl: true, outputObjUrl: true },
        orderBy: [desc(generationAttempts.createdAt)],
        limit: 1,
      },
      manufacturerActions: {
        orderBy: [desc(manufacturerActions.createdAt)],
      },
      qcPhotos: {
        columns: {
          id: true,
          storageKey: true,
          thumbnailKey: true,
          round: true,
          reviewStatus: true,
        },
        orderBy: [desc(qcPhotos.createdAt)],
      },
      qcReviews: {
        columns: { decision: true, reason: true, round: true, createdAt: true },
        orderBy: [desc(qcReviews.createdAt)],
      },
      product: {
        columns: { id: true, title: true, description: true, leadTimeDays: true },
        with: { images: { columns: { storageKey: true, sortOrder: true } } },
      },
    },
  });

  if (!order) notFound();

  const latestGeneration = order.generationAttempts[0] ?? null;

  // Only the current round's photos are shown to the manufacturer; older
  // (rejected) rounds stay in the DB as an audit trail.
  const currentRoundPhotos = order.qcPhotos
    .filter((p) => p.round === order.qcRound)
    .map((p) => ({ id: p.id, url: getPublicUrl(p.thumbnailKey ?? p.storageKey) }));
  const latestReject = order.qcReviews.find((r) => r.decision === "rejected");
  const qcRejectReason =
    order.manufacturerStatus === "qc_rejected"
      ? latestReject?.reason ?? null
      : null;

  // Marketplace orders: surface the listed product (title, description, images)
  // instead of the AI-generated model. Custom orders leave these null/empty.
  const marketplaceProduct =
    order.orderType === "marketplace" && order.product
      ? {
          title: order.productTitleSnapshot ?? order.product.title,
          description: order.product.description,
          images: [...order.product.images]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((img) => getPublicUrl(img.storageKey)),
        }
      : null;

  const serialized = {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      material: order.material,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
      qcRound: order.qcRound,
      quantity: order.quantity,
      productTitleSnapshot: order.productTitleSnapshot,
      customerNote: order.customerNote,
      shippingAddress: order.shippingAddress as TurkishAddress | null,
      assignedToManufacturerAt:
        order.assignedToManufacturerAt?.toISOString() ?? null,
      manufacturerAcceptedAt:
        order.manufacturerAcceptedAt?.toISOString() ?? null,
      manufacturerPrintedAt:
        order.manufacturerPrintedAt?.toISOString() ?? null,
      trackingNumber: order.trackingNumber,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
    },
    photos: order.photos.map((p) => ({
      id: p.id,
      originalUrl: p.originalUrl,
    })),
    qcPhotos: currentRoundPhotos,
    qcRejectReason,
    marketplaceProduct,
    glbUrl: normalizeFileUrl(latestGeneration?.outputGlbUrl ?? null),
    stlUrl: normalizeFileUrl(latestGeneration?.outputStlUrl ?? null),
    objUrl: normalizeFileUrl(latestGeneration?.outputObjUrl ?? null),
    actions: order.manufacturerActions.map((a) => ({
      id: a.id,
      action: a.action,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  return (
    <div className="p-8 max-w-7xl">
      <ManufacturerOrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
