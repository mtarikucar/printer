/** Isolated 55433 schema only; exact-schema teardown in finally. No sends. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.QA_MONEY_PG_URL;
if (!connectionString) throw new Error("QA_MONEY_PG_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433") throw new Error("Refusing non-QA database");
const namespace = `gift_usage_${Date.now()}_${process.pid}`;
const out = fs.mkdtempSync(path.join(os.tmpdir(), "gift-usage-ddl-"));
const admin = new pg.Client({ connectionString });
let pool: pg.Pool | undefined;
let checks = 0;
const test = async (name: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
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
    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const { countLiveGiftCardUses } = await import("../src/lib/services/gift-card-usage");
    const { validateGiftCard } = await import("../src/lib/services/gift-card");
    const { giftCards } = await import("../src/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const user = (await admin.query("INSERT INTO users(email,full_name) VALUES('usage@test.invalid','Test') RETURNING id")).rows[0].id;
    let seq = 0;
    const card = async () => (await admin.query("INSERT INTO gift_cards(code,amount_kurus,balance_kurus,max_redemptions,expires_at) VALUES($1,10000,5000,1,'2099-01-01') RETURNING id,code", [`USAGE-${++seq}`])).rows[0] as { id: string; code: string };
    const draft = async (id = randomUUID()) => {
      await admin.query("INSERT INTO order_drafts(id,reference,user_id,email,customer_name,shipping_address,payment_method,amount_kurus) VALUES($1,$2,$3,'usage@test.invalid','Test','{}','card',10000)", [id, `DRAFT-${++seq}`, user]); return id;
    };
    const order = async (draftId: string | null, id = randomUUID()) => {
      await admin.query("INSERT INTO orders(id,order_number,draft_id,user_id,email,customer_name,shipping_address,payment_method,amount_kurus) VALUES($1,$2,$3,$4,'usage@test.invalid','Test','{}','card',5000)", [id, `ORDER-${++seq}`, draftId, user]); return id;
    };
    const redemption = async (cardId: string, draftId: string | null, orderId: string | null, id = randomUUID()) => {
      await admin.query("INSERT INTO gift_card_redemptions(id,gift_card_id,draft_id,order_id,amount_kurus,redeemed_by_user_id) VALUES($1,$2,$3,$4,1000,$5)", [id, cardId, draftId, orderId, user]); return id;
    };
    const full = (id: string) => admin.query("UPDATE gift_card_redemptions SET refunded_at=now() WHERE id=$1", [id]);
    const c = await card(), d = await draft();
    let primary: string, sibling: string;
    await test("empty card has zero uses; db reader accepted", async () => {
      assert.equal(await countLiveGiftCardUses(db, c.id), 0);
    });
    await test("one cart with primary and null-draft sibling counts once", async () => {
      primary = await redemption(c.id, d, await order(d));
      sibling = await redemption(c.id, null, await order(d));
      assert.equal(await countLiveGiftCardUses(db, c.id), 1);
    });
    await test("primary fully returned: live sibling keeps limit occupied", async () => {
      await full(primary!);
      assert.equal(await countLiveGiftCardUses(db, c.id), 1);
      assert.deepEqual(await validateGiftCard(c.code), { valid: false, error: "limit_reached" });
      await db.transaction(async tx => {
        await tx.select({ id: giftCards.id }).from(giftCards).where(eq(giftCards.id, c.id)).for("update");
        assert.equal(await countLiveGiftCardUses(tx, c.id), 1, "checkout transaction reader accepted");
      });
    });
    await test("partial-return marker remains live regardless of card balance", async () => {
      // No partial-refund ledger exists yet. Model only its agreed invariant:
      // a credit change does not complete the redemption's refundedAt marker.
      await admin.query("UPDATE gift_cards SET balance_kurus=balance_kurus+100 WHERE id=$1", [c.id]);
      assert.equal((await admin.query("SELECT refunded_at FROM gift_card_redemptions WHERE id=$1", [sibling!])).rows[0].refunded_at, null);
      assert.equal(await countLiveGiftCardUses(db, c.id), 1);
    });
    await test("last funded sibling fully returned frees the checkout once", async () => {
      await full(sibling!); assert.equal(await countLiveGiftCardUses(db, c.id), 0);
      assert.equal((await validateGiftCard(c.code)).valid, true);
      await full(sibling!); assert.equal(await countLiveGiftCardUses(db, c.id), 0);
    });
    await test("two live checkouts count twice; draft reservation works without order", async () => {
      const c2 = await card(), d2 = await draft(), d3 = await draft();
      await redemption(c2.id, d2, await order(d2));
      await redemption(c2.id, null, await order(d2));
      await redemption(c2.id, d3, null);
      assert.equal(await countLiveGiftCardUses(db, c2.id), 2);
      assert.equal(await countLiveGiftCardUses(db, c.id), 0, "other card is isolated");
    });
    await test("null-draft legacy order/redemption fallbacks are conservative and namespaced", async () => {
      const c3 = await card(), sameId = randomUUID();
      const legacyOrder = await order(null, sameId);
      await redemption(c3.id, await draft(sameId), null);
      await redemption(c3.id, null, legacyOrder);
      await redemption(c3.id, null, legacyOrder); // same legacy order, one use
      await redemption(c3.id, null, null, sameId);
      assert.equal(await countLiveGiftCardUses(db, c3.id), 3, "same UUID across three identity kinds cannot collide");
      await redemption(c3.id, null, null);
      await redemption(c3.id, null, await order(null));
      assert.equal(await countLiveGiftCardUses(db, c3.id), 5, "unrelated legacy rows are not guessed to share a checkout");
    });
    console.log(`${checks} gift usage DB checks passed`);
  } finally {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.end(); fs.rmSync(out, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
