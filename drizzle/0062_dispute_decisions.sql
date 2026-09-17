-- Additive dispute decision evidence; existing closed/duplicate open rows are preserved.
SET lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_operation_key" uuid;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_request_hash" text;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "refund_record_id" uuid;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_email_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_email_progress" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_email_state" text DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_email_next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "decision_email_lease_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "opening_email_payload" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "opening_email_progress" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "opening_email_state" text DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "opening_email_next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "opening_email_lease_until" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.disputes'::regclass AND conname = 'disputes_refund_record_id_order_refund_records_id_fk') THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "disputes_refund_record_id_order_refund_records_id_fk" FOREIGN KEY ("refund_record_id") REFERENCES "public"."order_refund_records"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_decision_operation_key_unique" ON "disputes" USING btree ("decision_operation_key") WHERE "disputes"."decision_operation_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "disputes_refund_record_id_unique" ON "disputes" USING btree ("refund_record_id") WHERE "disputes"."refund_record_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_decision_email_due_idx" ON "disputes" USING btree ("decision_email_state","decision_email_next_attempt_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_opening_email_due_idx" ON "disputes" USING btree ("opening_email_state","opening_email_next_attempt_at","id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_status_resolved_idx" ON "disputes" USING btree ("status","resolved_at","id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.disputes'::regclass AND conname = 'disputes_decision_metadata_check') THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decision_metadata_check" CHECK (
    ("disputes"."decision_operation_key" IS NULL AND "disputes"."decision_request_hash" IS NULL AND "disputes"."decision_snapshot" IS NULL
      AND "disputes"."refund_record_id" IS NULL AND "disputes"."decision_email_payload" = '{}'::jsonb
      AND "disputes"."decision_email_progress" = '{}'::jsonb AND "disputes"."decision_email_state" = 'not_required'
      AND "disputes"."decision_email_next_attempt_at" IS NULL AND "disputes"."decision_email_lease_until" IS NULL)
    OR ("disputes"."decision_operation_key" IS NOT NULL AND "disputes"."decision_request_hash" IS NOT NULL AND length(btrim("disputes"."decision_request_hash")) > 0
      AND "disputes"."decision_snapshot" IS NOT NULL AND jsonb_typeof("disputes"."decision_snapshot") = 'object'
      AND "disputes"."status" IN ('resolved', 'rejected') AND "disputes"."resolution" IS NOT NULL AND length(btrim("disputes"."resolution")) > 0
      AND "disputes"."admin_email" IS NOT NULL AND length(btrim("disputes"."admin_email")) > 0 AND "disputes"."resolved_at" IS NOT NULL
      AND ("disputes"."refund_record_id" IS NULL OR "disputes"."status" = 'resolved'))
  );
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.disputes'::regclass AND conname = 'disputes_delivery_json_check') THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "disputes_delivery_json_check" CHECK (jsonb_typeof("disputes"."decision_email_payload") = 'object' AND jsonb_typeof("disputes"."decision_email_progress") = 'object'
    AND jsonb_typeof("disputes"."opening_email_payload") = 'object' AND jsonb_typeof("disputes"."opening_email_progress") = 'object');
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.disputes'::regclass AND conname = 'disputes_decision_email_check') THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "disputes_decision_email_check" CHECK (
    ("disputes"."decision_email_payload" = '{}'::jsonb AND "disputes"."decision_email_state" = 'not_required' AND "disputes"."decision_email_progress" = '{}'::jsonb
      AND "disputes"."decision_email_next_attempt_at" IS NULL AND "disputes"."decision_email_lease_until" IS NULL)
    OR ("disputes"."decision_email_payload" <> '{}'::jsonb AND "disputes"."decision_email_state" IN ('pending', 'delivering', 'delivered'))
  );
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.disputes'::regclass AND conname = 'disputes_opening_email_check') THEN
    ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opening_email_check" CHECK (
    ("disputes"."opening_email_payload" = '{}'::jsonb AND "disputes"."opening_email_state" = 'not_required' AND "disputes"."opening_email_progress" = '{}'::jsonb
      AND "disputes"."opening_email_next_attempt_at" IS NULL AND "disputes"."opening_email_lease_until" IS NULL)
    OR ("disputes"."opening_email_payload" <> '{}'::jsonb AND "disputes"."opening_email_state" IN ('pending', 'delivering', 'delivered'))
  );
  END IF;
END $$;
