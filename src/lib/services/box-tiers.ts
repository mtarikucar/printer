import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boxPriceTiers, products } from "@/lib/db/schema";
import {
  ABSOLUTE_MAX_LINE_QTY,
  BOX_QUANTITY_STEP,
  MAX_TIERS_PER_PRODUCT,
  type PriceTierConfig,
} from "@/lib/config/bulk";

/**
 * Anahtarlık kutusu: the single, global box price ladder.
 *
 * Deliberately not per product. A box is priced on its TOTAL piece count across
 * designs, so one ladder describes the whole offer. See the boxPriceTiers table
 * comment for why that is the point of the box surface existing at all.
 */

export interface BoxTierInput {
  minQuantity: number;
  unitPriceKurus: number;
}

export type BoxTierValidationError =
  | "too_many"
  | "not_a_step_multiple"
  | "min_quantity_too_low"
  | "min_quantity_too_high"
  | "min_quantity_duplicate"
  | "price_not_positive"
  | "price_not_decreasing"
  | "price_above_cheapest_product";

export function boxTierErrorMessage(
  code: BoxTierValidationError,
  context?: { cheapestProductTitle?: string; cheapestPriceKurus?: number }
): string {
  switch (code) {
    case "too_many":
      return `En fazla ${MAX_TIERS_PER_PRODUCT} kademe tanımlayabilirsiniz.`;
    case "not_a_step_multiple":
      return `Kutu adetleri ${BOX_QUANTITY_STEP}'un katı olmalı (müşteri de ${BOX_QUANTITY_STEP}'ar ${BOX_QUANTITY_STEP}'ar seçiyor).`;
    case "min_quantity_too_low":
      return `En düşük kademe en az ${BOX_QUANTITY_STEP} adet olmalı.`;
    case "min_quantity_too_high":
      return `Kademe adedi en fazla ${ABSOLUTE_MAX_LINE_QTY} olabilir.`;
    case "min_quantity_duplicate":
      return "Aynı adet için birden fazla kademe tanımlanamaz.";
    case "price_not_positive":
      return "Kutu birim fiyatı sıfırdan büyük olmalı.";
    case "price_not_decreasing":
      return "Adet arttıkça birim fiyat düşmeli — daha yüksek adet için daha pahalı bir kademe tanımlanamaz.";
    case "price_above_cheapest_product":
      return `Kutu birim fiyatı, kutuya uygun en ucuz ürünün liste fiyatının (${
        context?.cheapestProductTitle ?? "?"
      } — ₺${((context?.cheapestPriceKurus ?? 0) / 100).toFixed(2)}) altında olmalı; aksi halde kutu, ürünü tek tek almaktan pahalıya gelir.`;
  }
}

export interface ValidateBoxTiersArgs {
  tiers: BoxTierInput[];
  /** Lowest list price among box-eligible products, if any are flagged yet. */
  cheapestEligiblePriceKurus: number | null;
}

/**
 * Enforce that the ladder actually rewards a bigger box, and that the box is
 * never a worse deal than buying the same item normally.
 */
export function validateBoxTiers(
  args: ValidateBoxTiersArgs
):
  | { ok: true; tiers: PriceTierConfig[] }
  | { ok: false; error: BoxTierValidationError } {
  if (args.tiers.length > MAX_TIERS_PER_PRODUCT) {
    return { ok: false, error: "too_many" };
  }

  const tiers = [...args.tiers].sort((a, b) => a.minQuantity - b.minQuantity);

  let previousPrice: number | null = null;
  let previousQty: number | null = null;
  for (const tier of tiers) {
    if (!Number.isInteger(tier.minQuantity) || tier.minQuantity < BOX_QUANTITY_STEP) {
      return { ok: false, error: "min_quantity_too_low" };
    }
    if (tier.minQuantity % BOX_QUANTITY_STEP !== 0) {
      return { ok: false, error: "not_a_step_multiple" };
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
    if (previousPrice !== null && tier.unitPriceKurus >= previousPrice) {
      return { ok: false, error: "price_not_decreasing" };
    }
    // A box rung at or above the cheapest eligible product's list price means
    // that design is cheaper bought one at a time — the same "buy more, pay
    // more" trap the per-product ladder guards against, across the box border.
    if (
      args.cheapestEligiblePriceKurus != null &&
      tier.unitPriceKurus >= args.cheapestEligiblePriceKurus
    ) {
      return { ok: false, error: "price_above_cheapest_product" };
    }
    previousPrice = tier.unitPriceKurus;
    previousQty = tier.minQuantity;
  }

  return { ok: true, tiers };
}

export async function listBoxTiers(): Promise<PriceTierConfig[]> {
  return db
    .select({
      minQuantity: boxPriceTiers.minQuantity,
      unitPriceKurus: boxPriceTiers.unitPriceKurus,
    })
    .from(boxPriceTiers)
    .orderBy(asc(boxPriceTiers.minQuantity));
}

/** Atomic replace of the whole ladder — its invariants only hold as a set. */
export async function replaceBoxTiers(tiers: PriceTierConfig[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(boxPriceTiers);
    if (tiers.length === 0) return;
    await tx.insert(boxPriceTiers).values(
      tiers.map((t, i) => ({
        minQuantity: t.minQuantity,
        unitPriceKurus: t.unitPriceKurus,
        sortOrder: i,
      }))
    );
  });
}

/** Cheapest box-eligible listing, for the "box must beat buying singly" rule. */
export async function cheapestBoxEligible(): Promise<{
  title: string;
  priceKurus: number;
} | null> {
  const [product] = await db
    .select({ title: products.title, priceKurus: products.priceKurus })
    .from(products)
    .where(and(eq(products.boxEligible, true), eq(products.status, "active")))
    .orderBy(asc(products.priceKurus))
    .limit(1);
  return product ?? null;
}
