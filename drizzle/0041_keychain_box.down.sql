-- Rollback (down) for 0041_keychain_box.
--
-- The project's drizzle-kit `migrate` pipeline is forward-only and NEVER runs
-- this file automatically — it is intentionally NOT listed in meta/_journal.json.
-- It exists so the change stays reversible per policy: apply it by hand
-- (`psql "$DATABASE_URL" -f drizzle/0041_keychain_box.down.sql`) to remove
-- exactly what 0041 created — the box_price_tiers table (with its unique
-- constraint and index, dropped by CASCADE), the products.box_eligible flag and
-- the order_items.is_box_item marker. Idempotent and tightly scoped: it drops
-- ONLY these objects and no-ops if they are already gone (safe to re-run). It
-- never touches operator/customer data beyond this feature's own table and
-- columns.
--
-- Data loss on rollback is limited to box configuration and the box label on
-- past orders: the box price ladder, which products were offered in a box, and
-- the "this line came from a box" marker. The money columns (unit_price_kurus,
-- line_total_kurus, amount_kurus) are NOT touched — a box order keeps exactly
-- the amount it was charged and its per-design line items, so production and
-- accounting are unaffected. It merely stops being labelled a box.
DROP TABLE IF EXISTS "box_price_tiers" CASCADE;--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN IF EXISTS "box_eligible";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "is_box_item";
