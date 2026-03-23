export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { OrdersClient } from "./orders-client";

const PAGE_SIZE = 25;

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
    q?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const {
    status: filterStatus,
    page: pageParam,
    q,
    dateFrom,
    dateTo,
  } = await searchParams;

  const locale = await getLocale();
  const d = getDictionary(locale);
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);

  // Build WHERE conditions
  const conditions = [];

  if (filterStatus) {
    conditions.push(eq(orders.status, filterStatus as any));
  }

  if (q) {
    conditions.push(
      sql`(${orders.orderNumber} ILIKE ${"%" + q + "%"} OR ${orders.customerName} ILIKE ${"%" + q + "%"} OR ${orders.email} ILIKE ${"%" + q + "%"})`
    );
  }

  if (dateFrom) {
    conditions.push(sql`${orders.createdAt} >= ${dateFrom}`);
  }

  if (dateTo) {
    conditions.push(sql`${orders.createdAt} <= ${dateTo + "T23:59:59"}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count query for total
  const [{ total: totalCount }] = await db
    .select({ total: count() })
    .from(orders)
    .where(whereClause);

  // Data query with pagination
  const allOrders = await db.query.orders.findMany({
    where: whereClause,
    orderBy: [desc(orders.createdAt)],
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">
        {d["admin.orders.title"]}
      </h1>

      <OrdersClient
        orders={allOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          email: o.email,
          figurineSize: o.figurineSize,
          style: o.style,
          status: o.status,
          amountKurus: o.amountKurus,
          createdAt: o.createdAt.toISOString(),
        }))}
        total={totalCount}
        page={page}
        pageSize={PAGE_SIZE}
        filters={{ status: filterStatus, q, dateFrom, dateTo }}
        locale={locale}
      />
    </div>
  );
}
