CREATE TYPE "public"."wa_conversation_mode" AS ENUM('bot', 'human', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."wa_message_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "wa_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"wa_id" text,
	"profile_name" text,
	"mode" "wa_conversation_mode" DEFAULT 'bot' NOT NULL,
	"state" jsonb,
	"last_inbound_at" timestamp,
	"last_outbound_at" timestamp,
	"window_expires_at" timestamp,
	"kvkk_notice_sent_at" timestamp,
	"blocked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_conversations_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "wa_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_hash" text NOT NULL,
	"payload" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_inbound_events_event_hash_unique" UNIQUE("event_hash")
);
--> statement-breakpoint
CREATE TABLE "wa_media_cache" (
	"local_key" text PRIMARY KEY NOT NULL,
	"meta_media_id" text NOT NULL,
	"mime_type" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "wa_message_direction" NOT NULL,
	"wa_message_id" text,
	"type" text DEFAULT 'text' NOT NULL,
	"body" text,
	"media_key" text,
	"sender_kind" text,
	"status" text,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "wa_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_conversations_last_inbound_idx" ON "wa_conversations" USING btree ("last_inbound_at");--> statement-breakpoint
CREATE INDEX "wa_inbound_events_received_idx" ON "wa_inbound_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "wa_messages_conversation_idx" ON "wa_messages" USING btree ("conversation_id","created_at");