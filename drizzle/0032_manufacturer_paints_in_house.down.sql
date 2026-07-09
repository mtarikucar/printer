-- Rollback (down) for 0032_manufacturer_paints_in_house.
--
-- Forward-only drizzle-kit migrate NEVER runs this (not in meta/_journal.json).
-- Apply by hand to reverse 0032:
--   psql "$DATABASE_URL" -f drizzle/0032_manufacturer_paints_in_house.down.sql
-- Idempotent + tightly scoped: drops ONLY the paints_in_house column 0032 added
-- and no-ops if already reverted.
ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "paints_in_house";
