# Phase 6c — Actual refund evidence Implementation Plan

> **For agentic workers:** Execute this bounded contract task by task using `superpowers:executing-plans`. Implementation is active; main coordinates file ownership and verification.

**Goal:** One safe vertical slice for recorded actual cash refunds, partial gift returns and cancellation callers, preserving 6b financial behavior.

**Architecture:** Three refund-specific tables; immutable transfer/cancellation evidence and per-order allocations; existing partner gates and a transaction-taking extraction of existing reversal; in-app notices in the same DB transaction and retryable email intent on the refund record. No general ledger, general operations table, generic outbox, provider API or payment-attempt rewrite.

**Tech Stack:** Existing Next/Drizzle/PostgreSQL/BullMQ, integer kuruş, Turkish UI.

**Spec:** `docs/superpowers/plans/2026-09-17-phase6-money-plan.md` Slice 4/5, overridden by accepted 6b reversal/reconciliation semantics; `/tmp/printer-refund-gift-findings.md`, including its recorded-source-evidence addendum. Read-only source review, not a production-data verification.

## 1. Contract checkpoint — implement this first

Main may start schema/refund backend against this section. Later sections explain safety/testing; they do not require finishing the entire old Phase 6 roadmap.

### Ownership

| Lane | Files / boundary |
|---|---|
| Main schema/backend | 0061 reversible pair, snapshot/journal/schema; `src/lib/config/order-refund.ts`; `src/lib/services/order-refund.ts`; new `src/lib/services/gift-credit-return.ts`; refund API; bounded tx extraction in `partner-payables.ts` coordinated with its owner. |
| **Sartre — already implementing, preserve ownership** | `src/lib/services/gift-card-usage.ts`, usage validation in `gift-card.ts`, checkout count in `src/app/api/orders/route.ts`, focused usage tests. Refund code calls/relies on this shared helper; no duplicate counter or edits in that lane. Existing `refundedAt IS NULL` continues to mean a live residual. |
| Cancellation integration, assigned by main | `reject/route.ts`, `workshop-cancel.ts`, seat transaction adapter only if needed, session/participant cancel routes, exact closed-order accrual/placement guards. Must land before partial returns are exposed. |
| Main UI | Refund preview/history/dialog, order-money projection, workshop cancellation report/copy. Main decides extracted component layout. |
| Notice/test lane, assigned by main | Refund-record email delivery helper, existing email queue/worker/scheduler branches, templates; pure/QA DB tests. No separate queue infrastructure or universal outbox. |
| Next thin consumer, after core works | `dispute-resolution.ts` and resolve-route adapter. Optional refund calls same tx primitive; no separate refund implementation. Broad dispute tabs/extra charges/contract rollout are not prerequisites. |

Do not sweep all existing reversal callers. Extract `reversePartnerEarningTx` from the existing helper, keep the public wrapper and its current callers unchanged, and use the tx helper only in the new refund/cancellation unit.

### API/service types (client imports types only)

```ts
type RefundAllocationInput = { orderId: string; cashKurus: number; giftKurus: number };
type RefundActor = { adminEmail: string }; // authenticated session only

type RecordRefundInput = {
  operationKey: string; // UUID; identical intent retry reuses it
  expectedFingerprint: string;
  mode: 'actual' | 'legacy_evidence';
  allocations: RefundAllocationInput[];
  cashEvidence?: {
    method: 'card' | 'bank_transfer';
    externalReference: string;
    occurredAt: string; // ISO actual transfer occurrence
    paytrRefundCompleted?: true; // required for card cash
    bankTransferCompleted?: true; // required for havale cash
  };
  reason: string; // trimmed >=10
};

type RefundResult = {
  ok: true; refundId: string; replayed: boolean;
  cashKurus: number; giftKurus: number;
  orders: Array<{
    orderId: string; remainingCashKurus: number | null;
    remainingGiftKurus: number | null; fullyReturned: boolean;
    originalReversal: Array<{
      kind: 'manufacturer'|'painter'; earningId?: string;
      outcome: 'reversed'|'paid_retained'|'already_reversed'|'absent';
    }>;
  }>;
  notificationState: 'pending'|'delivered'|'not_required'; warning?: string;
};
type RefundFailure = { ok:false; status:400|404|409|503; error:string;
  code:'invalid_evidence'|'not_found'|'stale'|'over_refund'|'reference_used'
    |'operation_conflict'|'lineage_unknown'|'legacy_unverified'
    |'gift_history_unknown'|'busy'|'unavailable' };

readOrderRefundView(orderId: string): Promise<OrderRefundView>;
recordOrderRefund(input: RecordRefundInput, actor: RefundActor):
  Promise<RefundResult|RefundFailure>;
recordOrderRefundTx(tx: MoneyTx, context: LockedRefundContext,
  input: RecordRefundInput, actor: RefundActor): Promise<RefundResult>;
```

`LockedRefundContext` is private/branded: scope, locked sibling orders, normalized held partner keys and fingerprint. Routes cannot construct one from request data. Public service owns discovery/revalidation/retry; transaction helper opens no nested transaction and takes no late partner gate.

`OrderRefundView` exact shape:

```ts
{
  payment: { scopeKey:string; method:string; collectionReference:string|null;
    evidenceLevel:'recorded'; invoiceBasisKurus:number|null;
    cashBasisKurus:number|null; giftBasisKurus:number|null },
  siblings: Array<{ orderId:string; orderNumber:string;
    cashBasisKurus:number|null; giftBasisKurus:number|null;
    confirmedCashKurus:number; confirmedGiftKurus:number;
    remainingCashKurus:number|null; remainingGiftKurus:number|null;
    legacyUnverified:boolean; cancelled:boolean }>,
  history: Array<{ refundId:string; kind:'refund'|'cancellation'|'legacy_evidence';
    occurredAt:string; recordedAt:string; adminEmail:string; reason:string;
    externalReference:string|null; cashKurus:number; giftKurus:number;
    allocations:RefundAllocationInput[];
    notificationState:'pending'|'delivered'|'not_required' }>,
  expectedFingerprint:string; canRecord:boolean; blockedReason?:string;
}
```

GET/POST existing `/api/admin/orders/[id]/refund`; path order must be one of the allocations, extra orders must share the same recorded payment. Standard requireAdmin inside direct try, standard Turkish `handleRouteFailure`. Dates serialized ISO. Failed read is unavailable, never zero/empty. Old reason-only POST refuses400; never invent a confirmation/reference.

`cancelPaidOrder({orderId,operationKey,expectedFingerprint,source:'admin_reject'|'workshop_session'|'workshop_participant',reason},actor)` returns `{ok:true,cancellationId,replayed,cancelled:true,giftReturnedKurus,cashRefundRequiredKurus:number|null,giftReturnBlockedReason?:string,legacyUnverified,notificationState}`. Cancellation is distinct from cash returned. It writes a cancellation-kind record and zero-cash allocation; optional provable gift restoration is actual credit. Ambiguous gift evidence means explicit blocked gift obligation, not fabricated balance; real DB write failures roll back cancellation.

### Minimum 0061 schema (three tables; no generic outbox)

All IDs UUID; financial FKs RESTRICT; states checked text, not new pg enums. Header/allocations financial content is append-only; only header delivery state/lease is mutable. No guessed data backfill.

**`orderRefundRecords` / `order_refund_records`**

- id PK; operationKey UUID UNIQUE; requestHash; kind `refund|cancellation|legacy_evidence`; UNIQUE(id,kind) for composite allocation FK.
- paymentScopeKey; exactly one anchor draftId FK order_drafts or standaloneOrderId FK orders. CHECK normalized key matches anchor (`draft:<uuid>`/`order:<uuid>`).
- method `card|bank_transfer|gift_credit|none`; cashAmountKurus/giftAmountKurus nonnegative int. `refund` requires positive total; `cancellation` requires cash=0 and permits gift=0; legacy evidence requires positive evidenced total but applies no balance effects. `none` iff both zero; `gift_credit` iff cash=0 and gift>0.
- externalReference + trimmed externalReferenceKey required iff cash>0; unique partial(scope,method,externalReferenceKey) where cash>0. Preserve case/content unless provider supplies a normalization contract.
- occurredAt (cash occurrence; server now for gift/cancellation), recordedAt default now, confirmedAt, adminEmail, reason length>=10.
- sourceSnapshot JSONB (version, recorded collection basis/OID, sibling identities and tender amounts, prior returned basis); resultSnapshot JSONB (immutable replay and financial effects). No gift code/bank secrets.
- **Email intent on this record:** emailPayload JSONB (versioned recipient messages, stable per-message keys, actual/pending wording), emailProgress JSONB (per-key acceptedAt/attempts/error), emailState `pending|delivering|delivered|not_required`, emailNextAttemptAt, emailLeaseUntil. Index(state,nextAttemptAt,id). Empty payload only with not_required; no ambiguous “queued means sent”. Snapshot recipient before detaching partner. One record lease serializes delivery/progress updates.

**`orderRefundAllocations` / `order_refund_allocations`**

- id PK; refundId + kind composite FK to header; orderId FK orders; UNIQUE(refundId,orderId).
- cashKurus/giftKurus nonnegative; refund/evidence allocation total>0; cancellation cash=0 permits zero total.
- UNIQUE partial(orderId) WHERE kind='cancellation' (one terminal cancellation; new retries cannot double gift/notice).
- basisSnapshot JSONB including original tender, prior returns, pre-detach partners and before/after status; analyticsGrossKurus >=0, createdAt.
- index(orderId,createdAt,id), index(refundId). Service enforces header sums=allocation sums in same tx, not a misleading cross-row CHECK.

**`giftCreditReturns` / `gift_credit_returns`**

- id PK; redemptionId FK gift_card_redemptions; giftCardId FK gift_cards; amountKurus positive.
- Exactly one refundAllocationId FK above OR expiredDraftId FK order_drafts.
- balanceEffect `restore|none`; none only for legacy evidence (service joins parent and checks); expiry always restore.
- balanceBeforeKurus/balanceAfterKurus: restore requires after=before+amount and nonnegative; none requires both null. createdAt server time.
- Unique partial(refundAllocationId,redemptionId); unique partial(expiredDraftId,redemptionId); index(redemptionId).
- Original redemption amount stays unchanged after promotion. Existing refundedAt marks complete return; partial sum lives here. Marker and ledger must never be added together as two returns.

In-app notifications use existing notification tables **inside the money transaction**, with stable IDs derived from operation+recipient+event. No new notice table. Admin audit uses existing adminActions refund/reject entries with operation ID; header/allocations hold authoritative immutable audit.

### 0061 rollback contract

Follow 0060: bounded lock timeout; one atomic DO/transaction; lock affected tables before checking; refuse if ANY new table contains rows, including evidence-only/delivered/cancellation rows. Never delete money history to allow rollback. Empty/unused down drops only owned objects reverse FK order, removes only exact journal timestamp, is idempotent and handles partially present schema. Up idempotent where practical, statement-breakpoints/snapshot/journal consistent. No gift balance/marker changes in migration. QA: up/down/up, repeated up/down, populated refusal leaves rows/journal intact. After runtime use, application rollback retains additive schema and disables old unsafe reason-only refund writers.

## 2. Recorded tender and actual-refund meaning

**Recorded is not provider-verified.** Use consistent persisted succeeded/confirmed order/draft amounts as the source cap; do not require a new receipt/attempt system for clean existing records. `evidenceLevel:'recorded'` stays explicit. PayTR token retries overwrite the OID; webhook amount mismatch is currently logged, not a verified receipt ledger. Do not fabricate provider receipt verification from current OID. Known ambiguous attribution/mismatch or missing necessary lineage -> reconciliation-required; never allocate guessed amounts. No broad incoming-payment architecture in this slice.

Scope is `orders.draftId` for confirmed cart/single drafts. All children carry it; `parentReference` and `promotedOrderId` alone are not scope. Standalone legacy orders use `order:<id>` only with coherent recorded source basis. Check shared and child caps under one payment gate:

```ts
invoice = amountKurus - havaleDiscountKurus;
gift = giftCardAmountKurus;
cash = invoice - gift;
remainingCash = cash - actualCashAllocations;
remainingGift = gift - actualOrHistoricalGiftReturns;
full = remainingCash === 0 && remainingGift === 0;
```

Discount is not tender. Persisted child sums must agree with recorded draft totals; inconsistent sums refuse unchanged. Use safe integers/BigInt intermediates and INT32 bounds. Full preset uses remainder, not original totals. One transfer header can allocate across siblings; header cash exactly equals sum allocation cash. Another key reusing reference ->409 with existing record; same key/hash ->replay before fingerprint checking. Canonical hash includes actor/action/scope/allocations/evidence/reason, not volatile GET fingerprint.

Cash form requires real actual-transfer date/reference and literal rail-specific confirmation. Gift-only needs no external reference. Reject zero refund, over-refund, invalid/future actual date, pre-collection date and mismatched rail. UI says “Gerçekleşen iadeyi kaydet”; service never initiates a transfer. Wrong evidence is not editable/deletable here; separate reconciliation is needed.

Partial actual refund leaves fulfillment and original earnings unchanged. Full return detaches/stops future fulfillment and reverses only pending originals using accepted 6b helper semantics. Paid batches/originals and independent credits survive. Retained cost uses existing order-money/settlement semantics, including offset/netting, not raw paid-original net counted again as a second loss. Automatic pending reconciliation stays exactly as accepted for live orders.

### Safe blocked legacy cases

- Legacy paymentStatus refunded is **unknown actual amount/reference**, not automatic full cash evidence. No migration synthesizes a transfer.
- Legacy refundedAt consumes that redemption's full return cap; do not credit again. If marker absent on a legacy-refunded order, old restoration may have failed or been manual: unknown, not automatically refundable.
- `legacy_evidence` appends historical evidence, never calls credit/reversal helper, changes state or sends “just refunded” mail. Unknown remainder stays null. This increment keeps legacy-refunded scopes blocked for new money effects even after annotation; reconciliation can document but cannot guess a baseline.
- A cart sibling with unknown prior refund blocks new shared-scope actual refunds. Missing/contradictory redemption ownership or totals refuses gift movement; no first-child/current-product-price reallocation.
- In a cancellation, unknown cash/gift balance is an explicit pending reconciliation obligation. Stop fulfillment without pretending a transfer occurred.

## 3. Gift contract and Sartre prerequisite

Current promotion **already prorates one redemption per positive-gift child**. The first funded child keeps the original row at its reduced share; other funded children have separate rows with draftId=null. Use those stored shares/IDs and `redemption.orderId -> orders.draftId` lineage. Do not change promotion allocator, order child amounts or invent a historical split.

```ts
restoreGiftCreditTx(tx: MoneyTx, input: {
  scope: {kind:'order'|'draft'; id:string};
  parent: {refundAllocationId:string} | {expiredDraftId:string};
  allocations: readonly {redemptionId:string; amountKurus:number}[];
}): Promise<{restoredKurus:number; allocations:Array<{
  redemptionId:string; restoredKurus:number; remainingKurus:number;
}>}>;
```

Parent operation owns replay. Helper locks/revalidates scope/redemptions/card and residuals, inserts return evidence and exact balance increment in same tx, no network/public nested tx. Reject duplicate redemption IDs, foreign order/draft, missing card, amount/ownership mismatch and over-return. Return to original redemption card; card buyer need not be redeeming user. Current balance is not a refund entitlement/cap. Expired card stays expired.

**All full-return wrappers must become residual-aware before partial rollout.** Replace/remove old `refundGiftCardForOrder` full-value implementation; refund/reject must not retain an alternate unscoped call. Draft expire/fail retains existing draft row lock, refuses confirmed, selects only unpromoted orderId-null reservations, restores residual via helper. Promotion remains unchanged for clean untouched reservations; if a partial return exists on a pending reservation, refuse promotion rather than silently underfund it. No broad promotion rewrite.

`refundedAt` changes only when that redemption's cumulative actual restored amount is complete. For old full marker, available=0 irrespective of absent/new ledger; never marker+sum. Draft releases have their own unique draft/redemption claim, no fabricated order. New partial evidence rows protect source history from deletion.

Sartre's shared usage helper counts DISTINCT checkout identity across live redemption rows: coalesce redemption.draftId, order.draftId, otherwise conservative order/redemption identity. The first child's full return leaves a sibling use counted. This relies on null marker until each residual is zero and needs **no additional refund-owned counter change**. Integrate via the helper contract Sartre exports, rather than rename/reimplement it in this plan.

## Locking detail for the first vertical slice

### Refund/cancellation context

1. Discover payment scope/sibling set and **all current earning owners plus currently assigned partners** with unlocked reads. Existing historical paid earning owner may differ from current partner; include both. Independent adjustments need no unrelated partner gate unless the transaction actually changes their source membership.
2. Open tx, SET LOCAL timeout5s. Acquire all `lockPartnerMoney` keys sorted by `kind:id`, before order or money row locks.
3. Acquire one narrow transaction advisory gate `refund-payment:<scopeKey>` (hashtextextended) AFTER partner gates and BEFORE any draft/order lock. All new refund/cancellation paths use this order; no caller holds it then seeks a partner gate. It serializes child allocations/transfer references, not all platform money.
4. Lock confirmed draft if present, then all payment-sibling orders ascending UUID (standalone: own order). Re-read anchors, tender bases, earning identities/owners and current assigned partners. If participant set changed, **rollback and retry discovery**, at most 3 attempts; never acquire a new partner gate after order locks. If a draft is not confirmed, refuse; do not call promotion while holding partner gates.
5. Check replay under locks before stale fingerprint validation. Hash includes action/mode, scope, sorted allocations, method/ref, occurrence, explicit confirmation, reason and actor; not transient GET fingerprint. Identical retry returns immutable committed result even if now full/closed. Same UUID/different payload ->409.
6. Validate fingerprint, caps, closed/legacy policy. Lock relevant original earnings/adjustments/payouts via tx reversal helper as needed. Partner gates serialize existing payout claim/void/settle, so preserve their current internal order rather than rewriting all money services.
7. For gift effects lock gift cards sorted UUID **before** updating/locking their redemption rows, then redemptions sorted UUID; revalidate ownership/amounts under those locks. Existing checkout locks card then inserts redemption: this avoids a new card/redemption inversion. Draft expiry uses draft -> cards -> redemptions and touches only that draft's unpromoted reservations. Full refund involves only confirmed drafts. No checkout modification may take a confirmed refund order lock while holding the card.
8. Insert header, allocations, gift-return claims/balance updates, pending-original reversals, final order/cancellation state, existing in-app notifications, admin audit when applicable, refund-record email intent and immutable result in SAME tx. Any write failure rolls everything back. No network, public `reverseEarning`, public `refundGiftCardForOrder`, `notifyCustomer`, or public promotion called inside.
9. Commit; best-effort kick BullMQ. HTTP success describes committed money and `notificationState:'pending'|'delivered'`, not email success. A queue outage does not turn an already committed refund into an HTTP failure inviting duplicate entry.

`reversePartnerEarningTx(tx,{kind,orderId,expectedPartnerId})` will be extracted inside partner-payables, require a prelocked context and return `{ outcome:'reversed'|'paid_retained'|'already_reversed'|'absent', earningId?, netKurus?, affectedPayoutIds:[] }`. It acquires no partner gate/new tx; verifies owner. Existing public wrapper keeps its signature and uses helper. It retains existing exact-source debit detachment and pending payout recomputation; paid/netted originals and independent credits unchanged. No changes to `reconcileAccrual` decisions/amount derivation.

### Closing the cancelled-but-still-paid gap

- Add shared `originalEarningOrderOpen` predicate: payment not refunded AND status not rejected. Apply inside the locked original accrual reads in both services; return a truthful `skipped_cancelled` outcome with caller text. Do not turn a cancelled order into `skipped_refunded`.
- Extend original-source eligibility in `loadPartnerPayables` and any surviving shared SQL earning projections using order status; independent positive adjustments still eligible. Label blocked original source `order_cancelled`, preserving existing refund labels separately. No rewriting paid history or hiding liabilities.
- Forward placement/ship/QC methods that already constrain allowed status cannot admit rejected; retain those predicates. At shared manufacturer and painter placement choke points explicitly require not rejected in the conditional write even on force/manual paths. Workshop `batchOrderFilter` already excludes rejected: retain and test.
- Inventory all reachable forward writes/worker accrual paths with the rejected-but-succeeded fixture; add the minimal status guard where absent (admin force/approval/self-print/ship, manufacturer ship/handoff, painter receive/QC/ship, batch and SLA paths). Do NOT broaden `notRefundedGuard` itself to secretly mean “not rejected”: cleanup/refusal semantics and tests rely on its exact name/meaning. A newly required guard cannot be omitted merely to keep a static pin green.
- Cancellation and full return win against late accrual because both serialize on the order; if accrual wins first, cancellation reverses the now-visible pending original in the same gated tx. If settlement wins first, retain paid record and report retained cost. Re-discovery/revalidation prevents missing newly created earning owners.


## First-release caller coverage (required, not optional polish)

- **Admin refund:** GET preview/history + POST evidence; old reason-only request refuses. Same key retry safe, stale fingerprint409. Unknown read disables form; no zero fallback.
- **Admin reject:** preserve rejectable statuses, delegate to cancellation record+financial tx; status rejected, cash remains succeeded/due, pending originals reversed, paid retained. No old paymentStatus flip, full gift call or refund-success mail.
- **Workshop session/participant cancellation:** replace misleading refunded boolean/list with `{cancelled,refundRequiredOrders:[{orderId,orderNumber,fullName,cashRemainingKurus:number|null,giftRemainingKurus:number|null,legacyUnverified}],actualGiftReturnedKurus,alreadyCancelled,alreadyShipped,failed}`. Return current outstanding obligations on retries, not only first-call deltas. Preserve existing shipped refusal and seat release once. Paid participant seat mutation joins tx through narrow seat-helper adapter; acquire no workshop lock before entering partner-money coordinator. Bulk remains per-participant atomic and reports failures; session cancellation does not assert all money returned. Unpaid expiry stays existing draft/seat flow; never say “no collection” for known late/ambiguous receipt.
- **Emails/templates:** three separate meanings: no recorded collection, cancelled/cash pending with any actual gift amount, and actual confirmed cash/gift return. No bank-arrival prediction for gift-only/pending cash. Capture partner recipient before detach. Cancellation plus embedded gift return produces one combined notice; later actual cash return gets a new notice.
- **Order-money/customer/admin view:** original sale remains; cash-return total, gift-return total, cash still due, legacy unknown, retained paid/independent costs shown separately. No gross amount repeatedly reported as actual cash. Partial succeeded status must not hide refund history. Admin UI transfer action needs explicit confirmation, preserves retry UUID and disables stale snapshot.

### Dispute follow-up

Deferred entirely to the next slice. No dispute fields or schema edits in 0061.

## Email delivery: narrow record flags, existing queue

Add `refund_record_email {refundId}` and `refund_record_email_recover` typed branches to existing EmailJobData/email.worker. Existing workers/start registers recovery scheduler on **existing email queue**. No new notice table or queue platform.

- Insert complete email intent on refund/cancellation record in the money transaction. Insert existing in-app notification rows in that SAME transaction, stable ID per operation/recipient/event. Do not call best-effort `notifyCustomer` wrapper there. Realtime emit after commit optional.
- After commit enqueue stable job ID `refund-email-<uuid>` (no colon). Recovery scans pending/due and expired leases, reconciles absent/completed/failed BullMQ jobs and retries unsent work. Queue outage cannot lose intent or turn committed money into a misleading failed operation.
- Acquire record delivery lease with conditional update, commit lease, send each recipient message via existing email service, persist per-message accepted progress. Complete only after all recipients accepted. Retry skips progress already recorded. Do not hold money locks while sending.
- Crash after provider accepted but before progress update can duplicate that email. At-least-once is explicit; stable job ID is not provider exactly-once. Provider failure remains pending/error, not “sent”; admin can retry notification without replaying money. Lease timeout/worker restart recovery required. Queue retention/removal cannot erase DB intent.
- Evidence-only record: not_required, no fresh refund notification. UI separates “refund recorded” and “email pending/failed”. Existing direct sends for same mutation must be removed.
- Analytics: operation/allocation event ID, not `refund:<orderNumber>`. Preserve existing gross purchase basis with cumulative proportional gross-equivalent and final rounding remainder, not full gross on each partial. Add bounded analyticsPending/recorded flag to header if durable retry needed; no generic outbox. Honor stored consent. Legacy evidence/missing purchase basis emits no invented event. Operational cash/gift amounts are independent of GA projection.

## Exact implementation/test sequence

1. **Pure policy + schema contract:** new `scripts/test-order-refund-policy.ts`; 10,000 consideration=8,000cash+2,000gift; partial3,000cash leaves5,000/2,000; final5,000/2,000 closes; gift over-return refuses; discount excluded; safe rounding; old full marker counted once. Migration QA up/down/up and populated refusal.
2. **Tx internals:** extract existing pending reversal unchanged; `gift-credit-return.ts`; migrate old full wrappers to residual calculation. `scripts/test-refund-financial-effects-db.ts`: paid/netting immutable, independent credit intact, source debit release/batch recompute unchanged, original live pending reconciliation unchanged, cancelled/succeeded cannot re-accrue.
3. **Refund API + cancellation adapters:** `scripts/test-order-refund-db.ts` and `scripts/test-cancellation-refund-db.ts`: actual date/ref/confirm validation, stale/replay/conflict, same transfer split across children, concurrent sibling over-cap, changed owner during discovery, failure after header/allocation/balance/reversal writes leaves everything unchanged. Rejection/workshop paid cancellation stops work but does not claim cash return. Register tests through main owner.
4. **Notices/UI:** `scripts/test-refund-notices.ts` with fake email/queue; DB commit then queue outage; sent-but-unstamped crash; lease recovery; no duplicated money. Main browser: cancellation cash due, partial/full, cart/gift, stale form/retry one row, evidence-only no balance movement, paid retained. No real external emails/PayTR/bank/analytics.
5. **Release gate:** scope lint/typecheck + existing 6b reconciliation/adjustment/void/reclaim/netting and global API/Turkish/static checks. No scanner weakening. Main owns build/deploy timing. Only QA DB55433, exact fixtures/jobs teardown; no production/user DB or process control.

### Required gift cases shared with Sartre

- Two funded children + zero-gift child: preserve stored shares; no new refund-time allocation. Count1 before; count1 after primary full return while sibling live; count0 only after last residual complete.
- Partial return then legacy full adapter restores residual only; concurrent partial/full cannot exceed original redemption; same key adds nothing.
- Different checkouts on same card remain separate usage; null-draft fallback conservative. Card owner/redeemer distinction preserved.
- Rollback after return evidence insert/card update restores all financial rows and markers. Expiry vs promotion produces one outcome; confirmed child's balance never released by draft expiry.
- Known historical tender/redemption inconsistency ->reconciliation refusal; marker-only old return never credited again.

## Remaining real restrictions / explicit non-goals

- Recorded original tender is not provider settlement verification. Current OID overwrite and received-amount mismatch logging remain limitations, not invented receipts. Ambiguous source blocked; full attempt-history/late collection reconciliation is later work.
- Legacy refunded scopes remain blocked for new balance movements; evidence annotation cannot establish unknown baseline by assumption.
- Wrong recorded refund evidence has no destructive correction endpoint in this increment. Preserve audit and require a subsequent reconciliation design.
- External email exactly-once unavailable; at-least-once retry can duplicate after provider success/DB crash. Financial/in-app transaction remains atomic.
- No parcel recall: preserve shipped/delivered evidence; logical full refund blocks future work only. Workshop shipped restrictions unchanged.
- No proportional partner debit on partial refund; separate approved 6b adjustment. No altering paid payouts/netting or stripping independent credits; no disabling accepted automatic pending reconciliation.
- No tax credit-note provider, extra collection links, full dispute-management redesign or all-roadmap migration. Core 0061 can start independently of thin dispute follow-up.

**Checkpoint status:** implementation and verification in progress. Core, gift, cancellation, notices, analytics and admin UI implemented. Isolated database and browser checks passed; final repository gates and deployment are recorded in the implementation ledger. Dispute integration remains a separate follow-up.
