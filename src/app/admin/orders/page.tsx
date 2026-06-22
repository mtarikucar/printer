export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc, eq, sql, and, count, inArray } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { OrdersClient } from "./orders-client";

const PAGE_SIZE = 25;

// Map a coarse "bucket" filter to the set of order statuses it covers. Buckets
// replace the old wall of 13 status chips; the exact-status dropdown still wins.
const BUCKETS: Record<string, string[]> = {
  needsAction: ["review"],
  inProgress: ["paid", "generating", "processing_mesh", "approved", "printing", "shipped"],
  completed: ["delivered"],
  problems: ["failed_generation", "failed_mesh", "rejected"],
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    bucket?: string;
    page?: string;
    q?: string;
    dateFrom?: string;
    dateTo?: string;
  }>;
}) {
  const {
    status: filterStatus,
    bucket,
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
  } else if (bucket && BUCKETS[bucket]) {
    conditions.push(inArray(orders.status, BUCKETS[bucket] as any));
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
    <div className="p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">
          {d["admin.orders.title"]}
        </h1>
        <Link
          href="/admin/orders/new"
          className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1ebe5d]"
        >
          + WhatsApp siparişi oluştur
        </Link>
      </div>

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
        filters={{ status: filterStatus, bucket, q, dateFrom, dateTo }}
        locale={locale}
      />
    </div>
  );
}
