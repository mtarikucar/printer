-- Additive net compensation ledger; no data backfill or earning changes.
SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"manufacturer_id" uuid,
	"painter_id" uuid,
	"kind" text NOT NULL,
	"net_kurus" integer NOT NULL,
	"source_kind" text,
	"source_id" uuid,
	"source_snapshot" jsonb,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"admin_email" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"manufacturer_payout_id" uuid,
	"painter_payout_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	"void_operation_key" uuid,
	"void_request_hash" text,
	CONSTRAINT "partner_adjustments_void_operation_key_unique" UNIQUE("void_operation_key"),
	CONSTRAINT "partner_adjustments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "partner_adjustments_partner_check" CHECK (num_nonnulls("partner_adjustments"."manufacturer_id", "partner_adjustments"."painter_id") = 1),
	CONSTRAINT "partner_adjustments_kind_net_check" CHECK (
    ("partner_adjustments"."kind" IN ('topup', 'reprint') AND "partner_adjustments"."net_kurus" > 0)
    OR ("partner_adjustments"."kind" = 'unpaid_offset' AND "partner_adjustments"."net_kurus" BETWEEN -2147483647 AND -1)
  ),
	CONSTRAINT "partner_adjustments_source_check" CHECK (
    ("partner_adjustments"."kind" IN ('topup', 'reprint') AND "partner_adjustments"."source_kind" IS NULL AND "partner_adjustments"."source_id" IS NULL AND "partner_adjustments"."source_snapshot" IS NULL)
    OR ("partner_adjustments"."kind" = 'unpaid_offset' AND "partner_adjustments"."source_kind" IS NOT NULL
      AND "partner_adjustments"."source_kind" IN ('manufacturer_earning', 'painter_earning', 'adjustment')
      AND "partner_adjustments"."source_id" IS NOT NULL AND "partner_adjustments"."source_id" <> "partner_adjustments"."id"
      AND "partner_adjustments"."source_snapshot" IS NOT NULL AND jsonb_typeof("partner_adjustments"."source_snapshot") = 'object'
      AND ("partner_adjustments"."source_kind" <> 'manufacturer_earning' OR "partner_adjustments"."manufacturer_id" IS NOT NULL)
      AND ("partner_adjustments"."source_kind" <> 'painter_earning' OR "partner_adjustments"."painter_id" IS NOT NULL))
  ),
	CONSTRAINT "partner_adjustments_actor_check" CHECK (length(btrim("partner_adjustments"."admin_email")) > 0 AND length(btrim("partner_adjustments"."reason")) > 0 AND length(btrim("partner_adjustments"."request_hash")) > 0),
	CONSTRAINT "partner_adjustments_status_check" CHECK ("partner_adjustments"."status" IN ('pending', 'settled', 'voided')),
	CONSTRAINT "partner_adjustments_payout_check" CHECK (
    ("partner_adjustments"."manufacturer_payout_id" IS NULL OR "partner_adjustments"."manufacturer_id" IS NOT NULL)
    AND ("partner_adjustments"."painter_payout_id" IS NULL OR "partner_adjustments"."painter_id" IS NOT NULL)
  ),
	CONSTRAINT "partner_adjustments_settled_check" CHECK (
    ("partner_adjustments"."status" = 'settled' AND "partner_adjustments"."settled_at" IS NOT NULL
      AND num_nonnulls("partner_adjustments"."manufacturer_payout_id", "partner_adjustments"."painter_payout_id") = 1)
    OR ("partner_adjustments"."status" <> 'settled' AND "partner_adjustments"."settled_at" IS NULL)
  ),
	CONSTRAINT "partner_adjustments_void_check" CHECK (
    ("partner_adjustments"."status" = 'voided' AND "partner_adjustments"."voided_at" IS NOT NULL AND "partner_adjustments"."voided_by" IS NOT NULL
      AND length(btrim("partner_adjustments"."voided_by")) > 0 AND "partner_adjustments"."void_reason" IS NOT NULL AND length(btrim("partner_adjustments"."void_reason")) > 0
      AND "partner_adjustments"."void_operation_key" IS NOT NULL AND "partner_adjustments"."void_request_hash" IS NOT NULL AND length(btrim("partner_adjustments"."void_request_hash")) > 0
      AND "partner_adjustments"."manufacturer_payout_id" IS NULL AND "partner_adjustments"."painter_payout_id" IS NULL)
    OR ("partner_adjustments"."status" <> 'voided' AND "partner_adjustments"."voided_at" IS NULL AND "partner_adjustments"."voided_by" IS NULL AND "partner_adjustments"."void_reason" IS NULL
      AND "partner_adjustments"."void_operation_key" IS NULL AND "partner_adjustments"."void_request_hash" IS NULL)
  )
);
--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "adjustment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "settlement_kind" text DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "paid_by" text;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "voided_by" text;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "void_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "void_operation_key" uuid;--> statement-breakpoint
ALTER TABLE "painter_payouts" ADD COLUMN IF NOT EXISTS "void_request_hash" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "adjustment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "settlement_kind" text DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "paid_by" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "voided_by" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "void_reason" text;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "void_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "void_operation_key" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "void_request_hash" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_adjustments'::regclass AND conname = 'partner_adjustments_order_id_orders_id_fk') THEN
    ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_adjustments'::regclass AND conname = 'partner_adjustments_manufacturer_id_manufacturers_id_fk') THEN
    ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_adjustments'::regclass AND conname = 'partner_adjustments_painter_id_painters_id_fk') THEN
    ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_painter_id_painters_id_fk" FOREIGN KEY ("painter_id") REFERENCES "public"."painters"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_adjustments'::regclass AND conname = 'partner_adjustments_manufacturer_payout_id_payouts_id_fk') THEN
    ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_manufacturer_payout_id_payouts_id_fk" FOREIGN KEY ("manufacturer_payout_id") REFERENCES "public"."payouts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.partner_adjustments'::regclass AND conname = 'partner_adjustments_painter_payout_id_painter_payouts_id_fk') THEN
    ALTER TABLE "partner_adjustments" ADD CONSTRAINT "partner_adjustments_painter_payout_id_painter_payouts_id_fk" FOREIGN KEY ("painter_payout_id") REFERENCES "public"."painter_payouts"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_adjustments_manufacturer_state_idx" ON "partner_adjustments" USING btree ("manufacturer_id","status","manufacturer_payout_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_adjustments_painter_state_idx" ON "partner_adjustments" USING btree ("painter_id","status","painter_payout_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_adjustments_order_created_idx" ON "partner_adjustments" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "partner_adjustments_source_idx" ON "partner_adjustments" USING btree ("source_kind","source_id");--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.painter_payouts'::regclass AND conname = 'painter_payouts_void_operation_key_unique') THEN
    ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_void_operation_key_unique" UNIQUE("void_operation_key");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_void_operation_key_unique') THEN
    ALTER TABLE "payouts" ADD CONSTRAINT "payouts_void_operation_key_unique" UNIQUE("void_operation_key");
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.painter_payouts'::regclass AND conname = 'painter_payouts_adjustment_count_check') THEN
    ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_adjustment_count_check" CHECK ("painter_payouts"."adjustment_count" >= 0);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.painter_payouts'::regclass AND conname = 'painter_payouts_settlement_kind_check') THEN
    ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_settlement_kind_check" CHECK ("painter_payouts"."settlement_kind" IN ('transfer', 'netting'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.painter_payouts'::regclass AND conname = 'painter_payouts_netting_check') THEN
    ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_netting_check" CHECK ("painter_payouts"."settlement_kind" <> 'netting' OR ("painter_payouts"."total_kurus" = 0 AND "painter_payouts"."reference" IS NULL));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.painter_payouts'::regclass AND conname = 'painter_payouts_void_audit_check') THEN
    ALTER TABLE "painter_payouts" ADD CONSTRAINT "painter_payouts_void_audit_check" CHECK (
    ("painter_payouts"."voided_at" IS NULL AND "painter_payouts"."voided_by" IS NULL AND "painter_payouts"."void_reason" IS NULL
      AND "painter_payouts"."void_snapshot" IS NULL AND "painter_payouts"."void_operation_key" IS NULL AND "painter_payouts"."void_request_hash" IS NULL)
    OR
    ("painter_payouts"."status" = 'pending' AND "painter_payouts"."voided_at" IS NOT NULL AND "painter_payouts"."voided_by" IS NOT NULL
      AND length(btrim("painter_payouts"."voided_by")) > 0 AND "painter_payouts"."void_reason" IS NOT NULL AND length(btrim("painter_payouts"."void_reason")) > 0
      AND "painter_payouts"."void_snapshot" IS NOT NULL AND jsonb_typeof("painter_payouts"."void_snapshot") = 'object'
      AND "painter_payouts"."void_operation_key" IS NOT NULL AND "painter_payouts"."void_request_hash" IS NOT NULL AND length(btrim("painter_payouts"."void_request_hash")) > 0)
  );
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_adjustment_count_check') THEN
    ALTER TABLE "payouts" ADD CONSTRAINT "payouts_adjustment_count_check" CHECK ("payouts"."adjustment_count" >= 0);
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_settlement_kind_check') THEN
    ALTER TABLE "payouts" ADD CONSTRAINT "payouts_settlement_kind_check" CHECK ("payouts"."settlement_kind" IN ('transfer', 'netting'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_netting_check') THEN
    ALTER TABLE "payouts" ADD CONSTRAINT "payouts_netting_check" CHECK ("payouts"."settlement_kind" <> 'netting' OR ("payouts"."total_kurus" = 0 AND "payouts"."reference" IS NULL));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.payouts'::regclass AND conname = 'payouts_void_audit_check') THEN
    ALTER TABLE "payouts" ADD CONSTRAINT "payouts_void_audit_check" CHECK (
    ("payouts"."voided_at" IS NULL AND "payouts"."voided_by" IS NULL AND "payouts"."void_reason" IS NULL
      AND "payouts"."void_snapshot" IS NULL AND "payouts"."void_operation_key" IS NULL AND "payouts"."void_request_hash" IS NULL)
    OR
    ("payouts"."status" = 'pending' AND "payouts"."voided_at" IS NOT NULL AND "payouts"."voided_by" IS NOT NULL
      AND length(btrim("payouts"."voided_by")) > 0 AND "payouts"."void_reason" IS NOT NULL AND length(btrim("payouts"."void_reason")) > 0
      AND "payouts"."void_snapshot" IS NOT NULL AND jsonb_typeof("payouts"."void_snapshot") = 'object'
      AND "payouts"."void_operation_key" IS NOT NULL AND "payouts"."void_request_hash" IS NOT NULL AND length(btrim("payouts"."void_request_hash")) > 0)
  );
  END IF;
END $$;
