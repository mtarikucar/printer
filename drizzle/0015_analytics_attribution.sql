CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"visitor_id" text,
	"session_id" text,
	"user_id" uuid,
	"reference" text,
	"product_id" uuid,
	"value_kurus" integer,
	"currency" text DEFAULT 'TRY' NOT NULL,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"channel" text,
	"page_path" text,
	"user_agent" text,
	"ip" text,
	"props" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "utm_term" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "attribution_channel" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "order_drafts" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "utm_term" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "attribution_channel" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "attribution" jsonb;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_created_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_created_idx" ON "analytics_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "analytics_events_session_idx" ON "analytics_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "analytics_events_visitor_idx" ON "analytics_events" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "analytics_events_channel_idx" ON "analytics_events" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "analytics_events_product_idx" ON "analytics_events" USING btree ("product_id");