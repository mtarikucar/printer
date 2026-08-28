-- Down for 0043_ops_spine.
--
-- Idempotent and tightly scoped: it removes exactly what the up added and is a
-- safe no-op if already reverted. It never touches operator or customer data.
--
-- NOTE on `invoice_status`: PostgreSQL cannot drop a value from an enum. The up
-- added 'pending'; this down first pulls any row back to a value that existed
-- before ('draft', which is what an un-filed invoice always should have been),
-- then leaves the enum label in place as a dead value. Re-running the up is
-- safe because it uses ADD VALUE IF NOT EXISTS semantics via drizzle's journal.

-- Invoices written while the stub provider was in play go back to 'draft'.
UPDATE "invoices" SET "status" = 'draft' WHERE "status" = 'pending';

DROP INDEX IF EXISTS "idempotency_keys_expires_idx";
DROP INDEX IF EXISTS "ai_spend_ledger_provider_idx";
DROP INDEX IF EXISTS "ai_spend_ledger_scope_idx";
DROP INDEX IF EXISTS "ai_spend_ledger_created_idx";

DROP TABLE IF EXISTS "idempotency_keys";
DROP TABLE IF EXISTS "ai_spend_ledger";
DROP TABLE IF EXISTS "platform_flags";

DROP TYPE IF EXISTS "public"."idempotency_status";
DROP TYPE IF EXISTS "public"."spend_status";
