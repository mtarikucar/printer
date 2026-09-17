-- Durable admin draft history; no backfill and no changes to existing rows.
-- Bounded DDL lock wait, matching the preceding migrations.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_draft_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"action" text NOT NULL,
	"admin_email" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_draft_actions_action_check" CHECK ("admin_draft_actions"."action" IN ('edit', 'extend', 'cancel', 'resend')),
	CONSTRAINT "admin_draft_actions_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_draft_actions_draft_created_idx" ON "admin_draft_actions" USING btree ("draft_id","created_at");
