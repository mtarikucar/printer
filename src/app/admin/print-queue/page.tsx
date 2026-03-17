export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc, inArray } from "drizzle-orm";
import { PrintQueueClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";

export default async function PrintQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const approvedOrders = await db.query.orders.findMany({
    where: inArray(orders.status, ["approved", "printing"]),
    orderBy: [desc(orders.updatedAt)],
  });

  const queueItems = approvedOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    updatedAt: order.updatedAt.toISOString(),
  }));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.printQueue.title"]}</h1>
      <p className="text-gray-500 mt-1">
        {d["admin.printQueue.subtitle"]}
      </p>

      <PrintQueueClient items={queueItems} />
    </div>
  );
}
