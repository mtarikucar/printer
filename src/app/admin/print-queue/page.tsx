export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders, manufacturers } from "@/lib/db/schema";
import { desc, inArray, eq, sql } from "drizzle-orm";
import { PrintQueueClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function PrintQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const queueOrders = await db.query.orders.findMany({
    where: inArray(orders.status, ["approved", "printing"]),
    orderBy: [desc(orders.updatedAt)],
    with: {
      manufacturer: {
        columns: { id: true, companyName: true },
      },
    },
  });

  const queueItems = queueOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
    manufacturerName: order.manufacturer?.companyName ?? null,
    updatedAt: order.updatedAt.toISOString(),
  }));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.manufacturingQueue.title"]}</h1>
      <p className="text-gray-500 mt-1">
        {d["admin.manufacturingQueue.subtitle"]}
      </p>

      <PrintQueueClient items={queueItems} />
    </div>
  );
}
