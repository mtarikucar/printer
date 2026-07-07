export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workshopRequests } from "@/lib/db/schema";
import { WorkshopRequestDetailClient } from "./client";

export default async function AdminWorkshopRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const req = await db.query.workshopRequests.findFirst({
    where: eq(workshopRequests.id, id),
    with: { user: { columns: { email: true } } },
  });
  if (!req) notFound();

  return (
    <WorkshopRequestDetailClient
      data={{
        id: req.id,
        reference: req.reference,
        status: req.status,
        contactName: req.contactName,
        contactEmail: req.contactEmail,
        contactPhone: req.contactPhone,
        organizationName: req.organizationName,
        venueType: req.venueType,
        city: req.city,
        district: req.district,
        addressLine: req.addressLine,
        participantCount: req.participantCount,
        ageGroup: req.ageGroup,
        workshopType: req.workshopType,
        preferredDate: req.preferredDate,
        alternativeDate: req.alternativeDate,
        budgetRange: req.budgetRange,
        message: req.message,
        howHeard: req.howHeard,
        adminNotes: req.adminNotes,
        rejectionReason: req.rejectionReason,
        quotedPriceKurus: req.quotedPriceKurus,
        scheduledAt: req.scheduledAt ? req.scheduledAt.toISOString() : null,
        adminEmail: req.adminEmail,
        accountEmail: req.user?.email ?? null,
        createdAt: req.createdAt.toISOString(),
        updatedAt: req.updatedAt.toISOString(),
      }}
    />
  );
}
