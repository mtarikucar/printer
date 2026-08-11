CREATE TABLE "product_price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"min_quantity" integer NOT NULL,
	"unit_price_kurus" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "is_bulk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "list_unit_price_kurus" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "applied_tier_min_quantity" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "is_bulk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bulk_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bulk_max_quantity" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bulk_lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "product_price_tiers" ADD CONSTRAINT "product_price_tiers_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_price_tiers_product_min_qty_key" ON "product_price_tiers" USING btree ("product_id","min_quantity");