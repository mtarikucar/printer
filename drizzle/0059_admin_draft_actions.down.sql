-- 0059 rollback: audit history is runtime data and must never be discarded.
-- Refuse if populated; no draft, operator, or customer records are changed.
-- Roll back later migrations first, then this pair, before rerunning Drizzle:
-- its migrator advances from the latest recorded journal timestamp.
-- Remove ONLY this migration's exact journal entry (idx 59 / when below).
-- Lock, emptiness check, DROP and journal deletion are one atomic statement,
-- even when the caller does not open an explicit transaction.
DO $$ BEGIN
  SET LOCAL lock_timeout = '5s';
  IF to_regclass('public.admin_draft_actions') IS NOT NULL THEN
    LOCK TABLE public.admin_draft_actions IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.admin_draft_actions) THEN
      RAISE EXCEPTION '0059 rollback refused: admin_draft_actions contains audit history'
        USING HINT = 'Preserve draft audit history through an approved data migration before rollback. No rows were removed.';
    END IF;
    DROP TABLE IF EXISTS public.admin_draft_actions;
  END IF;
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789640739303;
  END IF;
END $$;
