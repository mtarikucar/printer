export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders, giftCards, manufacturers } from "@/lib/db/schema";
import { count, sql } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { DashboardClient } from "./dashboard-client";
import {
  AWAITING_MANUFACTURER,
  CASH_COLLECTED_KURUS,
  COUNTS_AS_REVENUE,
  ISTANBUL_TODAY_START,
  NOT_REFUNDED,
  REFUNDED_OPEN,
  REVENUE_DEFINITION_TR,
  dayKeyToDate,
  istanbulDay,
  istanbulLastDaysStart,
} from "@/lib/services/admin-order-sql";

// Pipeline counts are work counts, so they leave refunded orders out. A refunded
// order keeps its status, but every forward action on it is refused. Shipped,
// delivered and failed/rejected are history and still count every order (a
// reject on a paid order refunds it). Refunded orders that are not closed get
// their own card, so they don't silently vanish from the dashboard.
// "Today" is the Istanbul day (ISTANBUL_TODAY_START), not the database
// session's: CURRENT_DATE cut the day at 03:00 Istanbul time.
async function getMetrics() {
  const [
    [totalOrders],
    [todayOrders],
    [pendingReview],
    [approved],
    [printing],
    [qualityCheck],
    [painting],
    [shipped],
    [delivered],
    [failed],
    [revenue],
    [todayRevenue],
    [needsAttention],
    [giftCardsCreated],
    [activeMfg],
    [unassigned],
    [inProduction],
    [qcPending],
    [pendingMfg],
    [refundedOpen],
  ] = await Promise.all([
    db.select({ count: count() }).from(orders),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.createdAt} >= ${ISTANBUL_TODAY_START}`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'review' AND ${NOT_REFUNDED}`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'approved' AND ${NOT_REFUNDED}`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'printing' AND ${NOT_REFUNDED}`),

    // The manufacturer's QC round: printed, photos sent, admin decision.
    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'quality_check' AND ${NOT_REFUNDED}`),

    // With a painter (painted orders only).
    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'painting' AND ${NOT_REFUNDED}`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'shipped'`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'delivered'`),

    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${orders.status} IN ('failed_generation', 'failed_mesh', 'rejected')`
      ),

    // Revenue: the one C3 definition shared with /admin/analytics (cash
    // collected on orders whose payment succeeded, refunds excluded).
    db
      .select({
        total: sql<number>`COALESCE(SUM(${CASH_COLLECTED_KURUS}), 0)`,
      })
      .from(orders)
      .where(COUNTS_AS_REVENUE),

    db
      .select({
        total: sql<number>`COALESCE(SUM(${CASH_COLLECTED_KURUS}), 0)`,
      })
      .from(orders)
      .where(sql`${COUNTS_AS_REVENUE} AND ${orders.paidAt} >= ${ISTANBUL_TODAY_START}`),

    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${NOT_REFUNDED} AND (
          (${orders.status} = 'review' AND ${orders.updatedAt} < NOW() - INTERVAL '24 hours')
          OR (${orders.status} IN ('failed_generation', 'failed_mesh'))
        )`
      ),

    db
      .select({ count: count() })
      .from(giftCards)
      .where(sql`${giftCards.status} != 'pending_payment'`),

    // Active manufacturers
    db
      .select({ count: count() })
      .from(manufacturers)
      .where(sql`${manufacturers.status} = 'active'`),

    // Paid work with no manufacturer. Same definition as the manufacturing
    // queue's first section and the orders list's "Üretici bekliyor" bucket.
    db.select({ count: count() }).from(orders).where(AWAITING_MANUFACTURER),

    // Orders in production (manufacturer is printing)
    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${orders.manufacturerStatus} IN ('accepted', 'printing') AND ${NOT_REFUNDED}`
      ),

    // The admin's move: QC photos waiting for a decision (/admin/qc-queue).
    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${orders.manufacturerStatus} = 'qc_pending' AND ${NOT_REFUNDED}`
      ),

    // Pending manufacturer approvals
    db
      .select({ count: count() })
      .from(manufacturers)
      .where(sql`${manufacturers.status} = 'pending_approval'`),

    // Refunded but not closed (not rejected or delivered). These are frozen
    // mid-pipeline, and each has to be settled by hand with its partner. The
    // card opens the `refunded_open` bucket, which lists the same set.
    db.select({ count: count() }).from(orders).where(REFUNDED_OPEN),
  ]);

  return {
    total: totalOrders.count,
    todayOrders: todayOrders.count,
    pendingReview: pendingReview.count,
    approved: approved.count,
    printing: printing.count,
    qualityCheck: qualityCheck.count,
    painting: painting.count,
    shipped: shipped.count,
    delivered: delivered.count,
    failed: failed.count,
    needsAttention: needsAttention.count,
    // SUM over integers comes back from pg as a bigint string.
    revenueKurus: Number(revenue.total) || 0,
    todayRevenueKurus: Number(todayRevenue.total) || 0,
    giftCardsCreated: giftCardsCreated.count,
    activeManufacturers: activeMfg.count,
    unassignedOrders: unassigned.count,
    inProduction: inProduction.count,
    qcPending: qcPending.count,
    pendingManufacturerApproval: pendingMfg.count,
    refundedOpen: refundedOpen.count,
  };
}

// One bar per Istanbul day. date_trunc('day', paidAt) cut days at UTC midnight
// (03:00 Istanbul), so a sale at 01:30 landed on the previous day's bar. The
// window is the last 30 Istanbul days, today included, and it starts at an
// Istanbul midnight. The old `NOW() - 30 days` window started in the middle of
// a day, so the first bar was a partial one. The bound comes from the shared
// "N gün" helper rather than a hand-written `TODAY - 29`, so this window and
// analytics' cannot drift apart by an off-by-one.
async function getRevenueTrend(): Promise<{ date: string; amount: number }[]> {
  const rows = await db.execute(
    sql`SELECT ${istanbulDay(orders.paidAt)} AS day, SUM(${CASH_COLLECTED_KURUS}) AS total
        FROM ${orders}
        WHERE ${COUNTS_AS_REVENUE}
          AND ${orders.paidAt} >= ${istanbulLastDaysStart(30)}
        GROUP BY day
        ORDER BY day`
  );

  return (rows.rows as { day: string; total: string }[]).map((r) => ({
    date: dayKeyToDate(r.day).toISOString(),
    amount: Number(r.total),
  }));
}

async function getRecentOrders() {
  const rows = await db.query.orders.findMany({
    orderBy: (o, { desc }) => [desc(o.createdAt)],
    limit: 5,
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      status: true,
      createdAt: true,
      amountKurus: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    customerName: r.customerName,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    amountKurus: r.amountKurus,
  }));
}

async function getAttentionOrders() {
  // Same predicate as the needsAttention count above, refunded orders out.
  const rows = await db.query.orders.findMany({
    where: (o, { or, and, lt, inArray }) =>
      and(
        NOT_REFUNDED,
        or(
          and(
            sql`${o.status} = 'review'`,
            lt(o.updatedAt, sql`NOW() - INTERVAL '24 hours'`)
          ),
          inArray(o.status, ["failed_generation", "failed_mesh"])
        )
      ),
    orderBy: (o, { desc }) => [desc(o.updatedAt)],
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((r) => {
    let reason: string;
    if (r.status === "review") {
      reason = "reviewOverdue";
    } else {
      reason = "failedOrder";
    }
    return {
      id: r.id,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      status: r.status,
      reason,
    };
  });
}

export default async function AdminDashboardPage() {
  const locale = await getLocale();

  const [metrics, revenueTrend, recentOrders, attentionOrders] =
    await Promise.all([
      getMetrics(),
      getRevenueTrend(),
      getRecentOrders(),
      getAttentionOrders(),
    ]);

  return (
    <DashboardClient
      metrics={metrics}
      revenueTrend={revenueTrend}
      recentOrders={recentOrders}
      attentionOrders={attentionOrders}
      revenueNote={REVENUE_DEFINITION_TR}
      locale={locale}
    />
  );
}
