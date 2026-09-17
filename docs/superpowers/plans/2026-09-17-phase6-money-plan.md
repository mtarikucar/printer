# Printer Phase6 implementation plan

**Goal:** Allow controlled changes to paid-order money, preserve accrued earnings, record actual refunds, and finish the associated draft and payout workflows.

**Architecture:** Keep the existing orders, draft promotion, partner earnings, and two payout tables. Add versioned order line snapshots, append-only financial operations and partner adjustments, and durable payment attempts. Put money decisions in transaction-aware services shared by admin routes, dispute resolution, workshop cancellation, and payment callbacks.

**Stack:** Next.js 16 / React / TypeScript, Drizzle ORM with PostgreSQL, BullMQ, existing manual PayTR refund operations.

**Spec:** Phase 6, lines 130–141 of `/tmp/claude-1001/-home-tarik-Projects-printer/67e59cff-9a10-4c71-9647-80c5c50256c7/scratchpad/audit-plan.txt`, supplemented by the owner's decisions in this request. Owner decisions supersede the older plan's paid-earning clawback option and two-way split invariant.

**Inspection:** Read-only source inspection on 2026-09-17 in `/home/tarik/Projects/printer`. Phase5 build/deploy was left alone. No build, typecheck, test, DB connection, git mutation, or external message was performed. Only this report was written. Source paths below are relative to that repository; line anchors are observations, not stable boundaries during the ongoing Phase5 work.

## Constraints and resolved rules

- Pre-accrual production/painting allocations may change with a fixed customer total. Once either partner has an earning, use separate adjustments. An earning's payee, gross, commission, net, rate, and originating event must never be rewritten or deleted. Settlement metadata may advance; immutability does not prevent recording a payout.
- Reprints covered by this phase are platform-funded. Their approved compensation is a separate net credit, not a customer charge or a hidden increase to the original production base.
- A refund entry records money actually returned: amount, external reference, occurrence date, confirming admin and explicit confirmation. Clicking a refund button never calls a PayTR refund API.
- Partial refunds are cumulative. Paid partner earnings cannot be reduced, offset against unrelated future orders, or clawed back. Show retained partner payment and the refund's effect on platform margin.
- Dispute resolution may include an optional refund through exactly the same refund service; notify the customer even when no refund is selected.
- New-policy `digital_files` revenue is wholly platform income. Other workshop-delivered upsells retain their existing production allocation. Update both partner agreement texts because both describe the old two-base equality, with version bumps and actual acceptance rather than silent changes to onboarding history.
- Customer invoice basis is `amountKurus - havaleDiscountKurus`. Gift cards are tender, not invoice discounts. This decision is settled; do not reopen it as an accountant approval question.
- Freeze new-order commercial lines at draft creation/checkout, then copy them in the promotion transaction. A delayed havale payment must not read current product prices, labels or upsell constants.
- Reversible migrations use this project's `drizzle/NNNN_name.sql` + `NNNN_name.down.sql`, journal and snapshot conventions. Do not add irreversible PostgreSQL enum values. No seeds are needed.
- Scope includes only Phase6 and direct callers that could bypass its invariants. No whole-repository cleanup, new general accounting system, automatic refund integration, shipping-rate project, general admin RBAC project, or Phase7/8 expansion.
- Any later implementation commits/PRs use the user's identity and plain messages, with no AI authorship markers or AI references in branch names. This planning task creates none.

## What is already present, and what the audit no longer describes accurately

| Existing entry point | Observed behavior and Phase6 implication |
| --- | --- |
| `src/lib/db/schema.ts:415`, `:576`, `:2329` | Drafts/orders store totals and upsell keys; cart items store price/options/addons and production totals. No `order_cost_lines` table or platform base exists. |
| `src/lib/config/order-money.ts`, `src/lib/services/order-money.ts:96`, `:319` | `deriveOrderMoneyBreakdown`, `loadOrderMoneySnapshot`, `buildOrderMoneyBreakdown` already centralize the money card. New snapshots/operations belong here, not in a second UI calculator. Some lines are explicitly reconstructed; keep that distinction for history. |
| `src/lib/services/earning-base.ts` | `manufacturerBaseKurus`, `effectiveProductionBaseKurus`, `painterBaseKurus`, `orderMoneySplit`, `carvePaintingShare` are the shared bases. Current equality is production + painting = amount; platform income requires a versioned three-base model. |
| `src/app/api/admin/orders/[id]/add-painting/route.ts:179` | Guarded update checks no non-reversed manufacturer earning, no painter/shipment/workshop, and not refunded. Audit/notice are afterward. General split editing needs both earning tables, any historical accrual, row locks, and atomic audit/snapshot writes. |
| `src/lib/services/payouts.ts:85`, `:269`; `src/lib/services/painter-payouts.ts:156` | Accrual retries reconcile mismatched pending earnings by updating amounts. This contradicts the new immutable-accrual rule, even before payout. Both services take an order SHARE lock but accept caller-calculated gross, which can be stale. |
| `src/lib/services/revoke-after-painter.ts:216` | Reverses and deletes an accrued manufacturer earning to free UNIQUE(order_id), then can re-accrue on a lost race. Must use compensating entries and a replacement-work credit; keeping this deletion would defeat Phase6. |
| `src/lib/services/order-refund.ts:35` | `refundOrder` flips payment state and detaches partners, then catches financial reversal/gift-card errors separately. No amount/reference/date, partial refund or transaction covering all money exists. |
| `src/app/api/admin/orders/[id]/reject/route.ts:93`; `src/lib/services/workshop-cancel.ts:224`, `:372` | Reject has its own refund-like writes; workshop cancellations call the existing refund service without evidence of payment returned. Neither may manufacture an actual-refund record after Phase6. |
| `src/lib/services/payout-claim.ts`; `payouts.ts:569`, `:682`; `painter-payouts.ts:416`, `:506` | Atomic earning claims, lock timeout, and held-total checks already exist for both partner types. Extend them to adjustments; do not replace them with an unlocked sum-and-insert. Current reversal takes earning→batch locks while mark-paid takes batch→earning locks, so adopt one lock protocol. |
| `src/app/admin/payouts/page.tsx:67`, `:261`, `:303`; `client.tsx:234` | Both tabs, bank review warnings, expandable earnings and requester labels already exist. Lists cap at 100; no complete pagination/export. Requester is encoded as admin email or `manufacturer-request` / `painter-request`. |
| `src/app/api/admin/payouts/[id]/route.ts` | DELETE removes only an empty pending batch. That is not pending-batch void/unbatch. Keep legacy compatibility but expose an audited void action. |
| `src/app/api/orders/route.ts:509`, `:570`, `:582`; `order-draft.ts:137` | Checkout charges cart upsells and includes them in draft production base. Cart promotion sums only `order_items.lineTotalKurus` and drops upsell keys/amounts. Consequently child totals can be below collected payment, not merely missing labels. |
| `src/lib/services/order-draft.ts:67` | `promoteDraftToOrder` locks the draft and creates orders in a transaction, with confirmed-draft replay. Correct insertion point for copied snapshots and attempt-aware promotion. |
| `src/app/api/pay/[reference]/paytr/route.ts`; customer `retry-payment/route.ts` | Token creation overwrites the draft's single merchant OID. `src/app/api/webhooks/paytr/route.ts` acknowledges unmatched old OIDs and only logs amount mismatch before promotion. Editing price safely requires persistent attempt/revision correlation. |
| `src/lib/queue/workers/payment-deadline.worker.ts`; `order-draft.ts:634` | Worker expires eligible drafts without comparing the scheduled job with the current deadline. Removing an old BullMQ job alone cannot make deadline extension race-safe. |
| `src/lib/services/payouts.ts:813` | `getOrCreateInvoice` calculates KDV from gross amount and calls the provider before the unique invoice insert. Fix the basis and concurrent creation locally. Existing issued invoices must not be silently rewritten. |
| `src/app/api/admin/disputes/[id]/resolve/route.ts`; `src/app/admin/disputes/page.tsx` | Decision closes before reversal; reversal failure is reported as a warning. UI shows only open disputes and couples earning reversal to a strike. Customer dispute creation currently sends no admin notice. |

## Money model and invariants

Use integer kuruş throughout, with validated safe integer bounds at request boundaries. Add `moneyModelVersion` (legacy=1, new=2) to drafts/orders and freeze it at draft creation; promotion copies it. Existing unmodified drafts and paid orders remain version 1. An explicit admin repricing creates a fresh version-2 draft revision and requires renewed commercial consent.

For version 2:

```text
amountKurus = productionBaseKurus + paintingPriceKurus + platformBaseKurus
invoiceBasisKurus = amountKurus - havaleDiscountKurus
cashCollectedKurus = invoiceBasisKurus - giftCardAmountKurus
manufacturer base = production + (in-house painting ? painting : 0)
painter base = externally performed painting
platform-only base = platformBaseKurus; no partner commission is applied to it
```

Preserve version-1 earning bases for historic orders, including digital-file income already promised to partners. Do not subtract 9,900 kuruş from old orders because their upsell key happens to be present today. New snapshots must carry actual sale prices, not merely keys.

Keep `orders.amountKurus` as the original sale total after payment. Extra charges and refunds live alongside it:

```text
customer net consideration = original invoice basis + collected extra charges - confirmed refunds
remaining cash refundable = original cash + successful cash charges - prior confirmed cash refunds
remaining gift refundable = redeemed gift credit - prior gift-credit returns
partner payable = immutable earning net + eligible adjustment net
```

Refunds are not adjustments to original invoice rows. Display a credit/refund trail and separate charge documents; provider-specific statutory credit-note implementation remains outside this phase's approved invoice-basis change. Do not label an internal record as a filed tax document.

For refunds with mixed tender, require explicit `cashAmountKurus` and `giftCardAmountKurus` in the operation; the UI defaults partial refunds to available cash first, shows both values, and allows the admin to choose the gift component. A full-refund preset selects both remaining balances. This records the actual PayTR return rather than guessing a proportional cash amount. A gift-only return never requires a fictitious PayTR reference.

Partial refunds default to platform-funded compensation and do not automatically shrink a partner's earning or stop fulfillment. An explicit reduction to an unpaid earning uses a separately described, capped partner adjustment. Full refunds offset the remaining unpaid original earning liabilities; paid amounts remain intact. Platform reprint credits are independent obligations and do not disappear just because the original customer order was refunded.

A full refund sets `paymentStatus='refunded'` only after all refundable original consideration has been returned; if the order has collected extra charges, include those in the total refund scope and show the residual. Partial refunds keep `succeeded`, with a separate cumulative refunded amount/badge. Do not add a partially_refunded enum value. A partial line cancellation or digital entitlement revocation requires an explicit line allocation; an amount-only goodwill refund retains the purchased entitlement.

Show platform contribution as net customer consideration less actual/owed partner compensation, with gift tender shown separately from cash movement. Do not subtract gift tender from invoice revenue or count already-paid earnings twice as both an expense and a second 'loss'. For a full refund, identify the unrecoverable paid earnings explicitly. For partial refunds, show retained partner cost and resulting contribution; do not invent a proportional loss attribution as an accounting fact.

## Proposed schema, introduced with the slice that first needs it

Migration numbers are provisional: the latest observed pair is `0058_coverage_overrides`; recheck the Phase5 tip before assigning 0059 onward. Names below are proposed, not existing tables.

| Table / extension | Fields and constraints that matter |
| --- | --- |
| Draft/order extensions | `money_model_version` default 1, `platform_base_kurus` default 0, `cost_revision` default 0; snapshot agreement versions on new-policy orders. Drafts additionally have `edit_version`, `payment_deadline_at`, `deadline_version`, and revision-bound commercial-consent version. Keep existing havale deadline for compatibility during rollout. |
| `order_cost_line_revisions` | UUID, exactly one of `draft_id` / `order_id`, revision integer, source (`checkout`, `admin_edit`, `promotion`, `legacy_reconstruction`), total and three bases, money model, contract versions, actor/time, operation FK where applicable. Unique partial `(draft_id,revision)` / `(order_id,revision)`. Immutable headers. |
| `order_cost_lines` | Revision FK; stable source key, sort order, label, category/source (base/option/product-addon/checkout-upsell/manual), kind (`production`, `painting`, `platform`, or mixed `price`), amount, quantity/unit where meaningful, three allocated bases, product/item/upsell identity and frozen selection metadata. CHECK row bases sum to amount; unique `(revision_id, source_key)`. Option deltas may be signed; final line/base totals must stay nonnegative. Never force every option delta to be positive. |
| `money_operations` | UUID, action as checked text, nullable order/draft/dispute/payout target FKs with action-specific target checks, unique idempotency key, canonical request hash, actor/email, reason, before/after summary, immutable result, created time. Durable idempotency and narrow Phase6 audit, including draft/payout operations that cannot fit `admin_actions.order_id NOT NULL`. No generic audit-platform redesign. |
| `partner_adjustments` | UUID, operation/order FK, exactly one manufacturer/painter FK, optional original manufacturer/painter earning FK, work/reprint/replacement event key, kind (`reprint_bonus`, `topup`, `unpaid_offset`, `replacement_work`, `correction`), signed gross/commission/net and rate snapshot, source-funding label, positive/negative source link, settlement state, nullable manufacturer-payout/painter-payout FK. CHECK gross−commission=net; correct partner/payout pairing; unique operation+source key. Financial values/payee immutable. Negative rows must name the unpaid source they reduce, never a general future balance. |
| `order_refunds` | UUID, operation/order FK, optional dispute and payment-attempt/charge references, total/cash/gift amounts, method, actual external reference, actual refunded timestamp, confirmation timestamp/actor, reason, immutable allocation JSON. CHECK total=cash+gift and positive total. A manual cash row requires reference/date/confirmation. Unique operation; external transfer identity is checked at payment-attempt scope, allowing one cart transfer to be explicitly allocated across several children. Multiple independent refunds are separate rows. |
| `order_charges` | UUID, original order FK, capability reference for `/pay`, operation FK, amount and frozen charge lines/partner allocation, source-purpose/reason, state as text (`pending`, `paid`, `cancelled`, `expired`, `review`), deadline, paid timestamp/attempt. A charge never promotes to another physical order. Only successful collection releases its linked partner top-ups. |
| `payment_attempts` | UUID, unique merchant OID, exactly one draft/charge target, draft revision, expected amount/currency, state, provider result/received amount, created/completed times, reconciliation status/reason. Insert correlation before exposing an iframe; never overwrite history. Legacy single OID remains readable. |
| Payout extensions (both tables) | Nullable `voided_at`, `voided_by`, `void_reason`, `adjustment_count` default 0, `settlement_kind` default `transfer` (`transfer` / `netting`), batch revision, requester kind/id/email snapshot for new rows. Effective voided state is derived from `voided_at`; keep old `pending`/`paid` enum. Legacy requester display reads the current sentinel values. |
| `finance_outbox` | Operation FK, unique `(operation_id,event_key)`, recipient/type/payload, delivery state/attempts/error, timestamps. Only Phase6 notices, payment/deadline reconciliation work, and analytics. Committed with the money change; retried after commit through existing queues. |
| `partner_contract_acceptances` | Partner kind plus exactly one manufacturer/painter FK, agreement version, accepted time/IP/UA and text hash. Unique partner+version. Preserve existing `onboarding_version`; registration and explicit reacceptance append acceptance evidence. Snapshot applicable versions on orders. |

Use plain text plus CHECK constraints for new states/kinds. Foreign keys on financial/history rows use RESTRICT, not cascades that erase history. Add indexes for order/time/id on refunds/operations, partner/open/payout on adjustments, target/OID on attempts, and createdAt/id plus effective state on payout lists. `orders.refundedAmountKurus` may be an API projection from the ledger; a lone scalar/reference/date on orders cannot represent multiple partial refunds. Avoid a second editable total. If a cached cumulative column is necessary, update it only inside the same refund transaction and test equality against the ledger.

### Rollback contract

Every migration ships a matching down file. Follow the recent `0058_coverage_overrides.down.sql` pattern: bounded locks, exact object ownership, idempotent IF EXISTS handling, and remove only that migration's exact journal timestamp, never 'the last migration'. Reverse subsequent migrations first before reapplying an earlier one through Drizzle.

A populated financial table or used added column is runtime data. Down must acquire the required locks, detect data/use, and refuse atomically instead of dropping it, deleting rows, zeroing amounts, or guessing a reverse backfill. On a clean fixture it drops only objects that up created. For live rollback, roll back application behavior while retaining additive schema; destructive removal requires a separately approved preservation process. This is the only interpretation consistent with both reversibility and the owner's prohibition on touching runtime data.

For each pair later test up → down → up, a repeated down, a repeated idempotent up, and populated-data refusal leaving rows and migration journal intact. No migration execution is authorized in this planning session.

## Shared concurrency and idempotency protocol

Introduce `src/lib/services/money-transaction.ts` and `money-operations.ts` with transaction-taking internal functions. Do not call a public helper that opens another transaction while holding an order lock; existing payout comments document that this can wait on its own other connection.

1. Financial operations affecting partner liabilities obtain transaction-scoped partner advisory locks, ordered by `(kind,id)`. Discover IDs read-only, take locks, then lock/reread the order and earnings; if the participant set changed, abort and retry from discovery. No acquiring a newly discovered partner gate after an order lock. All accrual, adjustment, refund, batch-create, mark-paid, void and reversal paths must use the same gate.
2. Within a partner-gated transaction: order rows sorted by UUID → dispute row if applicable → payout rows in deterministic order → earning/adjustment rows sorted by source → gift redemptions/cards in deterministic order. Payout-only operations need not lock orders after locking batches; serialize money changes through the partner gate and validate current source eligibility. Retain guarded UPDATE predicates and `RETURNING`, even with locks.
3. Draft editing/promotion/expiry lock the draft first, reread revision/status, then payment attempt and gift-card rows. These operations do not accrue partner money while holding the draft; existing promotion kickoff remains after commit. Workshop session→draft ordering must remain compatible with `workshop-seat.ts`; retryable seat release stays after draft commit, as current code deliberately does.
4. Split editing takes order UPDATE lock and checks **both** earning tables for any row, including reversed historical rows, before writing a new revision. Accrual takes the same order lock and derives the authoritative base inside that transaction. Do not rely solely on NOT EXISTS evaluated in a statement snapshot, or on a caller's previously computed gross.
5. First accrual records the money for its fulfillment event once. A same-event retry returns the original record. A different base/payee/event never modifies or deletes it. A legitimate subsequent work event creates a uniquely keyed adjustment. Capture ship/handoff state transition plus initial accrual atomically where these Phase6 paths meet; there must not be a committed handoff with an editable split merely because accrual was fire-and-forget.
6. Every money mutation accepts a client-generated operation key. Same key+same normalized request returns the stored result; same key+different request is 409. Also enforce semantic keys: payment OID, refund external transfer allocation, dispute decision version, reprint/work event, and charge receipt. A fresh HTTP key cannot pay the same work event twice.
7. Use `SET LOCAL lock_timeout='5s'` and bounded retries for busy/deadlock results. No network calls while a money transaction is open. Never catch and ignore a financial-write failure; audit, balances, adjustment/refund rows and operation result commit together.
8. Notifications/analytics are durable after-commit work. Stable job IDs are helpful but not sufficient across enqueue crashes; the outbox records retry state. Inbox insertion needs a unique operation event key. Email delivery is at-least-once unless the provider supports an idempotency key; do not claim exactly-once delivery from BullMQ alone.
9. Mark-paid binds the displayed batch revision/total and transfer reference. A changed batch must be reconfirmed; do not mark a different amount paid from a stale tab. DB locks cannot protect an already-executed manual bank transfer: preserve entered payment evidence and flag a reconciliation conflict rather than silently applying it to new totals.

## Implementation sequence

Each slice is a reviewable vertical change. Keep mutations disabled until their financial backend and corresponding UI/read model are ready. Work from the settled Phase5 revision; do not reserve migration numbers in its active checkout now.

### Slice 1 — Frozen pricing, three bases, cart reconciliation, agreements and invoice basis

**Existing files:** `src/lib/config/cost-lines.ts`, `cost-line-row.ts`, `prices.ts`, `order-money.ts`, `contract-versions.ts`; `src/lib/services/product-cost-lines.ts`, `earning-base.ts`, `order-money.ts`, `order-draft.ts`, `payouts.ts`; `src/lib/db/schema.ts`; `src/lib/content/manufacturer-onboarding.ts`, `painter-onboarding.ts`; `src/app/api/orders/route.ts`; `src/app/api/customer/orders/[orderNumber]/invoice/route.ts`; `src/components/order-invoice.tsx`; `src/app/admin/orders/[id]/page.tsx` and `client.tsx`.

**New services:** `src/lib/config/order-cost-snapshot.ts` (pure projection/allocation), `src/lib/services/order-cost-snapshot.ts` (transactional persistence), `src/lib/services/partner-contracts.ts` (applicable version and explicit acceptance).

- [ ] Add snapshots/version/platform-base migration pair and read support first. Draft revisions own sale-time line amounts, labels, selections, production/painting/platform allocations. Promotion copies into a new order revision; never repoint and erase draft history.
- [ ] Instrument **all six draft writers**, not only `/api/orders`: `src/app/api/admin/orders/create/route.ts`, `src/lib/services/wa-order.ts:createWhatsAppDraft`, `src/lib/services/workshop-participant.ts:joinSession`, `src/app/api/customer/orders/[orderNumber]/reorder/route.ts`, and the main order route plus cart branch. Custom/upload/marketplace are branches of the main route. Admin creation currently creates a draft, so avoid a nonexistent separate paid-order writer. Reorder snapshots its new agreed offer rather than reading the old order's current product lines at promotion.
- [ ] Freeze detailed product cost labels, base/option/addon/bulk price components and checkout upsells. Preserve signed option deltas. Use shared deterministic integer allocation with stable source/group ordering; allocate floor shares then largest fractional remainders, ties by stable key.
- [ ] Cart checkout currently charges each selected upsell once per cart. Preserve that behavior: allocate each stored upsell fee over seller groups in proportion to product subtotal, without multiplying the charge by seller count. Add physical handling flags and digital entitlement to each applicable child, independently of whether rounding gave that child zero monetary share. Child amount includes its allocated upsells; physical shares go to production, digital shares to platform. Allocate havale/gift balances using final child amounts; allocate gift funding against post-havale capacity so rounding cannot make a child's cash negative. Freeze allocation before payment, reuse it on replay.
- [ ] Require `Σ child amount = draft amount`, `Σ child cash = draft cash`, `Σ child gift = draft gift`, `Σ child havale = draft havale`, and each child's three-base equality. Reject promotion with no cart items or irreconcilable stored totals; do not hide discrepancies through `max(0)`.
- [ ] Extend the order-only line model with platform amounts. Product cost editors can remain production/painting-only: `digital_files` is a checkout platform service, not permission for sellers to redirect arbitrary product income to the platform. Update shared totals/tripwires/UI accordingly.
- [ ] `loadOrderMoneySnapshot` prefers stored revisions. Version-1 orders lacking them use existing reconstruction marked as such. Never bulk backfill an invented historical digital fee from current constants.
- [ ] Bump manufacturer agreement 3.1→3.2 and painter 3.0→3.1, synchronize content/version constants/effective date at release, and add explicit reacceptance endpoints/screens under partner auth. New registrations record acceptance; existing onboarding history stays intact. New-policy assignment/acceptance and admin-on-behalf acceptance must require the applicable acceptance. Gate seller-owned checkout for new-policy jobs on seller acceptance; old jobs retain their recorded terms. Use the same policy in `manufacturer-assign.ts`, painter assignment, direct seller assignment, and partner accept routes.
- [ ] Change `getOrCreateInvoice` and its route projection to include havale and gift fields. Calculate KDV from amount minus havale only. Return tender breakdown for display. Preserve existing issued invoices; show a correction-needed difference without rewriting them. Unissued draft/stub-pending records can be recalculated under a lock with an operation record. Claim a pending invoice row before provider issuance and use the stable invoice number as the provider idempotency identity if supported.

**Acceptance tests:** extend `scripts/test-cost-lines.ts`, `test-order-money.ts`, `test-upsells.ts`, `test-finance.ts`, `test-payment.ts`; add `scripts/test-order-cost-snapshot.ts` and focused DB promotion tests. Verify every draft writer, product/constant edits between draft and payment, old-policy digital earnings unchanged, same in-house/external painting rule, repeat promotion, cart one-kuruş remainder and zero share entitlement, mixed gift/havale, snapshot sum mismatch, contract acceptance gates. Example new order: amount 109900, production 100000, platform 9900, painting 0, rate 4000 → manufacturer net 60000 and platform-only income 9900. Invoice example: amount 100000, havale 3000, gift 20000 → invoice 97000 and cash 77000.

**Release boundary:** deploy readers/schema before enabling version-2 writers; freeze writer activation and agreement requirement together. Do not reinterpret old live drafts.

### Slice 2 — Immutable accrual, adjustments, and payable balances

**Existing files:** `src/lib/services/payouts.ts:85/:269/:463/:569/:682`, `painter-payouts.ts:156/:333/:416/:506`, `payout-claim.ts`, `earning-claimable.ts`, `revoke-after-painter.ts`, `painter-auto-assign.ts`, `on-behalf.ts`; `src/app/api/manufacturer/orders/[id]/ship/route.ts`, `send-to-painter/route.ts`; `src/app/api/painter/orders/[id]/ship/route.ts`; `src/app/api/admin/workshops/sessions/[id]/ship/route.ts`; admin order `ship/route.ts` including its undo path.

**New services:** `money-transaction.ts`, `money-operations.ts`, `partner-adjustments.ts`; pure `src/lib/config/partner-balance.ts`. Add operation/adjustment/outbox schema and payout adjustment support in this slice.

- [ ] Replace `reconcileAccrual`'s `correct` branch with an immutable mismatch result and audited notice. Derive the first earning from locked current order state/rate/payee; remove stale gross as the authoritative input. Refactor to `accrueEarningTx(tx, {orderId, partnerId, eventKey})` and the painter equivalent, with public wrappers only for callers not already in a transaction.
- [ ] Preserve original earnings on revoke/reassign/undo. For an unpaid cancellation, append an offset tied to the original earning, atomically revoke assignment and release pending batch membership. A later replacement manufacturer's work accrues as `replacement_work` linked to the new assignment event; UNIQUE(order_id) on the original earnings need not be removed. Multiple jobs remain inspectable in money views rather than pretending the single earning row changed owner.
- [ ] A paid old earning remains untouched. The existing revoke flow may keep its operational refusal where physical handoff is unsafe, but a deliberately approved reprint/replacement uses a new platform-funded credit, never deletion of the paid row. A same-partner undo/reship that restores a previously offset obligation creates a uniquely keyed compensating credit, not a second full earning on every retry.
- [ ] Add `createPartnerAdjustmentTx`: positive net compensation uses explicit kuruş, recipient, reason, event and funding. A reprint bonus is the net compensation the admin authorizes, with gross=net and commission=0. Charge-funded work credits freeze the agreed commission calculation separately. Negative correction requires a named unpaid source and cannot exceed that source's remaining unpaid amount. Paid-source negative correction always rejects.
- [ ] Generalize claimable sources to include adjustments and retain `claimEarningsIntoPayout`'s lock/stamp/RETURNING discipline. Source identity is `(earning|adjustment, id)`, not bare UUID. Batch total is the exact sum of stamped sources; maintain earningCount and adjustmentCount separately. Enforce source partner matches batch partner.
- [ ] Apply source-linked offsets together with the liability they reduce. Never include an unrelated negative entry that recovers a paid earning from future work. A completely offset liability can close in a zero-transfer `netting` settlement: no bank reference/payment-sent email; UI says 'mahsup', not 'bankaya gönderildi'. If old enums use `paid` internally for settlement, settlement kind must be present in every display/export so no bank payment is falsely claimed. Ordinary transfer batches require positive total.
- [ ] After a full refund, new ledger-managed source+offset pairs remain eligible for zero settlement, and independent reprint compensation stays payable. The old blanket `orderNotRefundedSql` rule must not strand these obligations. Keep the existing exclusion for legacy refunded earnings lacking verified Phase6 offsets; label their reconciliation need rather than automatically paying them.
- [ ] Rebuild manufacturer/painter earnings/owed/dashboard totals from the same effective-source reader as batching. Extend `order-money` to display original earnings, separate corrections, platform-funded reprints, settlement state, and actual historical recipient after detach/reassign.

**Tests:** pure balance tests in `scripts/test-partner-adjustments.ts`; adapt the existing cost-line/accrual tests that currently expect rewriting; real PostgreSQL two-connection tests in `scripts/test-phase6-money-integration.ts`. Test same-event replay, changed-gross refusal, paid debit denial, unpaid bounded offset, reprint after original refund, replacement payee without deletion, reship replay, adjustment-only payouts, zero netting, orphan/wrong-partner source rejection, competing admin/partner batch requests, refund/void/mark-paid races, rollback when audit insertion fails. A mock or grep check alone cannot prove row-lock behavior.

### Slice 3 — General pre-accrual 'Kalemleri düzenle'

**Existing files:** admin order `add-painting/route.ts`, `edit/route.ts`, detail `page.tsx`/`client.tsx`, cost-line editor, `earning-base.ts`, notifications and shared money readers.

**New entry points:** `src/lib/services/order-cost-edit.ts`; `src/app/api/admin/orders/[id]/cost-lines/route.ts` PATCH.

- [ ] Request contains operation key, expected cost revision, production/painting line allocation and mandatory reason. Keep customer total and platform service allocations fixed; platform fees are not an arbitrary fund for manufacturing discounts. Shared preview uses the exact server allocation function.
- [ ] In one transaction lock/reread order, verify not fully refunded/closed, validate total, reject if either original earning table or a work-credit adjustment records accrual, append new snapshot revision, update base/needsPainting fields, record before/after and enqueue partner notice. Retain NOT EXISTS as a defensive final predicate, not the sole concurrency mechanism.
- [ ] Removing painting is allowed while unaccrued. If a painter is only assigned and has not accepted/received/started, revoke that assignment in the same transaction and notify both partners. Once painter work has started, reject removal with a concrete explanation and use the adjustment/reprint path. Do not silently take an active painting job away. Keep existing workshop no-painting constraint.
- [ ] Make the old add-painting route a narrow adapter to this service, so old UI callers cannot skip snapshot/audit protections. Regular specs/address edit does not gain a second money pathway. Map finish to a compatible unpainted/painted option explicitly; require selection where a legacy finish cannot be safely inferred.

**Tests:** `scripts/test-order-cost-edit.ts`: add/change/remove, stale revision, both partner earning guards including historical reversed row, painter assignment race, workshop restriction, refund race, split versus ship/handoff with barriers, notification before/after amounts, full transaction rollback.

### Slice 4 — Actual refund recording, partial refunds, gift returns, and cancellation callers

**Existing files:** `order-refund.ts`, `order-draft.ts:842/:902`, admin order `refund/route.ts`, `reject/route.ts`, `workshop-cancel.ts`, `order-money.ts`, order detail UI, customer notices, queue email types/templates, `src/lib/analytics/server.ts:305`.

**New internals:** `recordOrderRefundTx(tx, input)` and public `recordOrderRefund(input)` in `order-refund.ts`; `src/lib/config/order-refund.ts` for tender caps and cumulative/full classification. Add refund schema, scoped gift-credit-return support and operation/outbox integration.

- [ ] Replace the reason-only API with operation key, cash/gift amounts, method, actual external reference, refundedAt, explicit confirmation, reason, and optional affected lines/charge. For a card cash refund require literal `paytrRefundCompleted: true`; bank transfer requires its own actual-transfer confirmation. Reject missing/false confirmation, impossible dates, zero/negative amount, over-refund and mismatched tender. Distinguish occurred-at from recorded-at.
- [ ] Lock order and related money under the shared protocol; enforce cumulative caps from confirmed ledger rows, not a client-sent 'remaining'. Insert refund plus optional unpaid-source offsets, partial gift restoration, audit/result and outbox atomically. Full refund stops fulfillment/detaches partners in that transaction. Preserve identities in ledger/outbox payloads before detach.
- [ ] Extend gift restoration to amount-scoped returns with operation-linked claims; current `giftCardRedemptions.refundedAt` is an all-or-nothing flag and cannot support partial restores. Derive returned-to-date from refund ledger allocations to redemption IDs; mark old redemption fully refunded only when its complete amount has been returned. Cards are locked, and aggregate restored credit cannot exceed redeemed credit. Draft expiry still restores the remaining reserved amount once.
- [ ] Share the cumulative cash cap across a cart's original PayTR attempt. Distinguish one transfer allocated across children from repeated reuse of the same refund reference. Validate both per-order and payment-attempt remaining balances. Preserve positive remainder after prior partial refunds when applying the full preset.
- [ ] Keep a partial refund's production assignment and paymentStatus. Paid partner rows and paid batches are never edited/unbatched. Surface the retained cost beside refund cash/gift totals, not a misleading 'earnings reversed' message.
- [ ] Reject/cancel without actual payment evidence becomes operational cancellation with a refund-required operation/notice. It must not set paymentStatus refunded or email 'money returned'. Route an explicit confirmed refund through the shared service. Workshop bulk cancellation lists per-order refund amounts still required and supports recording evidence per actual transfer; do not let one checkbox invent references for all participants. Stop cancelled fulfillment using existing rejected/workshop cancellation state, extending only the exact guards that currently rely solely on paymentStatus. Gift credit may be returned automatically as a separately recorded actual gift-only return; outstanding cash stays due.
- [ ] Preserve legacy refunded orders as 'legacy refund, amount/reference unverified' rather than backfilling guessed actual transfers. They remain blocked from fulfillment. Provide a narrow admin evidence-reconciliation mode which records historical evidence without restoring gift balance or offsetting earnings a second time, and clearly leaves unknown prior amounts unknown.
- [ ] Make analytics event ID refund-operation-specific; it is currently `refund:<orderNumber>` and would deduplicate later partial refunds. Keep existing gross-basis purchase analytics coherent: track operational cash/gift refunds separately; if retaining gross-basis GA4 reporting, allocate cumulative gross-equivalent refund against the stored original purchase value with the final refund taking the rounding remainder. Never silently change an old purchase's basis, and never send the full order value on every partial refund.

**Tests:** `scripts/test-order-refund.ts` plus shared DB integration: false confirmation, missing reference, cumulative partial→full, concurrent over-refunds, duplicate request/ref replay, gift-only/mixed-tender/card/havale, cart sibling cap, paid partner retained, no negative future offset, transaction failure at each financial write, late ship/accrual, old refunded evidence reconciliation, rejected/workshop cancellation notices and later actual refund. Verify one durable notice per operation; worker failure cannot undo money or lose the pending notice.

### Slice 5 — Disputes through the shared service

**Existing files:** `src/app/api/admin/disputes/[id]/resolve/route.ts`; `src/app/api/customer/orders/[orderNumber]/dispute/route.ts`; `src/app/admin/disputes/page.tsx`, `client.tsx`; notifications/queue types. New `src/lib/services/dispute-resolution.ts`.

- [ ] Resolve/reject accepts resolution text, operation key and optional shared refund payload. No refund payload means decision only. Reject cannot carry a refund. If a refund is requested, lock order then dispute under the same transaction protocol and call `recordOrderRefundTx`; failure leaves the dispute open. Persist decision, refund association and notice atomically.
- [ ] Remove the combined 'clawback + strike' checkbox. If preserving unpaid-liability reduction, label it explicitly and send it through capped adjustment logic. A strike is an independent explicit conduct action and must not be applied merely because money was returned. Preserve current paid-earning protection in all variants.
- [ ] Notify customer with resolution/rejection and actual refunded amount when present. On dispute opening, create one admin email/outbox event. Serialize open-dispute creation on the order row to prevent concurrent duplicate opens; avoid a migration that fails on unknown existing duplicate data without a separate inspection.
- [ ] Add URL-selected open/resolved/rejected tabs, resolution/time/refund summary, real admin order link by orderId, and Turkish labels for not_as_described/damaged/not_received/other. Keep current degraded-read behavior honest.

**Tests:** decision-only notice, optional partial/full refund, invalid evidence leaves dispute open, refund transaction rollback, resolve/reject race, duplicate open, duplicate notice protection, paid partner unaffected and closed-tab rendering.

### Slice 6 — Durable payment attempts and safe draft operations

**Existing files:** `src/lib/services/order-draft.ts:67/:634/:773/:921`; `src/app/api/pay/[reference]/paytr/route.ts`; `src/app/api/customer/orders/[orderNumber]/retry-payment/route.ts`; `src/app/api/webhooks/paytr/route.ts`; `src/app/api/payment/paytr/callback/route.ts` alias; admin `drafts/[id]/verify-paytr/route.ts`, `expire/route.ts`; `src/lib/queue/workers/payment-deadline.worker.ts`, `dekont-ocr.worker.ts`; `src/app/pay/[reference]/page.tsx`, `pay-consent-gate.tsx`; pay `consent/route.ts`; admin draft detail page/client.

**New service/API:** `src/lib/services/payment-attempts.ts`, `draft-admin.ts`; PATCH `/api/admin/drafts/[id]`; POST child routes `/send-pay-link`, `/extend-deadline`, `/cancel`. Add attempts, edit/deadline version fields and revision-aware jobs before enabling price edits.

- [ ] Mint unique merchant OID before contacting PayTR; persist a pending attempt with target/revision/expected amount first. Provider call is outside the lock, followed by a guarded update; never return an iframe for an attempt superseded/cancelled during minting. Retain its OID anyway to reconcile a payment that still arrives.
- [ ] Callback and verify-paytr resolve the attempt, not just the draft's latest column. Validate success against frozen expected principal and the provider status response's amount semantics (do not blindly equate installment-inclusive `total_amount` to principal). Persist successful-but-stale/mismatched/second payments as `review` with a visible admin reconciliation item; never promote the newly priced revision for an old amount and never just log+discard the payment. Replayed successes are idempotent. Keep the canonical webhook and its alias calling one implementation.
- [ ] During migration, read a legacy draft OID when no attempt exists and materialize its correlation under lock from that draft's unchanged revision. Never allow price edits to erase the only existing attempt identity.
- [ ] PATCH reprices an eligible unpaid draft under UPDATE lock and `expectedEditVersion`. Regenerate full snapshot/totals, not a bare total override. For cart edits, update seller grouping/item quantity/base/options and the frozen group allocations consistently; manual line edits retain seller ownership. Financial changes to a draft with uploaded receipt/awaiting_review are blocked until review is explicitly reset, so an OCR result cannot approve an obsolete amount.
- [ ] While an attempt may still collect, block destructive repricing/cancellation until it is terminal or expired by provider-confirmed rules. If edits are allowed after a terminal attempt, increment revision and invalidate/recollect commercial consent. A revision/consent hash gate must be checked server-side at token mint and bank promotion, not only rendered in the page. Retain content-rights consent when source content is unchanged; commercial price consent is revision-specific.
- [ ] Gift reservations cannot exceed edited consideration. Return excess reservation transactionally; do not silently draw additional gift balance on a price increase. Recompute havale discount with the same pricing helper. A newly zero-cash offer follows the existing explicit confirmation/promotion rules; an admin edit itself is not evidence of customer payment/consent.
- [ ] Copy uses the canonical `/pay/<reference>` URL without a write. Resend enqueues the link to the draft's stored customer email with an operation key and the current revision/amount/deadline; do not add a new WhatsApp sending mechanism just for Phase6.
- [ ] Extend deadline writes deadline+version and reschedules jobs through the outbox. Worker checks current deadline/version under the draft lock; an already-running old job must no-op after extension. Explicit admin force-expire is a separate force action. Support both havale and card deadlines, since current card jobs have no authoritative stored general deadline. Reminders are revision/deadline-specific and cannot mention the old amount.
- [ ] Cancel uses the already-existing `cancelled` draft enum, releases remaining gift reservation exactly once, and releases workshop seat through existing retryable seat service. Confirmed drafts reject cancellation and link to order refund/cancel instead. A late successful payment on a cancelled/expired draft becomes reconciliation-required and is visible, not auto-promoted or swallowed.

**Tests:** `scripts/test-draft-admin.ts`, `test-payment-attempts.ts`, `test-payment.ts`, `test-workshop-cancel.ts`, and focused DB races. Old iframe success after repricing, two successful retries, callback versus cancel/edit/promotion, unchanged callback replay, awaiting_review/OCR stale revision, amount mismatch, legacy OID, reduced gift reservation, deadline extension versus active old expiry, resend replay, seat release retry, copy URL, and unauthorized admin calls. No live PayTR charge is necessary: use provider fakes and explicit sandbox integration only during later implementation.

### Slice 7 — Extra-charge payment links

Depends on slices 2 and 6; shares their adjustment and attempt services rather than creating a second payment stack.

**New files:** `src/lib/services/order-charges.ts`; `src/app/api/admin/orders/[id]/charges/route.ts`; dedicated charge handling in `src/app/pay/[reference]/page.tsx` and its token route. Add `order_charges` migration in this slice.

- [ ] Admin creates a fixed, reasoned, customer-facing extra charge with frozen line/partner allocation and a new opaque, collision-checked `/pay/<reference>` capability. Namespace references distinctly from FIG drafts. Original order amount, base snapshot and original earnings stay unchanged.
- [ ] Public pay resolver discriminates draft versus charge; a charge uses the original customer identity/address and explicit acceptance of the new charge. Do not create a pseudo draft that will promote to a second order.
- [ ] Successful charge attempt locks/settles that charge once, creates uniquely keyed partner credits only for collected funding, updates money read model, and queues receipt/notice. Pending/failed/expired charges create no payable credit. Platform-only charges create no partner credit.
- [ ] Cancellation/full-refund races close unpaid charges or put late charge receipts into review. Refunds against successfully collected charges use the same refund service and their own remaining-cash cap. A failed charge must not roll back original paid-order fulfillment automatically.
- [ ] Show original sale, additional collected/pending amounts, refunds, and effective total separately. Create a separate unissued charge invoice/document through the invoice adapter; do not overwrite a previously issued original invoice or falsely claim provider issuance.

**Tests:** charge without payment yields zero payable, one receipt→one top-up, stale/duplicate callbacks, cancelled-order race, independent capability, refunds capped to the correct payment, unchanged original earning/total, exact KDV/charge amount and original invoice immutability.

### Slice 8 — Pending payout void/unbatch, requester, pagination and CSV

Depends on slice 2's adjustment-aware sources.

**Existing files:** `src/app/admin/payouts/page.tsx`, `client.tsx`; `src/app/api/admin/payouts/[id]/route.ts`, `mark-paid/route.ts`; admin manufacturer/painter `[id]/payout/route.ts`; partner `payout-request/route.ts`; both payout services and `payout-claim.ts`.

**New files:** `src/lib/services/payout-list.ts`, POST `src/app/api/admin/payouts/[id]/void/route.ts`, GET `src/app/api/admin/payouts/export/route.ts`; optional GET batch detail route under existing `[id]/route.ts` for lazy expansion.

- [ ] Void requires explicit partner kind, batch revision, reason and operation key. Under partner gate then batch/source locks: reject paid/settled transfer, replay existing void result, release **all** still-unpaid earning and adjustment memberships, append operation with original member IDs/total/requester, set void metadata. Never delete the batch or monetary source rows. Do not zero its historical stated total; voided rows are excluded from active payable/mark-paid queries.
- [ ] Mark-paid, create, pending counts, delete-empty compatibility and partner history all honor voided state. UI currently classifies pending with `status !== 'paid'`; replace that because voided batches still have legacy pending enum. A voided adjustment-only or mixed batch must be claimable again exactly once.
- [ ] Preserve requester labels already shipped. New rows snapshot requester type/id/display/email from authenticated actor. Do not replace requester with the admin who marks paid; record payer/voider separately. Historic sentinel attribution remains readable rather than guessed into a fabricated actor ID.
- [ ] Paginate on the server, separately for pending/paid/voided and owed-partner queues. Stable `(createdAt DESC,id DESC)` cursor; explicit tab/state/partner/date filters and limit capped at 100 (default 25). Totals/counts describe the full filtered dataset, not the current page. Fetch source details lazily so expanding one row does not require loading every historical earning.
- [ ] CSV uses the identical filter/query service and a consistent read snapshot, covering all filtered rows instead of only the visible 100. UTF-8/BOM, quoted cells, predictable Turkish labels, ISO timestamp with stated timezone, both integer-kuruş and formatted TRY columns. Escape spreadsheet-formula prefixes in names/references. Columns include partner kind/id/name, payout ID, effective status, settlement kind, requester, totals/earning count/adjustment count, creation/paid/void dates, transfer reference, void reason; provide source detail export keyed to batch if needed.
- [ ] Keep existing IBAN review warnings and explicit unknown/read-failure states. Require admin auth for every list/detail/export/mutation route; include targeted unauthorized/malformed-body tests without expanding into a repository-wide auth audit.

**Tests:** `scripts/test-payout-void.ts`, `test-payout-list.ts`, DB integration and a focused UI flow: nonempty pending void, adjustment-only void, repeat void, paid refusal, concurrent create/void/mark-paid/refund, stale displayed total, preserved history/requester, pagination boundaries/ties and empty pages, CSV beyond 100 rows, exact totals, state/partner filtering, formula escaping and permission rejection.

### Slice 9 — Focused integration, release and operator acceptance

- [ ] Review the final settled Phase5 diff for overlaps in `schema.ts`, payout/earning code, assignment gates and `order-draft.ts`; update anchors and migration numbers. Do not rerun Phase5 deployment from this plan.
- [ ] Run the targeted pure scripts per slice, then one focused two-connection PostgreSQL suite against a disposable test database. Use explicit barriers to exercise competing transactions rather than hoping `Promise.all` happens to race.
- [ ] Run migration up/down/up and data-preservation refusal checks only on disposable fixtures. Include the real Drizzle journal behavior and new-text-kind CHECK constraints. No seeds or historical money rewrite should appear in the migration diff.
- [ ] Validate three end-to-end cases: mixed-seller cart + digital/gift/havale with frozen snapshots; handoff-accrued order + platform reprint bonus + partial then full manual refund; pending payout with earning+adjustment → void → new batch → mark paid and complete CSV. Add draft edit/old-payment reconciliation and optional dispute refund to the same focused suite.
- [ ] Test the touched customer/partner/admin screens together: amounts, paid earnings retained, reconstructed legacy labels, digital download entitlement, notices, mobile dialogs and history rows. A partner must see the same effective payable amount that payout creation will claim.
- [ ] Only during authorized implementation, after scoped tests pass, run the repository's required lint/typecheck/build gates once for the final candidate. Report existing unrelated failures separately; do not expand the phase into fixing every lint or style issue.
- [ ] Release additive schema/readers first, then transaction writers/attempt readers, then activate mutation UI and new-policy snapshots/agreements. Update web and workers together for attempt/deadline payload versions. Keep old job payload readers safe by verifying the database deadline even without a job version.
- [ ] Observe targeted invariant alerts: cart sums, split mismatch, immutable-accrual refusal, unclaimed outbox operations, stale paid attempts, payout source-total mismatch. Use the existing order/draft/payout screens for recovery; no new general monitoring product.

## Concrete transaction acceptance examples

These are required behaviors, not test runs performed here.

```ts
// Pure money contract: gift is tender; digital is not manufacturer income.
assert.equal(invoiceBasis({ amountKurus: 100000, havaleDiscountKurus: 3000 }), 97000);
assert.equal(97000 - 20000, 77000); // actual cash with gift funding
assert.equal(computeEarning(100000, 4000).netKurus, 60000);
// New platform-only fee of 9900 changes customer amount to 109900,
// never the 100000 manufacturer base.
```

Concurrency assertions for the DB test harness:

- Split transaction wins first → later accrual uses its new base; accrual wins first → split returns 409 and leaves every snapshot/base unchanged.
- Refund with two concurrent requests above the remaining cap → at most one commits; cumulative cash/gift and payment-attempt cap remain valid.
- Mark-paid wins before refund → paid source is preserved and refund records platform impact; refund wins → stale mark-paid fails revision/source-total validation.
- Void versus mark-paid → exactly one terminal result; every source is either held by the paid batch or unbatched from the voided batch, never both.
- Draft edit versus old callback → payment correlates to its original revision and cannot authorize the revised amount. A successful stale payment remains visible for reconciliation.
- Revoke/reassign after accrual → original earning still exists with identical payee/gross/commission/net/rate; any reduction and replacement compensation appear as separate keyed rows.
- Crash after money commit before notification enqueue → operation remains committed, outbox retry schedules the notice; HTTP retry returns the same result and does not repeat money.

## Business ambiguity and implementation assumptions

There is no need to reopen the stated owner decisions. Two details are not explicitly decided in the audit, but safe implementation defaults can resolve them without blocking planning:

1. **Unpaid partner impact of a partial refund:** default to no automatic reduction; require an explicit source-linked adjustment when the admin means to reduce an unpaid liability. This avoids inventing a proportional clawback and follows the immutable-earning decision. Full refunds offset unpaid original earnings while leaving independent reprint compensation and all paid earnings intact.
2. **Cart-wide upsell scope:** preserve today's one-charge-per-cart contract and propagate the selected service/entitlement to applicable children, allocating the fee once. Do not silently change checkout to charge per seller. Gift/rush physical handling and digital entitlement are distinct from rounding of fee shares.

Reprint amount is intentionally an explicit admin-entered net compensation, not a new automatic tariff. Extra charges contain their own explicit funded partner allocation. These are operation inputs, not unanswered business questions.

One external accounting boundary remains: this code's e-invoice provider is a stub, so official credit-note/reissuance integration cannot be claimed complete from this phase's internal ledger and approved invoice-basis change. Preserve issued documents and record required corrections; do not block the settled basis fix on reopening that decision.

## Recommended work order and parallel boundaries

1. Slice 1: snapshot/cart/platform/invoice foundations, keeping new policy gated until agreement acceptance exists.
2. Slice 2: immutable accrual, adjustments and adjustment-aware payout backend. This is the critical path; all current reversal/deletion callers must be adapted together.
3. Slice 3: split editor, then Slice 4: actual refund ledger and cancellation adapters.
4. Slice 5: dispute integration, after refund service is stable.
5. Slice 6: draft attempts/edit/deadline/cancel. Its UI can be developed independently once snapshot/operation interfaces are fixed, but shared promotion/webhook edits need one owner.
6. Slice 7: extra charges, after attempts and adjustments.
7. Slice 8: payout void/history/query/export can run alongside draft work after Slice 2, with one owner for payout services and their lock protocol.
8. Slice 9: focused cross-flow validation and coordinated release.

Do not parallelize conflicting edits to `schema.ts`/migration journal, `order-draft.ts`, the money model, or payout lock protocol. UI work and pure allocation/query tests are suitable independent tasks once their service interfaces are fixed. The deliverable is a coherent set of money workflows, not a repository hygiene campaign.

## Execution checkpoint — 2026-09-17

Phase5 deployed65ba658, workflow35209155137, app health OK / worker restart0.
First implementation increment (not all Phase6): pre-accrual split editor with
atomic audit and stale-write guard; locked-base accrual; cart upsell conservation;
invoice basis excluding havale discount only; guarded unpaid manual bank-transfer
draft edit/extend/cancel/resend with durable draft action history0059. Card/session,
gift-reserved and catalog repricing remain disabled until durable payment attempts
exist. Adjustment/refund ledgers, digital-only platform share/contract version,
extra charges, dispute integration and payout void/export remain to implement.
The proposed larger architecture above is guidance, not authority to invent new
product requirements or expand this increment into unrelated lifecycle refactors.

6a validation record: migration0059 clean up/down/up and populated rollback
refusal verified (15 checks); isolated draft actions49, renewed consent/manual
payment evidence30, handoff/shipping races26 and workshop98 checks passed.
Real browser tests cover split add/remove, refused refunded edit, draft repricing,
old customer consent409, current consent200, stale admin payment approval409,
extension/cancellation and three durable audits. Production build and all70 unit
scripts passed before final review corrections; release checks rerun for the final
candidate. Existing Phase4 pending-accrual reconciliation remains intact; manual
post-accrual corrections will be separate entries in the next increment.

Final6a candidate: production build and all70 unit scripts passed again after
review fixes; add-painting adapter9 DB cases passed. Lint has no errors.
