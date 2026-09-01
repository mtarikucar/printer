-- 0050 — kalem (cost-line) bazlı hakediş.
--
-- Ürünün fiyatı iki tür kalemden oluşur (production / painting); bu iki kalem
-- üreticinin ve boyacının hakediş tabanlarını belirler ve toplamları her zaman
-- sipariş tutarına eşittir. Kolonlar NULLABLE: NULL = kalem modelinden önceki
-- sipariş, eski hakediş kuralı aynen sürer (services/earning-base.ts).
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
CREATE TABLE IF NOT EXISTS "product_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"amount_kurus" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "production_base_kurus" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_base_kurus" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "production_base_kurus" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "product_cost_lines" ADD CONSTRAINT "product_cost_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_cost_lines_product_idx" ON "product_cost_lines" USING btree ("product_id","sort_order");
