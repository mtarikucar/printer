# Phase 6d — Dispute decisions implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Main owns integration and deployment.

**Goal:** Commit a dispute decision and optional actual refund atomically, notify the customer/admin, and retain visible history.

**Architecture:** Extend existing disputes with scoped idempotency and notification state. Reuse the 6c money coordinator and existing email queue.

**Tech Stack:** Next.js, TypeScript, Drizzle/PostgreSQL, BullMQ, Turkish UI.

**Spec:** approved Phase6 money plan Slice5 and Phase6c refund semantics.

**Authorization:** Owner approved all roadmap decisions and instructed uninterrupted implementation/deployment. 6c commit9278263 is pushed; verify its deployment before releasing6d. Shared working tree with file-disjoint ownership is retained. Basis: Phase 6 money plan Slice 5, overridden by the implemented 6c refund semantics. Scope: resolve/reject, optional actual refund atomically, customer decision notice, closed history. No ledger/outbox platform, payment attempts, contracts, new conduct/adjustment actions, reopening or destructive corrections.

## 1. Schema: reversible 0062, existing disputes only

Reuse `status`, `resolution`, `adminEmail`, `resolvedAt`. Add **fourteen columns**, no table/enum:

| Column | Type/default |
|---|---|
| decision_operation_key | nullable UUID, UNIQUE when nonnull |
| decision_request_hash | nullable text |
| refund_record_id | nullable UUID, UNIQUE when nonnull; FK order_refund_records(id), DELETE RESTRICT |
| decision_snapshot | nullable JSONB; immutable versioned receipt |
| decision_email_payload | JSONB NOT NULL DEFAULT '{}' |
| decision_email_progress | JSONB NOT NULL DEFAULT '{}' |
| decision_email_state | checked text DEFAULT 'not_required': pending/delivering/delivered/not_required |
| decision_email_next_attempt_at | nullable timestamptz |
| decision_email_lease_until | nullable timestamptz |
| opening_email_payload | JSONB NOT NULL DEFAULT '{}' |
| opening_email_progress | JSONB NOT NULL DEFAULT '{}' |
| opening_email_state | checked text DEFAULT 'not_required': pending/delivering/delivered/not_required |
| opening_email_next_attempt_at | nullable timestamptz |
| opening_email_lease_until | nullable timestamptz |

Checks: new key/hash/snapshot appear together and require closed status, resolution, actor and resolvedAt; refund association requires resolved status. JSON fields are objects. Empty email payload requires not_required, empty progress and null lease/retry. Keyless historical rows retain empty new fields. Service verifies linked header kind=refund, matching operation/scope and allocation; no cross-row CHECK. Index delivery(state,nextAttemptAt,id) and history(status,resolvedAt,id). Opening and decision delivery have independent leases/progress. Opening payload is written once with the new complaint and snapshots required ADMIN_EMAIL. No opening intent is backfilled for old complaints. Opening intent may remain pending after a decision closes the row. Only delivery fields remain mutable after a decision. Add a separate opening due index; every used opening field also blocks down.

Files: `0062_dispute_decisions.sql` + `.down.sql`, schema/snapshot/journal. Up is additive/idempotent where practical; no historical refund/notice backfill. Down locks disputes with bounded timeout, atomically refuses **any used new field**, including decision-only/delivered history. Unused down drops only owned indexes/constraints/columns and exact 0062 journal timestamp; tolerates partial schema/repetition. Never delete disputes/refunds to permit rollback. No new open-dispute uniqueness index over unknown historical duplicates.

## 2. Exact public interface and private composition

Pure types in `config/dispute-resolution.ts`; service facade in `services/dispute-resolution.ts`:

```ts
type ResolveDisputeInput = {
  disputeId: string; operationKey: string;
  expectedDecisionFingerprint: string;
  action: 'resolve' | 'reject';
  resolution: string; // trimmed 10–2000 characters
  refund?: Omit<RecordRefundInput, 'operationKey' | 'mode'>;
};
type DisputeDecisionResult = {
  ok: true; disputeId: string; orderId: string; operationKey: string;
  status: 'resolved' | 'rejected'; resolution: string; resolvedAt: string;
  replayed: boolean; refund: RefundResult | null;
  decisionNotificationState: RefundNotificationState;
};
resolveDispute(input: ResolveDisputeInput, actor: RefundActor):
  Promise<DisputeDecisionResult | DisputeDecisionFailure>;
```

Failure reuses RefundFailure with additional `already_closed`. Strict unknown-key/UUID/fingerprint validation; reject+refund and old `clawback` payloads refuse. Normalize optional refund through existing policy with parent operationKey and forced mode=actual; retain its existing refund-reason limit. First consumer permits exactly one allocation matching the dispute order; 6c still locks/checks all payment siblings.

Add narrow export `recordDisputeDecisionWithRefund(input, actor)` **inside order-refund-record.ts**, called by the facade. It owns composition; no circular import. Split existing private coordinator into `withLockedPaymentScope(orderId, callback)` plus its existing `coordinated` wrapper, which still calls loadContext for current 6c callers. Both callback runner and branded contexts stay private. No exported context factory, arbitrary transaction hook, nested public refund call or second money implementation.

Reason: today loadContext locks gift rows before the coordinator callback. Dispute composition must lock its dispute **before** loading financial context. Decision-only bypasses loadContext entirely, allowing adjudication despite unknown tender.

## 3. Lock, replay and commit rules

1. Discover dispute order, scope/siblings, assignments and historical earning owners unlocked.
2. Transaction timeout5s; sorted normalized partner gates → payment advisory gate → draft → sibling orders ascending UUID. Existing changed-set rollback/rediscovery stays capped at three; never acquire late partner gates.
3. Lock dispute FOR UPDATE; revalidate order anchor. Changed anchor refuses stale. Check decision operation-key ownership and canonical hash **before** closed-status/fingerprint checks. Same key/hash replays immutable receipt; changed payload/actor conflicts. Different-key closed or legacy-closed decision returns already_closed.
4. Check decision fingerprint. Optional refund loads the private refund context, validates the independent financial fingerprint/evidence and invokes recordOrderRefundTx. Keep existing card→redemption and gated reversal internals. Dispute user must match order user. Refuse a pre-existing refund header using this key: do not adopt an unrelated already-committed refund. Include private dispute origin in the refund hash without changing standalone retry hashes.
5. Guarded open→closed update stores receipt/refund FK/customer intent; insert stable customerNotifications row in the same transaction. Any requested refund or decision/notice write failure rolls everything back. Decision-only never changes fulfillment, earnings or balances; partial/full effects remain exactly 6c.
6. After commit: kick decision email, refund partner email and analytics, and call **publishRefundRecordChanges(refundId)** for an optional refund. Use persisted pre-detach allocation identities/current orders. These best-effort hooks never change financial success into failure; decision replay may re-kick them without repeating money.

Hash includes dispute/order, action, resolution, normalized refund intent and actor; excludes both fingerprints/delivery progress. Unique-key races roll back then inspect committed ownership. Busy preserves the browser UUID.

## 4. Customer notice and bounded UI

Use private dispute-origin notice ownership in recordOrderRefundTx: suppress only its generic customer refund email/in-app message; retain partner notices, analytics and realtime. Snapshot that ownership in refund evidence. Decision row owns one combined customer message; stable ID derives from operation+dispute+complainant. Capture complaint-owner recipient and actual refund amounts inside the transaction. Decision-only copy says “Bu kararla yeni iade kaydı oluşturulmadı”; rejection does not mean order cancellation. No arrival promises.

Add dispute_email {disputeId, phase: opening|decision} and recovery jobs on the existing email queue. Record-local lease/progress follows 6c; no generic outbox. Recovery preserves intent after queue loss; provider-success/checkpoint crash may resend email, never money.

Existing resolve route becomes strict authenticated adapter plus GET preview: dispute, decision fingerprint and nullable refund preview. Optional-money read failure disables only refund entry. URL open/resolved/rejected tabs show resolution/time/linked actual amounts and orderId links; retain honest degraded reads/legacy unknowns. Remove coupled clawback/strike. Reuse evidence form with a **combined** submit, preserving intent across lost response/auth/busy/conflict. Serialize customer open check+insert on its owned order; leave old duplicates intact. Opening-admin email IS included, as requested in Slice5: new complaint and its admin-email intent commit together; concurrent matching retries return the existing open complaint and never send twice. A different open complaint is a Turkish409. Legacy duplicate rows remain untouched.

## 5. Proposed owners and proof

| Owner lane | Files |
|---|---|
| Main | pure dispute config; admin resolve route; admin disputes page/client; customer dispute route/component; minimal refund-form reuse |
| Schema worker | 0062 up/down, schema, snapshot/journal, migration tests |
| Backend worker | order-refund-record.ts private split/narrow command; new dispute-resolution.ts; policy/DB tests |
| Boyle / notices | dispute-notices.ts; existing email queue/worker/scheduler/templates; notice tests |

Main assigns workers before implementation; one owner per shared file.

**Release proofs:** reversible up→down→up/repetition and populated refusal; unknown-tender decision-only; partial/full refund; reject+refund/invalid evidence leaves dispute open; injected failures after refund/gift/reversal/decision/notice roll back everything; paid/netted originals and independent credits unchanged; same-key replay/conflict and resolve-versus-reject race; owner rediscovery/busy→same-key retry; duplicate customer opens; one combined customer notice with correct partner audience; queue/provider crash recovery; persisted-identity realtime after full detach; closed/legacy/degraded UI and dropped-success replay. Run current 6c/6b regression suites on isolated QA55433 with fake external boundaries. Main owns registration/build/release; none run by this proposal.


## 6. Frozen consumer contracts and tasks

### Main — strict pure contract/API and release
- [x] Add config/dispute-resolution.ts with ResolveDisputeInput, DisputeDecisionResult/Failure/View; code already_closed, RefundFailure subset, strict normalizeResolveDisputeInput, DisputePolicyError. Test reason10..2000, unknown keys/clawback/reject+refund, valid one-order actual payload, replay hash excludes previews. Actual refund normalization remains the single existing helper.
- [x] GET/POST api/admin/disputes/[id]/resolve adapters authenticate, UUID404, return Turkish typed JSON. Body identity must equal route identity, never silently overwritten.
- [ ] Register scripts and review all lanes. Only QA PG55433/Redis56380, fake providers. Run migration roundtrip, old6c/6b regressions, full unit/type/build/lint and browser lost-response/atomicrefund tests. Main commits/pushes with useridentity/no markers and verifies exactSHA deployment.

### Backend — coordinator and complaint service
- [x] Implement services/dispute-resolution.ts (readDisputeDecisionView, resolveDispute, openDispute) and narrow composition in order-refund-record.ts. Keep private brands; no exported arbitrary money callback.
- [x] openDispute(orderNumber,userId,{category,description}) locks owned order, checks shipped/delivered, checks current open complaint, inserts exactly one with opening payload and pending state. Existing identical open complaint replays; changed complaint409. Return {ok:true,disputeId,replayed} or typed failure. Customer route remains a thin adapter.
- [x] Decision-only must work with unknown tender; optional refund failure leaves complaint open and no money effects. Validate locked complainant matches order owner before choosing recipients. Root operationUUID is refundUUID; never adopt unrelated prior refund. Keep standalone6c hash identical.
- [x] Customer decision notification replaces only generic customer refund notice; full refund partner notices remain. Internal origin passed through a private implementation, not a client option or public suppression flag.
- [x] Existing 6c wrappers retain behavior; postcommithooks always independent from emailstate. Test DB failure at each decision/refund/gift/notice write, shared payment concurrency, actor/key conflict, legacyclosed, unknown tender, paid retention, onecustomer notice and duplicate opens.

### Schema —0062 owner only
- [x] Add exactly named fourteen fields/constraints/indexes, up/down/snapshot/journal; verify empty/repeated/partialschema up/down/up, populated decision OR opening refusal preserving old dispute/order/refund data. Do not add a UNIQUE open-order index over legacy duplicates. Update0055 down documentation for newest timestamp; no other historical migration logic.

### Notices — dispute-specific delivery
- [x] services/dispute-notices.ts exports kickDisputeNotices(disputeId,phase), deliverDisputeNotices(disputeId,phase), recoverDisputeNotices(). Phase is opening|decision. Email queue jobs are dispute_email and dispute_email_recover. No new queue or generic outbox.
- [x] Versioned payload {version:1,messages:[{key,to,kind:'opening'|'decision',disputeId,orderNumber,customerName,category,description?,resolution?,decision?:'resolved'|'rejected',cashKurus?,giftKurus?}]}. Snapshot required ADMIN_EMAIL for opening; decision recipient is locked complaint owner. Backend and noticeowner coordinate exact exported type before writes.
- [x] Independent fenced leases/progress for each phase; retry acceptance checkpoints, failed destination stays pending, corrupt evidence never reset. Actual amounts only, decision-only explicitly no new refund, reject not an order cancellation. Inapp decision notice in the financial tx; realtime best-effort aftercommit, no inbox recreation in worker.

### UI owner — shared evidence fields and history
- [x] Extract only controlled input fields from OrderRefundCard into components/admin/refund-entry-fields.tsx, preserving old6c behavior. Export RefundEntryValues, emptyRefundEntry(), buildRefundEntryInput(orderId,view,values,operationKey,mode) and RefundEntryFields. Values fields: amounts:Record<string,{cash:string;gift:string}>, reason, reference, occurredAt, confirmed. Fields props: orderId,view,values,onChange,mode,disabled?,singleOrderOnly?. No networking or persisted intent inside fields.
- [x] Old OrderRefundCard retains its API/pendingUUID/confirmation and composes shared fields. New admin disputes client uses fields in mode actual with singleOrderOnly and one combined submit; never POST refund separately. Preserve root command in sessionStorage through lost response/auth/busy. Decision-only has no refund payload. Refunded/unknown preview disables only optional refund, not decision.
- [x] Main-defined DisputeDecisionView: dispute {id,orderId,orderNumber:string|null,category,description,status,resolution:string|null,resolvedAt:string|null,decisionOperationKey:string|null,refundRecordId:string|null}; expectedDecisionFingerprint:string; refundView:OrderRefundView|null; refundReadUnavailable?:string.
- [x] URL status tabs open/resolved/rejected; Turkish categorylabels, linked orderId, resolution/date/actualrefund summary. Closed legacy rows never claim a known refund. Preserve honest readfailure banners. Show any stored pending command even after a filter/reload moves its row out of the current list. Customer latest-dispute widget shows resolutiondate and actualamount without leaking adminemail/reference.
- [x] Customer GET/POST API ownership remains auth-session based. Backend openDispute owns mutation; customer component must not hide read failure as no dispute.

**Global constraints:** no live provider calls; no user PG5432/Redis6379; no process control/build/commit by subagents; main QA server3174 only. Worker graph no server-only, client graph no DB values. No unrelated financial/contract/payment-attempt changes. Existing all-phase authorization persists; routine implementation decisions do not reopen approval.

## Release evidence — 2026-09-17

Implementation complete. Main verified: 89-script unit chain exit0, whole-project typecheck exit0, production build exit0, full lint0errors (70 existing warnings), migration90 checks, transactional decision18 + independent23 checks, existing refund20 DB checks, notice14 + refundnotice22 + analytics16 checks. Final UI52 tests and independent malformed-receipt review passed. Browser10 includes malformed combined success retaining intent across reload/busy retry, single actual refund, preserved paid earning, customer decision/read-outage recovery, unknown tender, reject semantics and paginated legacy history. All QA fixtures/jobs removed. Exact-SHA deployment remains the unchecked release step above.
