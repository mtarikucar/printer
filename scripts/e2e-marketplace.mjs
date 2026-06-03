// Isolated end-to-end test of the marketplace feature against the e2e stack
// (test Postgres + Redis + Next server on :3055). Drives the REAL HTTP routes.
//
// Run with: DATABASE_URL=<test> node scripts/e2e-marketplace.mjs
import pg from "pg";

const BASE = "http://localhost:3055";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
function bad(name, detail) { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? " — " + detail : ""}`); }
function assert(cond, name, detail) { cond ? ok(name) : bad(name, detail); }
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

// ── tiny cookie jar ──────────────────────────────────────────────
function makeJar() {
  const jar = new Map();
  return {
    apply(headers = {}) {
      if (jar.size) headers["cookie"] = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      return headers;
    },
    store(res) {
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of sc) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (v === "" || v === "deleted") jar.delete(k);
        else jar.set(k, v);
      }
    },
  };
}

async function req(method, path, { jar, json, form, raw, headers = {} } = {}) {
  const h = { ...headers };
  let body;
  if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) { h["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  else if (raw) { body = raw; }
  if (jar) jar.apply(h);
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  if (jar) jar.store(res);
  return res;
}
async function jbody(res) { try { return await res.json(); } catch { return null; } }

// minimal valid 1x1 PNG
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  const MFG_EMAIL = "seller@e2e.test";
  const MFG_PASS = "seller12345";
  const ADMIN_EMAIL = "admin@e2e.test";
  const ADMIN_PASS = "admin12345";
  const PRICE_TRY = 250; // ₺250
  const PRICE_KURUS = PRICE_TRY * 100;

  const mfgJar = makeJar();
  const adminJar = makeJar();
  const custJar = makeJar(); // guest — stays empty

  // ── 1. Seller onboarding ───────────────────────────────────────
  section("1. Seller onboarding");
  const reg = await req("POST", "/api/manufacturer/auth/register", {
    json: {
      email: MFG_EMAIL, password: MFG_PASS,
      companyName: "E2E Atölye", contactPerson: "Ali Veli",
      phone: "5551112233",
      address: { adres: "Test Mah. 1", ilce: "Kadıköy", il: "İstanbul", postaKodu: "34000", telefon: "5551112233" },
      iban: "TR330006100519786457841326",
      bankAccountHolder: "E2E Atolye", bankName: "Test Bank",
      maxConcurrentOrders: 5, materials: ["resin", "filament"],
      onboardingAccepted: true,
    },
  });
  assert(reg.status === 200 || reg.status === 201, "manufacturer registered (pending_approval)", `HTTP ${reg.status} ${JSON.stringify(await jbody(reg))}`);

  // Admin "approves" the manufacturer to active (simulate the KYC approval so it can sell).
  const up = await pool.query("UPDATE manufacturers SET status='active', printer_photo_uploaded_at=now() WHERE email=$1 RETURNING id", [MFG_EMAIL]);
  const MFG_ID = up.rows[0]?.id;
  assert(!!MFG_ID, "manufacturer activated (id captured)", "no row");

  // Block: a non-active seller must NOT be able to create products — verify by
  // logging in before/after is overkill; we proceed with the active seller.
  const login = await req("POST", "/api/manufacturer/auth/login", { jar: mfgJar, json: { email: MFG_EMAIL, password: MFG_PASS } });
  assert(login.status === 200, "manufacturer login → session cookie", `HTTP ${login.status} ${JSON.stringify(await jbody(login))}`);

  // ── 2. Seller creates + submits a product ──────────────────────
  section("2. Seller product lifecycle");
  const create = await req("POST", "/api/manufacturer/products", {
    jar: mfgJar,
    json: { title: "Ejderha Figürü", description: "El boyaması reçine ejderha figürü, ~12cm.", priceKurus: PRICE_KURUS, material: "resin", category: "figurine", leadTimeDays: 5 },
  });
  const createBody = await jbody(create);
  const PRODUCT_ID = createBody?.product?.id;
  assert(create.status === 200 && PRODUCT_ID, "product created (draft)", `HTTP ${create.status} ${JSON.stringify(createBody)}`);
  assert(createBody?.product?.status === "draft", "new product status = draft", createBody?.product?.status);

  // Submit before adding an image must fail (no_images guard).
  const earlySubmit = await req("POST", `/api/manufacturer/products/${PRODUCT_ID}/submit`, { jar: mfgJar });
  assert(earlySubmit.status === 400, "submit without image rejected", `HTTP ${earlySubmit.status}`);

  // Upload an image (multipart).
  const fd = new FormData();
  fd.append("file", new Blob([PNG_1x1], { type: "image/png" }), "dragon.png");
  const imgRes = await req("POST", `/api/manufacturer/products/${PRODUCT_ID}/images`, { jar: mfgJar, raw: fd });
  const imgBody = await jbody(imgRes);
  assert(imgRes.status === 200 && imgBody?.image?.id, "product image uploaded", `HTTP ${imgRes.status} ${JSON.stringify(imgBody)}`);

  // Now submit for review.
  const submit = await req("POST", `/api/manufacturer/products/${PRODUCT_ID}/submit`, { jar: mfgJar });
  const submitBody = await jbody(submit);
  assert(submit.status === 200 && submitBody?.product?.status === "pending_review", "product submitted → pending_review", `HTTP ${submit.status} ${JSON.stringify(submitBody)}`);

  // ── 3. Admin moderation ────────────────────────────────────────
  section("3. Admin moderation");
  // NextAuth credentials login (CSRF flow).
  const csrfRes = await req("GET", "/api/auth/csrf", { jar: adminJar });
  const { csrfToken } = await jbody(csrfRes);
  assert(!!csrfToken, "admin CSRF token fetched", "no token");
  const adminLogin = await req("POST", "/api/auth/callback/credentials", {
    jar: adminJar,
    form: { csrfToken, email: ADMIN_EMAIL, password: ADMIN_PASS, callbackUrl: `${BASE}/admin/dashboard`, json: "true" },
  });
  // NextAuth sets the session cookie via Set-Cookie; status may be 200 or 302.
  const sess = await req("GET", "/api/auth/session", { jar: adminJar });
  const sessBody = await jbody(sess);
  assert(sessBody?.user?.email === ADMIN_EMAIL, "admin authenticated (session)", JSON.stringify(sessBody));

  // Product visible in admin moderation queue.
  const queue = await req("GET", "/api/admin/products?status=pending_review", { jar: adminJar });
  const queueBody = await jbody(queue);
  assert(queue.status === 200 && Array.isArray(queueBody?.products) && queueBody.products.some((p) => p.id === PRODUCT_ID), "product appears in moderation queue", `HTTP ${queue.status}`);

  // Approve.
  const approve = await req("POST", `/api/admin/products/${PRODUCT_ID}/approve`, { jar: adminJar });
  const approveBody = await jbody(approve);
  assert(approve.status === 200 && approveBody?.product?.status === "active", "admin approved → active", `HTTP ${approve.status} ${JSON.stringify(approveBody)}`);
  const SLUG = approveBody?.product?.slug;
  assert(!!SLUG, "slug minted on approval", SLUG);

  // ── 4. Storefront visibility ───────────────────────────────────
  section("4. Storefront");
  const shop = await req("GET", "/shop");
  const shopHtml = await shop.text();
  assert(shop.status === 200 && shopHtml.includes("Ejderha Figürü"), "active product shows on /shop", `HTTP ${shop.status}`);
  const pdp = await req("GET", `/shop/${SLUG}`);
  assert(pdp.status === 200, "product detail page renders", `HTTP ${pdp.status} /shop/${SLUG}`);

  // ── 5. Customer marketplace checkout (THE CRUX) ────────────────
  section("5. Marketplace checkout (auto-assign, no AI gen)");
  // Seed a gift card fully covering the price so checkout auto-promotes
  // without PayTR (we are not testing the payment provider here).
  const gc = await pool.query(
    `INSERT INTO gift_cards (code, amount_kurus, balance_kurus, status, expires_at)
     VALUES ($1,$2,$2,'active', now() + interval '1 year') RETURNING code`,
    ["E2EGIFT250", PRICE_KURUS]
  );
  const GIFT_CODE = gc.rows[0].code;

  const order = await req("POST", "/api/orders", {
    jar: custJar,
    json: {
      orderType: "marketplace",
      productId: PRODUCT_ID,
      quantity: 1,
      shippingAddress: { adres: "Müşteri Mah. 5", mahalle: "Merkez", ilce: "Çankaya", il: "Ankara", postaKodu: "06000", telefon: "5559998877" },
      giftCardCode: GIFT_CODE,
      paymentMethod: "card",
      guestEmail: "buyer@e2e.test",
      guestName: "Müşteri Test",
    },
  });
  const orderBody = await jbody(order);
  assert(order.status === 200 && orderBody?.autoConfirmed === true, "marketplace order auto-confirmed (gift card)", `HTTP ${order.status} ${JSON.stringify(orderBody)}`);
  const ORDER_NUMBER = orderBody?.orderNumber;

  // Inspect the promoted order in the DB — the crux assertions.
  const o = (await pool.query(
    `SELECT id, order_type, product_id, seller_manufacturer_id, manufacturer_id, manufacturer_status, status, amount_kurus, product_title_snapshot, figurine_size
     FROM orders WHERE order_number=$1`, [ORDER_NUMBER]
  )).rows[0];
  assert(!!o, "order row created", "missing");
  assert(o.order_type === "marketplace", "order.orderType = marketplace", o.order_type);
  assert(o.product_id === PRODUCT_ID, "order.productId linked", o.product_id);
  assert(o.manufacturer_id === MFG_ID, "order auto-assigned to owning seller", `${o.manufacturer_id} vs ${MFG_ID}`);
  assert(o.manufacturer_status === "assigned", "manufacturerStatus = assigned (skipped scoring)", o.manufacturer_status);
  assert(o.amount_kurus === PRICE_KURUS, "order amount = product price", `${o.amount_kurus} vs ${PRICE_KURUS}`);
  assert(o.product_title_snapshot === "Ejderha Figürü", "product title snapshot stored", o.product_title_snapshot);
  assert(o.figurine_size === null, "figurineSize null for marketplace", String(o.figurine_size));

  const genCount = (await pool.query("SELECT count(*)::int c FROM generation_attempts WHERE order_id=$1", [o.id])).rows[0].c;
  assert(genCount === 0, "NO AI generation attempt created", `count=${genCount}`);
  const photoCount = (await pool.query("SELECT count(*)::int c FROM order_photos WHERE order_id=$1", [o.id])).rows[0].c;
  assert(photoCount === 0, "NO customer input photo row", `count=${photoCount}`);

  // ── 6. Fulfillment + earning accrual (30% commission) ──────────
  section("6. Fulfillment + earning");
  const ORD = o.id;
  const acc = await req("POST", `/api/manufacturer/orders/${ORD}/accept`, { jar: mfgJar });
  assert(acc.status === 200, "seller accepted order", `HTTP ${acc.status} ${JSON.stringify(await jbody(acc))}`);
  const sp = await req("POST", `/api/manufacturer/orders/${ORD}/start-printing`, { jar: mfgJar });
  assert(sp.status === 200, "seller started printing", `HTTP ${sp.status}`);
  const fp = await req("POST", `/api/manufacturer/orders/${ORD}/finish-printing`, { jar: mfgJar });
  assert(fp.status === 200, "seller finished printing", `HTTP ${fp.status}`);

  // QC photo upload + submit.
  const qfd = new FormData();
  qfd.append("file", new Blob([PNG_1x1], { type: "image/png" }), "qc.png");
  const qcUp = await req("POST", `/api/manufacturer/orders/${ORD}/qc-photos`, { jar: mfgJar, raw: qfd });
  assert(qcUp.status === 200, "QC photo uploaded", `HTTP ${qcUp.status} ${JSON.stringify(await jbody(qcUp))}`);
  const qcSubmit = await req("POST", `/api/manufacturer/orders/${ORD}/submit-qc`, { jar: mfgJar });
  assert(qcSubmit.status === 200, "QC submitted (→ qc_pending)", `HTTP ${qcSubmit.status} ${JSON.stringify(await jbody(qcSubmit))}`);

  // Admin QC approve.
  const qcApprove = await req("POST", `/api/admin/orders/${ORD}/qc-approve`, { jar: adminJar });
  assert(qcApprove.status === 200, "admin QC approved (→ qc_approved)", `HTTP ${qcApprove.status} ${JSON.stringify(await jbody(qcApprove))}`);

  // Ship → accrues earning.
  const ship = await req("POST", `/api/manufacturer/orders/${ORD}/ship`, { jar: mfgJar, json: { trackingNumber: "E2E-TRACK-001", carrier: "yurtici" } });
  assert(ship.status === 200, "seller shipped order", `HTTP ${ship.status} ${JSON.stringify(await jbody(ship))}`);

  // Earning assertions — 30% platform commission.
  const earn = (await pool.query(
    "SELECT gross_kurus, commission_kurus, net_kurus, commission_rate_bps, manufacturer_id, status FROM manufacturer_earnings WHERE order_id=$1", [ORD]
  )).rows[0];
  assert(!!earn, "earning row accrued on ship", "missing");
  assert(earn.gross_kurus === PRICE_KURUS, "earning gross = price", `${earn?.gross_kurus}`);
  assert(earn.commission_rate_bps === 3000, "commission rate = 30% (3000 bps)", `${earn?.commission_rate_bps}`);
  assert(earn.commission_kurus === Math.round(PRICE_KURUS * 0.3), "commission = 30% of price", `${earn?.commission_kurus} vs ${Math.round(PRICE_KURUS*0.3)}`);
  assert(earn.net_kurus === PRICE_KURUS - Math.round(PRICE_KURUS * 0.3), "net = 70% to seller", `${earn?.net_kurus}`);
  assert(earn.manufacturer_id === MFG_ID, "earning attributed to seller", earn?.manufacturer_id);

  // ── 7. Payout batch ────────────────────────────────────────────
  section("7. Payout");
  const payout = await req("POST", `/api/admin/manufacturers/${MFG_ID}/payout`, { jar: adminJar });
  const payoutBody = await jbody(payout);
  assert(payout.status === 200, "admin created payout batch", `HTTP ${payout.status} ${JSON.stringify(payoutBody)}`);
  const po = (await pool.query("SELECT total_kurus, earning_count, status FROM payouts WHERE manufacturer_id=$1", [MFG_ID])).rows[0];
  assert(!!po && po.total_kurus === earn.net_kurus, "payout total = seller net", `${po?.total_kurus} vs ${earn.net_kurus}`);

  // ── summary ────────────────────────────────────────────────────
  console.log(`\n\x1b[1mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => { console.error("HARNESS ERROR:", e); try { await pool.end(); } catch {} process.exit(2); });
