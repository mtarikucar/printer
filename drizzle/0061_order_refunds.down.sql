-- 0061 preserves actual financial/evidence history, including delivered notices.
-- All locks, refusal checks, DDL and this migration's journal removal are atomic.
-- Roll back newer migrations first; application rollback retains used schema.
DO $$
DECLARE
  table_name text;
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  -- Lock every existing owned table before checking any row; no writer can
  -- insert between an emptiness check and DROP. Missing partial tables are OK.
  FOREACH table_name IN ARRAY ARRAY['gift_credit_returns', 'order_refund_allocations', 'order_refund_records'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', table_name);
    END IF;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['gift_credit_returns', 'order_refund_allocations', 'order_refund_records'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', table_name) INTO used;
      IF used THEN
        RAISE EXCEPTION '0061 rollback refused: % contains financial or delivery history', table_name;
      END IF;
    END IF;
  END LOOP;
  DROP TABLE IF EXISTS public.gift_credit_returns;
  DROP TABLE IF EXISTS public.order_refund_allocations;
  DROP TABLE IF EXISTS public.order_refund_records;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789651551663;
  END IF;
END $$;
