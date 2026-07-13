export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { painters, orders } from "@/lib/db/schema";
import { ACTIVE_PAINTER_ORDER_STATUSES } from "@/lib/services/painter-qc";
import { desc, sql, and, inArray } from "drizzle-orm";
import { getPublicUrl } from "@/lib/services/storage";
import { getLocale } from "@/lib/i18n/get-locale";
import { PaintersClient } from "./painters-client";

export default async function AdminPaintersPage() {
  const locale = await getLocale();

  const allPainters = await db.query.painters.findMany({
    orderBy: [desc(painters.createdAt)],
  });

  // Active painting-job counts per painter. A job is "active" from the moment it
  // is assigned until it is painted; once shipped it is done (mirrors the
  // manufacturer active-order count against the painter sub-lifecycle).
  const activeOrderCounts = await db
    .select({
      painterId: orders.painterId,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(
      and(
        sql`${orders.painterId} IS NOT NULL`,
        inArray(orders.painterStatus, [...ACTIVE_PAINTER_ORDER_STATUSES])
      )
    )
    .groupBy(orders.painterId);

  const countMap = new Map(
    activeOrderCounts.map((r) => [r.painterId, r.count])
  );

  const serialized = allPainters.map((p) => ({
    id: p.id,
    companyName: p.companyName,
    contactPerson: p.contactPerson,
    email: p.email,
    phone: p.phone,
    taxId: p.taxId,
    taxIdType: p.taxIdType as "vkn" | "tckn" | null,
    requiresManualTaxReview: p.requiresManualTaxReview,
    status: p.status,
    activeOrders: countMap.get(p.id) ?? 0,
    createdAt: p.createdAt.toISOString(),
    rejectionReason: p.rejectionReason,
    workSamplePhotoUploadedAt: p.workSamplePhotoUploadedAt
      ? p.workSamplePhotoUploadedAt.toISOString()
      : null,
    workSamplePhotoUrl: p.workSamplePhotoKey ? getPublicUrl(p.workSamplePhotoKey) : null,
    // Full application details (what the applicant chose at registration).
    whatsappPhone: p.whatsappPhone,
    address: p.address,
    iban: p.iban,
    bankAccountHolder: p.bankAccountHolder,
    bankName: p.bankName,
    maxConcurrentOrders: p.maxConcurrentOrders,
    acceptingOrders: p.acceptingOrders,
    capabilities: p.capabilities ?? [],
    onboardingAcceptedAt: p.onboardingAcceptedAt ? p.onboardingAcceptedAt.toISOString() : null,
    strikeCount: p.strikeCount,
  }));

  return (
    <div className="p-4 sm:p-8">
      <PaintersClient painters={serialized} locale={locale} />
    </div>
  );
}
