ALTER TABLE "order_drafts" ADD COLUMN "upsells" jsonb;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "upsell_amount_kurus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "upsells" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "upsell_amount_kurus" integer DEFAULT 0 NOT NULL;