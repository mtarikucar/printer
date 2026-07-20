ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "content_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "content_consent_version" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "content_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "content_consent_version" text;
