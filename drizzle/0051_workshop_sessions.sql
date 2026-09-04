-- 0051 — atölye seans sistemi.
--
-- Kalıcı mekan → tekrarlı seans → public linkten katılan katılımcı zinciri,
-- artı orders.workshop_session_id geri bağı ve carrier enum'una 'elden'.
--
-- ADD COLUMN (NULL, DEFAULT'suz) PG11+'ta tablo yeniden yazmaz; yine de kısa
-- süreli ACCESS EXCLUSIVE kilit ister. Canlıda `orders` sürekli okunuyor:
-- kilit hemen alınamazsa deploy'u dakikalarca bekletmek yerine hızlı başarısız
-- olsun.
--
-- Idempotent: bir kez uygulanmış bir veritabanında yeniden çalıştırılabilir.
SET lock_timeout = '5s';
--> statement-breakpoint
-- ALTER TYPE ... ADD VALUE PostgreSQL 12+'ta transaction içinde çalışır ve bu
-- migration o değeri AYNI transaction'da hiçbir yere yazmaz (yazsaydı hata
-- verirdi). Prod PG 16.12 — doğrulandı.
ALTER TYPE "carrier" ADD VALUE IF NOT EXISTS 'elden';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."workshop_session_status" AS ENUM('draft', 'open', 'closed', 'in_production', 'shipped', 'delivered', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workshop_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"draft_id" uuid,
	"order_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"photo_key" text NOT NULL,
	"kvkk_consent_at" timestamp NOT NULL,
	"content_consent_at" timestamp NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workshop_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"starts_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 120 NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"join_token" text NOT NULL,
	"join_closes_at" timestamp NOT NULL,
	"deliver_by" timestamp NOT NULL,
	"price_per_seat_kurus" integer NOT NULL,
	"manufacturer_id" uuid,
	"manufacturer_committed_at" timestamp,
	"commission_rate_bps" integer,
	"batch_carrier" "carrier",
	"batch_tracking_number" text,
	"batch_shipped_at" timestamp,
	"batch_delivered_at" timestamp,
	"status" "workshop_session_status" DEFAULT 'draft' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_sessions_join_token_unique" UNIQUE("join_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workshop_venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"name" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"address" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "workshop_session_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_participants" ADD CONSTRAINT "workshop_participants_session_id_workshop_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workshop_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_participants" ADD CONSTRAINT "workshop_participants_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_participants" ADD CONSTRAINT "workshop_participants_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_sessions" ADD CONSTRAINT "workshop_sessions_venue_id_workshop_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."workshop_venues"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_sessions" ADD CONSTRAINT "workshop_sessions_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workshop_venues" ADD CONSTRAINT "workshop_venues_request_id_workshop_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."workshop_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workshop_participants_session_idx" ON "workshop_participants" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workshop_participants_draft_idx" ON "workshop_participants" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workshop_sessions_venue_idx" ON "workshop_sessions" USING btree ("venue_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workshop_sessions_status_idx" ON "workshop_sessions" USING btree ("status","join_closes_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workshop_venues_status_idx" ON "workshop_venues" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workshop_venues_request_id_unique_idx" ON "workshop_venues" USING btree ("request_id") WHERE "request_id" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_workshop_session_id_workshop_sessions_id_fk" FOREIGN KEY ("workshop_session_id") REFERENCES "public"."workshop_sessions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
