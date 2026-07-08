ALTER TYPE "public"."painter_order_status" ADD VALUE 'qc_pending' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."painter_order_status" ADD VALUE 'qc_rejected' BEFORE 'shipped';--> statement-breakpoint
ALTER TYPE "public"."painter_order_status" ADD VALUE 'qc_approved' BEFORE 'shipped';--> statement-breakpoint
CREATE TABLE "painter_qc_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"painter_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"review_status" "qc_photo_review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "painter_qc_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"admin_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painter_qc_round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "painter_qc_photos" ADD CONSTRAINT "painter_qc_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_qc_photos" ADD CONSTRAINT "painter_qc_photos_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_qc_reviews" ADD CONSTRAINT "painter_qc_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;