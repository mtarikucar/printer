CREATE TABLE "box_price_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"min_quantity" integer NOT NULL,
	"unit_price_kurus" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "box_price_tiers_min_quantity_unique" UNIQUE("min_quantity")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "is_box_item" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "box_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "box_price_tiers_min_qty_idx" ON "box_price_tiers" USING btree ("min_quantity");