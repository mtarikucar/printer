export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { PrintQueueClient } from "./client";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import {
  IS_REFUNDED,
  NOT_REFUNDED,
  REFUNDED_OPEN,
} from "@/lib/services/admin-order-sql";

// Statuses an order passes through while a manufacturer, or the painter after
// it, holds it: approved → printing → quality_check (printed, QC photos, admin
// QC) → painting (painted orders only). The queue used to read only approved
// and printing, so every order in QC or with a painter dropped off it.
// Marketplace orders are assigned while still at `paid`: platform products wait
// there for a manufacturer, and a seller's own product goes to that seller at
// payment. So paid marketplace orders are in scope too.
const IN_QUEUE = or(
  inArray(orders.status, ["approved", "printing", "quality_check", "painting"]),
  and(eq(orders.orderType, "marketplace"), eq(orders.status, "paid"))
);

export default async function PrintQueuePage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const [queueOrders, [{ refundedHidden }], [{ refundedOpen }]] = await Promise.all([
    // Refunded orders keep their status but every forward action on them is
    // refused, so they are not queue work. They are counted separately below
    // so the desk knows they exist.
    db.query.orders.findMany({
      where: and(NOT_REFUNDED, IN_QUEUE),
      orderBy: [desc(orders.updatedAt)],
      with: {
        manufacturer: {
          columns: { id: true, companyName: true, paintsInHouse: true },
        },
        painter: {
          columns: { id: true, companyName: true },
        },
      },
    }),
    db
      .select({ refundedHidden: count() })
      .from(orders)
      .where(and(IS_REFUNDED, IN_QUEUE)),
    // The banner links to the orders list's refunded_open bucket (every open
    // refund), a superset of the hidden ones: it also holds refunds that
    // stopped outside this queue (model or review stage, shipped, ...). Its
    // own count goes on the link, so the number there matches the list.
    db.select({ refundedOpen: count() }).from(orders).where(REFUNDED_OPEN),
  ]);

  const queueItems = queueOrders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    status: order.status,
    manufacturerStatus: order.manufacturerStatus,
    manufacturerName: order.manufacturer?.companyName ?? null,
    // The ship gate for painted orders depends on it: a shop that paints in
    // house ships the job itself instead of handing it to a painter.
    manufacturerPaintsInHouse: order.manufacturer?.paintsInHouse ?? false,
    needsPainting: order.needsPainting,
    painterId: order.painterId,
    painterName: order.painter?.companyName ?? null,
    painterStatus: order.painterStatus,
    // A workshop-session order never ships one by one (the admin ships the
    // batch to the venue), so the classifier needs it. findMany above reads
    // every column, so this is already on the row.
    workshopSessionId: order.workshopSessionId,
    updatedAt: order.updatedAt.toISOString(),
  }));

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.manufacturingQueue.title"]}</h1>
      <p className="text-gray-500 mt-1">
        {d["admin.manufacturingQueue.subtitle"]}
      </p>

      <PrintQueueClient
        items={queueItems}
        refundedHidden={refundedHidden}
        refundedOpen={refundedOpen}
      />
    </div>
  );
}
