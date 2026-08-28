-- Down for 0047_agent_runtime.
--
-- Idempotent and tightly scoped. Dropping these tables discards the agent's
-- audit trail (every model turn and every tool call) and the in-progress order
-- specs for open WhatsApp conversations — run it only where that is disposable.
--
-- `order_drafts.channel` is dropped too. Nothing else reads it yet; the KVKK
-- payment gate falls back to the pre-0047 behaviour, where content_consent_at
-- alone decides.

DROP INDEX IF EXISTS "agent_runs_conversation_idx";
DROP INDEX IF EXISTS "agent_actions_run_idx";

DROP TABLE IF EXISTS "agent_actions";
DROP TABLE IF EXISTS "agent_runs";
DROP TABLE IF EXISTS "agent_order_specs";

ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "channel";
