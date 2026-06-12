export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { getLocale } from "@/lib/i18n/get-locale";
import { EditProductClient, type EditableProduct } from "./edit-client";

export default async function AdminEditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();

  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: { images: true, manufacturer: { columns: { companyName: true } } },
  });
  if (!product) notFound();

  const spec = await getProductSpec(product.id);
  const initialComponents = spec.components.map((c) => ({
    name: c.name,
    quantity: c.quantity,
    unit: c.unit ?? "",
    notes: c.notes ?? "",
  }));
  const initialSteps = spec.steps.map((s) => ({
    instruction: s.instruction,
    imageKey: s.imageKey,
    imageUrl: s.imageUrl,
  }));

  const serialized: EditableProduct = {
    id: product.id,
    ownerType: product.ownerType,
    title: product.title,
    description: product.description,
    priceKurus: product.priceKurus,
    material: product.material,
    category: product.category,
    leadTimeDays: product.leadTimeDays,
    status: product.status,
    rejectionReason: product.rejectionReason,
    sellerName: product.manufacturer?.companyName ?? "Platform",
    images: (product.images ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((img) => ({
        id: img.id,
        url: getPublicUrl(img.storageKey),
        sortOrder: img.sortOrder,
      })),
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <EditProductClient
        product={serialized}
        locale={locale}
        initialFiles={spec.files}
        initialComponents={initialComponents}
        initialSteps={initialSteps}
      />
    </div>
  );
}
