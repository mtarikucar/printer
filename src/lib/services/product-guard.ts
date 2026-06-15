import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";
import { requireActiveSeller } from "@/lib/services/manufacturer-guard";

export type ProductEditAccess =
  | { ok: true; actor: "admin" | "seller" }
  | { ok: false; status: number };

/**
 * Shared authorization for product-owned resources (options, add-ons, image
 * tags): an admin may edit any product; an active seller may edit only the
 * products it owns. Used by the unified /api/products/[id]/options route so the
 * same editor UI works in both the admin and seller panels.
 */
export async function canEditProduct(
  productId: string
): Promise<ProductEditAccess> {
  const adminSession = await auth();
  const role = (adminSession?.user as { role?: string } | undefined)?.role;
  if (adminSession?.user?.email && role === "admin") {
    return { ok: true, actor: "admin" };
  }

  const seller = await requireActiveSeller();
  if ("manufacturerId" in seller) {
    const [p] = await db
      .select({ manufacturerId: products.manufacturerId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (p && p.manufacturerId === seller.manufacturerId) {
      return { ok: true, actor: "seller" };
    }
    return { ok: false, status: 403 };
  }
  return { ok: false, status: 401 };
}
