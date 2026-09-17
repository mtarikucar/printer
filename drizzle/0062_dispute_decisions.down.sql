-- Remove only unused 0062 additions. Any opening/decision/delivery evidence
-- refuses rollback; application rollback must retain a schema with history.
-- One statement: lock, checks, DDL and exact journal deletion are atomic.
DO $$
DECLARE
  column_name text;
  predicates text[] := ARRAY[]::text[];
  used boolean;
BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.disputes') IS NOT NULL THEN
    LOCK TABLE public.disputes IN ACCESS EXCLUSIVE MODE;
    FOREACH column_name IN ARRAY ARRAY[
      'decision_operation_key', 'decision_request_hash', 'refund_record_id', 'decision_snapshot',
      'decision_email_payload', 'decision_email_progress', 'decision_email_state',
      'decision_email_next_attempt_at', 'decision_email_lease_until',
      'opening_email_payload', 'opening_email_progress', 'opening_email_state',
      'opening_email_next_attempt_at', 'opening_email_lease_until'
    ] LOOP
      IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.disputes'::regclass
        AND attname = column_name AND NOT attisdropped) THEN
        IF column_name IN ('decision_email_payload', 'decision_email_progress', 'opening_email_payload', 'opening_email_progress') THEN
          predicates := array_append(predicates, format('(%I IS NOT NULL AND %I <> %L::jsonb)', column_name, column_name, '{}'));
        ELSIF column_name IN ('decision_email_state', 'opening_email_state') THEN
          predicates := array_append(predicates, format('(%I IS NOT NULL AND %I <> %L)', column_name, column_name, 'not_required'));
        ELSE
          predicates := array_append(predicates, format('%I IS NOT NULL', column_name));
        END IF;
      END IF;
    END LOOP;
    IF cardinality(predicates) > 0 THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.disputes WHERE ' || array_to_string(predicates, ' OR ') || ')' INTO used;
      IF used THEN
        RAISE EXCEPTION '0062 rollback refused: disputes contain opening, decision or delivery metadata';
      END IF;
    END IF;
    DROP INDEX IF EXISTS public.disputes_decision_operation_key_unique;
    DROP INDEX IF EXISTS public.disputes_refund_record_id_unique;
    DROP INDEX IF EXISTS public.disputes_decision_email_due_idx;
    DROP INDEX IF EXISTS public.disputes_opening_email_due_idx;
    DROP INDEX IF EXISTS public.disputes_status_resolved_idx;
    ALTER TABLE public.disputes
      DROP CONSTRAINT IF EXISTS disputes_refund_record_id_order_refund_records_id_fk,
      DROP CONSTRAINT IF EXISTS disputes_decision_metadata_check,
      DROP CONSTRAINT IF EXISTS disputes_delivery_json_check,
      DROP CONSTRAINT IF EXISTS disputes_decision_email_check,
      DROP CONSTRAINT IF EXISTS disputes_opening_email_check,
      DROP COLUMN IF EXISTS decision_operation_key,
      DROP COLUMN IF EXISTS decision_request_hash,
      DROP COLUMN IF EXISTS refund_record_id,
      DROP COLUMN IF EXISTS decision_snapshot,
      DROP COLUMN IF EXISTS decision_email_payload,
      DROP COLUMN IF EXISTS decision_email_progress,
      DROP COLUMN IF EXISTS decision_email_state,
      DROP COLUMN IF EXISTS decision_email_next_attempt_at,
      DROP COLUMN IF EXISTS decision_email_lease_until,
      DROP COLUMN IF EXISTS opening_email_payload,
      DROP COLUMN IF EXISTS opening_email_progress,
      DROP COLUMN IF EXISTS opening_email_state,
      DROP COLUMN IF EXISTS opening_email_next_attempt_at,
      DROP COLUMN IF EXISTS opening_email_lease_until;
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789654507721;
  END IF;
END $$;
