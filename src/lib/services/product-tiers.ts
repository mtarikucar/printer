import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { productPriceTiers, products } from "@/lib/db/schema";
import {
  ABSOLUTE_MAX_LINE_QTY,
  MAX_TIERS_PER_PRODUCT,
  MIN_TIER_QUANTITY,
} from "@/lib/config/bulk";
import type { PriceTierConfig } from "@/lib/services/product-options";

/**
 * Toplu sipariş volume tiers: read, validate, replace.
 *
 * Kept out of product-options.ts on purpose — that module is the hot pricing
 * path read on every cart render, and mixing admin-only mutations into it would
 * grow a file that every request already pays to parse.
 */

export interface TierInput {
  minQuantity: number;
  unitPriceKurus: number;
}

export type TierValidationError =
  | "not_admin_product"
  | "too_many"
  | "min_quantity_too_low"
  | "min_quantity_too_high"
  | "min_quantity_duplicate"
  | "price_not_positive"
  | "price_not_below_base"
  | "price_not_decreasing"
  | "max_quantity_below_top_tier"
  | "bulk_without_tiers";

const MESSAGES: Record<TierValidationError, string> = {
  not_admin_product:
    "Toplu fiyat kademeleri yalnızca platform ürünlerinde tanımlanabilir.",
  too_many: `En fazla ${MAX_TIERS_PER_PRODUCT} kademe tanımlayabilirsiniz.`,
  min_quantity_too_low: `Kademe adedi en az ${MIN_TIER_QUANTITY} olmalı (1 adet zaten liste fiyatıdır).`,
  min_quantity_too_high: `Kademe adedi en fazla ${ABSOLUTE_MAX_LINE_QTY} olabilir.`,
  min_quantity_duplicate: "Aynı adet için birden fazla kademe tanımlanamaz.",
  price_not_positive: "Kademe birim fiyatı sıfırdan büyük olmalı.",
  price_not_below_base: "Kademe birim fiyatı ürünün liste fiyatından düşük olmalı.",
  price_not_decreasing:
    "Adet arttıkça birim fiyat düşmeli — daha yüksek adet için daha pahalı bir kademe tanımlanamaz.",
  max_quantity_below_top_tier:
    "Ürünün adet tavanı en yüksek kademenin altında olamaz; aksi halde o kademeye hiç ulaşılamaz.",
  bulk_without_tiers:
    "Toplu siparişe açılan ürün için en az bir fiyat kademesi tanımlamalısınız.",
};

export function tierErrorMessage(code: TierValidationError): string {
  return MESSAGES[code];
}

export interface ValidateTiersArgs {
  basePriceKurus: number;
  tiers: TierInput[];
  /** Product-level ceiling being saved alongside (null → the global default). */
  bulkMaxQuantity: number | null;
  bulkEnabled: boolean;
  ownerType: "admin" | "seller";
}

/**
 * Enforce the invariants that make a tier ladder safe to charge against.
 * Returns the sorted, normalized ladder or the first violated rule.
 *
 * The decreasing-price rules are the load-bearing ones: without them an admin
 * typo ships a "buy more, pay more" ladder that silently overcharges every
 * bulk customer, and the cart's own UI would cheerfully advertise it as a
 * discount.
 */
export function validateTiers(
  args: ValidateTiersArgs
):
  | { ok: true; tiers: PriceTierConfig[] }
  | { ok: false; error: TierValidationError } {
  const { basePriceKurus, bulkEnabled, bulkMaxQuantity, ownerType } = args;

  // v1 scope: a tier on a seller's product would cut their 65% payout without
  // their consent (commission is a flat 3500bps). That is a partner-contract
  // decision, so the door stays shut here rather than in the UI only.
  if (ownerType !== "admin" && (bulkEnabled || args.tiers.length > 0)) {
    return { ok: false, error: "not_admin_product" };
  }

  if (args.tiers.length > MAX_TIERS_PER_PRODUCT) {
    return { ok: false, error: "too_many" };
  }
  if (bulkEnabled && args.tiers.length === 0) {
    return { ok: false, error: "bulk_without_tiers" };
  }

  const tiers = [...args.tiers].sort((a, b) => a.minQuantity - b.minQuantity);

  let previousPrice: number | null = null;
  let previousQty: number | null = null;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < MIN_TIER_QUANTITY) {
      return { ok: false, error: "min_quantity_too_low" };
    }
    if (tier.minQuantity > ABSOLUTE_MAX_LINE_QTY) {
      return { ok: false, error: "min_quantity_too_high" };
    }
    if (previousQty !== null && tier.minQuantity === previousQty) {
      return { ok: false, error: "min_quantity_duplicate" };
    }
    if (!Number.isInteger(tier.unitPriceKurus) || tier.unitPriceKurus <= 0) {
      return { ok: false, error: "price_not_positive" };
    }
    if (tier.unitPriceKurus >= basePriceKurus) {
      return { ok: false, error: "price_not_below_base" };
    }
    if (previousPrice !== null && tier.unitPriceKurus >= previousPrice) {
      return { ok: false, error: "price_not_decreasing" };
    }
    previousPrice = tier.unitPriceKurus;
    previousQty = tier.minQuantity;
  }

  // An explicit ceiling under the top rung makes that rung unreachable, which
  // reads to the customer as an advertised price they can never buy at.
  const topTierQty = tiers.length ? tiers[tiers.length - 1].minQuantity : 0;
  if (bulkMaxQuantity != null && bulkMaxQuantity < topTierQty) {
    return { ok: false, error: "max_quantity_below_top_tier" };
  }

  return { ok: true, tiers };
}

export async function listTiers(productId: string): Promise<PriceTierConfig[]> {
  const rows = await db
    .select({
      minQuantity: productPriceTiers.minQuantity,
      unitPriceKurus: productPriceTiers.unitPriceKurus,
    })
    .from(productPriceTiers)
    .where(eq(productPriceTiers.productId, productId))
    .orderBy(asc(productPriceTiers.minQuantity));
  return rows;
}

/**
 * Replace a product's whole ladder atomically (delete + insert in one tx),
 * mirroring how the product spec editor replaces components/steps. Partial
 * updates are deliberately not supported: a half-applied ladder can violate the
 * decreasing-price invariant that validateTiers just proved for the whole set.
 */
export async function replaceTiers(
  productId: string,
  tiers: PriceTierConfig[]
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(productPriceTiers)
      .where(eq(productPriceTiers.productId, productId));
    if (tiers.length === 0) return;
    await tx.insert(productPriceTiers).values(
      tiers.map((t, i) => ({
        productId,
        minQuantity: t.minQuantity,
        unitPriceKurus: t.unitPriceKurus,
        sortOrder: i,
      }))
    );
  });
}

/**
 * Guard for product PATCH routes: a base-price edit must not sink to or below
 * an existing tier. validateTiers proves `tier < base` at tier-save time, but
 * nothing stops a later price edit from inverting it — at which point buying
 * more would cost more.
 */
export async function basePriceConflictsWithTiers(
  productId: string,
  newBasePriceKurus: number
): Promise<boolean> {
  const tiers = await listTiers(productId);
  return tiers.some((t) => t.unitPriceKurus >= newBasePriceKurus);
}

/** Product columns the bulk settings live on, for routes that need them. */
export async function getProductBulkSettings(productId: string) {
  const row = await db.query.products.findFirst({
    where: eq(products.id, productId),
    columns: {
      id: true,
      ownerType: true,
      priceKurus: true,
      bulkEnabled: true,
      boxEligible: true,
      bulkMaxQuantity: true,
      bulkLeadTimeDays: true,
    },
  });
  return row ?? null;
}
