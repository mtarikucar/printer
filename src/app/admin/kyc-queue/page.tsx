export const dynamic = "force-dynamic";

import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerDocuments, manufacturers } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { KycQueueClient } from "./client";

export default async function AdminKycQueuePage() {
  const docs = await db.query.manufacturerDocuments.findMany({
    where: eq(manufacturerDocuments.status, "pending"),
    with: { manufacturer: { columns: { companyName: true } } },
    orderBy: [desc(manufacturerDocuments.createdAt)],
    limit: 200,
  });
  const pendingIban = await db.query.manufacturers.findMany({
    where: eq(manufacturers.ibanReviewStatus, "pending"),
    columns: { id: true, companyName: true, iban: true, pendingIban: true },
  });

  return (
    <KycQueueClient
      docs={docs.map((x) => ({
        id: x.id,
        type: x.type,
        company: x.manufacturer?.companyName ?? "—",
        url: getPublicUrl(x.storageKey),
        createdAt: x.createdAt.toISOString(),
      }))}
      ibanChanges={pendingIban.map((m) => ({
        id: m.id,
        company: m.companyName,
        current: m.iban,
        pending: m.pendingIban,
      }))}
    />
  );
}
