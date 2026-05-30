# Database migration recovery

## What was broken

The prod `migrate` compose service ran `drizzle-kit push`, which is **interactive**:
it prompts on create-vs-rename column ambiguity. In the non-TTY deploy container it
aborts, so schema changes (the QC/chat/finance/trust/notification batch + the Q7
`manufacturer_assignment_evaluations` table) were **never applied**. Pages that query
those tables threw `relation "…" does not exist` → Next.js "server-side exception".

On top of that, `drizzle/meta/_journal.json` was gitignored and stale, and the repo had
two divergent migration sets — so `drizzle-kit migrate` couldn't have worked either.

## The fix (already applied to the repo)

- Migrations squashed into a single clean `drizzle/0000_baseline.sql` generated from
  `schema.ts` (the old sets didn't match any real DB lineage).
- `_journal.json` un-gitignored and committed.
- Deploy `migrate` service switched from `drizzle-kit push` → `drizzle-kit migrate`
  (deterministic, non-interactive).

## One-time prod cutover

Run on the prod DB, in order, BEFORE the first migrate-based deploy:

```bash
# 1. Bring the DB up to the full current schema (idempotent, additive, no data loss).
psql "$DATABASE_URL" -f scripts/db/prod-sync-hotfix.sql      # NOTE: do NOT use -1

# 2. Mark 0000_baseline as already applied so migrate skips it.
psql "$DATABASE_URL" -f scripts/db/prod-baseline.sql

# 3. Deploy as usual — the migrate service now runs `drizzle-kit migrate` (a no-op
#    until there are new migrations).
./deploy.sh
```

If step 2 is skipped, the first deploy's `migrate` tries to run `0000_baseline` against
the populated DB, the `CREATE TABLE`s error, `migrate` exits non-zero, and `deploy.sh`
(`set -e`) aborts before recreating the app — i.e. it fails safe, no downtime. Fix by
running step 2, then redeploy.

## Going forward (normal workflow)

```bash
# edit src/lib/db/schema.ts, then:
npx drizzle-kit generate --name <change>   # creates drizzle/000N_<change>.sql + snapshot, updates journal
git add drizzle/ && git commit             # commit SQL + journal + snapshot
./deploy.sh                                # migrate service applies 000N
```

Do **not** reintroduce `drizzle-kit push` in the deploy. `scripts/db/prod-sync-hotfix.sql`
is a one-time catch-up tool, not part of the ongoing pipeline.
