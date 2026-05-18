import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";

/**
 * Convert a free-form string to a URL-safe slug. Turkish characters fold to
 * ASCII (Ş→s, Ç→c, Ğ→g, İ→i, Ü→u, Ö→o) so slugs are readable in browser
 * status bars and email previews.
 */
function kebabify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
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

  // Collision check — extremely unlikely given orderPart includes the order
  // number, but defensive against schema changes that might let two rows
  // collide. Append `-2`, `-3`, ... until unique.
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
    if (suffix > 50) {
      // Hard cap — should be unreachable; fall back to order number alone.
      return `${orderPart}-${Date.now()}`;
    }
  }
}
