export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, and, desc, count, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painters, painterQcPhotos } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { PainterJobsClient } from "./jobs-client";
import { normalizeFileUrl, getPublicUrl } from "@/lib/services/storage";
import type { TurkishAddress } from "@/lib/db/schema";
import { PLATFORM_COMMISSION_RATE_BPS } from "@/lib/config/prices";

const PAGE_SIZE = 20;

type PainterJobStatus =
  | "assigned"
  | "accepted"
  | "painting"
  | "painted"
  | "qc_pending"
  | "qc_rejected"
  | "qc_approved"
  | "shipped";

const FILTERABLE: PainterJobStatus[] = [
  "assigned",
  "accepted",
  "painting",
  "painted",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
  "shipped",
];

export default async function PainterJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await getPainterSession();
  if (!session) redirect("/painter/login");

  const painter = await db.query.painters.findFirst({
    where: eq(painters.id, session.painterId),
  });
  if (!painter || painter.status !== "active") {
    redirect("/painter/dashboard");
  }

  const { status: filterStatus, page: pageParam } = await searchParams;
  const locale = await getLocale();
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  // Jobs = this painter's orders that carry the painting add-on.
  const conditions = [
    eq(orders.painterId, session.painterId),
    eq(orders.needsPainting, true),
  ];

  if (filterStatus && FILTERABLE.includes(filterStatus as PainterJobStatus)) {
    conditions.push(eq(orders.painterStatus, filterStatus as PainterJobStatus));
  }

  const whereClause = and(...conditions);

  const [countResult, orderRows] = await Promise.all([
    db.select({ total: count() }).from(orders).where(whereClause),
    db.query.orders.findMany({
      where: whereClause,
      orderBy: [desc(orders.assignedToPainterAt)],
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      columns: {
        id: true,
        orderNumber: true,
        orderType: true,
        productTitleSnapshot: true,
        customerName: true,
        figurineSize: true,
        style: true,
        finish: true,
        modifiers: true,
        painterStatus: true,
        paintingPriceKurus: true,
        assignedToPainterAt: true,
        // The painter holds the physical figure and ships it themselves, yet had
        // none of the brief: no colour spec, no reference image, no note, and no
        // address. Everything below is what they need to paint and post it.
        selectedOptions: true,
        customerNote: true,
        quantity: true,
        shippingAddress: true,
        modelGlbUrl: true,
        // Material decides the primer/adhesion the painter must use.
        material: true,
        painterQcRound: true,
        painterHandoffCarrier: true,
        painterHandoffTrackingNumber: true,
        receivedByPainterAt: true,
      },
      with: {
        user: { columns: { fullName: true } },
        photos: { columns: { originalUrl: true }, limit: 4 },
        preview: { columns: { selectedStyledImageUrl: true } },
      },
    }),
  ]);

  // QC photos already uploaded for the current round. Without this the submit
  // button re-locked after every page reload, because the count lived only in
  // client state.
  const jobIds = orderRows.map((o) => o.id);
  const qcRows = jobIds.length
    ? await db
        .select({
          orderId: painterQcPhotos.orderId,
          round: painterQcPhotos.round,
          storageKey: painterQcPhotos.storageKey,
          thumbnailKey: painterQcPhotos.thumbnailKey,
        })
        .from(painterQcPhotos)
        .where(inArray(painterQcPhotos.orderId, jobIds))
    : [];
  const qcByOrder = new Map<string, { count: number; urls: string[] }>();
  for (const row of orderRows) {
    const mine = qcRows.filter(
      (q) => q.orderId === row.id && q.round === row.painterQcRound
    );
    qcByOrder.set(row.id, {
      count: mine.length,
      urls: mine.map((q) => getPublicUrl(q.thumbnailKey ?? q.storageKey)),
    });
  }

  const totalCount = countResult[0]?.total ?? 0;

  return (
    <div className="p-4 sm:p-8">
      <PainterJobsClient
        jobs={orderRows.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          productTitleSnapshot: o.productTitleSnapshot,
          customerName: o.user?.fullName ?? o.customerName,
          figurineSize: o.figurineSize,
          style: o.style,
          finish: o.finish,
          modifiers: o.modifiers as string[] | null,
          painterStatus: o.painterStatus,
          paintingPriceKurus: o.paintingPriceKurus,
          assignedAt: o.assignedToPainterAt?.toISOString() ?? null,
          material: o.material,
          commissionRateBps: PLATFORM_COMMISSION_RATE_BPS,
          handoffCarrier: o.painterHandoffCarrier,
          handoffTrackingNumber: o.painterHandoffTrackingNumber,
          receivedAt: o.receivedByPainterAt?.toISOString() ?? null,
          qcPhotoCount: qcByOrder.get(o.id)?.count ?? 0,
          qcPhotoUrls: qcByOrder.get(o.id)?.urls ?? [],
          glbUrl: normalizeFileUrl(o.modelGlbUrl),
          specRows: (o.selectedOptions ?? []).map((s) => ({
            label: s.groupName,
            value: s.choiceName,
          })),
          customerNote: o.customerNote,
          quantity: o.quantity,
          approvedImageUrl: normalizeFileUrl(
            o.preview?.selectedStyledImageUrl ?? null
          ),
          photoUrls: o.photos.map((ph) => ph.originalUrl),
          shippingAddress: o.shippingAddress as TurkishAddress | null,
        }))}
        total={totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        filterStatus={filterStatus || null}
        locale={locale}
      />
    </div>
  );
}
