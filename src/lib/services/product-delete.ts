import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  orderItems,
  orderDrafts,
  productReviews,
  productImages,
  products,
} from "@/lib/db/schema";
import { deleteFile } from "@/lib/services/storage";

/**
 * How many history rows reference this product. A product is only HARD-deletable
 * when this is 0 — orders/drafts/order-items/reviews must keep their product
 * reference for invoices, payouts and history (those FKs are RESTRICT, so a
 * delete would be rejected by the DB anyway). The product's own sub-resources
 * (images, options, add-ons, files, BOM, steps) cascade and don't count.
 */
export async function productReferenceCount(productId: string): Promise<number> {
  const tables = [
    db.select({ c: count() }).from(orders).where(eq(orders.productId, productId)),
    db
      .select({ c: count() })
      .from(orderItems)
      .where(eq(orderItems.productId, productId)),
    db
      .select({ c: count() })
      .from(orderDrafts)
      .where(eq(orderDrafts.productId, productId)),
    db
      .select({ c: count() })
      .from(productReviews)
      .where(eq(productReviews.productId, productId)),
  ];
  const results = await Promise.all(tables);
  return results.reduce((sum, [row]) => sum + Number(row?.c ?? 0), 0);
}

export type HardDeleteResult =
  | { ok: true }
  | { ok: false; reason: "has_relations" | "not_found" };

/**
 * Permanently delete a product when it has NO history references. Cascade FKs
 * remove its images/options/add-ons/files/BOM/steps rows; the image files on
 * disk are cleaned best-effort afterwards. If any order/draft/order-item/review
 * references it, the delete is refused (the product should be archived instead).
 */
export async function hardDeleteProduct(
  productId: string
): Promise<HardDeleteResult> {
  if ((await productReferenceCount(productId)) > 0) {
    return { ok: false, reason: "has_relations" };
  }

  // Collect storage keys before the cascade removes the rows, to clean disk.
  const imageKeys = (
    await db
      .select({ k: productImages.storageKey })
      .from(productImages)
      .where(eq(productImages.productId, productId))
  ).map((r) => r.k);

  const [deleted] = await db
    .delete(products)
    .where(eq(products.id, productId))
    .returning({ id: products.id });
  if (!deleted) return { ok: false, reason: "not_found" };

  for (const key of imageKeys) {
    await deleteFile(key).catch(() => {});
  }
  return { ok: true };
}

/** Seller-scoped guard: only hard-delete a product the manufacturer owns. */
export async function hardDeleteOwnedProduct(
  productId: string,
  manufacturerId: string
): Promise<HardDeleteResult> {
  const [owned] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.manufacturerId, manufacturerId)))
    .limit(1);
  if (!owned) return { ok: false, reason: "not_found" };
  return hardDeleteProduct(productId);
}
