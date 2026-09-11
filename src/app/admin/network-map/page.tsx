export const dynamic = "force-dynamic";

import { getAdminNetworkPartners } from "@/lib/services/network-map";
import { NetworkMapClient } from "./network-map-client";

export default async function AdminNetworkMapPage({
  searchParams,
}: {
  searchParams: Promise<{ partner?: string }>;
}) {
  const sp = await searchParams;
  const partners = await getAdminNetworkPartners();
  return <NetworkMapClient partners={partners} initialPartnerId={sp.partner ?? null} />;
}
