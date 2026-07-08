export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, and, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painters } from "@/lib/db/schema";
import { getPainterSession } from "@/lib/services/painter-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { PainterJobsClient } from "./jobs-client";

const PAGE_SIZE = 20;

type PainterJobStatus =
  | "assigned"
  | "accepted"
  | "painting"
  | "painted"
  | "shipped";

const FILTERABLE: PainterJobStatus[] = [
  "assigned",
  "accepted",
  "painting",
  "painted",
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
      },
      with: {
        user: { columns: { fullName: true } },
      },
    }),
  ]);

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
