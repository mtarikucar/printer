export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders, giftCards, manufacturers } from "@/lib/db/schema";
import { count, sql } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { DashboardClient } from "./dashboard-client";

async function getMetrics() {
  const [
    [totalOrders],
    [todayOrders],
    [pendingReview],
    [approved],
    [printing],
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
    [pendingMfg],
  ] = await Promise.all([
    db.select({ count: count() }).from(orders),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.createdAt} >= CURRENT_DATE`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'review'`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'approved'`),

    db
      .select({ count: count() })
      .from(orders)
      .where(sql`${orders.status} = 'printing'`),

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

    db
      .select({
        total: sql<number>`COALESCE(SUM(${orders.amountKurus} - ${orders.giftCardAmountKurus}), 0)`,
      })
      .from(orders)
      .where(sql`${orders.paidAt} IS NOT NULL`),

    db
      .select({
        total: sql<number>`COALESCE(SUM(${orders.amountKurus} - ${orders.giftCardAmountKurus}), 0)`,
      })
      .from(orders)
      .where(
        sql`${orders.paidAt} IS NOT NULL AND ${orders.paidAt} >= CURRENT_DATE`
      ),

    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`(${orders.status} = 'review' AND ${orders.updatedAt} < NOW() - INTERVAL '24 hours')
        OR (${orders.status} = 'pending_payment' AND ${orders.createdAt} < NOW() - INTERVAL '48 hours')
        OR (${orders.status} IN ('failed_generation', 'failed_mesh'))`
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

    // Unassigned orders (approved but no manufacturer)
    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${orders.status} = 'approved' AND (${orders.manufacturerStatus} IS NULL OR ${orders.manufacturerStatus} = 'unassigned')`
      ),

    // Orders in production (manufacturer is printing)
    db
      .select({ count: count() })
      .from(orders)
      .where(
        sql`${orders.manufacturerStatus} IN ('accepted', 'printing')`
      ),

    // Pending manufacturer approvals
    db
      .select({ count: count() })
      .from(manufacturers)
      .where(sql`${manufacturers.status} = 'pending_approval'`),
  ]);

  return {
    total: totalOrders.count,
    todayOrders: todayOrders.count,
    pendingReview: pendingReview.count,
    approved: approved.count,
    printing: printing.count,
    shipped: shipped.count,
    delivered: delivered.count,
    failed: failed.count,
    needsAttention: needsAttention.count,
    revenueKurus: revenue.total || 0,
    todayRevenueKurus: todayRevenue.total || 0,
    giftCardsCreated: giftCardsCreated.count,
    activeManufacturers: activeMfg.count,
    unassignedOrders: unassigned.count,
    inProduction: inProduction.count,
    pendingManufacturerApproval: pendingMfg.count,
  };
}

async function getRevenueTrend(): Promise<{ date: string; amount: number }[]> {
  const rows = await db.execute(
    sql`SELECT date_trunc('day', ${orders.paidAt}) as day, SUM(${orders.amountKurus} - ${orders.giftCardAmountKurus}) as total
        FROM ${orders}
        WHERE ${orders.paidAt} >= NOW() - INTERVAL '30 days'
        GROUP BY day
        ORDER BY day`
  );

  return (rows.rows as { day: string; total: string }[]).map((r) => ({
    date: new Date(r.day).toISOString(),
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
  const rows = await db.query.orders.findMany({
    where: (o, { or, and, lt, inArray }) =>
      or(
        and(
          sql`${o.status} = 'review'`,
          lt(o.updatedAt, sql`NOW() - INTERVAL '24 hours'`)
        ),
        and(
          sql`${o.status} = 'pending_payment'`,
          lt(o.createdAt, sql`NOW() - INTERVAL '48 hours'`)
        ),
        inArray(o.status, ["failed_generation", "failed_mesh"])
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
    } else if (r.status === "pending_payment") {
      reason = "paymentOverdue";
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
      locale={locale}
    />
  );
}
