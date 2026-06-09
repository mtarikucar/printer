-- Finish/package tier enum + columns (Faz 1.1).
CREATE TYPE "public"."figurine_finish" AS ENUM('paintable_kit', 'hand_painted', 'collector_raw', 'luxe_display');--> statement-breakpoint
-- Trademark cleanup: rename the figurine_style enum value 'disney' -> 'storybook'
-- (atomic, preserves rows). Replaces drizzle's generated drop/recreate, which
-- would fail the ::figurine_style cast-back on any existing 'disney' row.
ALTER TYPE "public"."figurine_style" RENAME VALUE 'disney' TO 'storybook';--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "finish" "figurine_finish" DEFAULT 'paintable_kit' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finish" "figurine_finish" DEFAULT 'paintable_kit' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_at" timestamp;
