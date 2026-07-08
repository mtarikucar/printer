-- Rollback (down) for 0030_painter_qc.
--
-- Forward-only drizzle-kit migrate NEVER runs this (not in meta/_journal.json).
-- Apply by hand to reverse 0030:
--   psql "$DATABASE_URL" -f drizzle/0030_painter_qc.down.sql
-- Idempotent + tightly scoped: drops ONLY what 0030 added (the two painter-QC
-- tables and the orders.painter_qc_round column) and no-ops if already reverted.
--
-- CAVEAT: PostgreSQL cannot DROP a single enum value, so the three
-- painter_order_status values 0030 added (qc_pending / qc_rejected /
-- qc_approved) CANNOT be removed here without recreating the whole type. They
-- are left in place — harmless, unused extra values. Everything else reverses.

ALTER TABLE "orders" DROP COLUMN IF EXISTS "painter_qc_round";--> statement-breakpoint
DROP TABLE IF EXISTS "painter_qc_photos" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "painter_qc_reviews" CASCADE;
