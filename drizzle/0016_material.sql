CREATE TYPE "public"."figurine_material" AS ENUM('resin', 'filament');--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "material" "figurine_material" DEFAULT 'resin' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "material" "figurine_material" DEFAULT 'resin' NOT NULL;