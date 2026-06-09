import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { uploadedModels } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { SiteHeader } from "@/components/site-header";
import { QuoteClient } from "./client";

// Customer-facing accept page for an uploaded-model quote (or a ready auto-price
// re-entry). The id is the capability (linked from the quote email / account).
export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const m = await db.query.uploadedModels.findFirst({
    where: eq(uploadedModels.id, id),
  });
  if (!m) notFound();

  return (
    <main className="min-h-screen bg-bg-base">
      <SiteHeader />
      <QuoteClient
        model={{
          id: m.id,
          fileName: m.fileName,
          status: m.status,
          quoteStatus: m.quoteStatus,
          quotedPriceKurus: m.quotedPriceKurus,
          priceKurus: m.priceKurus,
          glbPreviewUrl: m.glbPreviewKey ? getPublicUrl(m.glbPreviewKey) : null,
        }}
      />
    </main>
  );
}
