ALTER TYPE "public"."manufacturer_doc_type" ADD VALUE 'printer_photo' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."manufacturer_status" ADD VALUE 'conditionally_approved' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "public"."manufacturer_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "manufacturers" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "manufacturers" ADD COLUMN "printer_photo_uploaded_at" timestamp;