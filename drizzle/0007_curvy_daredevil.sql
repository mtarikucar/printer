CREATE TYPE "public"."upload_quote_status" AS ENUM('none', 'quoted', 'accepted', 'expired', 'rejected');--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD COLUMN "quoted_price_kurus" integer;--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD COLUMN "quote_status" "upload_quote_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD COLUMN "quoted_by_email" text;--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD COLUMN "quoted_at" timestamp;--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD COLUMN "quote_expires_at" timestamp;