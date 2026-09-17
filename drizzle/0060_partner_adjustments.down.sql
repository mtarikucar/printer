-- 0060 rollback preserves runtime money and audit history. No data is deleted.
-- All locks, refusal checks, DDL and the exact journal deletion are atomic.
-- Roll back later migrations first before reapplying through Drizzle.
DO $$
DECLARE
  table_name text;
  column_name text;
  used boolean;
  predicate text;
BEGIN
  SET LOCAL lock_timeout = '5s';
  -- Lock ALL affected tables before inspecting any of them.
  FOREACH table_name IN ARRAY ARRAY['partner_adjustments', 'painter_payouts', 'payouts'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', table_name);
    END IF;
  END LOOP;
  IF to_regclass('public.partner_adjustments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.partner_adjustments) THEN
      RAISE EXCEPTION '0060 rollback refused: partner_adjustments contains financial history';
    END IF;
  END IF;
  FOREACH table_name IN ARRAY ARRAY['painter_payouts', 'payouts'] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN CONTINUE; END IF;
    -- Per-column checks also preserve data in a partially applied migration.
    FOREACH column_name IN ARRAY ARRAY['adjustment_count', 'settlement_kind', 'paid_by', 'voided_at', 'voided_by', 'void_reason', 'void_snapshot', 'void_operation_key', 'void_request_hash'] LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('public.' || table_name)
          AND attname = column_name AND attnum > 0 AND NOT attisdropped) THEN
        predicate := CASE column_name
          WHEN 'adjustment_count' THEN 'adjustment_count IS DISTINCT FROM 0'
          WHEN 'settlement_kind' THEN 'settlement_kind IS DISTINCT FROM ''transfer'''
          ELSE format('%I IS NOT NULL', column_name)
        END;
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE %s)', table_name, predicate) INTO used;
        IF used THEN
          RAISE EXCEPTION '0060 rollback refused: %.% contains financial metadata', table_name, column_name;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  DROP TABLE IF EXISTS public.partner_adjustments;
  IF to_regclass('public.painter_payouts') IS NOT NULL THEN
    ALTER TABLE public.painter_payouts DROP CONSTRAINT IF EXISTS "painter_payouts_void_operation_key_unique";
    ALTER TABLE public.painter_payouts DROP CONSTRAINT IF EXISTS "painter_payouts_adjustment_count_check";
    ALTER TABLE public.painter_payouts DROP CONSTRAINT IF EXISTS "painter_payouts_settlement_kind_check";
    ALTER TABLE public.painter_payouts DROP CONSTRAINT IF EXISTS "painter_payouts_netting_check";
    ALTER TABLE public.painter_payouts DROP CONSTRAINT IF EXISTS "painter_payouts_void_audit_check";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "adjustment_count";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "settlement_kind";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "paid_by";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "voided_at";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "voided_by";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "void_reason";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "void_snapshot";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "void_operation_key";
    ALTER TABLE public.painter_payouts DROP COLUMN IF EXISTS "void_request_hash";
  END IF;
  IF to_regclass('public.payouts') IS NOT NULL THEN
    ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS "payouts_void_operation_key_unique";
    ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS "payouts_adjustment_count_check";
    ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS "payouts_settlement_kind_check";
    ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS "payouts_netting_check";
    ALTER TABLE public.payouts DROP CONSTRAINT IF EXISTS "payouts_void_audit_check";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "adjustment_count";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "settlement_kind";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "paid_by";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "voided_at";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "voided_by";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "void_reason";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "void_snapshot";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "void_operation_key";
    ALTER TABLE public.payouts DROP COLUMN IF EXISTS "void_request_hash";
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789642762730;
  END IF;
END $$;
