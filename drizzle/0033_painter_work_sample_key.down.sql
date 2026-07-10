-- Rollback (down) for 0033_painter_work_sample_key.
--
-- Forward-only drizzle-kit migrate NEVER runs this (not in meta/_journal.json).
-- Apply by hand to reverse 0033:
--   psql "$DATABASE_URL" -f drizzle/0033_painter_work_sample_key.down.sql
-- Idempotent + tightly scoped: drops ONLY the work_sample_photo_key column 0033
-- added and no-ops if already reverted.
ALTER TABLE "painters" DROP COLUMN IF EXISTS "work_sample_photo_key";
