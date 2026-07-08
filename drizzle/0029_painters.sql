CREATE TYPE "public"."painter_order_status" AS ENUM('unassigned', 'assigned', 'accepted', 'painting', 'painted', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."painter_status" AS ENUM('pending_approval', 'conditionally_approved', 'active', 'suspended', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'painting' BEFORE 'shipped';--> statement-breakpoint
CREATE TABLE "painter_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"painter_id" uuid NOT NULL,
	"action" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "painter_earnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"painter_id" uuid NOT NULL,
	"gross_kurus" integer NOT NULL,
	"commission_kurus" integer NOT NULL,
	"net_kurus" integer NOT NULL,
	"commission_rate_bps" integer NOT NULL,
	"status" "earning_status" DEFAULT 'pending' NOT NULL,
	"payout_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "painter_earnings_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "painter_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"painter_id" uuid NOT NULL,
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
CREATE TABLE "painter_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"painter_id" uuid NOT NULL,
	"total_kurus" integer NOT NULL,
	"earning_count" integer NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"reference" text,
	"admin_email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "painters" (
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
	"status" "painter_status" DEFAULT 'pending_approval' NOT NULL,
	"rejection_reason" text,
	"work_sample_photo_uploaded_at" timestamp,
	"notes" text,
	"strike_count" integer DEFAULT 0 NOT NULL,
	"pending_iban" text,
	"iban_review_status" "iban_review_status" DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "painters_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "needs_painting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "painting_price_kurus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "needs_painting" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painting_price_kurus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painter_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painter_status" "painter_order_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "assigned_to_painter_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sent_to_painter_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "painted_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "declined_painter_ids" jsonb;--> statement-breakpoint
ALTER TABLE "painter_actions" ADD CONSTRAINT "painter_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_actions" ADD CONSTRAINT "painter_actions_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_earnings" ADD CONSTRAINT "painter_earnings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_earnings" ADD CONSTRAINT "painter_earnings_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_earnings" ADD CONSTRAINT "painter_earnings_payout_id_painter_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."painter_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_notifications" ADD CONSTRAINT "painter_notifications_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_notifications" ADD CONSTRAINT "painter_notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE no action ON UPDATE no action;