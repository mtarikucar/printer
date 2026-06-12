export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { NewProductClient } from "./new-product-client";

export default async function NewProductPage() {
  const session = await getManufacturerSession();
  if (!session) redirect("/manufacturer/login");

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  if (!manufacturer || manufacturer.status !== "active") {
    redirect("/manufacturer/dashboard");
  }

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <NewProductClient />
    </div>
  );
}
