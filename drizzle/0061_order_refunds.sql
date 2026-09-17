-- Additive refund/cancellation evidence and scoped gift returns; no data backfill.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_credit_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_allocation_id" uuid,
	"expired_draft_id" uuid,
	"redemption_id" uuid NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"amount_kurus" integer NOT NULL,
	"balance_effect" text NOT NULL,
	"balance_before_kurus" integer,
	"balance_after_kurus" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_credit_returns_parent_check" CHECK (num_nonnulls("gift_credit_returns"."refund_allocation_id", "gift_credit_returns"."expired_draft_id") = 1 AND ("gift_credit_returns"."expired_draft_id" IS NULL OR "gift_credit_returns"."balance_effect" = 'restore')),
	CONSTRAINT "gift_credit_returns_amount_check" CHECK ("gift_credit_returns"."amount_kurus" > 0),
	CONSTRAINT "gift_credit_returns_balance_check" CHECK (
    ("gift_credit_returns"."balance_effect" = 'restore' AND "gift_credit_returns"."balance_before_kurus" IS NOT NULL AND "gift_credit_returns"."balance_after_kurus" IS NOT NULL
      AND "gift_credit_returns"."balance_before_kurus" >= 0 AND "gift_credit_returns"."balance_after_kurus" >= 0
      AND "gift_credit_returns"."balance_after_kurus"::bigint = "gift_credit_returns"."balance_before_kurus"::bigint + "gift_credit_returns"."amount_kurus"::bigint)
    OR ("gift_credit_returns"."balance_effect" = 'none' AND "gift_credit_returns"."balance_before_kurus" IS NULL AND "gift_credit_returns"."balance_after_kurus" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_refund_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"refund_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"order_id" uuid NOT NULL,
	"cash_kurus" integer NOT NULL,
	"gift_kurus" integer NOT NULL,
	"basis_snapshot" jsonb NOT NULL,
	"analytics_gross_kurus" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_refund_allocations_amount_check" CHECK ("order_refund_allocations"."cash_kurus" >= 0 AND "order_refund_allocations"."gift_kurus" >= 0 AND "order_refund_allocations"."analytics_gross_kurus" >= 0 AND (
    ("order_refund_allocations"."kind" = 'cancellation' AND "order_refund_allocations"."cash_kurus" = 0)
    OR ("order_refund_allocations"."kind" IN ('refund', 'legacy_evidence') AND ("order_refund_allocations"."cash_kurus" > 0 OR "order_refund_allocations"."gift_kurus" > 0))
  )),
	CONSTRAINT "order_refund_allocations_snapshot_check" CHECK (jsonb_typeof("order_refund_allocations"."basis_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_refund_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"kind" text NOT NULL,
	"payment_scope_key" text NOT NULL,
	"draft_id" uuid,
	"standalone_order_id" uuid,
	"cash_amount_kurus" integer NOT NULL,
	"gift_amount_kurus" integer NOT NULL,
	"method" text NOT NULL,
	"external_reference" text,
	"external_reference_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"admin_email" text NOT NULL,
	"reason" text NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"result_snapshot" jsonb NOT NULL,
	"email_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_state" text DEFAULT 'not_required' NOT NULL,
	"email_next_attempt_at" timestamp with time zone,
	"email_lease_until" timestamp with time zone,
	"email_last_error" text,
	"analytics_state" text DEFAULT 'not_required' NOT NULL,
	"analytics_progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analytics_recorded_at" timestamp with time zone,
	"analytics_last_error" text,
	CONSTRAINT "order_refund_records_operation_key_unique" UNIQUE("operation_key"),
	CONSTRAINT "order_refund_records_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "order_refund_records_kind_check" CHECK ("order_refund_records"."kind" IN ('refund', 'cancellation', 'legacy_evidence')),
	CONSTRAINT "order_refund_records_scope_check" CHECK (num_nonnulls("order_refund_records"."draft_id", "order_refund_records"."standalone_order_id") = 1 AND (
    ("order_refund_records"."draft_id" IS NOT NULL AND "order_refund_records"."payment_scope_key" = 'draft:' || "order_refund_records"."draft_id"::text)
    OR ("order_refund_records"."standalone_order_id" IS NOT NULL AND "order_refund_records"."payment_scope_key" = 'order:' || "order_refund_records"."standalone_order_id"::text)
  )),
	CONSTRAINT "order_refund_records_amount_check" CHECK ("order_refund_records"."cash_amount_kurus" >= 0 AND "order_refund_records"."gift_amount_kurus" >= 0 AND (
    ("order_refund_records"."kind" = 'cancellation' AND "order_refund_records"."cash_amount_kurus" = 0)
    OR ("order_refund_records"."kind" IN ('refund', 'legacy_evidence') AND ("order_refund_records"."cash_amount_kurus" > 0 OR "order_refund_records"."gift_amount_kurus" > 0))
  )),
	CONSTRAINT "order_refund_records_method_check" CHECK (
    ("order_refund_records"."cash_amount_kurus" > 0 AND "order_refund_records"."method" IN ('card', 'bank_transfer'))
    OR ("order_refund_records"."cash_amount_kurus" = 0 AND "order_refund_records"."gift_amount_kurus" > 0 AND "order_refund_records"."method" = 'gift_credit')
    OR ("order_refund_records"."cash_amount_kurus" = 0 AND "order_refund_records"."gift_amount_kurus" = 0 AND "order_refund_records"."method" = 'none')
  ),
	CONSTRAINT "order_refund_records_reference_check" CHECK (
    ("order_refund_records"."cash_amount_kurus" > 0 AND "order_refund_records"."external_reference" IS NOT NULL AND length(btrim("order_refund_records"."external_reference")) > 0
      AND "order_refund_records"."external_reference_key" IS NOT NULL AND length(btrim("order_refund_records"."external_reference_key")) > 0)
    OR ("order_refund_records"."cash_amount_kurus" = 0 AND "order_refund_records"."external_reference" IS NULL AND "order_refund_records"."external_reference_key" IS NULL)
  ),
	CONSTRAINT "order_refund_records_actor_check" CHECK (length(btrim("order_refund_records"."admin_email")) > 0 AND length(btrim("order_refund_records"."reason")) >= 10 AND length(btrim("order_refund_records"."request_hash")) > 0),
	CONSTRAINT "order_refund_records_json_check" CHECK (jsonb_typeof("order_refund_records"."source_snapshot") = 'object' AND jsonb_typeof("order_refund_records"."result_snapshot") = 'object'
    AND jsonb_typeof("order_refund_records"."email_payload") = 'object' AND jsonb_typeof("order_refund_records"."email_progress") = 'object' AND jsonb_typeof("order_refund_records"."analytics_progress") = 'object'),
	CONSTRAINT "order_refund_records_email_state_check" CHECK ("order_refund_records"."email_state" IN ('pending', 'delivering', 'delivered', 'not_required')),
	CONSTRAINT "order_refund_records_analytics_state_check" CHECK ("order_refund_records"."analytics_state" IN ('pending', 'recorded', 'not_required')),
	CONSTRAINT "order_refund_records_legacy_delivery_check" CHECK ("order_refund_records"."kind" <> 'legacy_evidence' OR (
    "order_refund_records"."email_state" = 'not_required' AND "order_refund_records"."email_payload" = '{}'::jsonb AND "order_refund_records"."email_progress" = '{}'::jsonb
    AND "order_refund_records"."email_next_attempt_at" IS NULL AND "order_refund_records"."email_lease_until" IS NULL AND "order_refund_records"."email_last_error" IS NULL
    AND "order_refund_records"."analytics_state" = 'not_required' AND "order_refund_records"."analytics_progress" = '{}'::jsonb
    AND "order_refund_records"."analytics_recorded_at" IS NULL AND "order_refund_records"."analytics_last_error" IS NULL
  ))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gift_credit_returns'::regclass AND conname = 'gift_credit_returns_refund_allocation_id_order_refund_allocations_id_fk') THEN
    ALTER TABLE "gift_credit_returns" ADD CONSTRAINT "gift_credit_returns_refund_allocation_id_order_refund_allocations_id_fk" FOREIGN KEY ("refund_allocation_id") REFERENCES "public"."order_refund_allocations"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gift_credit_returns'::regclass AND conname = 'gift_credit_returns_expired_draft_id_order_drafts_id_fk') THEN
    ALTER TABLE "gift_credit_returns" ADD CONSTRAINT "gift_credit_returns_expired_draft_id_order_drafts_id_fk" FOREIGN KEY ("expired_draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gift_credit_returns'::regclass AND conname = 'gift_credit_returns_redemption_id_gift_card_redemptions_id_fk') THEN
    ALTER TABLE "gift_credit_returns" ADD CONSTRAINT "gift_credit_returns_redemption_id_gift_card_redemptions_id_fk" FOREIGN KEY ("redemption_id") REFERENCES "public"."gift_card_redemptions"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.gift_credit_returns'::regclass AND conname = 'gift_credit_returns_gift_card_id_gift_cards_id_fk') THEN
    ALTER TABLE "gift_credit_returns" ADD CONSTRAINT "gift_credit_returns_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.order_refund_allocations'::regclass AND conname = 'order_refund_allocations_order_id_orders_id_fk') THEN
    ALTER TABLE "order_refund_allocations" ADD CONSTRAINT "order_refund_allocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.order_refund_allocations'::regclass AND conname = 'order_refund_allocations_record_kind_fk') THEN
    ALTER TABLE "order_refund_allocations" ADD CONSTRAINT "order_refund_allocations_record_kind_fk" FOREIGN KEY ("refund_id","kind") REFERENCES "public"."order_refund_records"("id","kind") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.order_refund_records'::regclass AND conname = 'order_refund_records_draft_id_order_drafts_id_fk') THEN
    ALTER TABLE "order_refund_records" ADD CONSTRAINT "order_refund_records_draft_id_order_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."order_drafts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.order_refund_records'::regclass AND conname = 'order_refund_records_standalone_order_id_orders_id_fk') THEN
    ALTER TABLE "order_refund_records" ADD CONSTRAINT "order_refund_records_standalone_order_id_orders_id_fk" FOREIGN KEY ("standalone_order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_credit_returns_refund_redemption_unique" ON "gift_credit_returns" USING btree ("refund_allocation_id","redemption_id") WHERE "gift_credit_returns"."refund_allocation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gift_credit_returns_draft_redemption_unique" ON "gift_credit_returns" USING btree ("expired_draft_id","redemption_id") WHERE "gift_credit_returns"."expired_draft_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_credit_returns_redemption_idx" ON "gift_credit_returns" USING btree ("redemption_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_refund_allocations_refund_order_unique" ON "order_refund_allocations" USING btree ("refund_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_refund_allocations_cancellation_order_unique" ON "order_refund_allocations" USING btree ("order_id") WHERE "order_refund_allocations"."kind" = 'cancellation';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_refund_allocations_order_created_idx" ON "order_refund_allocations" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_refund_records_transfer_unique" ON "order_refund_records" USING btree ("payment_scope_key","method","external_reference_key") WHERE "order_refund_records"."cash_amount_kurus" > 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_refund_records_scope_created_idx" ON "order_refund_records" USING btree ("payment_scope_key","recorded_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_refund_records_email_due_idx" ON "order_refund_records" USING btree ("email_state","email_next_attempt_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_refund_records_analytics_state_idx" ON "order_refund_records" USING btree ("analytics_state","recorded_at","id");
