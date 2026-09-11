export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { orders, orderStatusEnum } from "@/lib/db/schema";
import { desc, eq, sql, and, count, inArray } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  AWAITING_MANUFACTURER,
  IS_REFUNDED,
  NOT_REFUNDED,
  REFUNDED_OPEN,
  istanbulDayStart,
} from "@/lib/services/admin-order-sql";
import { OrdersClient } from "./orders-client";

const PAGE_SIZE = 25;

type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

// The exact-status filter comes straight from the URL. A value that is not a
// real order_status reached Postgres as an enum literal and 500'd the page. The
// dropdown itself offered `pending_payment`, which exists on drafts and gift
// cards, never on orders. Unknown values are now ignored.
function isOrderStatus(value: string): value is OrderStatus {
  return (orderStatusEnum.enumValues as readonly string[]).includes(value);
}

// The date filters also come from the URL. A malformed or impossible day
// (2026-02-31) would reach Postgres as a bad date literal and 500 the page, so
// only a real YYYY-MM-DD calendar day is used.
function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Map a coarse "bucket" filter to the set of order statuses it covers. Buckets
// replace the old wall of 13 status chips; the exact-status dropdown still wins.
const BUCKETS: Record<string, OrderStatus[]> = {
  needsAction: ["awaiting_model", "review"],
  // `awaiting_customer_approval` is deliberately NOT in needsAction: the ball
  // is in the customer's court, not ours. It sits in inProgress and gets its
  // own SLA sweeper for the ones that go quiet.
  // `quality_check` (the manufacturer's QC round: printed → photos → admin QC)
  // and `painting` (with the painter) are live production states that the
  // manufacturer and painter routes write. Without them here those orders
  // showed up under no bucket but "Tümü".
  inProgress: [
    "paid",
    "generating",
    "processing_mesh",
    "awaiting_customer_approval",
    "approved",
    "printing",
    "quality_check",
    "painting",
    "shipped",
  ],
  completed: ["delivered"],
  problems: ["failed_generation", "failed_mesh", "rejected"],
};

// Work buckets leave refunded orders out: a refunded order keeps its status,
// but every forward action on it is refused, so it is not work. "completed"
// and "problems" are history and keep them (a reject on a paid order refunds
// it, so most rejected orders are refunded). The "refunded" bucket lists every
// refunded order. "refunded_open" lists the refunded orders that are not
// closed yet (REFUNDED_OPEN): the dashboard's "İade edildi (açık)" card opens
// it and counts with the same predicate, so the two numbers agree.
const WORK_BUCKETS = new Set(["needsAction", "inProgress"]);

// "unassigned" is not a status bucket: it is paid work nobody is producing yet.
// That means approved custom/upload orders, and paid marketplace orders
// (platform products wait at `paid`, an assignable status). Both would
// otherwise hide inside "inProgress" alongside everything already being
// printed. It uses the same definition (AWAITING_MANUFACTURER) as the
// dashboard's "Atanmamış" count and the manufacturing queue's first section.

// Painting jobs. Two things hide here that an admin needs to find: a job the
// manufacturer QC-approved but never handed to a painter (nobody is working on
// it), and one that is with a painter (status 'painting'). Both are "boyama"
// from the desk's point of view, so one bucket covers them. Refunded orders are
// frozen, so they are not painting work.
const PAINTING_BUCKET = sql`${orders.needsPainting} = true
  AND ${NOT_REFUNDED}
  AND ${orders.status} NOT IN ('shipped', 'delivered', 'rejected')
  AND (
    ${orders.status} = 'painting'
    OR ${orders.manufacturerStatus} = 'qc_approved'
  )`;

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
    status: rawStatus,
    bucket,
    page: pageParam,
    q,
    dateFrom,
    dateTo,
  } = await searchParams;

  const locale = await getLocale();
  const d = getDictionary(locale);
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const filterStatus =
    rawStatus && isOrderStatus(rawStatus) ? rawStatus : undefined;

  // Build WHERE conditions
  const conditions = [];

  if (filterStatus) {
    conditions.push(eq(orders.status, filterStatus));
  } else if (bucket === "unassigned") {
    conditions.push(AWAITING_MANUFACTURER);
  } else if (bucket === "painting") {
    conditions.push(PAINTING_BUCKET);
  } else if (bucket === "refunded") {
    conditions.push(IS_REFUNDED);
  } else if (bucket === "refunded_open") {
    conditions.push(REFUNDED_OPEN);
  } else if (bucket && BUCKETS[bucket]) {
    conditions.push(inArray(orders.status, BUCKETS[bucket]));
    if (WORK_BUCKETS.has(bucket)) conditions.push(NOT_REFUNDED);
  }

  if (q) {
    conditions.push(
      sql`(${orders.orderNumber} ILIKE ${"%" + q + "%"} OR ${orders.customerName} ILIKE ${"%" + q + "%"} OR ${orders.email} ILIKE ${"%" + q + "%"})`
    );
  }

  // The date inputs are Istanbul calendar days. Compared as bare strings they
  // cut at UTC midnight (03:00 Istanbul), so a late-night order fell on the
  // wrong day. `dateTo` runs up to the start of the next Istanbul day, so the
  // last second of the day (23:59:59.xxx) is not dropped either.
  if (dateFrom && isCalendarDay(dateFrom)) {
    conditions.push(
      sql`${orders.createdAt} >= ${istanbulDayStart(sql`${dateFrom}`)}`
    );
  }

  if (dateTo && isCalendarDay(dateTo)) {
    conditions.push(
      sql`${orders.createdAt} < ${istanbulDayStart(sql`${dateTo}::date + 1`)}`
    );
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
          paymentStatus: o.paymentStatus,
          needsPainting: o.needsPainting,
          painterStatus: o.painterStatus,
          isBulk: o.isBulk,
          quantity: o.quantity,
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
