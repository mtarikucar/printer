export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers, products } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { getPublicUrl } from "@/lib/services/storage";
import { getProductSpec } from "@/lib/services/product-spec";
import { EditProductClient } from "./edit-client";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  const { id } = await params;

  const product = await db.query.products.findFirst({
    where: and(
      eq(products.id, id),
      eq(products.manufacturerId, session.manufacturerId)
    ),
    with: { images: true },
  });

  if (!product) notFound();

  const images = (product.images ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((img) => ({ id: img.id, url: getPublicUrl(img.storageKey) }));

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

  const serialized = {
    id: product.id,
    title: product.title,
    description: product.description,
    priceKurus: product.priceKurus,
    material: product.material,
    category: product.category,
    leadTimeDays: product.leadTimeDays,
    status: product.status,
    rejectionReason: product.rejectionReason,
  };

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <EditProductClient
        product={serialized}
        initialImages={images}
        initialFiles={spec.files}
        initialComponents={initialComponents}
        initialSteps={initialSteps}
      />
    </div>
  );
}
