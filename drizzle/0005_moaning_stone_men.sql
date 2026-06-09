CREATE TYPE "public"."upload_model_status" AS ENUM('uploaded', 'processing', 'ready', 'review', 'failed');--> statement-breakpoint
ALTER TYPE "public"."order_type" ADD VALUE 'upload';--> statement-breakpoint
CREATE TABLE "uploaded_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"source_key" text NOT NULL,
	"source_format" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"target_height_mm" integer DEFAULT 80 NOT NULL,
	"material" "figurine_material" DEFAULT 'resin' NOT NULL,
	"status" "upload_model_status" DEFAULT 'uploaded' NOT NULL,
	"is_volume" boolean,
	"volume_mm3" double precision,
	"bounding_box_mm" jsonb,
	"min_wall_thickness_mm" double precision,
	"print_risk" jsonb,
	"glb_preview_key" text,
	"thumbnail_key" text,
	"price_kurus" integer,
	"needs_quote" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "uploaded_model_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "uploaded_model_id" uuid;--> statement-breakpoint
ALTER TABLE "uploaded_models" ADD CONSTRAINT "uploaded_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploaded_models_user_idx" ON "uploaded_models" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_uploaded_model_id_uploaded_models_id_fk" FOREIGN KEY ("uploaded_model_id") REFERENCES "public"."uploaded_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_uploaded_model_id_uploaded_models_id_fk" FOREIGN KEY ("uploaded_model_id") REFERENCES "public"."uploaded_models"("id") ON DELETE no action ON UPDATE no action;