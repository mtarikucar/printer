-- Down migration for 0034_order_content_consent
-- Reverts exactly what the up added: the content-consent columns on both
-- order_drafts and orders. Idempotent + scoped; never touches other data.
ALTER TABLE "orders" DROP COLUMN IF EXISTS "content_consent_version";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "content_consent_at";--> statement-breakpoint
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "content_consent_version";--> statement-breakpoint
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "content_consent_at";
