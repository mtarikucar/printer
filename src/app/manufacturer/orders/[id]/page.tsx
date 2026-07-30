export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  orderPhotos,
  generationAttempts,
  manufacturerActions,
  manufacturers,
  qcPhotos,
  qcReviews,
  products,
  orderModelRevisions,
} from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";
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
        columns: {
          id: true,
          title: true,
          description: true,
          leadTimeDays: true,
          material: true,
        },
        with: { images: { columns: { storageKey: true, sortOrder: true } } },
      },
      // Image-first flow: the styled image the customer approved IS the brief
      // for what gets printed. The admin panel already surfaces it; the
      // manufacturer needs it just as much.
      preview: {
        columns: { selectedStyledImageUrl: true, photoKeys: true },
      },
      // If the admin uploaded a corrected model, the workshop must know the file
      // it downloaded earlier is stale.
      modelRevisions: {
        columns: { revision: true, note: true, createdAt: true },
        orderBy: [desc(orderModelRevisions.revision)],
      },
      // Customer-uploaded STL/OBJ: the print height, the analysed geometry and
      // the material were only ever visible on the admin quote screen, so the
      // workshop printing it could not know what size to print.
      uploadedModel: {
        columns: {
          fileName: true,
          targetHeightMm: true,
          material: true,
          boundingBoxMm: true,
          minWallThicknessMm: true,
          printRisk: true,
          sourceFormat: true,
          volumeMm3: true,
          isVolume: true,
        },
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

  // Every product this marketplace order covers — single buy-now (order.product)
  // OR a cart sub-order's line items — each with its manufacturable spec, so the
  // fulfilling manufacturer can produce them all.
  const orderProductRefs: {
    itemId: string;
    productId: string;
    title: string;
    quantity: number;
    selectedOptions: { groupName: string; choiceName: string }[];
    selectedAddons: { name: string }[];
    itemImageUrl: string | null;
  }[] = [];
  if (order.orderType === "marketplace") {
    if (order.productId && order.product) {
      orderProductRefs.push({
        itemId: "single",
        productId: order.productId,
        title: order.productTitleSnapshot ?? order.product.title,
        quantity: order.quantity,
        selectedOptions: order.selectedOptions ?? [],
        selectedAddons: order.selectedAddons ?? [],
        itemImageUrl: order.itemImageKey ? getPublicUrl(order.itemImageKey) : null,
      });
    }
    const itemRows = await db
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        title: orderItems.productTitleSnapshot,
        quantity: orderItems.quantity,
        selectedOptions: orderItems.selectedOptions,
        selectedAddons: orderItems.selectedAddons,
        itemImageKey: orderItems.itemImageKey,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    for (const it of itemRows) {
      // One ref per LINE, not per product: two lines of the same product with
      // different options are two separate production jobs.
      if (it.productId) {
        orderProductRefs.push({
          itemId: it.id,
          productId: it.productId,
          title: it.title,
          quantity: it.quantity,
          selectedOptions: it.selectedOptions ?? [],
          selectedAddons: it.selectedAddons ?? [],
          itemImageUrl: it.itemImageKey ? getPublicUrl(it.itemImageKey) : null,
        });
      }
    }
  }
  // Per-line product facts. getProductSpec covers files/BOM/steps but not the
  // listing itself, so an admin-owned product reached the workshop with no
  // material, no description and no images.
  const refIds = [...new Set(orderProductRefs.map((r) => r.productId))];
  const refProducts = refIds.length
    ? await db.query.products.findMany({
        where: inArray(products.id, refIds),
        columns: { id: true, material: true, description: true, leadTimeDays: true },
        with: {
          images: { columns: { storageKey: true, sortOrder: true } },
        },
      })
    : [];
  const productById = new Map(refProducts.map((pr) => [pr.id, pr]));

  const productSpecs = await Promise.all(
    orderProductRefs.map(async (ref) => {
      const s = await getProductSpec(ref.productId);
      const listing = productById.get(ref.productId);
      return {
        itemId: ref.itemId,
        productId: ref.productId,
        title: ref.title,
        quantity: ref.quantity,
        material: listing?.material ?? null,
        // Only when there is no single-product card above (cart sub-orders),
        // otherwise the description/images would appear twice.
        description: marketplaceProduct ? null : listing?.description ?? null,
        images: marketplaceProduct
          ? []
          : [...(listing?.images ?? [])]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((img) => getPublicUrl(img.storageKey)),
        selectedOptions: ref.selectedOptions,
        selectedAddons: ref.selectedAddons,
        itemImageUrl: ref.itemImageUrl,
        files: s.files.map((f) => ({
          id: f.id,
          partName: f.partName,
          fileName: f.fileName,
          sourceFormat: f.sourceFormat,
          quantity: f.quantity,
          glbUrl: f.glbUrl,
          // Geometry the seller's upload already measured — the workshop can
          // sanity-check the scale before starting a long print.
          fileSizeBytes: f.fileSizeBytes,
          volumeMm3: f.volumeMm3,
          boundingBoxMm: f.boundingBoxMm,
        })),
        components: s.components.map((c) => ({
          name: c.name,
          quantity: c.quantity,
          unit: c.unit,
          notes: c.notes,
        })),
        steps: s.steps.map((st) => ({
          instruction: st.instruction,
          imageUrl: st.imageUrl,
        })),
      };
    })
  );

  const serialized = {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      customerName: order.customerName,
      phone: order.phone,
      figurineSize: order.figurineSize,
      material: order.material,
      finish: order.finish,
      style: order.style,
      modifiers: order.modifiers as string[] | null,
      // The technical spec the customer/admin agreed on (colour, base, engraving,
      // and — on manual orders — size/material/finish mirrored here so they can
      // be told apart from the columns' schema defaults).
      selectedOptions: order.selectedOptions ?? [],
      // Paid add-ons the customer bought. gift_wrap / extra_paint / rush_shipping
      // are physical work the workshop must actually do; they were charged for
      // and shown to nobody who could fulfil them.
      upsells: (order.upsells ?? []) as string[],
      // Product material for marketplace orders — the workshop was otherwise
      // guessing what an admin-owned store product is printed from.
      productMaterial: order.product?.material ?? null,
      // Customer-uploaded model facts (upload orders only).
      paidAt: order.paidAt?.toISOString() ?? null,
      // Promised lead time (product listing) so the workshop can see the deadline.
      leadTimeDays: refProducts.length
        ? Math.min(...refProducts.map((pr) => pr.leadTimeDays ?? 7))
        : order.product?.leadTimeDays ?? null,
      // A later admin upload makes a previously downloaded file stale.
      modelRevision: order.modelRevisions.length
        ? {
            current: order.modelRevisions[0].revision,
            total: order.modelRevisions.length,
            uploadedAt: order.modelUploadedAt?.toISOString() ?? null,
          }
        : null,
      uploadedModel: order.uploadedModel
        ? {
            fileName: order.uploadedModel.fileName,
            sourceFormat: order.uploadedModel.sourceFormat,
            targetHeightMm: order.uploadedModel.targetHeightMm,
            material: order.uploadedModel.material,
            boundingBoxMm: order.uploadedModel.boundingBoxMm ?? null,
            minWallThicknessMm: order.uploadedModel.minWallThicknessMm ?? null,
            printRisk: (order.uploadedModel.printRisk ?? []) as string[],
            volumeMm3: order.uploadedModel.volumeMm3 ?? null,
            isVolume: order.uploadedModel.isVolume ?? null,
          }
        : null,
      status: order.status,
      manufacturerStatus: order.manufacturerStatus,
      needsPainting: order.needsPainting,
      painterStatus: order.painterStatus,
      // Manufacturer-level flag surfaced on the order so the client can offer
      // the in-house "paint + ship" path instead of a forced painter hand-off.
      paintsInHouse: manufacturer.paintsInHouse,
      qcRound: order.qcRound,
      quantity: order.quantity,
      productTitleSnapshot: order.productTitleSnapshot,
      // Earnings preview. The manufacturer has 24 hours to accept or decline
      // and could not see what the job pays — the contract now promises this.
      // Painting orders accrue on the print portion only, unless the
      // manufacturer paints in house (then the full amount is theirs).
      grossKurus:
        order.needsPainting && !manufacturer.paintsInHouse
          ? Math.max(0, order.amountKurus - order.paintingPriceKurus)
          : order.amountKurus,
      commissionRateBps: PLATFORM_COMMISSION_RATE_BPS,
      // Manual/WhatsApp orders carry no product row — their contents live here
      // as {name, priceKurus} line items. Without this the manufacturer has no
      // idea what was ordered.
      selectedAddons: order.selectedAddons ?? [],
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
    photos: [
      ...order.photos.map((p) => ({ id: p.id, originalUrl: p.originalUrl })),
      // Multi-angle fusion sets: only the primary photo becomes an order_photo,
      // so the other angles the customer uploaded never reached the workshop.
      // photoKeys[0] IS the primary — skip it to avoid a duplicate.
      ...(order.preview?.photoKeys ?? []).slice(1).map((k, i) => ({
        id: `ref-${i}`,
        originalUrl: getPublicUrl(k),
      })),
    ],
    qcPhotos: currentRoundPhotos,
    qcRejectReason,
    marketplaceProduct,
    productSpecs,
    approvedImageUrl: normalizeFileUrl(order.preview?.selectedStyledImageUrl ?? null),
    // The printable model comes from the ADMIN upload (orders.model_*) since the
    // auto-3D pipeline was removed; generationAttempts is the legacy fallback for
    // historical orders. Reading only the latter left every recent order with no
    // downloadable file at all.
    glbUrl: normalizeFileUrl(order.modelGlbUrl ?? latestGeneration?.outputGlbUrl ?? null),
    stlUrl: normalizeFileUrl(order.modelStlUrl ?? latestGeneration?.outputStlUrl ?? null),
    objUrl: normalizeFileUrl(latestGeneration?.outputObjUrl ?? null),
    actions: order.manufacturerActions.map((a) => ({
      id: a.id,
      action: a.action,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      <ManufacturerOrderDetailClient data={serialized} locale={locale} />
    </div>
  );
}
