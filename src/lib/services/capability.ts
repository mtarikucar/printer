// Manufacturer capability matching for assignment. `capabilities` is a string[]
// a manufacturer declares (materials, max sizes, styles). An order derives a set
// of required capability tags; a manufacturer matches when it declares them all.
// Pure + unit-tested (scripts/test-capability.ts). The existing Q7 ranker can use
// capabilityMatch as a hard filter and capabilityScore as a soft boost.

import { presetHeightMm } from "@/lib/config/sizes";

/**
 * Nominal height at which an order needs a large-format printer, in mm.
 *
 * Derived from the pre-2026-08-24 rule, which required `large_format` for the
 * retired "buyuk" tier — 120 mm. Keying off the tier KEY silently broke when
 * the catalogue collapsed to one 150 mm preset: `standart` is not "buyuk", so
 * every new order stopped requiring large_format even though it is TALLER than
 * the tier that used to require it. Comparing millimetres keeps the original
 * operational intent intact across any future preset rename or resize.
 */
export const LARGE_FORMAT_MIN_MM = 120;

export function orderRequirements(opts: {
  style?: string;
  figurineSize?: string;
}): string[] {
  const reqs: string[] = [];
  // `presetHeightMm` resolves every preset ever sold (current + retired) and
  // returns null for a free-form bespoke measurement ("17,5 cm"). Free-form
  // sizes only exist on orders an admin priced and assigned BY HAND, so there
  // is no automatic requirement to derive: adding a speculative large_format
  // tag there would shrink the candidate pool for orders a human is already
  // routing. Unknown height → no requirement, same as before.
  const heightMm = opts.figurineSize ? presetHeightMm(opts.figurineSize) : null;
  if (heightMm !== null && heightMm >= LARGE_FORMAT_MIN_MM) reqs.push("large_format");
  // Stylized work (anime/storybook/chibi) benefits from a manufacturer skilled in it.
  if (opts.style && ["anime", "storybook", "chibi"].includes(opts.style)) {
    reqs.push(`style_${opts.style}`);
  }
  return reqs;
}

export function capabilityMatch(
  capabilities: string[] | null | undefined,
  required: string[]
): boolean {
  if (required.length === 0) return true;
  const set = new Set(capabilities ?? []);
  return required.every((r) => set.has(r));
}

export function capabilityScore(
  capabilities: string[] | null | undefined,
  required: string[]
): number {
  if (required.length === 0) return 1;
  const set = new Set(capabilities ?? []);
  const hit = required.filter((r) => set.has(r)).length;
  return hit / required.length;
}

// Whether a manufacturer can print the order's material. Material capabilities
// are declared as `material_<m>` tags in manufacturers.capabilities. Legacy
// behaviour: a manufacturer with no declared capabilities (or none of the
// `material_*` kind) is treated as able to print any material — so existing
// manufacturers keep receiving orders until they declare materials.
export function manufacturerSupportsMaterial(
  capabilities: string[] | null | undefined,
  material: string
): boolean {
  if (!capabilities || capabilities.length === 0) return true;
  const materialTags = capabilities.filter((c) => c.startsWith("material_"));
  if (materialTags.length === 0) return true;
  return materialTags.includes(`material_${material}`);
}
