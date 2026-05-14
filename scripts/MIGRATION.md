# Migration: orders → orders + order_drafts split

This refactor breaks the `orders` table contract: it used to contain
pending-payment rows, now it only contains paid orders. Pre-payment state
lives in a new `order_drafts` table.

Running `drizzle-kit push` or `migrate` directly **WILL FAIL** because:

1. Postgres won't drop an enum value (`pending_payment` from `order_status`,
   `pending` / `awaiting_transfer` from `payment_status`,
   `message_whatsapp` from `admin_action_type`) while existing rows reference it.
2. Several `orders` columns we dropped (`bank_transfer_*`, `paytr_*`,
   `admin_messages.channel`) still have data.
3. `orders.paid_at` becomes `NOT NULL` — but legacy `pending_payment` rows
   have `paid_at = NULL`.

## Run order on production

```bash
# 1. Take a snapshot first (Railway → "Backups").
# 2. Pull the schema (locally):
npm run db:generate          # produces drizzle/0006_*.sql or similar
# 3. Inspect the generated SQL. Drizzle's generator typically:
#    - emits the CREATE TABLE order_drafts
#    - emits ALTER TABLE manufacturers ADD COLUMN ...
#    - DOES NOT correctly handle enum value removal — comment those out
# 4. Hand-edit the generated SQL: replace any naive `ALTER TYPE ... DROP VALUE`
#    with the rename-rebuild pattern below.
# 5. Run the backfill BEFORE the migration:
npx tsx scripts/backfill-pending-orders.ts
# 6. Apply the migration:
npm run db:migrate
```

## Required SQL fragments (manual)

### Enum value removal (Postgres can't drop in-place)

```sql
-- order_status: drop "pending_payment"
ALTER TYPE order_status RENAME TO order_status_old;
CREATE TYPE order_status AS ENUM (
  'paid','generating','processing_mesh','review','approved',
  'printing','shipped','delivered','failed_generation','failed_mesh','rejected'
);
ALTER TABLE orders
  ALTER COLUMN status TYPE order_status USING status::text::order_status;
DROP TYPE order_status_old;

-- payment_status: drop "pending", "awaiting_transfer", "failed", "expired"
ALTER TYPE payment_status RENAME TO payment_status_old;
CREATE TYPE payment_status AS ENUM ('succeeded','refunded');
ALTER TABLE orders
  ALTER COLUMN payment_status TYPE payment_status USING payment_status::text::payment_status;
DROP TYPE payment_status_old;

-- admin_action_type: drop "message_whatsapp"
ALTER TYPE admin_action_type RENAME TO admin_action_type_old;
CREATE TYPE admin_action_type AS ENUM (
  'approve','reject','regenerate','print','ship','confirm','deliver',
  'message_email','edit','assign_manufacturer','mark_havale_paid','mark_payment_expired'
);
ALTER TABLE admin_actions
  ALTER COLUMN action TYPE admin_action_type USING action::text::admin_action_type;
DROP TYPE admin_action_type_old;
```

### Column drops on `orders`

```sql
ALTER TABLE orders
  DROP COLUMN paytr_merchant_oid,
  DROP COLUMN paytr_payment_type,
  DROP COLUMN paytr_test_mode,
  DROP COLUMN paytr_failure_reason,
  DROP COLUMN bank_transfer_deadline,
  DROP COLUMN bank_transfer_receipt_key,
  DROP COLUMN bank_transfer_receipt_uploaded_at,
  DROP COLUMN bank_transfer_reminder_sent_at;

ALTER TABLE admin_messages DROP COLUMN channel;
```

### `orders.paid_at` becomes NOT NULL

```sql
-- Only safe after the backfill drained pending_payment rows.
ALTER TABLE orders ALTER COLUMN paid_at SET NOT NULL;
```

### New columns

```sql
ALTER TABLE orders
  ADD COLUMN draft_id uuid REFERENCES order_drafts(id);

ALTER TABLE manufacturers
  ADD COLUMN whatsapp_phone text,
  ADD COLUMN iban text,
  ADD COLUMN bank_account_holder text,
  ADD COLUMN bank_name text,
  ADD COLUMN max_concurrent_orders integer NOT NULL DEFAULT 5,
  ADD COLUMN accepting_orders boolean NOT NULL DEFAULT true,
  ADD COLUMN onboarding_accepted_at timestamp;

ALTER TABLE gift_card_redemptions
  ADD COLUMN draft_id uuid REFERENCES order_drafts(id),
  ADD COLUMN refunded_at timestamp,
  ALTER COLUMN order_id DROP NOT NULL;
```

### Unique on `order_drafts.paytr_merchant_oid`

```sql
CREATE UNIQUE INDEX order_drafts_paytr_merchant_oid_unique
  ON order_drafts (paytr_merchant_oid)
  WHERE paytr_merchant_oid IS NOT NULL;
```

## Verification queries (run on a copy first)

```sql
-- Should be 0 after backfill — anything left will break the enum migration.
SELECT count(*) FROM orders WHERE status = 'pending_payment';

-- Should be 0 — these payment_status values are being dropped.
SELECT count(*) FROM orders
WHERE payment_status IN ('pending','awaiting_transfer','failed','expired');

-- Sanity: every order has a paid_at.
SELECT count(*) FROM orders WHERE paid_at IS NULL;

-- Sanity: no message_whatsapp actions remain.
SELECT count(*) FROM admin_actions WHERE action = 'message_whatsapp';
```
