CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_path_unique" ON "categories" USING btree ("path");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Seed the pre-existing flat categories as root nodes so no product loses its
-- category. Root path === slug, keeping legacy ?category=<slug> links valid.
INSERT INTO "categories" ("name","slug","path","depth","sort_order") VALUES
  ('Figürin','figurine','figurine',0,0),
  ('Ev Dekorasyonu','home_decor','home_decor',0,1),
  ('Oyuncak','toy','toy',0,2),
  ('Takı','jewelry','jewelry',0,3),
  ('Aksesuar','gadget','gadget',0,4),
  ('Diğer','other','other',0,5)
ON CONFLICT ("path") DO NOTHING;--> statement-breakpoint
-- Backfill existing products onto their matching root category.
UPDATE "products" p SET "category_id" = c."id"
FROM "categories" c
WHERE c."depth" = 0 AND c."slug" = p."category" AND p."category_id" IS NULL;