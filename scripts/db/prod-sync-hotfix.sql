-- ─────────────────────────────────────────────────────────────────────────
-- MANUAL HOTFIX — sync DB with schema.ts for tables the migrate pipeline
-- never applied (prod `migrate` service runs `drizzle-kit push`, which aborts
-- on interactive create-vs-rename prompts in the non-TTY container, so the
-- batch tables added by commit c77aa8a and the Q7 eval table 0008 were never
-- created).
--
-- Fully idempotent + additive (no DROP, no data loss). Safe to run more than
-- once and against any divergent state. Apply with:
--   psql "$DATABASE_URL" -f drizzle/hotfix_sync_missing_tables.sql
-- Do NOT use -1/--single-transaction: ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block.
--
-- Covers ALL 25 schema.ts tables, including order_drafts + the draft_id
-- columns. draft_id is an ADDITIVE new column on orders/gift_card_redemptions
-- (paytr_merchant_oid is kept), so no data migration is involved.
-- ─────────────────────────────────────────────────────────────────────────

-- ── enum value additions (0011_qc_chat_enums) ──────────────────────────────
ALTER TYPE "public"."admin_action_type" ADD VALUE IF NOT EXISTS 'qc_approve';
ALTER TYPE "public"."admin_action_type" ADD VALUE IF NOT EXISTS 'qc_reject';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_pending' BEFORE 'shipped';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_rejected' BEFORE 'shipped';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_approved' BEFORE 'shipped';
ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'quality_check' BEFORE 'shipped';

-- ── new enum types ─────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "public"."message_channel" AS ENUM('customer_admin', 'manufacturer_admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."message_sender_type" AS ENUM('customer', 'admin', 'manufacturer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."qc_photo_review_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."earning_status" AS ENUM('pending', 'paid', 'reversed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."carrier" AS ENUM('yurtici', 'aras', 'mng', 'ptt', 'surat', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."doc_review_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."manufacturer_doc_type" AS ENUM('vergi_levhasi', 'ticaret_sicil', 'imza_sirkuleri', 'kimlik', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."iban_review_status" AS ENUM('none', 'pending'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."order_draft_status" AS ENUM('pending', 'awaiting_review', 'confirmed', 'expired', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."ocr_confidence" AS ENUM('high', 'medium', 'low'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'gift_card_full'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── tables (0008 Q7 eval) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "manufacturer_assignment_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"v1_winner_id" uuid,
	"v2_winner_id" uuid,
	"v1_scores" jsonb,
	"v2_scores" jsonb,
	"weights_version" text NOT NULL,
	"authoritative" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ── tables (0012 qc + chat) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" "message_channel" NOT NULL,
	"sender_type" "message_sender_type" NOT NULL,
	"sender_id" uuid,
	"sender_email" text,
	"body" text NOT NULL,
	"attachment_key" text,
	"attachment_thumbnail_key" text,
	"read_by_admin_at" timestamp,
	"read_by_counterparty_at" timestamp,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "qc_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"review_status" "qc_photo_review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "qc_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"admin_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ── tables (0013 finance) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"subtotal_kurus" integer NOT NULL,
	"kdv_kurus" integer NOT NULL,
	"total_kurus" integer NOT NULL,
	"kdv_rate_bps" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'issued' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
CREATE TABLE IF NOT EXISTS "manufacturer_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"gross_kurus" integer NOT NULL,
	"commission_kurus" integer NOT NULL,
	"net_kurus" integer NOT NULL,
	"commission_rate_bps" integer NOT NULL,
	"status" "earning_status" DEFAULT 'pending' NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturer_earnings_order_id_unique" UNIQUE("order_id")
);
CREATE TABLE IF NOT EXISTS "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"total_kurus" integer NOT NULL,
	"earning_count" integer NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"reference" text,
	"admin_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);

-- ── tables (0014 trust) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"admin_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
CREATE TABLE IF NOT EXISTS "manufacturer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"type" "manufacturer_doc_type" NOT NULL,
	"storage_key" text NOT NULL,
	"status" "doc_review_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ── tables (0015 notifications) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- ── tables (base lineage, missing locally) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "manufacturer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"email_sent_at" timestamp,
	"email_failed_reason" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"adres" text NOT NULL,
	"mahalle" text,
	"ilce" text NOT NULL,
	"il" text NOT NULL,
	"posta_kodu" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- ── table (order_drafts, base lineage) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "order_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"preview_id" uuid,
	"email" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text,
	"figurine_size" "figurine_size" NOT NULL,
	"style" "figurine_style" DEFAULT 'realistic' NOT NULL,
	"modifiers" jsonb,
	"shipping_address" jsonb NOT NULL,
	"photo_key" text NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"amount_kurus" integer NOT NULL,
	"gift_card_id" uuid,
	"gift_card_amount_kurus" integer DEFAULT 0 NOT NULL,
	"havale_discount_kurus" integer DEFAULT 0 NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "order_draft_status" DEFAULT 'pending' NOT NULL,
	"paytr_merchant_oid" text,
	"paytr_test_mode" boolean,
	"paytr_payment_type" text,
	"paytr_failure_reason" text,
	"bank_transfer_deadline" timestamp,
	"bank_transfer_receipt_key" text,
	"bank_transfer_receipt_uploaded_at" timestamp,
	"bank_transfer_reminder_sent_at" timestamp,
	"receipt_ocr_text" text,
	"receipt_ocr_parsed" jsonb,
	"receipt_ocr_confidence" "ocr_confidence",
	"receipt_ocr_failure_reason" text,
	"promoted_order_id" uuid,
	"promoted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "order_drafts_reference_unique" UNIQUE("reference"),
	CONSTRAINT "order_drafts_paytr_merchant_oid_unique" UNIQUE("paytr_merchant_oid")
);

-- ── new columns on existing tables ─────────────────────────────────────────
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "draft_id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "draft_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qc_round" integer DEFAULT 1 NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qc_rejection_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_note" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" "carrier";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "strike_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "pending_iban" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "iban_review_status" "iban_review_status" DEFAULT 'none' NOT NULL;

-- ── foreign keys (guarded for idempotency) ─────────────────────────────────
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v1_winner_id_manufacturers_id_fk" FOREIGN KEY ("v1_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v2_winner_id_manufacturers_id_fk" FOREIGN KEY ("v2_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "payouts" ADD CONSTRAINT "payouts_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_documents" ADD CONSTRAINT "manufacturer_documents_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── indexes ────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version");
CREATE INDEX IF NOT EXISTS "messages_order_channel_idx" ON "messages" USING btree ("order_id","channel","created_at");
CREATE INDEX IF NOT EXISTS "customer_notifications_user_idx" ON "customer_notifications" USING btree ("user_id","created_at");
-- guarded: the partial predicate needs gift_card_redemptions.refunded_at, which
-- ancient DBs may lack. On a current DB (incl. prod) it creates normally.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_redemptions_draft_id_unique" ON "gift_card_redemptions" USING btree ("draft_id") WHERE "gift_card_redemptions"."draft_id" IS NOT NULL AND "gift_card_redemptions"."refunded_at" IS NULL;
EXCEPTION WHEN undefined_column THEN RAISE NOTICE 'skipped gift_card_redemptions_draft_id_unique: refunded_at column absent';
END $$;
