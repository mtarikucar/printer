export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, and, desc, count, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers, quoteCheckouts } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { ManufacturerOrdersClient } from "./orders-client";

const PAGE_SIZE = 20;

export default async function ManufacturerOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
  }>;
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

  const { status: filterStatus, page: pageParam } = await searchParams;
  const locale = await getLocale();
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  // Build WHERE conditions
  const conditions = [eq(orders.manufacturerId, session.manufacturerId)];

  if (
    filterStatus &&
    ["assigned", "accepted", "printing", "printed", "shipped"].includes(
      filterStatus
    )
  ) {
    conditions.push(
      eq(
        orders.manufacturerStatus,
        filterStatus as
          | "assigned"
          | "accepted"
          | "printing"
          | "printed"
          | "shipped"
      )
    );
  }

  const whereClause = and(...conditions);

  // Count + data queries
  const [countResult, orderRows] = await Promise.all([
    db.select({ total: count() }).from(orders).where(whereClause),
    db.query.orders.findMany({
      where: whereClause,
      orderBy: [desc(orders.assignedToManufacturerAt)],
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
        manufacturerStatus: true,
        assignedToManufacturerAt: true,
        quantity: true,
        needsPainting: true,
        upsells: true,
        // Atölye partisine ait siparişler tek tek kargolanmaz (uç 409 döner);
        // üreticinin bunu listede GÖRMESİ gerekiyor ki denemesin.
        workshopSessionId: true,
      },
    }),
  ]);

  const totalCount = countResult[0]?.total ?? 0;

  // Teklif siparişinin listedeki kimliği BOYU değil PARÇA SAYISIDIR: teklif
  // siparişinde `figurineSize` yok (null), yani satır "—" görünüyordu. Sayı
  // ödeme anındaki anlık görüntüden okunur (tek sorgu, sayfadaki satırlar
  // kadar). Okuma arızası listeyi düşürmez: sayı bilinmezse satır eski
  // gösterimine döner.
  const quotePartCounts = orderRows.length
    ? await db
        .select({
          orderId: orders.id,
          partCount: sql<number>`jsonb_array_length(${quoteCheckouts.partsSnapshot})`,
        })
        .from(quoteCheckouts)
        .innerJoin(orders, eq(orders.draftId, quoteCheckouts.draftId))
        .where(inArray(orders.id, orderRows.map((o) => o.id)))
        .catch((e) => {
          console.error("manufacturer orders list: teklif parça sayıları okunamadı", e);
          return [];
        })
    : [];
  const partCountById = new Map(quotePartCounts.map((r) => [r.orderId, Number(r.partCount)]));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        {/* Title rendered in client via i18n */}
      </h1>
      <ManufacturerOrdersClient
        orders={orderRows.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          orderType: o.orderType,
          productTitleSnapshot: o.productTitleSnapshot,
          customerName: o.customerName,
          figurineSize: o.figurineSize,
          style: o.style,
          finish: o.finish,
          modifiers: o.modifiers as string[] | null,
          manufacturerStatus: o.manufacturerStatus,
          assignedAt: o.assignedToManufacturerAt?.toISOString() ?? null,
          quantity: o.quantity,
          needsPainting: o.needsPainting,
          rushShipping: ((o.upsells ?? []) as string[]).includes("rush_shipping"),
          isWorkshop: o.workshopSessionId != null,
          /** Teklif siparişi: kaç parça basılacak. Teklif değilse null. */
          quotePartCount: partCountById.get(o.id) ?? null,
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
