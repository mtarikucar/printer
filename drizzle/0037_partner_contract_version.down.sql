-- Rollback for 0037_partner_contract_version.
-- Forward-only pipeline: deliberately NOT in meta/_journal.json (0027.. pattern).
-- Apply by hand: psql "$DATABASE_URL" -f drizzle/0037_partner_contract_version.down.sql
-- Idempotent and narrowly scoped: drops only the two columns this migration added.
-- Dropping them discards which contract version each partner accepted; dump first
-- if that record matters:
--   \copy (SELECT id, onboarding_version FROM manufacturers) TO 'mfr_versions.csv' CSV
ALTER TABLE "manufacturers" DROP COLUMN IF EXISTS "onboarding_version";--> statement-breakpoint
ALTER TABLE "painters" DROP COLUMN IF EXISTS "onboarding_version";
