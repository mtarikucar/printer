CREATE TYPE "public"."admin_action_type" AS ENUM('approve', 'reject', 'regenerate', 'print', 'ship', 'confirm', 'deliver', 'message_email', 'edit', 'force_review', 'assign_manufacturer', 'mark_havale_paid', 'mark_payment_expired');--> statement-breakpoint
CREATE TYPE "public"."figurine_size" AS ENUM('kucuk', 'orta', 'buyuk');--> statement-breakpoint
CREATE TYPE "public"."figurine_style" AS ENUM('realistic', 'disney', 'anime', 'chibi', 'object');--> statement-breakpoint
CREATE TYPE "public"."generation_provider" AS ENUM('tripo3d', 'meshy');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gift_card_status" AS ENUM('pending_payment', 'active', 'partially_used', 'fully_used', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gift_card_theme" AS ENUM('ramazan', 'dogum_gunu', 'yeni_yil', 'sevgililer_gunu', 'genel');--> statement-breakpoint
CREATE TYPE "public"."manufacturer_order_status" AS ENUM('unassigned', 'assigned', 'accepted', 'printing', 'printed', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."manufacturer_status" AS ENUM('pending_approval', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."ocr_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."order_draft_status" AS ENUM('pending', 'awaiting_review', 'confirmed', 'expired', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('paid', 'generating', 'processing_mesh', 'review', 'approved', 'printing', 'shipped', 'delivered', 'failed_generation', 'failed_mesh', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card', 'bank_transfer', 'gift_card_full');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('succeeded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."preview_status" AS ENUM('generating', 'ready', 'failed', 'approved', 'revision_requested', 'expired');--> statement-breakpoint
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
CREATE TABLE "manufacturer_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid NOT NULL,
	"action" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"shipping_address" jsonb NOT NULL,
	"status" "order_status" DEFAULT 'paid' NOT NULL,
	"locale" text DEFAULT 'tr' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'succeeded' NOT NULL,
	"amount_kurus" integer NOT NULL,
	"havale_discount_kurus" integer DEFAULT 0 NOT NULL,
	"gift_card_amount_kurus" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"shipped_at" timestamp,
	"tracking_number" text,
	"admin_notes" text,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"public_display_name" text,
	"published_at" timestamp,
	"gallery_category" text,
	"gallery_tags" jsonb,
	"manufacturer_id" uuid,
	"manufacturer_status" "manufacturer_order_status",
	"assigned_to_manufacturer_at" timestamp,
	"manufacturer_accepted_at" timestamp,
	"manufacturer_printed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"google_id" text,
	"full_name" text NOT NULL,
	"phone" text,
	"default_address" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_actions" ADD CONSTRAINT "manufacturer_actions_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_notifications" ADD CONSTRAINT "manufacturer_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mesh_reports" ADD CONSTRAINT "mesh_reports_generation_id_generation_attempts_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD CONSTRAINT "order_drafts_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_photos" ADD CONSTRAINT "order_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_preview_id_previews_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."previews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_card_redemptions_draft_id_unique" ON "gift_card_redemptions" USING btree ("draft_id") WHERE "gift_card_redemptions"."draft_id" IS NOT NULL AND "gift_card_redemptions"."refunded_at" IS NULL;