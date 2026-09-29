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

## Migration ordering: a new migration needs a BIGGER `when` than the applied maximum

`drizzle-kit migrate` does **not** sort by `when`. It walks `drizzle/meta/_journal.json`'s
`entries` in **array order** and compares each entry's `when` against **one** watermark — the
single row it reads with `select … from drizzle.__drizzle_migrations order by created_at desc
limit 1` — applying an entry only while `last.created_at < entry.when`
(`drizzle-orm/pg-core/dialect.cjs`, `migrator.cjs`).

Consequence: **a migration whose `when` is below the highest already-applied `when` is skipped
silently and forever.** The deploy stays green (`.github/workflows/deploy.yml` does not verify
the schema afterwards) and the only recovery is editing `drizzle.__drizzle_migrations` by hand
in production.

So, at merge time:

- `0064_instant_quotes` carries `when = 1789657000000`, deliberately placed **between** `0062`
  (`1789654507721`) and the other session's still-uncommitted `0063` (`1789657536377`), because
  the instant-quote branch deploys **first**. 0064 therefore applies against the 0062 watermark.
- **That placement no longer rescues the pending 0063.** The same branch now also carries
  `0065_quote_files_attached_at` with `when = 1790686312063` — *above* 0063's `1789657536377`.
  Once 0065 is applied the watermark is **`1790686312063`**, so a 0063 journal entry landing
  afterwards would be skipped **silently and forever**. Before the other session's 0063 is
  merged it must be **regenerated**: `npx drizzle-kit generate` for a fresh number (0067, …) and
  a fresh `when` from the clock, then move its hand-written SQL into that new file. Do not merge
  its existing journal entry, and do not lower 0065's `when` to make room — production may
  already have recorded it.
- `0066_print_catalog_checks` (catalogue range CHECKs) carries `when = 1790689912063`, above
  0065 — so the branch's numbers stay strictly increasing in array order and the watermark moves
  to 0066's `when`.
- **Any migration that lands after this branch has been applied to production must carry a
  `when` larger than the highest already-applied one — today `1790689912063` (0066).** Same
  recipe: never hand-merge an old journal entry, always re-generate.
- Never lower a `when` that production has already recorded.

## Rolling back 0064 (instant quote engine)

### Order is mandatory: application first, database second

`drizzle/0064_instant_quotes.down.sql` drops tables that **today's order pipeline reads with no
feature-flag check**, so dropping them under a running 0064 image takes the live site down:

| # | Read | What breaks |
|---|---|---|
| 1 | `src/lib/services/order-confirm.ts` → `linkQuoteToOrderTx` (inside the payment transaction, for **every** custom order) | The PayTR webhook 500s with money already captured; the order freezes in `paid` and the webhook is retried forever |
| 2 | `src/lib/services/manufacturer-assign.ts` → `loadPlacementFacts` → `quoteOrderRequirements` | Manufacturer assignment throws |
| 3 | `src/lib/services/manufacturer-assignment.ts` ranker | Auto-assignment throws |
| 4 | `src/app/api/admin/orders/[id]/approve/route.ts` (selects from `quotes` before any branch) | Admin approval 500s for every order |
| 5 | `src/app/manufacturer/orders/[id]/page.tsx` → `productionGateClosed` (order-type-blind by design) | "Baskı başlat / bitir / QC'ye gönder" closes for **every** manufacturer order |

The refusal gate below keys on **rows**; these five call sites key on the tables **existing**. The
"feature never used, therefore safe to drop" case is exactly the case that breaks production.

```bash
# 1. Redeploy app + worker from the last pre-0064 commit (images, not just the flag).
# 2. Verify: /api/health is 200 AND one paid order still kicks off processing
#    (a test order through the PayTR sandbox, or a replayed webhook on a draft).
# 3. Only then run the down script (below).
```

Turning `instant_quote_enabled` off is **not** a substitute: the flag hides the new surfaces, it
does not remove these five reads.

### The script itself

`drizzle/0064_instant_quotes.down.sql` is applied **by hand** (`psql "$DATABASE_URL" -f …`),
never by the migrate service: it is not in the journal, and any newer migration must be
rolled back first.

It refuses to run when **any** of `quotes`, `quote_checkouts`, `quote_parts`,
`quote_messages`, `quote_admin_actions` or `print_catalog_changes` holds a row, and exits
with `0064 rollback refused: <table> contains quote or catalog history`. Nothing is dropped
in that case — the whole script is one transaction.

Read that list carefully before planning a rollback window: **`print_catalog_changes` is an
audit table, and a single catalogue edit in `/admin/baski-katalogu` puts a row in it.** So a
day of internal testing with the flag off is enough to make the down script refuse forever.
That is the intended design — the script never deletes operator or customer data on its own.

If the rollback is still wanted, the operator removes the audit history **deliberately**,
after exporting it:

```bash
psql "$DATABASE_URL" -c "\copy print_catalog_changes TO 'print_catalog_changes-$(date +%F).csv' CSV HEADER"
psql "$DATABASE_URL" -c "DELETE FROM print_catalog_changes;"   # audit trail only; the seed lives in the catalogue tables
# Newer migrations first, each deleting its OWN ledger row. Skipping 0066/0065 here would leave
# their rows (created_at 1790689912063 / 1790686312063) behind as the watermark, and a re-applied
# 0064 would be skipped silently forever.
psql "$DATABASE_URL" -f drizzle/0066_print_catalog_checks.down.sql
psql "$DATABASE_URL" -f drizzle/0065_quote_files_attached_at.down.sql
psql "$DATABASE_URL" -f drizzle/0064_instant_quotes.down.sql
```

There is **no** such shortcut for the other five tables: those are customer data (quotes,
their parts, files, messages, payment attempts). Once a real quote exists, 0064 is not
reversible — turn `instant_quote_enabled` off in `/admin/ayarlar` instead, which hides every
new surface (the pages 404 for non-admins) and leaves the data intact.

Note that an **admin** session passes the flag gate (`src/lib/services/quote-access.ts`), so an
internal admin walkthrough with the flag off creates real `quotes` rows — not just catalogue
audit rows. The rollback window closes on the first internal test, not on the first customer.

## Deploying 0064: operator checklist

**Before the deploy**

- [ ] **Quiet window.** 0064 runs under `SET lock_timeout = '5s'` and adds foreign keys to the
      live `users`, `orders` and `order_drafts` tables. A busy moment aborts the migration with
      `canceling statement due to lock timeout` and fails the deploy. The up is fully idempotent:
      re-run the deploy workflow and it completes.
- [ ] Confirm no migration with a `when` below **`1790689912063`** — this branch's highest, 0066's
      — is waiting to land. The other session's uncommitted `0063` (`1789657536377`) is exactly
      such a migration: it must be regenerated, not merged as-is (see "Migration ordering" above).

**After the deploy**

- [ ] **Check for CHECK constraints 0066 could not validate.** `0066_print_catalog_checks` adds
      the catalogue's range constraints `NOT VALID` and then validates them; a row outside the
      range (a hand-edited catalogue value) leaves *that* constraint unvalidated and raises a
      `WARNING` instead of failing the deploy — deliberately, so a hygiene migration can never
      block a release. **`drizzle-kit migrate` does not print server notices, so that WARNING is
      probably not in the deploy log — this query is the only reliable signal.** An unvalidated
      constraint still rejects every new write, and it also blocks edits to the offending row
      itself, so fix the value and validate by hand:

      ```bash
      psql "$DATABASE_URL" -c "SELECT t.relname, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid WHERE c.contype = 'c' AND NOT c.convalidated ORDER BY 1,2;"
      # then, per row named above: correct the value in /admin/baski-katalogu and
      psql "$DATABASE_URL" -c "ALTER TABLE <table> VALIDATE CONSTRAINT <name>;"
      ```

**After the deploy, before turning `instant_quote_enabled` on**

- [ ] **Check the holiday calendar in `/admin/baski-katalogu`.** Ship-by dates — and the
      manufacturer SLA measured against them — come from `quote_pricing_settings.holidays`. The
      seeded list ends **2027-10-29**: from **2027-11-01** onwards every weekday counts as a
      working day and every promised date is silently wrong. Verify the 2026 and 2027 religious
      holiday dates against the Diyanet calendar (the seed also omits the **2026-10-28** half
      day) and correct them in the catalogue screen.
- [ ] **Calendar reminder: extend the holiday list before 2027-11-01.**
- [ ] Re-check `max_file_bytes` (seeded 32 MB) against the worker's `mem_limit` in
      `docker/docker-compose.production.yml` (2 g). They are a pair — see
      `scripts/test-quote-validation.ts`, which fails if they drift apart.

**Day-to-day**

- [ ] **"Yanlış yüklemeyi sil" on a quote-backed order is safe from 0065 on.** The recovery sweep
      keys on `quotes.files_attached_at` (the one-way stamp 0065 adds), not on "the order has no
      model files", so a deliberate deletion is no longer re-baked. **One-time exception:** an
      order whose revision was deleted *before* 0065 was applied carries no stamp, so the first
      sweep after the deploy re-bakes its files **once** and then stamps it. If such an order
      exists, either re-delete the revision after the first sweep, or stamp it by hand before the
      deploy (the deletion leaves an `admin_actions` note, so the candidates are findable):
      `UPDATE quotes q SET files_attached_at = now() WHERE q.order_id IS NOT NULL AND q.files_attached_at IS NULL AND EXISTS (SELECT 1 FROM admin_actions a WHERE a.order_id = q.order_id AND a.notes LIKE '%sürüm silindi%');`
      That query is deliberately **not** inside 0065: a backfill that reads a free-text audit note
      would go silently wrong the day the note's wording changes.
