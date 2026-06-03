import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, products } from "@/lib/db/schema";

/**
 * Convert a free-form string to a URL-safe slug. Turkish characters fold
 * to ASCII (Ş→s, Ç→c, Ğ→g, İ→i, Ü→u, Ö→o) so slugs are readable in
 * browser status bars and email previews.
 *
 * IMPORTANT: Turkish substitutions run BEFORE `.toLowerCase()` and cover
 * BOTH cases. Doing it the other way around relies on locale-correct
 * lowering (`"İ".toLowerCase() === "i̇"` in V8, but `"i"` in Turkish
 * locale), which is environment-dependent and dropped diacritic marks
 * differently across runtimes. Explicit substitution is locale-safe.
 *
 * The combining-mark strip uses an explicit `̀-ͯ` Unicode
 * range — earlier versions used a literal-character range which is
 * fragile across editor encodings.
 */
export function kebabify(input: string): string {
  return input
    // Turkish-specific folding, both cases, before toLowerCase.
    .replace(/[İI]/g, "i")
    .replace(/[ıI]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[ğĞ]/g, "g")
    .replace(/[çÇ]/g, "c")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Build a gallery slug from a display name (optional) + order number.
 *
 *   "Ayşe Yılmaz" + "FIG-ABC123LF_" → "ayse-yilmaz-fig-abc123lf"
 *   null         + "FIG-ABC123LF_" → "fig-abc123lf"
 *
 * The order number is always present in the slug so the slug is unique
 * by construction — but we still check for collisions defensively in case
 * two orders share a sanitized form (rare; e.g. two trailing underscores).
 */
export async function generateGallerySlug(
  orderNumber: string,
  displayName: string | null | undefined
): Promise<string> {
  const namePart = displayName ? kebabify(displayName) : "";
  const orderPart = kebabify(orderNumber);
  const base = namePart ? `${namePart}-${orderPart}` : orderPart;

  // Collision check — extremely unlikely given orderPart includes the
  // order number, but defensive against schema changes that might let
  // two rows collide. Append `-2`, `-3`, ... until unique.
  let candidate = base;
  let suffix = 1;
  while (true) {
    const existing = await db.query.orders.findFirst({
      where: eq(orders.gallerySlug, candidate),
      columns: { id: true },
    });
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
    if (suffix > 50) break;
  }

  // Pathological-collision fallback. Use a cryptographic random suffix
  // (NOT Date.now() — two simultaneous fallbacks in the same ms would
  // produce identical slugs and the second insert would throw on the
  // unique index). Re-check once; if even THIS collides we surrender
  // and let the caller's unique-constraint violation propagate.
  const randomFallback = `${orderPart}-${crypto.randomBytes(4).toString("hex")}`;
  const dup = await db.query.orders.findFirst({
    where: eq(orders.gallerySlug, randomFallback),
    columns: { id: true },
  });
  if (!dup) return randomFallback;
  // 2^32 birthday on a single row — effectively unreachable.
  return `${orderPart}-${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Build a marketplace product slug from its title, minted on approval/create.
 * Unlike gallery slugs the title alone isn't unique, so we always append a
 * short random suffix and collision-check against products.slug.
 *
 *   "Ejderha Figürü" → "ejderha-figuru-a1b2c3"
 */
export async function generateProductSlug(title: string): Promise<string> {
  const base = kebabify(title) || "urun";
  let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 0; i < 5; i++) {
    const existing = await db.query.products.findFirst({
      where: eq(products.slug, candidate),
      columns: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${base}-${crypto.randomBytes(4).toString("hex")}`;
  }
  // Pathological fallback — effectively unreachable.
  return `${base}-${crypto.randomBytes(8).toString("hex")}`;
}
