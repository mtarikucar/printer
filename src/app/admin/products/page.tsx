export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { getPublicUrl } from "@/lib/services/storage";
import { getLocale } from "@/lib/i18n/get-locale";
import { ProductsClient, type AdminProduct } from "./products-client";

export default async function AdminProductsPage() {
  const locale = await getLocale();

  const pending = await db.query.products.findMany({
    where: eq(products.status, "pending_review"),
    orderBy: [desc(products.submittedAt)],
    with: { images: true, manufacturer: { columns: { companyName: true } } },
  });

  const all = await db.query.products.findMany({
    orderBy: [desc(products.createdAt)],
    with: { images: true, manufacturer: { columns: { companyName: true } } },
  });

  const serialize = (p: (typeof all)[number]): AdminProduct => ({
    id: p.id,
    slug: p.slug,
    ownerType: p.ownerType,
    title: p.title,
    priceKurus: p.priceKurus,
    description: p.description,
    material: p.material,
    category: p.category,
    leadTimeDays: p.leadTimeDays,
    status: p.status,
    rejectionReason: p.rejectionReason,
    sellerName: p.manufacturer?.companyName ?? "Platform",
    createdAt: p.createdAt.toISOString(),
    submittedAt: p.submittedAt ? p.submittedAt.toISOString() : null,
    primaryImageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    images: (p.images ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({
        id: img.id,
        url: getPublicUrl(img.storageKey),
        sortOrder: img.sortOrder,
      })),
  });

  return (
    <div className="p-4 sm:p-8">
      <ProductsClient
        pending={pending.map(serialize)}
        all={all.map(serialize)}
        locale={locale}
      />
    </div>
  );
}
