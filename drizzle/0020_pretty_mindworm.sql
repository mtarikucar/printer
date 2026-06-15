ALTER TABLE "order_drafts" ADD COLUMN "selected_options" jsonb;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "selected_addons" jsonb;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "item_image_key" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "item_image_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "selected_options" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "selected_addons" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "item_image_key" text;