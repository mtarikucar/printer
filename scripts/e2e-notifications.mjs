// Isolated e2e for "every manufacturer-related event emails the manufacturer".
// Each admin action must create a manufacturer_notifications row (which the
// email worker turns into an email). The chat path schedules/cancels a delayed
// notification-queue job. Runs against the :3055 isolated stack.
import pg from "pg";
import bcrypt from "bcryptjs";
import { Queue } from "bullmq";

const BASE = "http://localhost:3055";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const notifQueue = new Queue("notification", {
  connection: { host: "localhost", port: 56399 },
});

let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); };
const bad = (n, d) => { fail++; console.log(`  \x1b[31m✗ ${n}\x1b[0m${d ? " — " + d : ""}`); };
const assert = (c, n, d) => (c ? ok(n) : bad(n, d));
const jbody = async (r) => { try { return await r.json(); } catch { return null; } };

const adminJar = new Map();
function applyJar(jar, h = {}) { if (jar.size) h.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); return h; }
function storeJar(jar, res) { (res.headers.getSetCookie?.() ?? []).forEach((c) => { const p = c.split(";")[0]; const i = p.indexOf("="); jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }); }
async function req(method, path, { jar, json, form } = {}) {
  const h = {}; let body;
  if (json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(json); }
  else if (form) { h["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  if (jar) applyJar(jar, h);
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  if (jar) storeJar(jar, res);
  return res;
}

// Count manufacturer_notifications for a manufacturer; return latest subject too.
async function latestNotif(mfgId) {
  const r = await pool.query(
    "SELECT count(*)::int c, max(subject) FILTER (WHERE created_at = (SELECT max(created_at) FROM manufacturer_notifications WHERE manufacturer_id=$1)) AS subject FROM manufacturer_notifications WHERE manufacturer_id=$1",
    [mfgId]
  );
  return { count: r.rows[0].c, subject: r.rows[0].subject };
}

async function main() {
  // ── Admin login (NextAuth) ──
  const csrf = (await jbody(await req("GET", "/api/auth/csrf", { jar: adminJar }))).csrfToken;
  await req("POST", "/api/auth/callback/credentials", { jar: adminJar, form: { csrfToken: csrf, email: "admin@e2e.test", password: "admin12345", callbackUrl: `${BASE}/admin/dashboard`, json: "true" } });
  const sess = await jbody(await req("GET", "/api/auth/session", { jar: adminJar }));
  assert(sess?.user?.email === "admin@e2e.test", "admin authenticated");

  // ── Seed: user, active manufacturer (pending IBAN), order, KYC doc, earning ──
  const userId = (await pool.query("INSERT INTO users (email, full_name, is_guest) VALUES ('cust@e2e.test','Cust',true) RETURNING id")).rows[0].id;
  const mfgHash = bcrypt.hashSync("seller12345", 12);
  const mfgId = (await pool.query(
    `INSERT INTO manufacturers (email, password_hash, company_name, contact_person, phone, status, iban, pending_iban, iban_review_status)
     VALUES ('seller@e2e.test',$1,'E2E Atölye','Ali','5551112233','active','TR330006100519786457841326','TR120006100519786457841327','pending') RETURNING id`,
    [mfgHash]
  )).rows[0].id;
  const orderId = (await pool.query(
    `INSERT INTO orders (order_number, user_id, email, customer_name, shipping_address, status, payment_method, amount_kurus, manufacturer_id, manufacturer_status, order_type)
     VALUES ('FIG-NOTIF01',$1,'cust@e2e.test','Cust', '{"adres":"A","ilce":"B","il":"C","postaKodu":"34000","telefon":"+905551110000"}', 'paid','card', 25000, $2, 'accepted','marketplace') RETURNING id`,
    [userId, mfgId]
  )).rows[0].id;
  const docId = (await pool.query(
    `INSERT INTO manufacturer_documents (manufacturer_id, type, storage_key, status) VALUES ($1,'vergi_levhasi','kyc-docs/x.jpg','pending') RETURNING id`,
    [mfgId]
  )).rows[0].id;
  await pool.query(
    `INSERT INTO manufacturer_earnings (order_id, manufacturer_id, gross_kurus, commission_kurus, net_kurus, commission_rate_bps, status)
     VALUES ($1,$2,25000,7500,17500,3000,'pending')`,
    [orderId, mfgId]
  );

  console.log("\n\x1b[1mPart 1 — gap events create a manufacturer notification\x1b[0m");

  // IBAN approve
  let before = (await latestNotif(mfgId)).count;
  await req("POST", `/api/admin/manufacturers/${mfgId}/iban`, { jar: adminJar, json: { action: "approve" } });
  let n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /IBAN/i.test(n.subject), "IBAN approve → notification", n.subject);

  // Payout create
  before = n.count;
  const payoutRes = await jbody(await req("POST", `/api/admin/manufacturers/${mfgId}/payout`, { jar: adminJar }));
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /Ödeme talebiniz/i.test(n.subject), "payout create → notification", n.subject);

  // Payout mark-paid
  before = n.count;
  await req("POST", `/api/admin/payouts/${payoutRes.payoutId}/mark-paid`, { jar: adminJar, json: { reference: "REF-1" } });
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /gönderildi/i.test(n.subject), "payout mark-paid → notification", n.subject);

  // KYC doc review (approve)
  before = n.count;
  await req("POST", `/api/admin/documents/${docId}/review`, { jar: adminJar, json: { action: "approve" } });
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /onayland/i.test(n.subject), "KYC doc approve → notification", n.subject);

  // Order edit (shipping address change)
  before = n.count;
  await req("POST", `/api/admin/orders/${orderId}/edit`, { jar: adminJar, json: { shippingAddress: { adres: "Yeni Adres 5", ilce: "Çankaya", il: "Ankara", postaKodu: "06000", telefon: "5559998877" } } });
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /güncellendi/i.test(n.subject), "order edit (address) → notification", n.subject);

  // Suspend
  before = n.count;
  await req("POST", `/api/admin/manufacturers/${mfgId}/suspend`, { jar: adminJar });
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /askıya/i.test(n.subject), "suspend → notification", n.subject);
  assert((await pool.query("SELECT status FROM manufacturers WHERE id=$1", [mfgId])).rows[0].status === "suspended", "manufacturer is suspended");

  // Reactivate
  before = n.count;
  await req("POST", `/api/admin/manufacturers/${mfgId}/activate`, { jar: adminJar });
  n = await latestNotif(mfgId);
  assert(n.count === before + 1 && /aktif/i.test(n.subject), "reactivate → notification", n.subject);

  console.log("\n\x1b[1mPart 2 — chat: 30-min delayed email, cancelled on read\x1b[0m");
  const jobId = `mfg-msg-email-${orderId}`;
  // Admin posts a manufacturer-channel message
  const msgRes = await req("POST", `/api/admin/orders/${orderId}/messages?channel=manufacturer_admin`, { jar: adminJar, form: { body: "Merhaba, sipariş hakkında bir sorum var." } });
  assert(msgRes.status === 200, "admin posted manufacturer message", `HTTP ${msgRes.status}`);
  let job = await notifQueue.getJob(jobId);
  assert(!!job, "delayed unread-message email scheduled");
  assert(job && job.opts.delay === 30 * 60 * 1000, "delay = 30 min", job ? `${job.opts.delay}` : "no job");

  // Second message keeps a single pending job (stable jobId)
  await req("POST", `/api/admin/orders/${orderId}/messages?channel=manufacturer_admin`, { jar: adminJar, form: { body: "İkinci mesaj." } });
  const jobsAfter = await notifQueue.getDelayed();
  assert(jobsAfter.filter((j) => j.id === jobId).length === 1, "back-to-back messages keep ONE pending email");

  // Manufacturer logs in and reads → job cancelled
  const mfgJar = new Map();
  await req("POST", "/api/manufacturer/auth/login", { jar: mfgJar, json: { email: "seller@e2e.test", password: "seller12345" } });
  const readRes = await req("POST", `/api/manufacturer/orders/${orderId}/messages/read`, { jar: mfgJar });
  assert(readRes.status === 200, "manufacturer marked thread read", `HTTP ${readRes.status}`);
  job = await notifQueue.getJob(jobId);
  assert(!job, "pending email cancelled after read");

  console.log(`\n\x1b[1mRESULT: ${pass} passed, ${fail} failed\x1b[0m`);
  await notifQueue.close();
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("HARNESS ERROR:", e); try { await notifQueue.close(); await pool.end(); } catch {} process.exit(2); });
