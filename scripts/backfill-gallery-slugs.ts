// Backfill orders.gallery_slug for already-published gallery items.
//
// Q3 (per-figurine detail pages) introduces a slug column populated at
// admin-approve time. Existing approved rows (pre-Q3 deploy) have null
// slugs, so /gallery/[slug] permalinks don't work for them. This script
// walks each public+approved order without a slug and fills it in.
//
// Safe to re-run: it only touches rows where gallery_slug IS NULL.
//
// Run with:  npx tsx scripts/backfill-gallery-slugs.ts
// Add --dry-run to see what would change without writing.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../src/lib/db";
import { orders } from "../src/lib/db/schema";
import { generateGallerySlug } from "../src/lib/services/slug";

const GALLERY_STATUSES = [
  "approved",
  "printing",
  "shipped",
  "delivered",
] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      publicDisplayName: orders.publicDisplayName,
    })
    .from(orders)
    .where(
      and(
        eq(orders.isPublic, true),
        inArray(orders.status, [...GALLERY_STATUSES]),
        isNull(orders.gallerySlug)
      )
    );

  console.log(
    `Found ${rows.length} approved gallery row(s) without a slug${
      dryRun ? " (dry run)" : ""
    }`
  );

  let done = 0;
  for (const row of rows) {
    // generateGallerySlug checks for collisions across all rows; running it
    // serially (rather than in Promise.all) keeps the uniqueness check
    // honest — a parallel race could allocate the same suffix twice.
    const slug = await generateGallerySlug(row.orderNumber, row.publicDisplayName);
    console.log(`  ${row.orderNumber} → ${slug}`);
    if (!dryRun) {
      await db
        .update(orders)
        .set({ gallerySlug: slug, updatedAt: new Date() })
        .where(eq(orders.id, row.id));
    }
    done++;
  }

  console.log(
    `\n${dryRun ? "Would update" : "Updated"} ${done}/${rows.length} row(s).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
