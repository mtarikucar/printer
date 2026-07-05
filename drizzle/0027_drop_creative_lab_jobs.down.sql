-- Rollback (down) for 0027_drop_creative_lab_jobs.
--
-- The project's drizzle-kit `migrate` pipeline is forward-only and NEVER runs
-- this file automatically — it is intentionally NOT listed in meta/_journal.json.
-- It exists so the drop stays reversible per policy: apply it by hand
-- (`psql "$DATABASE_URL" -f drizzle/0027_drop_creative_lab_jobs.down.sql`) to
-- restore the Creative Lab jobs table + its two enums exactly as migration
-- 0024 created them. Idempotent and tightly scoped: it recreates ONLY these
-- three objects and no-ops if they already exist (safe to re-run).
DO $$ BEGIN
 CREATE TYPE "public"."creative_lab_job_status" AS ENUM('generating', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."creative_lab_product" AS ENUM('keychain', 'fridge_magnet', 'lamp');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creative_lab_jobs" (
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
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "creative_lab_jobs" ADD CONSTRAINT "creative_lab_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
