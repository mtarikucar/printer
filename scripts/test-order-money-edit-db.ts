/** Isolated schema; up = CREATE/fixtures, down = DROP of that exact schema. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL must name the isolated QA database on 127.0.0.1:55433");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `money_edit_${Date.now()}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "money-edit-ddl-"));
const admin = new pg.Client({ connectionString });

async function main() {
  await admin.connect();
  try {
    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], { env: { ...process.env, SCRATCH_OUT: out }, stdio: "ignore" });
    const ddl = fs.readFileSync(path.join(out, fs.readdirSync(out).find(f => f.endsWith(".sql"))!), "utf8").replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`SET search_path TO ${namespace}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter(s => s.trim())) await admin.query(statement);
    url.searchParams.set("options", `-c search_path=${namespace}`);
    process.env.DATABASE_URL = url.toString();
    process.env.REDIS_URL = "redis://127.0.0.1:56380/15";
    process.env.GA4_API_SECRET = "";
    process.env.META_CAPI_ACCESS_TOKEN = "";
    process.env.TIKTOK_EVENTS_API_TOKEN = "";
    const { editOrderMoneySplit, loadMoneySplitEdit } = await import("../src/lib/services/order-money-edit");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('money-edit@example.test','Test') RETURNING id")).rows[0].id;
    const maker = (await admin.query("INSERT INTO manufacturers(email,password_hash,company_name,contact_person,phone) VALUES('money-maker@example.test','x','Test','Test','05000000000') RETURNING id")).rows[0].id;
    const address = { adres: "Test", mahalle: "Test", ilce: "Test", il: "Ankara", postaKodu: "06000", telefon: "05000000000" };
    let seq = 0;
    async function seed() {
      return (await admin.query("INSERT INTO orders(order_number,user_id,email,customer_name,shipping_address,payment_method,status,amount_kurus,production_base_kurus,painting_price_kurus) VALUES($1,$2,'money@example.test','Test',$3,'bank_transfer','approved',10000,10000,0) RETURNING id", [`MONEY-${++seq}`, user, JSON.stringify(address)])).rows[0].id as string;
    }
    const args = (orderId: string) => ({ orderId, productionKurus: 6000, paintingKurus: 4000, expectedProductionKurus: 10000, expectedPaintingKurus: 0, reason: "Müşteri talebi doğrultusunda", adminEmail: "admin@example.test" });
    const id = await seed();
    assert.equal((await editOrderMoneySplit(args(id))).ok, true);
    assert.equal((await loadMoneySplitEdit(id))?.paintingKurus, 4000);
    let row = (await admin.query("SELECT amount_kurus,needs_painting,finish FROM orders WHERE id=$1", [id])).rows[0];
    assert.deepEqual(row, { amount_kurus: 10000, needs_painting: true, finish: "hand_painted" });
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM admin_actions WHERE order_id=$1", [id])).rows[0].n, 1);
    assert.equal((await editOrderMoneySplit(args(id))).ok, false, "stale editor refused");
    assert.equal((await editOrderMoneySplit({ ...args(id), expectedProductionKurus: 6000, expectedPaintingKurus: 4000, productionKurus: 10000, paintingKurus: 0 })).ok, true);
    row = (await admin.query("SELECT needs_painting,finish FROM orders WHERE id=$1", [id])).rows[0];
    assert.deepEqual(row, { needs_painting: false, finish: "paintable_kit" });

    const concurrent = await seed();
    const both = await Promise.all([editOrderMoneySplit(args(concurrent)), editOrderMoneySplit({ ...args(concurrent), productionKurus: 7000, paintingKurus: 3000 })]);
    assert.equal(both.filter(r => r.ok).length, 1, "only one stale snapshot wins");

    const staleAccrual = await seed();
    await editOrderMoneySplit(args(staleAccrual));
    const { accrueEarning } = await import("../src/lib/services/payouts");
    await accrueEarning(staleAccrual, maker, 10000); // Caller read before split edit.
    assert.equal((await admin.query("SELECT gross_kurus FROM manufacturer_earnings WHERE order_id=$1", [staleAccrual])).rows[0].gross_kurus, 6000, "later accrual must use the locked current split, not stale caller money");

    const inHouseShipped = await seed();
    await editOrderMoneySplit(args(inHouseShipped));
    await admin.query("UPDATE manufacturers SET paints_in_house=true WHERE id=$1", [maker]);
    await admin.query("UPDATE orders SET manufacturer_id=$2, manufacturer_status='shipped', status='shipped', shipped_at=now() WHERE id=$1", [inHouseShipped, maker]);
    // The completed shipment retains its painting ownership after profile edits.
    await admin.query("UPDATE manufacturers SET paints_in_house=false WHERE id=$1", [maker]);
    await accrueEarning(inHouseShipped, maker, 10000);
    assert.equal((await admin.query("SELECT gross_kurus FROM manufacturer_earnings WHERE order_id=$1", [inHouseShipped])).rows[0].gross_kurus, 10000, "completed in-house painting must survive a later profile toggle");

    const painter = (await admin.query("INSERT INTO painters(email,password_hash,company_name,contact_person,phone) VALUES('money-painter@example.test','x','Test','Test','05000000000') RETURNING id")).rows[0].id;
    const painted = await seed();
    await editOrderMoneySplit(args(painted));
    const { accruePainterEarning } = await import("../src/lib/services/painter-payouts");
    await accruePainterEarning(painted, painter, 1000);
    assert.equal((await admin.query("SELECT gross_kurus FROM painter_earnings WHERE order_id=$1", [painted])).rows[0].gross_kurus, 4000, "painter accrual uses current locked painting base");

    const audited = await seed();
    await admin.query("CREATE FUNCTION refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$");
    await admin.query("CREATE TRIGGER fail_audit BEFORE INSERT ON admin_actions FOR EACH ROW EXECUTE FUNCTION refuse_audit()");
    await assert.rejects(editOrderMoneySplit(args(audited)));
    assert.equal((await loadMoneySplitEdit(audited))?.paintingKurus, 0, "failed audit rolls back split");
    await admin.query("DROP TRIGGER fail_audit ON admin_actions");

    const accrued = await seed();
    const blocker = new pg.Client({ connectionString: url.toString() });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM orders WHERE id=$1 FOR SHARE", [accrued]);
      const pending = editOrderMoneySplit(args(accrued));
      await blocker.query("INSERT INTO manufacturer_earnings(order_id,manufacturer_id,gross_kurus,commission_kurus,net_kurus,commission_rate_bps,status) VALUES($1,$2,10000,4000,6000,4000,'pending')", [accrued, maker]);
      await blocker.query("COMMIT");
      assert.equal((await pending).ok, false, "an accrual that holds the order lock wins over split edit");
      await admin.query("UPDATE manufacturer_earnings SET status='reversed' WHERE order_id=$1", [accrued]);
      assert.equal((await editOrderMoneySplit(args(accrued))).ok, false, "reversed historical accrual remains immutable");

      const refunded = await seed();
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [refunded]);
      const edit = editOrderMoneySplit(args(refunded));
      await blocker.query("UPDATE orders SET payment_status='refunded' WHERE id=$1", [refunded]);
      await blocker.query("COMMIT");
      assert.equal((await edit).ok, false, "refund race keeps original split");
    } finally { await blocker.query("ROLLBACK"); await blocker.end(); }
    const { eInvoiceProvider } = await import("../src/lib/services/e-invoice");
    const { getOrCreateInvoice } = await import("../src/lib/services/payouts");
    const originalIssue = eInvoiceProvider.issue;
    let issued = 0;
    eInvoiceProvider.issue = async () => { issued++; return { providerRef: "QA-INVOICE" }; };
    try {
      const invoiceOrder = { id: await seed(), orderNumber: "QA-INVOICE", amountKurus: 10000, havaleDiscountKurus: 300, giftCardAmountKurus: 7000, customerName: "Test", email: "test@example.test" };
      const invoices = await Promise.all([getOrCreateInvoice(invoiceOrder), getOrCreateInvoice(invoiceOrder)]);
      assert.equal(issued, 1, "concurrent invoice requests issue once");
      assert.equal(invoices[0]?.id, invoices[1]?.id);
      assert.equal(invoices[0]?.totalKurus, 9700, "gift payment does not reduce invoice consideration");
      assert.equal((await getOrCreateInvoice({ ...invoiceOrder, amountKurus: 20000 }))?.totalKurus, 9700, "issued invoice stays immutable");
    } finally { eInvoiceProvider.issue = originalIssue; }
    // Exercise the real promotion path with queue delivery stubbed. No email
    // job can escape this disposable schema into a running worker.
    const { getEmailQueue } = await import("../src/lib/queue/queues");
    const queue = getEmailQueue();
    const originalAdd = queue.add;
    queue.add = async () => ({ id: "qa-no-delivery" }) as Awaited<ReturnType<typeof queue.add>>;
    try {
      const { promoteDraftToOrder } = await import("../src/lib/services/order-draft");
      const cart = (await admin.query("INSERT INTO order_drafts(reference,parent_reference,user_id,email,customer_name,shipping_address,payment_method,order_type,amount_kurus,production_base_kurus,painting_price_kurus,upsells,upsell_amount_kurus,havale_discount_kurus,gift_card_amount_kurus) VALUES('CART-MONEY','CART-MONEY',$1,'cart@example.test','Test',$2,'bank_transfer','marketplace',49900,44900,5000,$3,9900,1497,20000) RETURNING id", [user, JSON.stringify(address), JSON.stringify(["digital_files"])])).rows[0].id;
      await admin.query("INSERT INTO order_items(draft_id,seller_manufacturer_id,product_title_snapshot,unit_price_kurus,line_total_kurus,production_base_kurus) VALUES($1,$2,'A',10000,10000,8000),($1,null,'B',30000,30000,27000)", [cart, maker]);
      await promoteDraftToOrder(cart);
      await promoteDraftToOrder(cart); // Callback retry cannot duplicate children or fees.
      const children = (await admin.query("SELECT amount_kurus,production_base_kurus,painting_price_kurus,upsells,upsell_amount_kurus,havale_discount_kurus,gift_card_amount_kurus FROM orders WHERE draft_id=$1", [cart])).rows;
      assert.equal(children.length, 2);
      for (const [key, total] of Object.entries({ amount_kurus: 49900, production_base_kurus: 44900, painting_price_kurus: 5000, upsell_amount_kurus: 9900, havale_discount_kurus: 1497, gift_card_amount_kurus: 20000 })) {
        assert.equal(children.reduce((n, r) => n + r[key], 0), total, key);
      }
      for (const child of children) {
        assert.deepEqual(child.upsells, ["digital_files"]);
        assert.equal(child.production_base_kurus + child.painting_price_kurus, child.amount_kurus);
        assert.ok(child.amount_kurus >= child.havale_discount_kurus + child.gift_card_amount_kurus);
      }
      console.log("cart promotion: exact collected/discount/gift/upsell shares, entitlements and replay passed");
    } finally { queue.add = originalAdd; await queue.close(); }
    console.log("money split DB: edits/removal, stale writes, audit rollback, accrual lock and refund race passed");
  } catch (error) {
    console.error("Test failure:", error);
    throw error;
  } finally {
    const { db } = await import("../src/lib/db");
    await (db as typeof db & { $client: pg.Pool }).$client.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end();
    fs.rmSync(out, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
