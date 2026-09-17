# Phase6b — separate partner adjustments and payout void

Approved roadmap continuation after6a fa75d38. No approval checkpoint needed;
owner requested completion and deployment of every approved phase.

One additive adjustment table, small payout metadata additions, existing earning
rows retained. Manual compensation is expressed as net kuruş, clearly labeled in
UI. Positive topups/reprints are platform-funded; customer charges/refunds remain
separate later increments. Paid earnings cannot be debited. A negative entry
names and is capped by one same-order/same-payee unpaid source; never deduct it
from unrelated work. Phase4 automatic pending-accrual reconciliation is retained.

Creation/cancellation, claim/settlement/void and every affected balance view ship
together. Sources with offsets are indivisible payout groups; missing/reversed
or now-insufficient sources fail closed. Positive independent reprint credits
remain payable after a customer refund. Zero net groups close via explicit
netting, without a bank-transfer claim. All money uses checked integer kuruş.

Shared partner advisory gate precedes order/source/batch locks; all existing
mutations participate. No nested public transaction called while holding a lock
it needs. Actual held identities/amounts determine payout totals and confirmation
fingerprints. Pending void preserves original stated totals/requester and held
snapshot, releases memberships atomically; paid batches never void. Replays
return the original result, conflicting idempotency payloads refuse.

Migration0060 uses checked text, not enum changes. Source references to original
earnings are logical plus immutable snapshots, since existing handoff recovery
can delete reversed rows; history must survive that path. Foreign keys for
orders/partners/payouts restrict deletion. Down refuses populated adjustments or
used metadata, and clean up/down/up is verified on disposable55433 fixtures.

Ownership:
- Schema/pure rules/migration: Ptolemy.
- Shared payable reader/gate and both payout services: Sartre.
- Adjustment create/cancel and admin APIs: Nietzsche.
- Admin order/payout controls and partner balances: main.

Before release: pure amount/group/idempotency tests; real PostgreSQL concurrency
for duplicate claim, competing offsets, void-vs-settle, reversal with offsets,
refunded source versus independent credit; migration roundtrip; browser balances
and warning/confirmation flow; unit/type/lint/build. Pagination/CSV, actual refund
recording, extra charge links and digital platform-share policy follow separately.

## Implementation and verification

0060 is a reversible additive migration; clean up/down/up, idempotence, runtime
history refusal and cancellation metadata were tested in a disposable55433 DB
(15 checks). Shared QA received only the final up for browser checks.

One partner advisory gate serializes credit/offset creation, claim, settlement,
void and original-earning reconciliation/reversal. Source groups fail closed
when refunded, missing, reversed or reduced below existing offsets. Original
manual-adjustment amounts never overwrite original earning financial fields.
All balance pages use the shared reader; original refund disclosures stay
separate. Zero-net settlement is explicitly labelled mahsup in order and partner
history and sends no bank-transfer notice. Voided batches retain totals/reason
and requester while releasing memberships.

Verification before release: 40 CRUD DB checks,23 payout DB scenarios,29 real
route-adapter checks with external boundaries stubbed,9 API contracts,6 pure
amount/group checks and86 order-money assertions passed. Whole73-script unit
chain passed. Browser16 checks passed: actual admin/partner login, signed
adjustments and balance parity, create/void/reclaim, zero netting, paid-source
refusal, unchanged original financial columns and no page errors. Browser
fixtures and exact queued fixture emails were removed. Final lint/types/build
are the release gates; see final run logs for their completion.

Phase6a deployed successfully as fa75d38 on run35213118478 (app health and
worker restart0 verified); this increment does not yet include actual customer
refund recording, extra charges, payment attempts, digital-platform allocation
or payout pagination/CSV.

Final production build passed after extraction cleanup and settlement-copy
corrections. TypeScript passed; final scoped lint contains only the three
pre-existing order-client warnings. No unused extraction helpers remain. The
refund confirmation now distinguishes a settled earning from a bank transfer
and points at the adjustment-aware money breakdown for actual cash impact.
