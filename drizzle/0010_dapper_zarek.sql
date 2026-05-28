ALTER TYPE "public"."admin_action_type" ADD VALUE 'gallery_feature';--> statement-breakpoint
ALTER TYPE "public"."admin_action_type" ADD VALUE 'gallery_unfeature';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gallery_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gallery_featured_at" timestamp;