export const dynamic = "force-dynamic";

import { listVenues } from "@/lib/services/workshop-venue";
import { WorkshopsClient } from "./workshops-client";

export default async function AdminWorkshopsPage() {
  const venues = await listVenues();
  return (
    <WorkshopsClient
      venues={venues.map((v) => ({
        id: v.id,
        name: v.name,
        contactName: v.contactName,
        contactPhone: v.contactPhone,
        city: v.address.il,
        district: v.address.ilce,
        status: v.status,
        createdAt: v.createdAt.toISOString(),
      }))}
    />
  );
}
