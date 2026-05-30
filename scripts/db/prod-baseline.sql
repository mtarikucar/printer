-- ─────────────────────────────────────────────────────────────────────────
-- ONE-TIME prod baseline for the new `drizzle-kit migrate` pipeline.
--
-- Context: migrations were squashed into a single 0000_baseline that creates
-- the full schema. A fresh DB is built by `migrate` running 0000_baseline.
-- An EXISTING DB (prod) already has the tables, so 0000_baseline must NOT run
-- against it (its CREATE TABLE statements would error). This marks 0000_baseline
-- as already applied so `migrate` skips it and only applies FUTURE migrations.
--
-- Run ONCE on prod, AFTER scripts/db/prod-sync-hotfix.sql has brought the DB
-- up to the full current schema, and BEFORE the first migrate-based deploy:
--   psql "$DATABASE_URL" -f scripts/db/prod-sync-hotfix.sql
--   psql "$DATABASE_URL" -f scripts/db/prod-baseline.sql
--
-- The hash + created_at below match drizzle/meta/_journal.json (tag
-- 0000_baseline, when=1780157096420). drizzle's migrator decides what to run by
-- comparing journal `when` against the latest created_at in this table, so the
-- created_at value MUST equal the journal `when`.
-- ─────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- Only insert if not already baselined (idempotent).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '412ae1c22b2eda8549c66c7a2362933d6162ca8404b774d22fdda06de9ca198a', 1780157096420
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations);
