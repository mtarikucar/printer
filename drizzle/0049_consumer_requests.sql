-- Tüketici talep sistemi (MSY m.12/A). Aracı hizmet sağlayıcı olarak
-- tüketicinin cayma/fesih/iade/kayıt/teslimat taleplerini iletebileceği ve
-- takip edebileceği, satıcıya DERHAL ileten sistem. Tekrar çalıştırılabilir.
DO $$ BEGIN
  CREATE TYPE "public"."consumer_request_status" AS ENUM('new', 'forwarded', 'in_progress', 'resolved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."consumer_request_type" AS ENUM('withdrawal', 'termination', 'refund', 'records', 'delivery_complaint');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"seller_manufacturer_id" uuid,
	"type" "consumer_request_type" NOT NULL,
	"status" "consumer_request_status" DEFAULT 'new' NOT NULL,
	"message" text NOT NULL,
	"contact_email" text NOT NULL,
	"forwarded_at" timestamp,
	"forward_failed_reason" text,
	"resolution_note" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consumer_requests_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "consumer_requests" ADD CONSTRAINT "consumer_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "consumer_requests" ADD CONSTRAINT "consumer_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "consumer_requests" ADD CONSTRAINT "consumer_requests_seller_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("seller_manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consumer_requests_order_idx" ON "consumer_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consumer_requests_seller_idx" ON "consumer_requests" USING btree ("seller_manufacturer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consumer_requests_status_idx" ON "consumer_requests" USING btree ("status");