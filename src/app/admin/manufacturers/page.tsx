export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { manufacturers, orders, manufacturerDocuments } from "@/lib/db/schema";
import { desc, sql, eq, and, notInArray } from "drizzle-orm";
import { getPublicUrl } from "@/lib/services/storage";
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

  const photos = await db.query.manufacturerDocuments.findMany({
    where: eq(manufacturerDocuments.type, "printer_photo"),
    orderBy: [desc(manufacturerDocuments.createdAt)],
  });
  const photoMap = new Map<string, string>();
  for (const p of photos) {
    if (!photoMap.has(p.manufacturerId)) photoMap.set(p.manufacturerId, getPublicUrl(p.storageKey));
  }

  const serialized = allManufacturers.map((m) => ({
    id: m.id,
    companyName: m.companyName,
    contactPerson: m.contactPerson,
    email: m.email,
    phone: m.phone,
    taxId: m.taxId,
    taxIdType: m.taxIdType as "vkn" | "tckn" | null,
    requiresManualTaxReview: m.requiresManualTaxReview,
    status: m.status,
    activeOrders: countMap.get(m.id) ?? 0,
    createdAt: m.createdAt.toISOString(),
    rejectionReason: m.rejectionReason,
    printerPhotoUploadedAt: m.printerPhotoUploadedAt ? m.printerPhotoUploadedAt.toISOString() : null,
    printerPhotoUrl: photoMap.get(m.id) ?? null,
  }));

  return (
    <div className="p-4 sm:p-8">
      <ManufacturersClient manufacturers={serialized} locale={locale} />
    </div>
  );
}
