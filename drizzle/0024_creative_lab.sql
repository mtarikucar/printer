CREATE TYPE "public"."creative_lab_job_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."creative_lab_product" AS ENUM('keychain', 'fridge_magnet', 'lamp');--> statement-breakpoint
CREATE TABLE "creative_lab_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"product" "creative_lab_product" NOT NULL,
	"photo_key" text NOT NULL,
	"photo_url" text NOT NULL,
	"status" "creative_lab_job_status" DEFAULT 'generating' NOT NULL,
	"glb_url" text,
	"glb_key" text,
	"stl_url" text,
	"stl_key" text,
	"prototype_task_id" text,
	"build_task_id" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_lab_jobs" ADD CONSTRAINT "creative_lab_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;