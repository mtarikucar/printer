ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_token_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verification_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: existing customers are grandfathered as verified so the new
-- generation gates (email + phone) don't lock them out. New rows default false.
UPDATE "users" SET "email_verified" = true, "phone_verified" = true;