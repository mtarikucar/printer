export const dynamic = "force-dynamic";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, painterQcPhotos } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { NOT_REFUNDED } from "@/lib/services/admin-order-sql";
import { PainterQcQueueClient } from "./client";

export default async function AdminPainterQcQueuePage() {
  const rows = await db.query.orders.findMany({
    // Refunded orders are frozen, so their painter QC is not work. Same
    // predicate as the sidebar's "Boyacı QC" badge that opens this list.
    where: and(eq(orders.painterStatus, "qc_pending"), NOT_REFUNDED),
    orderBy: [desc(orders.updatedAt)],
    limit: 200,
    columns: {
      id: true, orderNumber: true, customerName: true, style: true,
      figurineSize: true, finish: true, paintingPriceKurus: true, painterQcRound: true,
    },
    with: { painter: { columns: { companyName: true } } },
  });

  const orderIds = rows.map((r) => r.id);
  const photos = orderIds.length
    ? await db.query.painterQcPhotos.findMany({
        where: inArray(painterQcPhotos.orderId, orderIds),
      })
    : [];

  return (
    <PainterQcQueueClient
      jobs={rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        painterName: r.painter?.companyName ?? "—",
        customerName: r.customerName,
        style: r.style,
        figurineSize: r.figurineSize,
        finish: r.finish,
        paintingPriceKurus: r.paintingPriceKurus,
        photos: photos
          .filter((p) => p.orderId === r.id && p.round === r.painterQcRound)
          .map((p) => ({ id: p.id, url: getPublicUrl(p.thumbnailKey || p.storageKey), fullUrl: getPublicUrl(p.storageKey) })),
      }))}
    />
  );
}
