ALTER TYPE "public"."preview_status" ADD VALUE 'styled' BEFORE 'ready';--> statement-breakpoint
ALTER TYPE "public"."preview_status" ADD VALUE 'building' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "styled_image_urls" jsonb;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "selected_styled_image_url" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "back_image_url" text;--> statement-breakpoint
ALTER TABLE "previews" ADD COLUMN "variation_rounds" integer DEFAULT 1 NOT NULL;