ALTER TABLE "orders" ADD COLUMN "gallery_slug" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gallery_slug_unique" UNIQUE("gallery_slug");