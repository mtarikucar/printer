CREATE TYPE "public"."idempotency_status" AS ENUM('in_flight', 'done');--> statement-breakpoint
CREATE TYPE "public"."spend_status" AS ENUM('reserved', 'settled', 'released');--> statement-breakpoint
ALTER TYPE "public"."invoice_status" ADD VALUE IF NOT EXISTS 'pending' BEFORE 'issued';--> statement-breakpoint
CREATE TABLE "ai_spend_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"reserved_cents" integer NOT NULL,
	"settled_cents" integer,
	"status" "spend_status" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"status" "idempotency_status" DEFAULT 'in_flight' NOT NULL,
	"response_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "platform_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE INDEX "ai_spend_ledger_created_idx" ON "ai_spend_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_spend_ledger_scope_idx" ON "ai_spend_ledger" USING btree ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "ai_spend_ledger_provider_idx" ON "ai_spend_ledger" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");