// Regression + negative checks: the legacy CUSTOM order path must still branch
// correctly (photo → generation, unassigned), and a non-active seller must be
// blocked. Runs against the same isolated :3055 stack.
import pg from "pg";
const BASE = "http://localhost:3055";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); };
const bad = (n, d) => { fail++; console.log(`  \x1b[31m✗ ${n}\x1b[0m${d ? " — " + d : ""}`); };
const assert = (c, n, d) => (c ? ok(n) : bad(n, d));
const jbody = async (r) => { try { return await r.json(); } catch { return null; } };

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function main() {
  console.log("\x1b[1mRegression: legacy custom order path\x1b[0m");
  // Upload a customer photo (Turnstile bypassed in test env → no token needed).
  const fd = new FormData();
  fd.append("file", new Blob([PNG], { type: "image/png" }), "me.png");
  const up = await fetch(BASE + "/api/upload", { method: "POST", body: fd });
  const upBody = await jbody(up);
  const photoKey = upBody?.key;
  assert(up.status === 200 && photoKey?.startsWith("photos/"), "customer photo uploaded", `HTTP ${up.status} ${JSON.stringify(upBody)}`);

  // Gift card fully covering a custom resin/orta order (₺1399).
  await pool.query(
    `INSERT INTO gift_cards (code, amount_kurus, balance_kurus, status, expires_at)
     VALUES ('E2ECUSTOM', 200000, 200000, 'active', now() + interval '1 year')
     ON CONFLICT (code) DO NOTHING`
  );

  const order = await fetch(BASE + "/api/orders", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      photoKey, figurineSize: "orta", material: "resin", style: "realistic", modifiers: [],
      shippingAddress: { adres: "Cust 1", mahalle: "M", ilce: "Çankaya", il: "Ankara", postaKodu: "06000", telefon: "5551110000" },
      giftCardCode: "E2ECUSTOM", paymentMethod: "card",
      guestEmail: "custbuyer@e2e.test", guestName: "Custom Buyer",
    }),
  });
  const ob = await jbody(order);
  assert(order.status === 200 && ob?.autoConfirmed === true, "custom order auto-confirmed", `HTTP ${order.status} ${JSON.stringify(ob)}`);

  const o = (await pool.query(
    "SELECT id, order_type, manufacturer_status, status, figurine_size FROM orders WHERE order_number=$1", [ob.orderNumber]
  )).rows[0];
  assert(o.order_type === "custom", "order.orderType = custom", o.order_type);
  assert(o.figurine_size === "orta", "custom keeps figurineSize", o.figurine_size);
  assert(o.manufacturer_status === "unassigned", "custom manufacturerStatus = unassigned (awaits scoring)", o.manufacturer_status);
  const photos = (await pool.query("SELECT count(*)::int c FROM order_photos WHERE order_id=$1", [o.id])).rows[0].c;
  assert(photos === 1, "custom order has input photo row", `count=${photos}`);
  // kickOffOrderProcessing should have moved it toward generation (no preview → generating).
  assert(["generating", "paid"].includes(o.status), "custom order entered generation path", o.status);

  console.log("\n\x1b[1mNegative: non-active seller blocked\x1b[0m");
  // A freshly-registered (pending_approval) manufacturer cannot log in to sell.
  await fetch(BASE + "/api/manufacturer/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "pending@e2e.test", password: "pending12345",
      companyName: "Pending Co", contactPerson: "Pending P", phone: "5552223344",
      address: { adres: "Pend 1", ilce: "Kadıköy", il: "İstanbul", postaKodu: "34000", telefon: "5552223344" },
      iban: "TR330006100519786457841326", bankAccountHolder: "Pending Co", bankName: "Test Bank",
      maxConcurrentOrders: 3, materials: ["resin"], onboardingAccepted: true,
    }),
  });
  const plog = await fetch(BASE + "/api/manufacturer/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "pending@e2e.test", password: "pending12345" }),
  });
  assert(plog.status !== 200, "pending manufacturer login blocked", `HTTP ${plog.status}`);

  console.log(`\n\x1b[1mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("ERROR:", e); try { await pool.end(); } catch {} process.exit(2); });
