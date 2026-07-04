ALTER TYPE "public"."admin_action_type" ADD VALUE 'upload_model';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'awaiting_model' BEFORE 'generating';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_glb_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_glb_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_stl_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_stl_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_uploaded_at" timestamp;