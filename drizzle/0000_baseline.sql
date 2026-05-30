CREATE TYPE "public"."admin_action_type" AS ENUM('approve', 'reject', 'regenerate', 'print', 'ship', 'confirm', 'deliver', 'message_email', 'edit', 'force_review', 'assign_manufacturer', 'mark_havale_paid', 'mark_payment_expired', 'gallery_approve', 'gallery_reject', 'gallery_reward', 'gallery_feature', 'gallery_unfeature', 'qc_approve', 'qc_reject');--> statement-breakpoint
CREATE TYPE "public"."carrier" AS ENUM('yurtici', 'aras', 'mng', 'ptt', 'surat', 'other');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."doc_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."manufacturer_doc_type" AS ENUM('vergi_levhasi', 'ticaret_sicil', 'imza_sirkuleri', 'kimlik', 'other');--> statement-breakpoint
CREATE TYPE "public"."earning_status" AS ENUM('pending', 'paid', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."figurine_material" AS ENUM('resin', 'filament');--> statement-breakpoint
CREATE TYPE "public"."figurine_size" AS ENUM('kucuk', 'orta', 'buyuk');--> statement-breakpoint
CREATE TYPE "public"."figurine_style" AS ENUM('realistic', 'disney', 'anime', 'chibi', 'object');--> statement-breakpoint
CREATE TYPE "public"."gallery_review_status" AS ENUM('none', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."generation_provider" AS ENUM('tripo3d', 'meshy');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gift_card_status" AS ENUM('pending_payment', 'active', 'partially_used', 'fully_used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gift_card_theme" AS ENUM('ramazan', 'dogum_gunu', 'yeni_yil', 'sevgililer_gunu', 'genel');--> statement-breakpoint
CREATE TYPE "public"."iban_review_status" AS ENUM('none', 'pending');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued');--> statement-breakpoint
CREATE TYPE "public"."manufacturer_order_status" AS ENUM('unassigned', 'assigned', 'accepted', 'printing', 'printed', 'qc_pending', 'qc_rejected', 'qc_approved', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."manufacturer_status" AS ENUM('pending_approval', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('customer_admin', 'manufacturer_admin');--> statement-breakpoint
CREATE TYPE "public"."message_sender_type" AS ENUM('customer', 'admin', 'manufacturer');--> statement-breakpoint
CREATE TYPE "public"."ocr_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."order_draft_status" AS ENUM('pending', 'awaiting_review', 'confirmed', 'expired', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('paid', 'generating', 'processing_mesh', 'review', 'approved', 'printing', 'quality_check', 'shipped', 'delivered', 'failed_generation', 'failed_mesh', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'gift_card_full');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('succeeded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "public"."preview_status" AS ENUM('generating', 'ready', 'failed', 'approved', 'revision_requested', 'expired');--> statement-breakpoint
CREATE TYPE "public"."qc_photo_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"action" "admin_action_type" NOT NULL,
	"admin_email" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"template_key" text,
	"admin_email" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
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
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
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
--> statement-breakpoint
CREATE TABLE "gift_card_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"order_id" uuid,
	"draft_id" uuid,
	"amount_kurus" integer NOT NULL,
	"redeemed_by_user_id" uuid NOT NULL,
	"refunded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
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
--> statement-breakpoint
CREATE TABLE "invoices" (
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
--> statement-breakpoint
CREATE TABLE "manufacturer_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturer_assignment_evaluations" (
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
--> statement-breakpoint
CREATE TABLE "manufacturer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"type" "manufacturer_doc_type" NOT NULL,
	"storage_key" text NOT NULL,
	"status" "doc_review_status" DEFAULT 'pending' NOT NULL,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturer_earnings" (
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
--> statement-breakpoint
CREATE TABLE "manufacturer_notifications" (
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
--> statement-breakpoint
CREATE TABLE "manufacturers" (
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
--> statement-breakpoint
CREATE TABLE "mesh_reports" (
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
--> statement-breakpoint
CREATE TABLE "messages" (
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
--> statement-breakpoint
CREATE TABLE "order_drafts" (
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
--> statement-breakpoint
CREATE TABLE "order_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"original_url" text NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
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
--> statement-breakpoint
CREATE TABLE "payouts" (
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
--> statement-breakpoint
CREATE TABLE "previews" (
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
--> statement-breakpoint
CREATE TABLE "qc_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"review_status" "qc_photo_review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"admin_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_addresses" (
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
--> statement-breakpoint
CREATE TABLE "users" (
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
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notifications" ADD CONSTRAINT "customer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v1_winner_id_manufacturers_id_fk" FOREIGN KEY ("v1_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_assignment_evaluations" ADD CONSTRAINT "manufacturer_assignment_evaluations_v2_winner_id_manufacturers_id_fk" FOREIGN KEY ("v2_winner_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_documents" ADD CONSTRAINT "manufacturer_documents_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_earnings" ADD CONSTRAINT "manufacturer_earnings_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD CONSTRAINT "mesh_reports_generation_id_generation_attempts_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gallery_reward_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gallery_reward_gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_photos" ADD CONSTRAINT "qc_photos_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_addresses" ADD CONSTRAINT "user_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_notifications_user_idx" ON "customer_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_card_redemptions_draft_id_unique" ON "gift_card_redemptions" USING btree ("draft_id") WHERE "gift_card_redemptions"."draft_id" IS NOT NULL AND "gift_card_redemptions"."refunded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mfg_eval_order_version_idx" ON "manufacturer_assignment_evaluations" USING btree ("order_id","weights_version");--> statement-breakpoint
CREATE INDEX "messages_order_channel_idx" ON "messages" USING btree ("order_id","channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_addresses_one_default_idx" ON "user_addresses" USING btree ("user_id") WHERE "user_addresses"."is_default" = true;