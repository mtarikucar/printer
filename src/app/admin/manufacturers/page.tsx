export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { manufacturers, orders } from "@/lib/db/schema";
import { desc, sql, eq, and, notInArray } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { ManufacturersClient } from "./manufacturers-client";

export default async function AdminManufacturersPage() {
  const locale = await getLocale();

  const allManufacturers = await db.query.manufacturers.findMany({
    orderBy: [desc(manufacturers.createdAt)],
  });

  // Get active order counts per manufacturer
  const activeOrderCounts = await db
    .select({
      manufacturerId: orders.manufacturerId,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.manufacturerId} IS NOT NULL`,
        notInArray(orders.status, ["delivered", "rejected"])
      )
    )
    .groupBy(orders.manufacturerId);

  const countMap = new Map(
    activeOrderCounts.map((r) => [r.manufacturerId, r.count])
  );

  const serialized = allManufacturers.map((m) => ({
    id: m.id,
    companyName: m.companyName,
    contactPerson: m.contactPerson,
    email: m.email,
    phone: m.phone,
    status: m.status,
    activeOrders: countMap.get(m.id) ?? 0,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <div className="p-8">
      <ManufacturersClient manufacturers={serialized} locale={locale} />
    </div>
  );
}
