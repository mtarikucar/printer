CREATE TYPE "public"."gallery_review_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."admin_action_type" ADD VALUE 'gallery_approve';--> statement-breakpoint
ALTER TYPE "public"."admin_action_type" ADD VALUE 'gallery_reject';--> statement-breakpoint
ALTER TYPE "public"."admin_action_type" ADD VALUE 'gallery_reward';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gallery_review_status" "gallery_review_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gallery_review_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gallery_reward_gift_card_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gallery_reward_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gallery_reward_gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;