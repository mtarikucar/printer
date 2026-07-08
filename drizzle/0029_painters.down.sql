-- Rollback (down) for 0029_painters.
--
-- The project's drizzle-kit `migrate` pipeline is forward-only and NEVER runs
-- this file automatically — it is intentionally NOT listed in meta/_journal.json.
-- Apply by hand to reverse 0029:
--   psql "$DATABASE_URL" -f drizzle/0029_painters.down.sql
-- Idempotent and tightly scoped: drops ONLY what 0029 added (the painter tables,
-- the orders painting columns, and the two painter enum types) and no-ops if
-- already reverted. It never touches operator/customer data beyond this feature.
--
-- CAVEAT: PostgreSQL cannot DROP a single value from an enum, so the
-- `order_status` value 'painting' that 0029 added via ALTER TYPE ... ADD VALUE
-- CANNOT be removed here without recreating the whole `order_status` type (which
-- would require rewriting the orders table). It is left in place — a harmless,
-- unused extra value. Everything else is fully reversed.

-- 1) Drop the orders + order_drafts painting columns (drops the FK to painters).
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "painting_price_kurus";--> statement-breakpoint
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "needs_painting";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "declined_painter_ids";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painted_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "sent_to_painter_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "assigned_to_painter_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painter_status";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painter_id";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "painting_price_kurus";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "needs_painting";--> statement-breakpoint

-- 2) Drop the painter tables (CASCADE clears their FKs). Child tables first is
--    unnecessary with CASCADE, but order is harmless.
DROP TABLE IF EXISTS "painter_earnings" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "painter_payouts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "painter_actions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "painter_notifications" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "painters" CASCADE;--> statement-breakpoint

-- 3) Drop the painter enum types (now unused).
DROP TYPE IF EXISTS "public"."painter_order_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."painter_status";
