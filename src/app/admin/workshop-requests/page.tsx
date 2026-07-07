export const dynamic = "force-dynamic";

import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopRequests } from "@/lib/db/schema";
import { WorkshopRequestsClient } from "./client";

export default async function AdminWorkshopRequestsPage() {
  const rows = await db.query.workshopRequests.findMany({
    orderBy: [desc(workshopRequests.createdAt)],
    limit: 300,
  });

  return (
    <WorkshopRequestsClient
      requests={rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        contactName: r.contactName,
        organizationName: r.organizationName,
        city: r.city,
        district: r.district,
        participantCount: r.participantCount,
        venueType: r.venueType,
        workshopType: r.workshopType,
        status: r.status,
        scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      }))}
    />
  );
}
