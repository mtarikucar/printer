export const dynamic = "force-dynamic";

import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputes } from "@/lib/db/schema";
import { DisputesClient } from "./client";

export default async function AdminDisputesPage() {
  const open = await db.query.disputes.findMany({
    where: eq(disputes.status, "open"),
    with: { order: { columns: { orderNumber: true } } },
    orderBy: [desc(disputes.createdAt)],
    limit: 200,
  });

  return (
    <DisputesClient
      disputes={open.map((x) => ({
        id: x.id,
        orderNumber: x.order?.orderNumber ?? "—",
        category: x.category,
        description: x.description,
        createdAt: x.createdAt.toISOString(),
      }))}
    />
  );
}
