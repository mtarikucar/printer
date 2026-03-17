export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders, giftCards } from "@/lib/db/schema";
import { count, sql } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency } from "@/lib/i18n/format";

async function getMetrics() {
  const [totalOrders] = await db
    .select({ count: count() })
    .from(orders);

  const [pendingReview] = await db
    .select({ count: count() })
    .from(orders)
    .where(sql`${orders.status} = 'review'`);

  const [approved] = await db
    .select({ count: count() })
    .from(orders)
    .where(sql`${orders.status} = 'approved'`);

  const [printing] = await db
    .select({ count: count() })
    .from(orders)
    .where(sql`${orders.status} = 'printing'`);

  const [shipped] = await db
    .select({ count: count() })
    .from(orders)
    .where(sql`${orders.status} = 'shipped'`);

  const [failed] = await db
    .select({ count: count() })
    .from(orders)
    .where(
      sql`${orders.status} IN ('failed_generation', 'failed_mesh', 'rejected')`
    );

  const [revenue] = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.amountKurus}), 0)` })
    .from(orders)
    .where(sql`${orders.paidAt} IS NOT NULL`);

  const [giftCardsCreated] = await db
    .select({ count: count() })
    .from(giftCards)
    .where(sql`${giftCards.status} != 'pending_payment'`);

  return {
    total: totalOrders.count,
    pendingReview: pendingReview.count,
    approved: approved.count,
    printing: printing.count,
    shipped: shipped.count,
    failed: failed.count,
    revenueKurus: revenue.total || 0,
    giftCardsCreated: giftCardsCreated.count,
  };
}

export default async function AdminDashboardPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);
  const metrics = await getMetrics();

  const cards = [
    { label: d["admin.dashboard.totalOrders"], value: metrics.total, color: "bg-blue-500" },
    { label: d["admin.dashboard.pendingReview"], value: metrics.pendingReview, color: "bg-yellow-500" },
    { label: d["admin.dashboard.approved"], value: metrics.approved, color: "bg-green-500" },
    { label: d["admin.dashboard.printing"], value: metrics.printing, color: "bg-purple-500" },
    { label: d["admin.dashboard.shipped"], value: metrics.shipped, color: "bg-emerald-500" },
    { label: d["admin.dashboard.failedRejected"], value: metrics.failed, color: "bg-red-500" },
    { label: d["admin.dashboard.giftCardsCreated"], value: metrics.giftCardsCreated, color: "bg-pink-500" },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.dashboard.title"]}</h1>
      <p className="text-gray-500 mt-1">{d["admin.dashboard.subtitle"]}</p>

      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-3 h-3 rounded-full ${card.color} mb-3`} />
            <p className="text-2xl font-bold text-gray-900">{card.value}</p>
            <p className="text-sm text-gray-500">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900">{d["admin.dashboard.revenue"]}</h2>
          <p className="text-3xl font-bold text-gray-900 mt-2">
            {formatCurrency(metrics.revenueKurus, locale)}
          </p>
          <p className="text-sm text-gray-500 mt-1">{d["admin.dashboard.revenueSubtitle"]}</p>
        </div>
      </div>
    </div>
  );
}
