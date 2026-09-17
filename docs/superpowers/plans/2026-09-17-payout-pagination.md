# Payout pagination and CSV implementation plan

**Goal:** Reach every manufacturer/painter payout beyond the admin 100-row and partner 50-row caps, and export every matching payout without changing 6b money rules.
**Baseline:** `docs/superpowers/plans/2026-09-17-phase6-adjustments.md`; current Next.js/TypeScript, Drizzle/PostgreSQL. This increment changes read surfaces only and requires no migration.

## Existing integration

- `src/app/admin/payouts/page.tsx`: separate manufacturer/painter queries, active pending first, each capped at 100; page enriches batches through `readPartnerPayables`.
- `src/app/{manufacturer,painter}/earnings/page.tsx`: payout histories capped at 50. Their original-earning display lists separately cap at 200; changing those lists is outside this increment.
- `src/lib/services/partner-payables.ts`: shared complete balances, groups, actual held amounts/counts/fingerprint, adjustment history and payout summaries. These totals must never be computed from a paginated display list.
- Existing payout APIs mutate only: request/create, mark-paid, void; legacy DELETE refuses history deletion. No payout listing/CSV API or reusable CSV encoder was found. The customer-preview date-only cursor is unsuitable: it loses tied timestamps and treats bad cursors as empty results.

## 1. One server query/read model

Create `src/lib/config/payout-list.ts` for pure request/cursor types and validation; `src/lib/services/payout-list.ts` for shared selection and serialization. Reuse existing `PartnerKind` and `MoneyTx` types.

```ts
type PayoutStatusFilter = "all" | "pending" | "paid" | "netted" | "voided";
type PayoutListScope =
  | { audience: "admin"; kind: PartnerKind; partnerId?: string }
  | { audience: "partner"; kind: PartnerKind; partnerId: string };
type PayoutListQuery = { status: PayoutStatusFilter; limit: number; cursor?: string };
// PayoutListRow: explicit public DTO of batch identity/owner, stated money/counts,
// semantic status, settlement kind, timestamps, reference and authorized audit
// fields; actual held money/counts/fingerprint + readable/blocked state.
loadPayoutPage(tx: MoneyTx, scope: PayoutListScope, query: PayoutListQuery): Promise<{
  rows: PayoutListRow[]; nextCursor: string | null; hasMore: boolean;
}>;
readPayoutPage(scope: PayoutListScope, query: PayoutListQuery): Promise<PayoutPage>;
```

Define `PayoutPage` as the return DTO above. Read wrapper uses a read-only repeatable-read transaction so headers, membership and confirmation values describe one snapshot. Query `limit + 1` headers, hydrate only returned rows; reuse `loadPartnerPayables(tx, kind, ownerId)` once per distinct owner within that page/snapshot and use its `payouts`/groups for held facts. Do not introduce local source/offset eligibility SQL or a new full-ledger implementation. Existing complete summary reads remain independent of paging; this increment does not claim to optimize their full-history cost.

Filters, shared by UI/API/CSV:
- `pending`: status=pending AND voidedAt IS NULL (transfer and pending netting).
- `paid`: status=paid AND settlementKind=transfer AND voidedAt IS NULL.
- `netted`: status=paid AND settlementKind=netting AND voidedAt IS NULL.
- `voided`: voidedAt IS NOT NULL. Its stored status remains pending; stated totals remain historical.
- `all`: all batches. Kind is explicitly manufacturer or painter, matching current tabs; no combined-table cursor needed. Admin may additionally filter by validated partner UUID; partner scope always comes from the session.

Use stable `created_at DESC, id DESC`, with `(created_at, id) < (:lastTimestamp::timestamp, :lastId::uuid)` for continuation. Keep the admin default filter `pending`; `all` is chronological, not mutable pending-first ranking. This prevents settlement/void from changing the sort key during traversal.

Cursor: bounded base64url JSON `{v:1, kind, status, partnerId, lastTimestamp, lastId}`. Bind it to the server-derived scope/filters; reject mismatches, unknown versions, extra fields, oversized encoding, invalid UUID/calendar timestamp with 400, never an empty success. Cursor contents never authorize access. Preserve PostgreSQL timestamp-without-time-zone microseconds with a canonical SQL text projection (`YYYY-MM-DD HH24:MI:SS.US`); do not round-trip its boundary through JS Date/milliseconds or infer a timezone. Display timestamps retain existing application conventions. Strictly parse decimal page size as a safe integer, default 50, range 1..100; reject fractions, exponent notation, overflow and non-finite values. All money/count conversions require safe integers; sum in checked arithmetic, never float TL or `parseInt` coercion.

Each page is a live snapshot: concurrent new records appear on refresh; status-filter membership can change between requests. Do not promise a frozen historical traversal. Full exports below do have one snapshot.

## 2. Thin authenticated routes and UI

Create GET routes at `/api/admin/payouts`, `/api/manufacturer/payouts`, `/api/painter/payouts`, plus `/export` below each. Admin uses `requireAdmin()`; partners use the matching `getManufacturerSession()`/`getPainterSession()`. Authorize independently on every list/export request inside the route try/catch. Partner kind/owner are fixed by route/session; reject supplied foreign-owner filters and mismatched cursors. Do not restrict an inactive partner's historical reads merely because new payout requests require active status.

Update the admin payout page/client and the two partner earnings history blocks to consume the same DTO and add status filters, Next/Previous (client cursor stack), and a CSV link. Reset cursors on kind/filter changes or after mutations. Keep pagination separate from the admin unbatched-owed queue and complete balance cards. Label counts as rows on this page, not global totals; use `hasMore`, not a guessed grand total. Return all matching history through successive pages, including batches with only adjustments and zero-netting/void records.

Keep 6b mutation endpoints unchanged: expected fingerprint + settlement kind, server revalidation, explicit netting, idempotent audited void and notification behavior. A failed page read shows unknown/retry, never empty/no-money. A held-data failure disables settlement and void for the affected row and labels held amounts unknown, never zero. Cached/displayed rows are not authorization or eligibility evidence.

## 3. Complete CSV using the same scope and filters

Create pure `src/lib/config/payout-csv.ts`; use the same `loadPayoutPage` selection in a single read-only repeatable-read transaction and walk internal cursor pages until exhausted. Export always starts at the first matching record and rejects a UI cursor/limit: it means **all matching payout batches**, not the visible page. No silent record cap, independent SQL filter copy, or browser-only export of loaded rows.

One CSV row per payout. Explicit columns: kind, payout ID, partner ID/name, semantic status, settlement kind, created/paid/void timestamps, stated total in integer kuruş, earning/adjustment counts, actual held total/counts, held eligibility/read state, reference. Admin additionally gets requester/adminEmail, paidBy, voidedBy, void reason, and retained void snapshot (JSON text). Partner projection contains only their own payout/history fields, with no bank credentials, internal operator identity, or unrelated order/customer data. For voided rows distinguish original stated totals, released current membership, and historical snapshot; do not present the original total as money still owed. This is a complete batch-history export, not a new original-earning ledger export.

Encoding: UTF-8 (BOM for Turkish spreadsheet compatibility), comma separator, CRLF, quote every cell, double embedded quotes. For every textual cell, prefix `'` if its first non-whitespace/control character is `=`, `+`, `-` or `@`, or if it begins with tab/CR/LF; inspect leading Unicode whitespace/control characters too. Apply before RFC4180 quoting, including partner names, reference/reason and JSON text. Quoting alone does not prevent formulas. Numeric cells come only from validated safe integers, retain legitimate negative numbers; never pass untrusted text through the numeric branch. Preserve UUID/identifier and timestamp fields as text.

To avoid a truncated export masquerading as a successful complete file, write the finished CSV to a unique private temporary file (0600) before sending success headers; on query/encoding/timeout failure delete it and return the established Turkish JSON error. After successful completion, serve with `text/csv; charset=utf-8`, fixed safe attachment filename, `Content-Length`, and `Cache-Control: private, no-store`; unlink on completion/cancel. Release the DB snapshot before client download. No financial/advisory locks for reads, no transaction held for client think time, and no background export job/schema in this increment.

## 4. Bounded acceptance checks

- [x] Pure tests: page-size validation, cursor scope/version/UUID/calendar rejection; tied timestamps and microsecond boundary round trips; semantic pending/paid/netted/voided filters; checked integer failures; CSV quotes/newlines/Turkish text and formula payloads with whitespace/control prefixes.
- [x] Isolated 55433 DB fixtures: >100 admin and >50 partner batches, equal timestamps with UUID tie-breaks, no omissions/duplicates on unchanged data; every filter and both kinds; adjustment-only/netting/void records; held snapshot/fingerprint agrees with 6b reader.
- [x] Auth/API tests: unauthenticated/non-admin refusal; partner cannot switch owner/kind by query or cursor; admin owner filtering; API and initial server-render use the same model; read failure remains unknown and mutation controls stay disabled.
- [x] CSV integration: exported row IDs equal the complete filtered DB snapshot, not page one; concurrent settlement/void during export cannot mix states; injected later-page failure returns no successful partial CSV and removes its temporary file; owner and sensitive-field isolation.
- [x] Browser: navigate past both old caps, switch filters/reset cursor, return to prior page, inspect zero-net and void history, download CSV and compare count/totals. Run focused 6b regressions plus coherent unit/types/lint/build under the main agent's schedule.

No migrations, new money mutation policy, customer refund work, or changes to original earnings/cart/invoice allocation are required. A later measured query-performance issue may justify an index separately; it does not block this bounded read-only feature.

## Release validation — 2026-09-17

78-script unit chain passed, TypeScript passed, production build passed. Full lint
returned zero errors (70 existing warnings); changed-scope lint returned zero warnings.
List database suite: 10 checks in an isolated 55433 schema, including 133 rows per
kind, microsecond/tied timestamp boundaries, full balance parity and failed reads.
CSV database suite: 38 checks, 126 rows per kind, concurrent settle/void snapshot
consistency and later-page failure cleanup. Browser: 13 checks using actual admin
and both partner sessions, 107/57 rows, next/back/filter reset, complete downloads,
safe formula names, authorization and inactive historical access. Exact fixtures
were removed. No production data, migrations or financial mutations in this increment.

The admin unbatched owed queue and the separate 200-row original-earning display
remain outside this increment. The shared full-ledger summary reader still owns
all balances; pagination does not optimize its full-history query cost.
