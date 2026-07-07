-- Rollback (down) for 0028_workshop_requests.
--
-- The project's drizzle-kit `migrate` pipeline is forward-only and NEVER runs
-- this file automatically — it is intentionally NOT listed in meta/_journal.json.
-- It exists so the change stays reversible per policy: apply it by hand
-- (`psql "$DATABASE_URL" -f drizzle/0028_workshop_requests.down.sql`) to remove
-- exactly what 0028 created — the workshop_requests table (with its indexes,
-- unique constraint and FK, all dropped by CASCADE) and the
-- workshop_request_status enum type. Idempotent and tightly scoped: it drops
-- ONLY these two objects and no-ops if they are already gone (safe to re-run).
-- It never touches operator/customer data beyond this feature's own table.
DROP TABLE IF EXISTS "workshop_requests" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."workshop_request_status";
