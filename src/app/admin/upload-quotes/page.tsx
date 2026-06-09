export const dynamic = "force-dynamic";

import { and, eq, isNotNull, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadedModels } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { UploadQuotesClient } from "./client";

// Faz 3 quote-bridge queue: uploaded models that need a manual price (status
// 'review') and have a contact email (a real customer request).
export default async function AdminUploadQuotesPage() {
  const rows = await db.query.uploadedModels.findMany({
    where: and(
      eq(uploadedModels.status, "review"),
      isNotNull(uploadedModels.contactEmail)
    ),
    orderBy: [desc(uploadedModels.createdAt)],
    limit: 200,
  });

  return (
    <UploadQuotesClient
      models={rows.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        material: m.material,
        targetHeightMm: m.targetHeightMm,
        volumeMm3: m.volumeMm3,
        isVolume: m.isVolume,
        boundingBoxMm: m.boundingBoxMm,
        printRisk: m.printRisk,
        contactEmail: m.contactEmail,
        quoteStatus: m.quoteStatus,
        quotedPriceKurus: m.quotedPriceKurus,
        glbPreviewUrl: m.glbPreviewKey ? getPublicUrl(m.glbPreviewKey) : null,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}
