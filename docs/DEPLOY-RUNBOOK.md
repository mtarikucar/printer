# Deployment Runbook — Wave A/B/C Security & Correctness Fixes

This branch ships ~70 fixes covering admin auth, payment defense-in-depth, gift-card refund integrity, signed file URLs, JWT realm isolation, worker idempotency, and rate-limit hardening. Follow this runbook in order — skipping steps will lock customers out, drop payments, or fail schema migration.

## Pre-flight (must pass before deploy)

1. **Check for duplicate live redemptions in every env (dev, staging, prod):**
   ```sql
   SELECT draft_id, COUNT(*)
   FROM gift_card_redemptions
   WHERE draft_id IS NOT NULL AND refunded_at IS NULL
   GROUP BY 1
   HAVING COUNT(*) > 1;
   ```
   Must return zero rows. If not, reconcile before applying migration (the new partial unique index will fail to create on conflicting rows).

2. **Verify the committed migration matches schema.** This branch already
   ships `drizzle/0000_nifty_dust.sql` (generated and committed). To confirm
   no drift before deploy:
   ```bash
   npm run db:generate   # should produce NO new files; exits cleanly
   ```
   If a new migration file appears, the live schema diverged after commit —
   investigate before deploying. The committed file should add (a) `force_review`
   to `admin_action_type`, (b) partial unique index `gift_card_redemptions_draft_id_unique`,
   (c) FK `order_drafts.gift_card_id → gift_cards.id`.

3. **Run `npm ci`** in the deploy pipeline so `tesseract.js` (used by dekont OCR worker) is installed. Existing images that skip install will crash on first OCR job.

4. **Run the tax-ID validation tests:**
   ```bash
   npx tsx scripts/test-tax-id.ts
   ```
   Must report `17/17 passed`. If any case fails, the VKN/TCKN validation logic has regressed — block deploy and reconcile.

5. **Run the Playwright e2e tests** (requires Postgres up; dev server boots automatically):
   ```bash
   npm run test:e2e
   ```
   Must report 4/4 passed. Covers the card-payment recovery flow + waiting-retry loop.

## ⚠️ PayTR merchant panel — webhook URL (CRITICAL, one-time setup)

**The webhook URL is configured ONCE in the PayTR merchant panel, NOT via env vars.**

Login to <https://paytr.com/magaza/ayarlar> and set the **Bildirim URL** field to:

```
https://figurunica.com/api/webhooks/paytr
```

If this is misconfigured (404 path, wrong domain, or empty), PayTR will silently
fire webhooks to a dead URL and **every card payment will get stuck** in the
`pending_payment` state forever. The verify-payment endpoint heals fresh
transactions but only when the customer returns to the track page within their
session — async webhook recovery is the primary path.

**Backward-compat:** The codebase also serves `/api/payment/paytr/callback` as
an alias for the canonical `/api/webhooks/paytr` endpoint. This catches the
case where the panel was previously set to that (incorrect) path. New
deployments should always use the canonical path.

**Smoke test:**
```bash
curl -sv -X POST https://figurunica.com/api/webhooks/paytr \
  -d "merchant_oid=TEST&status=success&total_amount=100&hash=invalid"
# → should respond "PAYTR bad hash" (HTTP 400). 404 means the route is missing.
```

## Required env vars (NEW)

Add to your production `.env` BEFORE deploying:

| Var | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | ✅ required, ≥32 chars | server fail-fast on missing in prod |
| `CUSTOMER_JWT_SECRET` | recommended (distinct value) | falls back to AUTH_SECRET with warn |
| `MANUFACTURER_JWT_SECRET` | recommended (distinct value) | falls back to AUTH_SECRET with warn |
| `TRUSTED_PROXY_IPS` | required for prod | comma-sep upstream proxy IPs; without it XFF is spoofable |
| `FILES_SIGNING_SECRET` | optional | separate secret for `/api/files/*` HMAC; falls back to AUTH_SECRET |
| `FILES_REQUIRE_SIGNATURE` | leave **unset** at first deploy | set to `1` only AFTER all old URLs have aged out (see below) |
| `PAYTR_DEBUG_ON` | set to `0` in prod | leaving it tied to test_mode leaks error details |
| `PAYTR_WEBHOOK_STATUS_CHECK` | leave unset (default on) | cross-check webhook claims against PayTR status API |

## Deploy order

1. Apply DB migration (`drizzle-kit migrate` or `db:push` with the committed SQL).
2. Restart background workers (`workers/start.ts`).
3. Restart web servers.

## Post-deploy expected behaviour

- **All existing customer + manufacturer sessions are invalidated** (the new JWT iss/aud claims fail verification on old tokens). Users will be redirected to login on next request — expected, one-time cost.
- **Admin sessions are also invalidated** (NextAuth secret may change if AUTH_SECRET rotated, or if the role claim was missing on old tokens). Admins re-login.
- **All file URLs continue to work** because `FILES_REQUIRE_SIGNATURE` is unset — signed URLs are minted but unsigned ones still resolve.

## Flipping `FILES_REQUIRE_SIGNATURE=1` (do later, NOT on first deploy)

The 24-hour signed-URL TTL means any BullMQ job queued more than 24h before the flip would 401 on retry. To do it safely:

1. Drain BullMQ queues — `bullmq` admin UI or `redis-cli FLUSHDB` if you're certain no in-flight jobs matter.
2. Verify no admin email contains old `/api/files/...` URLs without `?exp=&sig=` (they'd 401 if forwarded after the flip).
3. Set `FILES_REQUIRE_SIGNATURE=1`, restart web.
4. Monitor for 401s on `/api/files/*` for 24h; if seen, identify the caller and run them through `normalizeFileUrl`.

## Recovery procedures

### Stuck card draft (PayTR webhook never landed)
- Customer side: open `/track/<reference>?payment=success` and wait — the verify-payment effect calls PayTR's status API on mount.
- Admin side: `/admin/drafts/<id>` → "PayTR durumunu sorgula" button.

### Late webhook after retry-payment overwrite
- If `[paytr.webhook] NO DRAFT MATCHING merchant_oid=...` appears in logs at ERROR severity, the customer used retry-payment between the two webhook deliveries. Manual reconciliation: find the draft by reference (not merchant_oid), confirm with PayTR dashboard, then admin "PayTR durumunu sorgula" to promote it.

### Auth role drift
- If a customer reports "I'm seeing admin pages": check NextAuth JWT cookie payload — `role` claim must be `"admin"`. If it's missing or different, signOut and re-login (the JWT callback now stamps role on first sign-in only).

## Rollback plan

- Code rollback: redeploy the previous commit. Existing sessions remain invalidated (no way to undo iss/aud verification once added), but functionality returns.
- Schema rollback: the partial unique index and `force_review` enum value are forward-only. Don't roll the schema back; old code can coexist (it just won't reference `force_review`).

---

Generated as part of the Wave A/B/C review cycle. Owners: dev team.
