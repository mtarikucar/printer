-- Down for 0046_whatsapp_channel.
--
-- Idempotent and tightly scoped: it removes exactly what the up created and is
-- a safe no-op if already reverted. Dropping these tables discards WhatsApp
-- conversation history, which exists nowhere else — run it only on an
-- environment where that history is disposable.

ALTER TABLE "orders" DROP COLUMN IF EXISTS "wa_conversation_id";

DROP INDEX IF EXISTS "wa_messages_conversation_idx";
DROP INDEX IF EXISTS "wa_inbound_events_received_idx";
DROP INDEX IF EXISTS "wa_conversations_last_inbound_idx";

DROP TABLE IF EXISTS "wa_messages";
DROP TABLE IF EXISTS "wa_media_cache";
DROP TABLE IF EXISTS "wa_inbound_events";
DROP TABLE IF EXISTS "wa_conversations";

DROP TYPE IF EXISTS "public"."wa_message_direction";
DROP TYPE IF EXISTS "public"."wa_conversation_mode";
