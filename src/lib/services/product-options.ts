import { db } from "@/lib/db";
import {
  productAddons,
  productImages,
  productOptionChoices,
  productOptionGroups,
} from "@/lib/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface OptionChoiceConfig {
  id: string;
  name: string;
  priceDeltaKurus: number;
  isDefault: boolean;
  /** True when this choice has its own image set (e.g. the painted gallery). */
  hasImages: boolean;
}
export interface OptionGroupConfig {
  id: string;
  name: string;
  isRequired: boolean;
  choices: OptionChoiceConfig[];
}
export interface AddonConfig {
  id: string;
  name: string;
  description: string | null;
  priceKurus: number;
}
export interface ProductConfig {
  optionGroups: OptionGroupConfig[];
  addons: AddonConfig[];
}

export interface PricedSelection {
  unitPriceKurus: number;
  selectedOptions: {
    groupName: string;
    choiceName: string;
    priceDeltaKurus: number;
  }[];
  selectedAddons: { name: string; priceKurus: number }[];
  /** Normalized ids actually applied — for cart-line identity + image resolution. */
  appliedChoiceIds: string[];
  appliedAddonIds: string[];
}

// ─── Config loading (batched) ───────────────────────────────────────────────
/**
 * Load the option groups (+choices, with hasImages) and add-ons for many
 * products at once. Used by the cart (re-pricing every line) and the buyer page.
 */
export async function loadProductConfigs(
  productIds: string[]
): Promise<Map<string, ProductConfig>> {
  const out = new Map<string, ProductConfig>();
  if (productIds.length === 0) return out;
  for (const id of productIds) out.set(id, { optionGroups: [], addons: [] });

  const groups = await db
    .select()
    .from(productOptionGroups)
    .where(inArray(productOptionGroups.productId, productIds))
    .orderBy(asc(productOptionGroups.sortOrder), asc(productOptionGroups.name));
  const groupIds = groups.map((g) => g.id);

  const choices = groupIds.length
    ? await db
        .select()
        .from(productOptionChoices)
        .where(inArray(productOptionChoices.groupId, groupIds))
        .orderBy(
          asc(productOptionChoices.sortOrder),
          asc(productOptionChoices.name)
        )
    : [];

  // Which choices carry their own image set.
  const choicesWithImages = new Set<string>();
  if (groupIds.length) {
    const choiceIds = choices.map((c) => c.id);
    if (choiceIds.length) {
      const imgs = await db
        .select({ optionChoiceId: productImages.optionChoiceId })
        .from(productImages)
        .where(inArray(productImages.optionChoiceId, choiceIds));
      for (const i of imgs) if (i.optionChoiceId) choicesWithImages.add(i.optionChoiceId);
    }
  }

  const addons = await db
    .select()
    .from(productAddons)
    .where(inArray(productAddons.productId, productIds))
    .orderBy(asc(productAddons.sortOrder), asc(productAddons.name));

  const choicesByGroup = new Map<string, OptionChoiceConfig[]>();
  for (const c of choices) {
    const list = choicesByGroup.get(c.groupId) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      priceDeltaKurus: c.priceDeltaKurus,
      isDefault: c.isDefault,
      hasImages: choicesWithImages.has(c.id),
    });
    choicesByGroup.set(c.groupId, list);
  }

  for (const g of groups) {
    const cfg = out.get(g.productId);
    if (!cfg) continue;
    cfg.optionGroups.push({
      id: g.id,
      name: g.name,
      isRequired: g.isRequired,
      choices: choicesByGroup.get(g.id) ?? [],
    });
  }
  for (const a of addons) {
    const cfg = out.get(a.productId);
    if (!cfg) continue;
    cfg.addons.push({
      id: a.id,
      name: a.name,
      description: a.description,
      priceKurus: a.priceKurus,
    });
  }
  return out;
}

export async function getProductConfig(productId: string): Promise<ProductConfig> {
  return (
    (await loadProductConfigs([productId])).get(productId) ?? {
      optionGroups: [],
      addons: [],
    }
  );
}

// ─── Pricing (pure, server-authoritative) ───────────────────────────────────
/**
 * Compute the trusted unit price for a selection. Invalid ids are ignored;
 * each group contributes at most one choice (the selected one, else its default).
 * NEVER trust a client-sent price — always recompute from the config here.
 */
export function computeSelectionPrice(
  config: ProductConfig,
  basePriceKurus: number,
  rawChoiceIds: string[],
  rawAddonIds: string[]
): PricedSelection {
  const chosen = new Set(rawChoiceIds);
  const selectedOptions: PricedSelection["selectedOptions"] = [];
  const appliedChoiceIds: string[] = [];
  let total = basePriceKurus;

  for (const group of config.optionGroups) {
    // The buyer's pick for this group, else the group's default choice.
    const picked =
      group.choices.find((c) => chosen.has(c.id)) ??
      group.choices.find((c) => c.isDefault) ??
      null;
    if (!picked) continue;
    total += picked.priceDeltaKurus;
    appliedChoiceIds.push(picked.id);
    // Only surface a line for non-zero / non-default picks worth showing.
    selectedOptions.push({
      groupName: group.name,
      choiceName: picked.name,
      priceDeltaKurus: picked.priceDeltaKurus,
    });
  }

  const addonIds = new Set(rawAddonIds);
  const selectedAddons: PricedSelection["selectedAddons"] = [];
  const appliedAddonIds: string[] = [];
  for (const addon of config.addons) {
    if (!addonIds.has(addon.id)) continue;
    total += addon.priceKurus;
    appliedAddonIds.push(addon.id);
    selectedAddons.push({ name: addon.name, priceKurus: addon.priceKurus });
  }

  return {
    unitPriceKurus: total,
    selectedOptions,
    selectedAddons,
    appliedChoiceIds,
    appliedAddonIds,
  };
}

// ─── Image resolution (painted vs default) ──────────────────────────────────
export interface ProductImageRow {
  storageKey: string;
  sortOrder: number;
  optionChoiceId: string | null;
}
/**
 * Pick the gallery to show: if a selected choice has its own image set (e.g.
 * "El boyaması" → painted photos), show those; otherwise the default gallery
 * (images with no option choice). Returns storage keys in sort order.
 */
export function resolveGalleryImageKeys(
  images: ProductImageRow[],
  selectedChoiceIds: string[]
): string[] {
  const selected = new Set(selectedChoiceIds);
  const choiceWithImages = images.find(
    (i) => i.optionChoiceId && selected.has(i.optionChoiceId)
  )?.optionChoiceId;
  const pool = choiceWithImages
    ? images.filter((i) => i.optionChoiceId === choiceWithImages)
    : images.filter((i) => !i.optionChoiceId);
  return [...pool].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.storageKey);
}

// ─── Order-line resolution (price + snapshot + image, batched) ──────────────
export interface ResolvedOrderLine {
  unitPriceKurus: number;
  selectedOptions: PricedSelection["selectedOptions"];
  selectedAddons: PricedSelection["selectedAddons"];
  /** Resolved primary image (painted set if a selected choice has one). */
  itemImageKey: string | null;
}

/**
 * Server-authoritative pricing + snapshot + image resolution for order lines.
 * Loads every product's config + images once, then resolves each line. Used by
 * the cart hydrate and the order-creation route so a line is never charged the
 * bare base price when options/add-ons were chosen.
 */
export async function resolveOrderLines(
  lines: {
    productId: string;
    basePriceKurus: number;
    optionChoiceIds: string[];
    addonIds: string[];
  }[]
): Promise<ResolvedOrderLine[]> {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const configs = await loadProductConfigs(productIds);
  const imagesByProduct = new Map<string, ProductImageRow[]>();
  if (productIds.length) {
    const imgs = await db
      .select({
        productId: productImages.productId,
        storageKey: productImages.storageKey,
        sortOrder: productImages.sortOrder,
        optionChoiceId: productImages.optionChoiceId,
      })
      .from(productImages)
      .where(inArray(productImages.productId, productIds));
    for (const i of imgs) {
      const list = imagesByProduct.get(i.productId) ?? [];
      list.push({
        storageKey: i.storageKey,
        sortOrder: i.sortOrder,
        optionChoiceId: i.optionChoiceId,
      });
      imagesByProduct.set(i.productId, list);
    }
  }

  return lines.map((line) => {
    const config = configs.get(line.productId) ?? { optionGroups: [], addons: [] };
    const priced = computeSelectionPrice(
      config,
      line.basePriceKurus,
      line.optionChoiceIds,
      line.addonIds
    );
    const gallery = resolveGalleryImageKeys(
      imagesByProduct.get(line.productId) ?? [],
      priced.appliedChoiceIds
    );
    return {
      unitPriceKurus: priced.unitPriceKurus,
      selectedOptions: priced.selectedOptions,
      selectedAddons: priced.selectedAddons,
      itemImageKey: gallery[0] ?? null,
    };
  });
}

// ─── Ownership resolvers (routes guard the product before mutating) ──────────
export async function productIdForGroup(groupId: string): Promise<string | null> {
  const [g] = await db
    .select({ productId: productOptionGroups.productId })
    .from(productOptionGroups)
    .where(eq(productOptionGroups.id, groupId))
    .limit(1);
  return g?.productId ?? null;
}
export async function productIdForChoice(choiceId: string): Promise<string | null> {
  const [c] = await db
    .select({ productId: productOptionGroups.productId })
    .from(productOptionChoices)
    .innerJoin(
      productOptionGroups,
      eq(productOptionChoices.groupId, productOptionGroups.id)
    )
    .where(eq(productOptionChoices.id, choiceId))
    .limit(1);
  return c?.productId ?? null;
}
export async function productIdForAddon(addonId: string): Promise<string | null> {
  const [a] = await db
    .select({ productId: productAddons.productId })
    .from(productAddons)
    .where(eq(productAddons.id, addonId))
    .limit(1);
  return a?.productId ?? null;
}

// ─── Mutations ──────────────────────────────────────────────────────────────
export async function createOptionGroup(input: {
  productId: string;
  name: string;
  isRequired?: boolean;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("EMPTY_NAME");
  const [row] = await db
    .insert(productOptionGroups)
    .values({
      productId: input.productId,
      name,
      isRequired: input.isRequired ?? false,
    })
    .returning();
  return row;
}
export async function updateOptionGroup(
  id: string,
  patch: { name?: string; isRequired?: boolean }
) {
  const set: Partial<typeof productOptionGroups.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("EMPTY_NAME");
    set.name = n;
  }
  if (patch.isRequired !== undefined) set.isRequired = patch.isRequired;
  await db.update(productOptionGroups).set(set).where(eq(productOptionGroups.id, id));
}
export async function deleteOptionGroup(id: string) {
  await db.delete(productOptionGroups).where(eq(productOptionGroups.id, id));
}

export async function addOptionChoice(input: {
  groupId: string;
  name: string;
  priceDeltaKurus?: number;
  isDefault?: boolean;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("EMPTY_NAME");
  // Only one default per group.
  if (input.isDefault) {
    await db
      .update(productOptionChoices)
      .set({ isDefault: false })
      .where(eq(productOptionChoices.groupId, input.groupId));
  }
  const [row] = await db
    .insert(productOptionChoices)
    .values({
      groupId: input.groupId,
      name,
      priceDeltaKurus: Math.round(input.priceDeltaKurus ?? 0),
      isDefault: input.isDefault ?? false,
    })
    .returning();
  return row;
}
export async function updateOptionChoice(
  id: string,
  patch: { name?: string; priceDeltaKurus?: number; isDefault?: boolean }
) {
  const set: Partial<typeof productOptionChoices.$inferInsert> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("EMPTY_NAME");
    set.name = n;
  }
  if (patch.priceDeltaKurus !== undefined)
    set.priceDeltaKurus = Math.round(patch.priceDeltaKurus);
  if (patch.isDefault !== undefined) set.isDefault = patch.isDefault;
  if (patch.isDefault) {
    const [c] = await db
      .select({ groupId: productOptionChoices.groupId })
      .from(productOptionChoices)
      .where(eq(productOptionChoices.id, id))
      .limit(1);
    if (c)
      await db
        .update(productOptionChoices)
        .set({ isDefault: false })
        .where(eq(productOptionChoices.groupId, c.groupId));
  }
  await db.update(productOptionChoices).set(set).where(eq(productOptionChoices.id, id));
}
export async function deleteOptionChoice(id: string) {
  await db.delete(productOptionChoices).where(eq(productOptionChoices.id, id));
}

export async function createAddon(input: {
  productId: string;
  name: string;
  description?: string | null;
  priceKurus?: number;
}) {
  const name = input.name.trim();
  if (!name) throw new Error("EMPTY_NAME");
  const [row] = await db
    .insert(productAddons)
    .values({
      productId: input.productId,
      name,
      description: input.description?.trim() || null,
      priceKurus: Math.round(input.priceKurus ?? 0),
    })
    .returning();
  return row;
}
export async function updateAddon(
  id: string,
  patch: { name?: string; description?: string | null; priceKurus?: number }
) {
  const set: Partial<typeof productAddons.$inferInsert> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("EMPTY_NAME");
    set.name = n;
  }
  if (patch.description !== undefined)
    set.description = patch.description?.trim() || null;
  if (patch.priceKurus !== undefined) set.priceKurus = Math.round(patch.priceKurus);
  await db.update(productAddons).set(set).where(eq(productAddons.id, id));
}
export async function deleteAddon(id: string) {
  await db.delete(productAddons).where(eq(productAddons.id, id));
}

/** Tag (or untag) a product image to an option choice — the painted-set link. */
export async function setImageOptionChoice(
  productId: string,
  imageId: string,
  optionChoiceId: string | null
) {
  await db
    .update(productImages)
    .set({ optionChoiceId })
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)));
}
