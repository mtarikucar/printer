-- Down migration for 0035_draft_photo_keys
-- Reverts exactly what the up added. Idempotent + scoped.
ALTER TABLE "order_drafts" DROP COLUMN IF EXISTS "photo_keys";
