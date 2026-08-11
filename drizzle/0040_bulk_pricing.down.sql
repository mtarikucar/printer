-- Rollback (down) for 0040_bulk_pricing.
--
-- The project's drizzle-kit `migrate` pipeline is forward-only and NEVER runs
-- this file automatically — it is intentionally NOT listed in meta/_journal.json.
-- It exists so the change stays reversible per policy: apply it by hand
-- (`psql "$DATABASE_URL" -f drizzle/0040_bulk_pricing.down.sql`) to remove
-- exactly what 0040 created — the product_price_tiers table (with its unique
-- index and FK, dropped by CASCADE) and the seven bulk-ordering columns added to
-- products, orders, order_drafts and order_items. Idempotent and tightly scoped:
-- it drops ONLY these objects and no-ops if they are already gone (safe to
-- re-run). It never touches operator/customer data beyond this feature's own
-- table and columns.
--
-- Data loss on rollback is limited to bulk configuration and bulk audit trail:
-- every configured price tier, the per-product bulk settings, and the
-- toplu-üretim flag / list-price snapshot on existing orders. The money columns
-- (amount_kurus, unit_price_kurus, line_total_kurus) are NOT touched — an order
-- placed at a tier price keeps exactly the amount it was charged, it just stops
-- being labelled as a bulk order.
DROP TABLE IF EXISTS "product_price_tiers" CASCADE;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "bulk_enabled";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "bulk_max_quantity";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "bulk_lead_time_days";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "is_bulk";--> statement-breakpoint
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "is_bulk";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "list_unit_price_kurus";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "applied_tier_min_quantity";
