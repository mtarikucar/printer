ALTER TABLE "orders" ADD COLUMN "painter_handoff_carrier" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painter_handoff_tracking_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "received_by_painter_at" timestamp;