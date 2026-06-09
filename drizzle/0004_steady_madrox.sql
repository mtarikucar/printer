CREATE TYPE "public"."figurine_finish" AS ENUM('paintable_kit', 'hand_painted', 'collector_raw', 'luxe_display');--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "finish" "figurine_finish" DEFAULT 'paintable_kit' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "finish" "figurine_finish" DEFAULT 'paintable_kit' NOT NULL;