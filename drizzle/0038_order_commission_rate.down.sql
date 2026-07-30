-- Rollback for 0038_order_commission_rate.
-- Forward-only pipeline: deliberately NOT in meta/_journal.json (0027.. pattern).
-- Apply by hand: psql "$DATABASE_URL" -f drizzle/0038_order_commission_rate.down.sql
-- Idempotent and narrowly scoped: drops only the column this migration added.
-- Dropping it makes accrueEarning fall back to the live platform rate for orders
-- that had a frozen one; dump first if that matters:
--   \copy (SELECT id, commission_rate_bps FROM orders WHERE commission_rate_bps IS NOT NULL) TO 'order_rates.csv' CSV
ALTER TABLE "orders" DROP COLUMN IF EXISTS "commission_rate_bps";
