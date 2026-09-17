/** Isolated QA only. Exact scratch schema up/down; no runtime rows or queues touched. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

pg.types.setTypeParser(1114, (value) => new Date(`${value}Z`));

const raw = process.env.QA_DRAFT_DB_URL;
if (!raw) throw new Error("QA_DRAFT_DB_URL is required (isolated Postgres :55433 only)");
const url = new URL(raw);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only isolated printer_qa on localhost:55433 is allowed");
const schema = `draft_admin_test_${Date.now()}`;
const admin = new pg.Client({ connectionString: raw });
let checks = 0;
const check = (label: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, label); checks++; console.log(`ok ${label}`); };
const barrier = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

async function main() {
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    // Clone definitions, not data; LIKE does not copy foreign keys. The exact
    // schema is dropped in finally even if an assertion or connection fails.
    for (const table of ["order_drafts", "orders", "workshop_participants", "order_items"]) {
      await admin.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    await admin.query(`CREATE TABLE ${schema}.admin_draft_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL, action text NOT NULL,
      admin_email text NOT NULL, reason text NOT NULL, before jsonb NOT NULL, after jsonb NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT valid_action CHECK(action IN ('edit','extend','cancel','resend'))
    )`);
    url.searchParams.set("options", `-c search_path=${schema}`);
    url.searchParams.set("application_name", schema);
    process.env.DATABASE_URL = url.toString();
    process.env.REDIS_URL = "redis://127.0.0.1:56380/15";
    const { applyDraftAction } = await import("../src/app/api/admin/drafts/[id]/_actions");
    const { expireDraftAtCurrentDeadline } = await import("../src/lib/queue/workers/payment-deadline.worker");
    const { db } = await import("../src/lib/db");
    const waitForLock = async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await admin.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema]);
        if (result.rowCount) { checks++; return; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("Expected an actual PostgreSQL lock wait, not merely two sequential calls");
    };
    const row = async (id: string) => (await admin.query(`SELECT * FROM ${schema}.order_drafts WHERE id=$1`, [id])).rows[0];
    const seed = async () => {
      const id = randomUUID();
      await admin.query(`INSERT INTO ${schema}.order_drafts
        (id,reference,user_id,email,customer_name,shipping_address,amount_kurus,payment_method,order_type,attribution_channel,selected_addons,production_base_kurus,finish,bank_transfer_deadline)
        VALUES ($1,$2,$3,'draft-test@example.invalid','Test','{}',10000,'bank_transfer','marketplace','whatsapp',$4,10000,'raw',now() - interval '1 hour')`,
      [id, `FIG-TEST-${id}`, randomUUID(), JSON.stringify([{ name: "Baskı", kind: "production", priceKurus: 10000 }])]);
      return id;
    };
    const version = async (id: string) => (await row(id)).updated_at.toISOString();
    const edit = async (id: string) => ({ action: "edit" as const, expectedUpdatedAt: await version(id), reason: "Müşteri fiyat anlaşması", lines: [{ description: "Baskı", quantity: 2, unitPrice: "100,25", kind: "production" as const }, { description: "Boyama", quantity: 1, unitPrice: "50", kind: "painting" as const }] });
    const refuse = async (fn: () => Promise<unknown>, pattern: RegExp) => { await assert.rejects(fn, pattern); checks++; };
    try {
      let id = await seed();
      await admin.query(`UPDATE ${schema}.order_drafts SET preliminary_info_accepted_at=now(), preliminary_info_version='old', distance_contract_version='old' WHERE id=$1`, [id]);
      let input = await edit(id);
      await applyDraftAction(id, input, "admin@example.invalid");
      const d = await row(id);
      check("old commercial consent cleared", [d.preliminary_info_accepted_at, d.preliminary_info_version, d.distance_contract_version], [null, null, null]);
      const audit = (await admin.query(`SELECT * FROM ${schema}.admin_draft_actions WHERE draft_id=$1`, [id])).rows[0];
      check("durable actor and change snapshot", [audit.admin_email, audit.before.amountKurus, audit.after.amountKurus], ["admin@example.invalid", 10000, 25050]);
      assert.match(audit.before.preliminaryInfoAcceptedAt, /Z$/); checks++;
      check("edit derives total and both bases", [d.amount_kurus, d.production_base_kurus, d.painting_price_kurus, d.needs_painting], [25050, 20050, 5000, true]);
      await refuse(() => applyDraftAction(id, input, "admin@example.invalid"), /başka bir işlem/);
      input = await edit(id);
      await refuse(() => applyDraftAction(id, { ...input, lines: [{ ...input.lines[0], unitPrice: "1.2345" }] }, "admin@example.invalid"), /bilgileri geçersiz/);
      check("invalid edit unchanged", (await row(id)).amount_kurus, 25050);
      for (const change of ["status='confirmed'", "status='awaiting_review'", "paytr_merchant_oid='attempt'", "bank_transfer_receipt_key='receipt'", "gift_card_amount_kurus=100", "payment_method='card'", "promoted_order_id='00000000-0000-0000-0000-000000000001'"]) {
        id = await seed(); await admin.query(`UPDATE ${schema}.order_drafts SET ${change} WHERE id=$1`, [id]);
        await refuse(async () => applyDraftAction(id, await edit(id), "admin@example.invalid"), /./);
        check(`refusal preserves price: ${change}`, (await row(id)).amount_kurus, 10000);
      }
      id = await seed();
      await applyDraftAction(id, { action: "cancel", reason: "Müşteri vazgeçti", expectedUpdatedAt: await version(id) }, "admin@example.invalid");
      check("cancel terminal", (await row(id)).status, "cancelled");
      await refuse(async () => applyDraftAction(id, await edit(id), "admin@example.invalid"), /ödenmemiş/);
      id = await seed();
      await admin.query(`ALTER TABLE ${schema}.admin_draft_actions RENAME TO audit_unavailable`);
      try { await refuse(async () => applyDraftAction(id, await edit(id), "admin@example.invalid"), /relation|query|exist/i); }
      finally { await admin.query(`ALTER TABLE ${schema}.audit_unavailable RENAME TO admin_draft_actions`); }
      check("audit failure rolls price back", (await row(id)).amount_kurus, 10000);
      id = await seed();
      const resend = { action: "resend" as const, reason: "Müşteri bağlantı istedi", expectedUpdatedAt: await version(id) };
      await refuse(() => applyDraftAction(id, resend, "admin@example.invalid", async () => { throw new Error("injected email failure"); }), /kuyruğuna alınamadı/);
      check("failed email rolls audit back", (await admin.query(`SELECT count(*)::int AS n FROM ${schema}.admin_draft_actions WHERE draft_id=$1`, [id])).rows[0].n, 0);
      let queued = 0;
      const sent = await applyDraftAction(id, resend, "admin@example.invalid", async (mail) => { queued++; assert.match(mail.customBody ?? "", /\/pay\/FIG-TEST/); });
      check("email retry queued once", queued, 1);
      assert.match(sent.message, /teslim henüz doğrulanmadı/); checks++;
      const deadline = new Date(Date.now() + 86400_000).toISOString();
      const extend = { action: "extend" as const, reason: "Müşteri süre istedi", deadline, expectedUpdatedAt: await version(id) };
      const oldDeadline = (await row(id)).bank_transfer_deadline;
      await refuse(() => applyDraftAction(id, extend, "admin@example.invalid", undefined, async () => { throw new Error("queue down"); }), /son tarih değiştirilmedi/);
      check("failed scheduling rolls back date", (await row(id)).bank_transfer_deadline, oldDeadline);
      await admin.query(`ALTER TABLE ${schema}.admin_draft_actions RENAME TO audit_unavailable`);
      let orphanQueued = false;
      try { await refuse(() => applyDraftAction(id, extend, "admin@example.invalid", undefined, async () => { orphanQueued = true; }), /relation|query|exist/i); }
      finally { await admin.query(`ALTER TABLE ${schema}.audit_unavailable RENAME TO admin_draft_actions`); }
      check("queue accepted before audit rollback", orphanQueued, true);
      check("audit rollback leaves old date", (await row(id)).bank_transfer_deadline, oldDeadline);
      check("orphan deadline job cannot expire rollback", await expireDraftAtCurrentDeadline(id, async () => { throw new Error("orphan must not expire"); }, deadline), "superseded");
      let scheduled = 0;
      await applyDraftAction(id, extend, "admin@example.invalid", undefined, async () => { scheduled++; });
      check("extension schedules once", scheduled, 1);
      check("deadline persisted", (await row(id)).bank_transfer_deadline.toISOString(), deadline);
      let expired = 0;
      check("old queued job ignores extended draft", await expireDraftAtCurrentDeadline(id, async () => { expired++; }), "extended");
      check("expiry service not called for future date", expired, 0);

      // Promotion holds exactly the same row lock as the production service.
      // The waiting admin edit MUST reread the committed terminal state.
      id = await seed(); input = await edit(id);
      const promotion = new pg.Client({ connectionString: url.toString() }); await promotion.connect();
      try {
        await promotion.query("BEGIN");
        await promotion.query("SELECT id FROM order_drafts WHERE id=$1 FOR UPDATE", [id]);
        const waiting = applyDraftAction(id, input, "admin@example.invalid");
        const rejection = assert.rejects(waiting, /ödenmemiş/);
        await waitForLock();
        await promotion.query("UPDATE order_drafts SET status='confirmed', promoted_order_id=$2 WHERE id=$1", [id, randomUUID()]);
        await promotion.query("COMMIT");
        await rejection; checks++;
        check("promotion wins: price unchanged", (await row(id)).amount_kurus, 10000);
      } finally { await promotion.query("ROLLBACK"); await promotion.end(); }

      // Admin extension wins; old active job starts during the scheduling
      // callback, must wait and then see the future deadline after commit.
      id = await seed();
      const entered = barrier(); const finish = barrier();
      const extension = applyDraftAction(id, { ...extend, expectedUpdatedAt: await version(id) }, "admin@example.invalid", undefined,
        async () => { entered.release(); await finish.promise; });
      await entered.promise;
      const expiry = expireDraftAtCurrentDeadline(id, async () => { expired++; });
      await waitForLock();
      finish.release(); await extension;
      check("concurrent old expiry waits for extension", await expiry, "extended");
      check("concurrent expiry made no call", expired, 0);

      // Expiry wins: while its inner row transition runs, extension must not
      // slip between the worker's deadline reread and expireDraft's lock.
      id = await seed(); const extInput = { ...extend, expectedUpdatedAt: await version(id) };
      const expiryEntered = barrier(); const expiryFinish = barrier();
      const expiring = expireDraftAtCurrentDeadline(id, async (draftId) => {
        expiryEntered.release(); await expiryFinish.promise;
        await admin.query(`UPDATE ${schema}.order_drafts SET status='expired' WHERE id=$1 AND status='pending'`, [draftId]);
      });
      await expiryEntered.promise;
      const blocked = assert.rejects(applyDraftAction(id, extInput, "admin@example.invalid", undefined, async () => {}), /ödenmemiş/);
      await waitForLock();
      expiryFinish.release(); await expiring; await blocked; checks++;
      check("expiry wins: remains expired", (await row(id)).status, "expired");
      check("terminal worker no-op", await expireDraftAtCurrentDeadline(id, async () => { throw new Error("must not run"); }), "closed");
    } finally {
      await (db as unknown as { $client: pg.Pool }).$client.end();
    }
  } finally {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
  console.log(`${checks} checks passed; scratch schema removed`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
