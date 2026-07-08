-- Rollback (down) for 0031_order_model_revisions.
--
-- Forward-only drizzle-kit migrate NEVER runs this (not in meta/_journal.json).
-- Apply by hand to reverse 0031:
--   psql "$DATABASE_URL" -f drizzle/0031_order_model_revisions.down.sql
-- Idempotent + tightly scoped: drops ONLY the order_model_revisions table 0031
-- created (with its FK + unique index, via CASCADE) and no-ops if already gone.
DROP TABLE IF EXISTS "order_model_revisions" CASCADE;
