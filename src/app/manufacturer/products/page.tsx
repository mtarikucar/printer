export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, products } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getLocale } from "@/lib/i18n/get-locale";
import { getPublicUrl } from "@/lib/services/storage";
import { ProductsClient } from "./products-client";

export default async function ManufacturerProductsPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const locale = await getLocale();

  const rows = await db.query.products.findMany({
    where: eq(products.manufacturerId, session.manufacturerId),
    orderBy: [desc(products.createdAt)],
    with: { images: true },
  });

  const list = rows.map((p) => ({
    id: p.id,
    title: p.title,
    priceKurus: p.priceKurus,
    status: p.status,
    category: p.category,
    material: p.material,
    imageCount: p.images?.length ?? 0,
    primaryImageUrl: p.primaryImageKey ? getPublicUrl(p.primaryImageKey) : null,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="p-8 max-w-6xl">
      <ProductsClient products={list} locale={locale} />
    </div>
  );
}
