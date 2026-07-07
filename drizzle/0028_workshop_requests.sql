CREATE TYPE "public"."workshop_request_status" AS ENUM('new', 'reviewing', 'scheduled', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "workshop_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"organization_name" text,
	"venue_type" text NOT NULL,
	"city" text NOT NULL,
	"district" text NOT NULL,
	"address_line" text NOT NULL,
	"participant_count" integer NOT NULL,
	"age_group" text NOT NULL,
	"workshop_type" text NOT NULL,
	"preferred_date" text,
	"alternative_date" text,
	"budget_range" text,
	"message" text,
	"how_heard" text,
	"source" text DEFAULT 'web' NOT NULL,
	"kvkk_consent_at" timestamp DEFAULT now() NOT NULL,
	"status" "workshop_request_status" DEFAULT 'new' NOT NULL,
	"admin_notes" text,
	"rejection_reason" text,
	"quoted_price_kurus" integer,
	"scheduled_at" timestamp,
	"admin_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workshop_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "workshop_requests" ADD CONSTRAINT "workshop_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workshop_requests_status_idx" ON "workshop_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workshop_requests_user_idx" ON "workshop_requests" USING btree ("user_id","created_at");