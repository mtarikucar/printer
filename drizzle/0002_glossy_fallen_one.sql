CREATE TYPE "public"."order_type" AS ENUM('custom', 'marketplace');--> statement-breakpoint
CREATE TYPE "public"."product_owner_type" AS ENUM('seller', 'admin');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'pending_review', 'active', 'rejected', 'archived');--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"owner_type" "product_owner_type" DEFAULT 'seller' NOT NULL,
	"manufacturer_id" uuid,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"price_kurus" integer NOT NULL,
	"material" "figurine_material",
	"category" text,
	"lead_time_days" integer DEFAULT 7,
	"primary_image_key" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"reviewed_by_email" text,
	"reviewed_at" timestamp,
	"submitted_at" timestamp,
	"created_by_admin_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ALTER COLUMN "figurine_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_drafts" ALTER COLUMN "photo_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "figurine_size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "order_type" "order_type" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "seller_manufacturer_id" uuid;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "product_title_snapshot" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_type" "order_type" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "seller_manufacturer_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "product_title_snapshot" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id","sort_order");--> statement-breakpoint
CREATE INDEX "products_status_created_idx" ON "products" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "products_manufacturer_status_idx" ON "products" USING btree ("manufacturer_id","status");--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_seller_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("seller_manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("seller_manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;