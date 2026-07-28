-- Rollback for 0036_figurine_size_text.
-- drizzle-kit's pipeline is forward-only and never runs this file; it is
-- deliberately NOT listed in meta/_journal.json (same as 0027..0035). Apply by
-- hand:  psql "$DATABASE_URL" -f drizzle/0036_figurine_size_text.down.sql
-- Idempotent and narrowly scoped: touches only the three figurine_size columns.
--
-- DATA LOSS CAVEAT: text -> enum is an explicit cast, so rows written after
-- 0036 that hold a real measurement ("17,5 cm") would raise 22P02. They are
-- normalized away first — the measurement is DESTROYED:
--   orders / order_drafts (nullable) -> NULL
--   previews (NOT NULL)              -> 'orta'
-- The frozen {"groupName":"Boyut"} snapshots in orders.selected_options are NOT
-- touched, so after a rollback a panel may still display the old measurement
-- text while the typed column says 'orta' (display only, nothing crashes).
-- Dump first if the values matter:
--   \copy (SELECT id, figurine_size FROM orders WHERE figurine_size IS NOT NULL) TO 'orders_size.csv' CSV
DO $$ BEGIN
  CREATE TYPE "public"."figurine_size" AS ENUM('kucuk', 'orta', 'buyuk');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
UPDATE "order_drafts" SET "figurine_size" = NULL
  WHERE "figurine_size" IS NOT NULL AND "figurine_size" NOT IN ('kucuk','orta','buyuk');--> statement-breakpoint
UPDATE "orders" SET "figurine_size" = NULL
  WHERE "figurine_size" IS NOT NULL AND "figurine_size" NOT IN ('kucuk','orta','buyuk');--> statement-breakpoint
UPDATE "previews" SET "figurine_size" = 'orta'
  WHERE "figurine_size" NOT IN ('kucuk','orta','buyuk');--> statement-breakpoint
ALTER TABLE "order_drafts" ALTER COLUMN "figurine_size"
  SET DATA TYPE "public"."figurine_size" USING "figurine_size"::"public"."figurine_size";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "figurine_size"
  SET DATA TYPE "public"."figurine_size" USING "figurine_size"::"public"."figurine_size";--> statement-breakpoint
ALTER TABLE "previews" ALTER COLUMN "figurine_size"
  SET DATA TYPE "public"."figurine_size" USING "figurine_size"::"public"."figurine_size";
