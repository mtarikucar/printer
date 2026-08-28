-- Down for 0044_auto_model_pipeline.
--
-- Idempotent and tightly scoped. It never deletes an order, a model file or a
-- customer's approval decision that has already been recorded — only the
-- columns and tables this migration introduced.
--
-- NOTE on `order_status`: PostgreSQL cannot drop an enum value. Any order
-- parked in 'awaiting_customer_approval' is pulled back to 'review', which is
-- the state it came from and which the pre-0044 admin UI already understands.
-- The label itself is left behind as a dead value; the up re-adds it with
-- IF NOT EXISTS, so up -> down -> up is clean.

UPDATE "orders" SET "status" = 'review' WHERE "status" = 'awaiting_customer_approval';

DROP INDEX IF EXISTS "generation_attempts_order_round_uq";
DROP INDEX IF EXISTS "order_model_approvals_order_idx";

DROP TABLE IF EXISTS "order_model_approvals";
DROP TYPE IF EXISTS "public"."model_approval_decision";

ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_model_approval_token_unique";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "customer_model_revision_note";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "customer_model_approved_at";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "model_approval_token";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "model_turntable_url";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "model_turntable_key";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "model_generation_round";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "model_source";

ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "verdict_reasons";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "verdict";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "dropped_significant_component";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "fill_ratio";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "height_mm";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "merged_component_count";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "min_wall_p5_mm";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "min_wall_p1_mm";
ALTER TABLE "mesh_reports" DROP COLUMN IF EXISTS "meshy_printability";

ALTER TABLE "generation_attempts" DROP COLUMN IF EXISTS "credits";
ALTER TABLE "generation_attempts" DROP COLUMN IF EXISTS "round";
-- Restoring the NOT NULL is only safe when no row was written without a URL.
UPDATE "generation_attempts" SET "input_image_url" = '' WHERE "input_image_url" IS NULL;
ALTER TABLE "generation_attempts" ALTER COLUMN "input_image_url" SET NOT NULL;
