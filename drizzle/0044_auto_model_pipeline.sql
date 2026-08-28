CREATE TYPE "public"."model_approval_decision" AS ENUM('approved', 'revision', 'cancelled', 'auto_approved');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'awaiting_customer_approval' BEFORE 'generating';--> statement-breakpoint
CREATE TABLE "order_model_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"glb_key" text,
	"turntable_key" text,
	"channel" text DEFAULT 'email' NOT NULL,
	"shown_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decision" "model_approval_decision",
	"note" text,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "generation_attempts" ALTER COLUMN "input_image_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "round" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "credits" integer;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "meshy_printability" jsonb;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "min_wall_p1_mm" double precision;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "min_wall_p5_mm" double precision;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "merged_component_count" integer;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "height_mm" double precision;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "fill_ratio" double precision;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "dropped_significant_component" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD COLUMN "verdict_reasons" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_generation_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_turntable_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_turntable_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "model_approval_token" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_model_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_model_revision_note" text;--> statement-breakpoint
ALTER TABLE "order_model_approvals" ADD CONSTRAINT "order_model_approvals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_model_approvals_order_idx" ON "order_model_approvals" USING btree ("order_id","revision");--> statement-breakpoint
-- Backfill before the unique index, or this migration cannot be applied to any
-- database that already has history: `round` defaults to 1 for every existing
-- row, and the old auto-3D pipeline retried (queue attempts: 3, plus an admin
-- "regenerate" action), so orders with several attempts are expected. Without
-- this, CREATE UNIQUE INDEX raises 23505 and the whole deploy aborts.
UPDATE "generation_attempts" ga
SET "round" = numbered.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "order_id" ORDER BY "created_at", "id") AS rn
  FROM "generation_attempts"
) numbered
WHERE ga."id" = numbered."id" AND ga."round" <> numbered.rn;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_order_round_uq" ON "generation_attempts" USING btree ("order_id","round");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_model_approval_token_unique" UNIQUE("model_approval_token");