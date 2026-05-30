-- ─────────────────────────────────────────────────────────────────────────
-- IDEMPOTENT SCHEMA SYNC — generated from drizzle/0000_baseline.sql.
-- Brings any DB (fresh, or partial/divergent) up to the full current schema:
--   * creates missing enums / tables
--   * ADDS MISSING COLUMNS on tables that already exist but are partial
--     (added nullable so populated tables never block; strict NOT NULL is
--      reconciled by later generated migrations)
--   * adds missing FKs / indexes
-- Additive only (no DROP), no data loss, safe to run repeatedly.
-- Apply: psql "$DATABASE_URL" -f scripts/db/prod-sync-hotfix.sql   (NOT -1)
-- ─────────────────────────────────────────────────────────────────────────

-- ── enums (guarded) ──
DO $$ BEGIN CREATE TYPE "public"."admin_action_type" AS ENUM('approve', 'reject', 'regenerate', 'print', 'ship', 'confirm', 'deliver', 'message_email', 'edit', 'force_review', 'assign_manufacturer', 'mark_havale_paid', 'mark_payment_expired', 'gallery_approve', 'gallery_reject', 'gallery_reward', 'gallery_feature', 'gallery_unfeature', 'qc_approve', 'qc_reject'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."carrier" AS ENUM('yurtici', 'aras', 'mng', 'ptt', 'surat', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."doc_review_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."manufacturer_doc_type" AS ENUM('vergi_levhasi', 'ticaret_sicil', 'imza_sirkuleri', 'kimlik', 'other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."earning_status" AS ENUM('pending', 'paid', 'reversed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."figurine_material" AS ENUM('resin', 'filament'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."figurine_size" AS ENUM('kucuk', 'orta', 'buyuk'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."figurine_style" AS ENUM('realistic', 'disney', 'anime', 'chibi', 'object'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."gallery_review_status" AS ENUM('none', 'pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."generation_provider" AS ENUM('tripo3d', 'meshy'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."generation_status" AS ENUM('pending', 'running', 'succeeded', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."gift_card_status" AS ENUM('pending_payment', 'active', 'partially_used', 'fully_used', 'expired'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."gift_card_theme" AS ENUM('ramazan', 'dogum_gunu', 'yeni_yil', 'sevgililer_gunu', 'genel'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."iban_review_status" AS ENUM('none', 'pending'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."manufacturer_order_status" AS ENUM('unassigned', 'assigned', 'accepted', 'printing', 'printed', 'qc_pending', 'qc_rejected', 'qc_approved', 'shipped'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."manufacturer_status" AS ENUM('pending_approval', 'active', 'suspended'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."message_channel" AS ENUM('customer_admin', 'manufacturer_admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."message_sender_type" AS ENUM('customer', 'admin', 'manufacturer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."ocr_confidence" AS ENUM('high', 'medium', 'low'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."order_draft_status" AS ENUM('pending', 'awaiting_review', 'confirmed', 'expired', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."order_status" AS ENUM('paid', 'generating', 'processing_mesh', 'review', 'approved', 'printing', 'quality_check', 'shipped', 'delivered', 'failed_generation', 'failed_mesh', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'gift_card_full'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."payment_status" AS ENUM('succeeded', 'refunded'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."preview_status" AS ENUM('generating', 'ready', 'failed', 'approved', 'revision_requested', 'expired'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."qc_photo_review_status" AS ENUM('pending', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
-- ── enum values added to PRE-EXISTING enums (CREATE TYPE below is skipped on
--    existing DBs, so these must be added explicitly; ADD VALUE needs no txn) ──
ALTER TYPE "public"."admin_action_type" ADD VALUE IF NOT EXISTS 'qc_approve';
ALTER TYPE "public"."admin_action_type" ADD VALUE IF NOT EXISTS 'qc_reject';
ALTER TYPE "public"."order_status" ADD VALUE IF NOT EXISTS 'quality_check' BEFORE 'shipped';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_pending' BEFORE 'shipped';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_rejected' BEFORE 'shipped';
ALTER TYPE "public"."manufacturer_order_status" ADD VALUE IF NOT EXISTS 'qc_approved' BEFORE 'shipped';
ALTER TYPE "public"."figurine_size" ADD VALUE IF NOT EXISTS 'kucuk';
ALTER TYPE "public"."figurine_style" ADD VALUE IF NOT EXISTS 'object';


-- ── tables (IF NOT EXISTS) ──
CREATE TABLE IF NOT EXISTS "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"action" "admin_action_type" NOT NULL,
	"admin_email" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "admin_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template_key" text,
	"admin_email" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "generation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "generation_provider" NOT NULL,
	"provider_task_id" text,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"input_image_url" text NOT NULL,
	"output_glb_url" text,
	"output_stl_url" text,
	"error_message" text,
	"cost_cents" integer,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "gift_card_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"order_id" uuid,
	"draft_id" uuid,
	"amount_kurus" integer NOT NULL,
	"redeemed_by_user_id" uuid NOT NULL,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"theme" "gift_card_theme",
	"amount_kurus" integer NOT NULL,
	"balance_kurus" integer NOT NULL,
	"status" "gift_card_status" DEFAULT 'active' NOT NULL,
	"buyer_user_id" uuid,
	"buyer_email" text,
	"buyer_name" text,
	"note" text,
	"max_redemptions" integer,
	"recipient_email" text,
	"recipient_name" text,
	"recipient_message" text,
	"email_sent" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_unique" UNIQUE("code")
);
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
CREATE TABLE IF NOT EXISTS "manufacturer_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "manufacturers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"company_name" text NOT NULL,
	"contact_person" text NOT NULL,
	"phone" text NOT NULL,
	"whatsapp_phone" text,
	"address" jsonb,
	"capabilities" jsonb,
	"tax_id" text,
	"tax_id_type" text,
	"requires_manual_tax_review" boolean DEFAULT false NOT NULL,
	"iban" text,
	"bank_account_holder" text,
	"bank_name" text,
	"max_concurrent_orders" integer DEFAULT 5 NOT NULL,
	"accepting_orders" boolean DEFAULT true NOT NULL,
	"onboarding_accepted_at" timestamp,
	"status" "manufacturer_status" DEFAULT 'pending_approval' NOT NULL,
	"notes" text,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"pending_iban" text,
	"iban_review_status" "iban_review_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "manufacturers_email_unique" UNIQUE("email")
);
CREATE TABLE IF NOT EXISTS "mesh_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"generation_id" uuid NOT NULL,
	"is_watertight" boolean NOT NULL,
	"is_volume" boolean NOT NULL,
	"vertex_count" integer NOT NULL,
	"face_count" integer NOT NULL,
	"component_count" integer NOT NULL,
	"bounding_box" jsonb,
	"base_added" boolean DEFAULT false NOT NULL,
	"repairs_applied" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
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
	"material" "figurine_material" DEFAULT 'resin' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"photo_key" text NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"amount_kurus" integer NOT NULL,
	"gift_card_id" uuid,
	"gift_card_amount_kurus" integer DEFAULT 0 NOT NULL,
	"havale_discount_kurus" integer DEFAULT 0 NOT NULL,
	"upsells" jsonb,
	"upsell_amount_kurus" integer DEFAULT 0 NOT NULL,
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
CREATE TABLE IF NOT EXISTS "order_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"original_url" text NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"preview_id" uuid,
	"draft_id" uuid,
	"email" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text,
	"figurine_size" "figurine_size" NOT NULL,
	"style" "figurine_style" DEFAULT 'realistic' NOT NULL,
	"modifiers" jsonb,
	"material" "figurine_material" DEFAULT 'resin' NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"status" "order_status" DEFAULT 'paid' NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'succeeded' NOT NULL,
	"amount_kurus" integer NOT NULL,
	"havale_discount_kurus" integer DEFAULT 0 NOT NULL,
	"gift_card_amount_kurus" integer DEFAULT 0 NOT NULL,
	"upsells" jsonb,
	"upsell_amount_kurus" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"shipped_at" timestamp,
	"tracking_number" text,
	"carrier" "carrier",
	"delivered_at" timestamp,
	"admin_notes" text,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_display_name" text,
	"published_at" timestamp,
	"gallery_slug" text,
	"gallery_category" text,
	"gallery_tags" jsonb,
	"gallery_review_status" "gallery_review_status" DEFAULT 'none' NOT NULL,
	"gallery_review_reason" text,
	"gallery_reward_gift_card_id" uuid,
	"gallery_featured" boolean DEFAULT false NOT NULL,
	"gallery_featured_at" timestamp,
	"manufacturer_id" uuid,
	"manufacturer_status" "manufacturer_order_status",
	"assigned_to_manufacturer_at" timestamp,
	"manufacturer_accepted_at" timestamp,
	"manufacturer_printed_at" timestamp,
	"declined_manufacturer_ids" jsonb,
	"qc_round" integer DEFAULT 1 NOT NULL,
	"qc_rejection_count" integer DEFAULT 0 NOT NULL,
	"customer_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "orders_gallery_slug_unique" UNIQUE("gallery_slug")
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
CREATE TABLE IF NOT EXISTS "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"photo_key" text NOT NULL,
	"photo_url" text NOT NULL,
	"figurine_size" "figurine_size" NOT NULL,
	"style" "figurine_style" DEFAULT 'realistic' NOT NULL,
	"modifiers" jsonb,
	"status" "preview_status" DEFAULT 'generating' NOT NULL,
	"glb_url" text,
	"glb_key" text,
	"meshy_task_id" text,
	"revision_note" text,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"full_name" text NOT NULL,
	"phone" text,
	"default_address" jsonb,
	"password_reset_token_hash" text,
	"password_reset_expires_at" timestamp,
	"is_guest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- ── columns (fill partial pre-existing tables; nullable, idempotent) ──
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "action" "admin_action_type";
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "admin_email" text;
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "admin_actions" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "template_key" text;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "admin_email" text;
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp;
ALTER TABLE "customer_notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "status" "dispute_status";
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolution" text;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "admin_email" text;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "provider" "generation_provider";
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "provider_task_id" text;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "status" "generation_status";
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "input_image_url" text;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "output_glb_url" text;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "output_stl_url" text;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "error_message" text;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "cost_cents" integer;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "generation_attempts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "gift_card_id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "draft_id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "amount_kurus" integer;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "redeemed_by_user_id" uuid;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp;
ALTER TABLE "gift_card_redemptions" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "theme" "gift_card_theme";
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "amount_kurus" integer;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "balance_kurus" integer;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "status" "gift_card_status";
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "buyer_user_id" uuid;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "buyer_email" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "buyer_name" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "note" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "max_redemptions" integer;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "recipient_email" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "recipient_name" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "recipient_message" text;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "email_sent" boolean;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "gift_cards" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_number" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subtotal_kurus" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "kdv_kurus" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "total_kurus" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "kdv_rate_bps" integer;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "status" "invoice_status";
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "provider_ref" text;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "action" text;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "manufacturer_actions" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "v1_winner_id" uuid;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "v2_winner_id" uuid;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "v1_scores" jsonb;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "v2_scores" jsonb;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "weights_version" text;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "authoritative" text;
ALTER TABLE "manufacturer_assignment_evaluations" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "type" "manufacturer_doc_type";
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "storage_key" text;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "status" "doc_review_status";
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "review_note" text;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturer_documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "gross_kurus" integer;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "commission_kurus" integer;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "net_kurus" integer;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "commission_rate_bps" integer;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "status" "earning_status";
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "payout_id" uuid;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturer_earnings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "email_sent_at" timestamp;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "email_failed_reason" text;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "read_at" timestamp;
ALTER TABLE "manufacturer_notifications" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "company_name" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "contact_person" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "whatsapp_phone" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "address" jsonb;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "capabilities" jsonb;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "tax_id" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "tax_id_type" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "requires_manual_tax_review" boolean;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "iban" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "bank_account_holder" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "bank_name" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "max_concurrent_orders" integer;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "accepting_orders" boolean;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "onboarding_accepted_at" timestamp;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "status" "manufacturer_status";
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "notes" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "strike_count" integer;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "pending_iban" text;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "iban_review_status" "iban_review_status";
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "manufacturers" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "generation_id" uuid;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "is_watertight" boolean;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "is_volume" boolean;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "vertex_count" integer;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "face_count" integer;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "component_count" integer;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "bounding_box" jsonb;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "base_added" boolean;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "repairs_applied" jsonb;
ALTER TABLE "mesh_reports" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channel" "message_channel";
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_type" "message_sender_type";
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_id" uuid;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender_email" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_key" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachment_thumbnail_key" text;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "read_by_admin_at" timestamp;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "read_by_counterparty_at" timestamp;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "flagged" boolean;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "reference" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "preview_id" uuid;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "figurine_size" "figurine_size";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "style" "figurine_style";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "modifiers" jsonb;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "material" "figurine_material";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "shipping_address" jsonb;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "photo_key" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "amount_kurus" integer;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "gift_card_id" uuid;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "gift_card_amount_kurus" integer;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "havale_discount_kurus" integer;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "upsells" jsonb;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "upsell_amount_kurus" integer;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "payment_method" "payment_method";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "status" "order_draft_status";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "paytr_merchant_oid" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "paytr_test_mode" boolean;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "paytr_payment_type" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "paytr_failure_reason" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "bank_transfer_deadline" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "bank_transfer_receipt_key" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "bank_transfer_receipt_uploaded_at" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "bank_transfer_reminder_sent_at" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "receipt_ocr_text" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "receipt_ocr_parsed" jsonb;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "receipt_ocr_confidence" "ocr_confidence";
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "receipt_ocr_failure_reason" text;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "promoted_order_id" uuid;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "promoted_at" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "order_drafts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "order_photos" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "order_photos" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "order_photos" ADD COLUMN IF NOT EXISTS "original_url" text;
ALTER TABLE "order_photos" ADD COLUMN IF NOT EXISTS "thumbnail_url" text;
ALTER TABLE "order_photos" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "order_number" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preview_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "draft_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "figurine_size" "figurine_size";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "style" "figurine_style";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "modifiers" jsonb;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "material" "figurine_material";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_address" jsonb;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "status" "order_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "locale" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_method" "payment_method";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_status" "payment_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "amount_kurus" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "havale_discount_kurus" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gift_card_amount_kurus" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "upsells" jsonb;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "upsell_amount_kurus" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipped_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_number" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" "carrier";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "admin_notes" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "failure_reason" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "retry_count" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "is_public" boolean;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "public_display_name" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "published_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_slug" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_category" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_tags" jsonb;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_review_status" "gallery_review_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_review_reason" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_reward_gift_card_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_featured" boolean;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "gallery_featured_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manufacturer_status" "manufacturer_order_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_to_manufacturer_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manufacturer_accepted_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manufacturer_printed_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "declined_manufacturer_ids" jsonb;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qc_round" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "qc_rejection_count" integer;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_note" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "total_kurus" integer;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "earning_count" integer;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "status" "payout_status";
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "reference" text;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "admin_email" text;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "paid_at" timestamp;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "photo_key" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "photo_url" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "figurine_size" "figurine_size";
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "style" "figurine_style";
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "modifiers" jsonb;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "status" "preview_status";
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "glb_url" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "glb_key" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "meshy_task_id" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "revision_note" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "error_message" text;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "previews" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "manufacturer_id" uuid;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "round" integer;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "storage_key" text;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "thumbnail_key" text;
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "review_status" "qc_photo_review_status";
ALTER TABLE "qc_photos" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "order_id" uuid;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "round" integer;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "decision" text;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "reason" text;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "admin_email" text;
ALTER TABLE "qc_reviews" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "user_id" uuid;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "full_name" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "adres" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "mahalle" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "ilce" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "il" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "posta_kodu" text;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "is_default" boolean;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "user_addresses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "id" uuid;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "default_address" jsonb;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_hash" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_expires_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_guest" boolean;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;

-- ── foreign keys (guarded) ──
DO $$ BEGIN ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v1_winner_id_manufacturers_id_fk" FOREIGN KEY ("v1_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v2_winner_id_manufacturers_id_fk" FOREIGN KEY ("v2_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_documents" ADD CONSTRAINT "manufacturer_documents_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "mesh_reports" ADD CONSTRAINT "mesh_reports_generation_id_generation_attempts_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation_attempts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_gallery_reward_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gallery_reward_gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "payouts" ADD CONSTRAINT "payouts_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "previews" ADD CONSTRAINT "previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── indexes (guarded; undefined_column tolerates a missing partial-predicate col) ──
DO $$ BEGIN CREATE INDEX IF NOT EXISTS "customer_notifications_user_idx" ON "customer_notifications" USING btree ("user_id","created_at"); EXCEPTION WHEN undefined_column OR duplicate_table THEN null; END $$;
DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_redemptions_draft_id_unique" ON "gift_card_redemptions" USING btree ("draft_id") WHERE "gift_card_redemptions"."draft_id" IS NOT NULL AND "gift_card_redemptions"."refunded_at" IS NULL; EXCEPTION WHEN undefined_column OR duplicate_table THEN null; END $$;
DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version"); EXCEPTION WHEN undefined_column OR duplicate_table THEN null; END $$;
DO $$ BEGIN CREATE INDEX IF NOT EXISTS "messages_order_channel_idx" ON "messages" USING btree ("order_id","channel","created_at"); EXCEPTION WHEN undefined_column OR duplicate_table THEN null; END $$;
DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS "user_addresses_one_default_idx" ON "user_addresses" USING btree ("user_id") WHERE "user_addresses"."is_default" = true; EXCEPTION WHEN undefined_column OR duplicate_table THEN null; END $$;
