/** QA :55433 only; real consent/edit/promotion SQL, external effects stubbed. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import pg from "pg";

pg.types.setTypeParser(1114, (value) => new Date(`${value}Z`));
const raw = process.env.QA_DRAFT_DB_URL;
if (!raw) throw new Error("QA_DRAFT_DB_URL is required");
const url = new URL(raw);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.port !== "55433" || url.pathname !== "/printer_qa") throw new Error("Only isolated printer_qa at localhost:55433 is allowed");
const scratch = `draft_consent_test_${Date.now()}`;
const admin = new pg.Client({ connectionString: raw });
const require = createRequire(import.meta.url);
const originals = new Map<string, NodeJS.Module | undefined>();
let checks = 0;
const check = (name: string, actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected, name); checks++; console.log(`ok ${name}`); };
function stub(path: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(path);
  originals.set(resolved, require.cache[resolved]);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeJS.Module;
}
async function main() {
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${scratch}`);
    for (const table of ["order_drafts", "orders", "order_items", "gift_card_redemptions", "workshop_participants", "admin_draft_actions"]) {
      await admin.query(`CREATE TABLE ${scratch}.${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
    }
    url.searchParams.set("options", `-c search_path=${scratch}`);
    url.searchParams.set("application_name", scratch);
    process.env.DATABASE_URL = url.toString();
    // Replace only effects AFTER promotion's commit. No actual email, queue,
    // analytics or realtime send is made; promotion itself is the real code.
    let fulfilled = 0;
    stub("../src/lib/services/order-confirm", { kickOffMarketplaceOrder: async () => { fulfilled++; }, kickOffOrderProcessing: async () => { throw new Error("unexpected custom processing"); } });
    stub("../src/lib/realtime/emit", { emitOrderChanged: async () => {} });
    stub("../src/lib/realtime/bus", { publishRealtime: async () => {} });
    stub("../src/lib/analytics/server", { recordPurchase: async () => {} });
    stub("../src/lib/queue/queues", { getPaymentDeadlineQueue: () => ({ remove: async () => {} }), havaleExpireJobId: (id: string) => id, havaleReminderJobId: (id: string) => id, cardExpireJobId: (id: string) => id });
    const { db } = await import("../src/lib/db");
    const { orderDrafts } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { recordDraftCommercialConsent, draftCommercialFingerprint, DraftConsentRequiredError, DraftConsentInputError, DraftPaymentEvidenceChangedError } = await import("../src/lib/services/draft-commercial-consent");
    const { applyDraftAction } = await import("../src/app/api/admin/drafts/[id]/_actions");
    const { promoteDraftToOrder } = await import("../src/lib/services/order-draft");
    const load = async (id: string) => (await db.select().from(orderDrafts).where(eq(orderDrafts.id, id)))[0];
    const seed = async () => {
      const id = randomUUID();
      await admin.query(`INSERT INTO ${scratch}.order_drafts
        (id, reference, user_id, email, customer_name, shipping_address, payment_method, order_type, attribution_channel, amount_kurus, production_base_kurus, selected_addons, finish)
        VALUES ($1,$2,$3,'consent@example.invalid','Test','{}','bank_transfer','marketplace','whatsapp',10000,10000,$4,'raw')`,
      [id, `FIG-CONSENT-${id}`, randomUUID(), JSON.stringify([{ name: "Baskı", priceKurus: 10000, kind: "production" }])]);
      return id;
    };
    const consent = async (draft: Awaited<ReturnType<typeof load>>, fingerprint = draftCommercialFingerprint(draft)) => recordDraftCommercialConsent({ reference: draft.reference, fingerprint, ip: "127.0.0.1", userAgent: "isolated-test" });
    const edit = async (id: string) => applyDraftAction(id, { action: "edit", expectedUpdatedAt: (await load(id)).updatedAt.toISOString(), reason: "Müşteri fiyat düzeltmesi", lines: [{ description: "Yeni baskı", unitPrice: "150", quantity: 1, kind: "production" }] }, "admin@example.invalid");
    try {
      let id = await seed();
      const original = await load(id);
      const staleToken = draftCommercialFingerprint(original);
      await edit(id);
      await assert.rejects(() => consent(original, staleToken), (e: unknown) => e instanceof DraftConsentInputError && e.status === 409); checks++;
      let current = await load(id);
      check("stale page records neither stamp", [current.contentConsentAt, current.preliminaryInfoAcceptedAt], [null, null]);
      await assert.rejects(() => promoteDraftToOrder(id), DraftConsentRequiredError); checks++;
      check("unconsented promotion inserts nothing", (await admin.query(`SELECT count(*)::int AS n FROM ${scratch}.orders WHERE draft_id=$1`, [id])).rows[0].n, 0);
      const freshToken = draftCommercialFingerprint(current);
      await consent(current);
      current = await load(id);
      assert.ok(current.contentConsentAt && current.preliminaryInfoAcceptedAt); checks++;
      check("both stamps written together", current.contentConsentAt, current.preliminaryInfoAcceptedAt);
      check("commercial version recorded", typeof current.preliminaryInfoVersion, "string");
      check("consent does not change commercial token", draftCommercialFingerprint(current), freshToken);
      const firstConsent = current.preliminaryInfoAcceptedAt;
      await consent(current);
      check("duplicate retains first stamp", (await load(id)).preliminaryInfoAcceptedAt, firstConsent);
      await assert.rejects(() => promoteDraftToOrder(id, { manualPaymentEvidence: { fingerprint: staleToken } }), DraftPaymentEvidenceChangedError); checks++;
      await assert.rejects(() => promoteDraftToOrder(id, { manualPaymentEvidence: {} }), DraftPaymentEvidenceChangedError); checks++;
      check("fresh customer consent cannot validate old admin evidence", (await admin.query(`SELECT count(*)::int AS n FROM ${scratch}.orders WHERE draft_id=$1`, [id])).rows[0].n, 0);
      const promoted = await promoteDraftToOrder(id, { manualPaymentEvidence: { fingerprint: freshToken } });
      check("fresh consent permits real promotion", (await load(id)).status, "confirmed");
      const order = (await admin.query(`SELECT amount_kurus, preliminary_info_accepted_at FROM ${scratch}.orders WHERE id=$1`, [promoted.orderId])).rows[0];
      check("promoted order carries new price and consent", [order.amount_kurus, order.preliminary_info_accepted_at], [15000, firstConsent]);
      check("fulfillment only after successful promotion", fulfilled, 1);
      check("confirmed retry stays idempotent", (await promoteDraftToOrder(id)).orderId, promoted.orderId);
      check("retry does not fulfill again", fulfilled, 1);

      id = await seed();
      await consent(await load(id));
      const contentStamp = (await load(id)).contentConsentAt;
      await edit(id);
      current = await load(id);
      check("edit preserves image rights consent", current.contentConsentAt, contentStamp);
      check("consent first then edit clears commercial stamp", current.preliminaryInfoAcceptedAt, null);
      await assert.rejects(() => promoteDraftToOrder(id), DraftConsentRequiredError); checks++;
      check("second refused promotion inserts nothing", (await admin.query(`SELECT count(*)::int AS n FROM ${scratch}.orders WHERE draft_id=$1`, [id])).rows[0].n, 0);
      await consent(current);
      check("renewed consent permits promotion again", (await promoteDraftToOrder(id)).orderNumber, current.reference);

      id = await seed();
      const legacy = await promoteDraftToOrder(id, { manualPaymentEvidence: {} });
      check("never-edited legacy draft still promotes without new gate", !!legacy.orderId, true);

      id = await seed();
      const tabToken = draftCommercialFingerprint(await load(id));
      // Hold the real edit at its audit insert, with the draft row locked.
      // Approval starts after its page read, waits, then must see the new row.
      const lockKey = Math.floor(Math.random() * 1000000000);
      await admin.query(`CREATE FUNCTION ${scratch}.pause_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lockKey}); RETURN NEW; END $$`);
      await admin.query(`CREATE TRIGGER pause_edit BEFORE INSERT ON ${scratch}.admin_draft_actions FOR EACH ROW EXECUTE FUNCTION ${scratch}.pause_edit()`);
      await admin.query("SELECT pg_advisory_lock($1)", [lockKey]);
      const waitForLocks = async (n: number) => {
        for (let i = 0; i < 200; i++) {
          const result = await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [scratch]);
          if (result.rows[0].n >= n) return;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Expected ${n} blocked real transactions`);
      };
      const editing = edit(id);
      let approving: Promise<void> | undefined;
      try {
        await waitForLocks(1);
        approving = assert.rejects(() => promoteDraftToOrder(id, { manualPaymentEvidence: { fingerprint: tabToken } }), DraftPaymentEvidenceChangedError);
        await waitForLocks(2);
        checks++;
      } finally {
        await admin.query("SELECT pg_advisory_unlock($1)", [lockKey]);
        await editing;
        if (approving) await approving;
        await admin.query(`DROP TRIGGER pause_edit ON ${scratch}.admin_draft_actions`);
      }
      check("concurrent edit leaves draft unpromoted", (await load(id)).status, "pending");
      check("concurrent edit inserts no order", (await admin.query(`SELECT count(*)::int AS n FROM ${scratch}.orders WHERE draft_id=$1`, [id])).rows[0].n, 0);

      id = await seed();
      const terminal = await load(id);
      await admin.query(`UPDATE ${scratch}.order_drafts SET status='cancelled' WHERE id=$1`, [id]);
      await assert.rejects(() => consent(terminal), (e: unknown) => e instanceof DraftConsentInputError && e.status === 409); checks++;
      check("closed draft cannot acquire consent", (await load(id)).preliminaryInfoAcceptedAt, null);

      id = await seed();
      // A DB failure must not leave only one of the two consent stamps behind.
      await admin.query(`ALTER TABLE ${scratch}.order_drafts ADD CONSTRAINT fail_consent CHECK(id <> '${id}'::uuid OR preliminary_info_accepted_at IS NULL)`);
      await assert.rejects(() => load(id).then((draft) => consent(draft))); checks++;
      current = await load(id);
      check("failed write leaves both stamps empty", [current.contentConsentAt, current.preliminaryInfoAcceptedAt], [null, null]);
      await admin.query(`ALTER TABLE ${scratch}.order_drafts DROP CONSTRAINT fail_consent`);
    } finally { await (db as unknown as { $client: pg.Pool }).$client.end(); }
  } finally {
    for (const [id, original] of originals) { if (original) require.cache[id] = original; else delete require.cache[id]; }
    await admin.query(`DROP SCHEMA IF EXISTS ${scratch} CASCADE`);
    await admin.end();
  }
  console.log(`${checks} draft consent checks passed; scratch removed; no external sends`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
