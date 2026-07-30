-- Rollback for 0039_painter_handoff_tracking.
-- Forward-only pipeline: deliberately NOT in meta/_journal.json (0027.. pattern).
-- Apply by hand: psql "$DATABASE_URL" -f drizzle/0039_painter_handoff_tracking.down.sql
-- Idempotent and narrowly scoped: drops only the three columns this migration added.
-- Dropping them discards the courier record of manufacturer→painter hand-offs and
-- whether the painter confirmed receipt; dump first if that matters:
--   \copy (SELECT id, painter_handoff_carrier, painter_handoff_tracking_number, received_by_painter_at FROM orders WHERE painter_id IS NOT NULL) TO 'handoffs.csv' CSV
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painter_handoff_carrier";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painter_handoff_tracking_number";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "received_by_painter_at";
