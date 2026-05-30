export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/types";

export default async function ManufacturerDashboardPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer) redirect("/manufacturer/login");

  const locale = (await getLocale()) as Locale;
  const d = getDictionary(locale);

  // Not yet active (pending approval / suspended): show a status card instead
  // of order data. This is also where the orders/[id] guards land non-active
  // manufacturers, so it must be a terminal page (no redirect back to orders).
  if (manufacturer.status !== "active") {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">
          {d["manufacturer.dashboard.title"]}
        </h1>
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="font-medium text-amber-900">
            {d["manufacturer.dashboard.pendingApproval"]}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {d["manufacturer.dashboard.pendingApprovalDesc"]}
          </p>
        </div>
      </div>
    );
  }

  const mfgId = session.manufacturerId;
  const [[total], [assigned], [printing], [shipped], recent] =
    await Promise.all([
      db.select({ c: count() }).from(orders).where(eq(orders.manufacturerId, mfgId)),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.manufacturerId, mfgId), eq(orders.manufacturerStatus, "assigned"))),
      db
        .select({ c: count() })
        .from(orders)
        .where(and(eq(orders.manufacturerId, mfgId), eq(orders.manufacturerStatus, "printing"))),
      db
        .select({ c: count() })
        .from(orders)
        .where(
          and(
            eq(orders.manufacturerId, mfgId),
            eq(orders.manufacturerStatus, "shipped"),
            sql`${orders.shippedAt} >= date_trunc('month', now())`
          )
        ),
      db.query.orders.findMany({
        where: eq(orders.manufacturerId, mfgId),
        orderBy: [desc(orders.assignedToManufacturerAt)],
        limit: 5,
        columns: {
          id: true,
          orderNumber: true,
          customerName: true,
          manufacturerStatus: true,
          assignedToManufacturerAt: true,
        },
      }),
    ]);

  const stats = [
    { label: d["manufacturer.dashboard.totalOrders"], value: total?.c ?? 0 },
    { label: d["manufacturer.dashboard.newAssignments"], value: assigned?.c ?? 0 },
    { label: d["manufacturer.dashboard.currentlyPrinting"], value: printing?.c ?? 0 },
    { label: d["manufacturer.dashboard.shippedThisMonth"], value: shipped?.c ?? 0 },
  ];

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">
        {d["manufacturer.dashboard.title"]}
      </h1>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="font-semibold text-gray-900">
            {d["manufacturer.dashboard.recentOrders"]}
          </h2>
          <Link href="/manufacturer/orders" className="text-sm text-indigo-600 hover:underline">
            {d["manufacturer.orders.title"] ?? "Siparişler"}
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">
            {locale === "en" ? "No orders yet." : "Henüz sipariş yok."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/manufacturer/orders/${o.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-gray-50"
                >
                  <span className="font-mono text-sm text-indigo-600">{o.orderNumber}</span>
                  <span className="text-sm text-gray-600">{o.customerName}</span>
                  <span className="text-xs text-gray-500">
                    {o.manufacturerStatus
                      ? (d[`manufacturer.status.${o.manufacturerStatus}` as keyof typeof d] as string) ?? o.manufacturerStatus
                      : "—"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {o.assignedToManufacturerAt
                      ? formatDate(o.assignedToManufacturerAt, locale)
                      : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
