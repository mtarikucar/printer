import "dotenv/config";
import { and, eq, isNull, like, desc, inArray } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  products,
  orders,
  orderDrafts,
  orderItems,
  uploadedModels,
  manufacturers,
  manufacturerEarnings,
  productReviews,
  users,
  customerNotifications,
} from "../src/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Full end-to-end lifecycle against the LIVE dev server (4320): customer cart →
// payment (simulated promote) → per-seller sub-orders → manufacturer accept/
// print/QC → admin QC-approve → ship → deliver → customer review → admin refund
// → payout request/paid. Plus upload-order + quote-bridge lifecycles. Prints a
// PASS/FAIL checklist; exits 1 if anything failed.
// Requires: dev on :4320 booted with ADMIN_EMAIL=admin@test.local and
// ADMIN_PASSWORD_HASH=$(cat /tmp/adminhash); scripts/_e2e-prep.ts run first.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "http://127.0.0.1:4320";
let pass = 0;
let fail = 0;
const failures: string[] = [];
function ok(name: string) {
  pass++;
  console.log(`  ✓ ${name}`);
}
function bad(name: string, detail?: string) {
  fail++;
  failures.push(name + (detail ? ` — ${detail}` : ""));
  console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
}
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) ok(name);
  else bad(name, detail);
}
function section(t: string) {
  console.log(`\n— ${t} ${"—".repeat(Math.max(1, 60 - t.length))}`);
}

function makeJar() {
  const jar = new Map<string, string>();
  return {
    apply(headers: Record<string, string> = {}) {
      if (jar.size)
        headers["cookie"] = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      return headers;
    },
    store(res: Response) {
      const sc = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      for (const c of sc) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const k = pair.slice(0, i).trim();
        const v = pair.slice(i + 1).trim();
        if (!v || v === "deleted") jar.delete(k);
        else jar.set(k, v);
      }
    },
  };
}
type Jar = ReturnType<typeof makeJar>;

async function req(
  method: string,
  path: string,
  opts: { jar?: Jar; json?: unknown; form?: Record<string, string>; body?: BodyInit; headers?: Record<string, string> } = {}
) {
  const h: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined = opts.body;
  if (opts.json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    h["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  opts.jar?.apply(h);
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  opts.jar?.store(res);
  return res;
}
const j = async (r: Response) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const ADDRESS = {
  adres: "E2E Test Mah. 1. Sk. No:1",
  mahalle: "Test",
  ilce: "Çankaya",
  il: "Ankara",
  postaKodu: "06100",
  telefon: "+905321119988",
};

async function adminLogin(): Promise<Jar> {
  const jar = makeJar();
  const csrfRes = await req("GET", "/api/auth/csrf", { jar });
  const csrf = (await j(csrfRes))?.csrfToken;
  assert(csrf, "admin: csrf token alındı");
  const login = await req("POST", "/api/auth/callback/credentials", {
    jar,
    form: {
      csrfToken: String(csrf),
      email: "admin@test.local",
      password: "verify1234",
      redirect: "false",
    },
  });
  // NextAuth answers 302 on success; session cookie must be in the jar now.
  const me = await req("GET", "/api/auth/session", { jar });
  const sess = await j(me);
  assert(
    login.status === 302 && sess?.user?.email === "admin@test.local",
    "admin: NextAuth girişi (admin@test.local)",
    `status=${login.status} session=${JSON.stringify(sess)?.slice(0, 120)}`
  );
  return jar;
}

async function customerLogin(): Promise<Jar> {
  const jar = makeJar();
  const email = "e2e-customer@demo.local";
  const reg = await req("POST", "/api/auth/register", {
    jar,
    json: {
      email,
      password: "customer123",
      fullName: "E2E Müşteri",
      phone: "+905321119988",
    },
  });
  if (reg.status !== 200) {
    const login = await req("POST", "/api/auth/login", {
      jar,
      json: { email, password: "customer123" },
    });
    assert(login.status === 200, "customer: login (mevcut hesap)", `status=${login.status}`);
  } else {
    ok("customer: kayıt (yeni hesap)");
  }
  const me = await j(await req("GET", "/api/auth/me", { jar }));
  assert(me?.user?.email === email, "customer: oturum doğrulandı");
  return jar;
}

async function manufacturerLogin(): Promise<{ jar: Jar; id: string }> {
  const jar = makeJar();
  const res = await req("POST", "/api/manufacturer/auth/login", {
    jar,
    json: { email: "atolye3d@demo.local", password: "test1234" },
  });
  assert(res.status === 200, "manufacturer: giriş (atolye3d@demo.local)", `status=${res.status}`);
  const row = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.email, "atolye3d@demo.local"),
    columns: { id: true },
  });
  return { jar, id: row!.id };
}

async function manufacturerRun(
  mfgJar: Jar,
  adminJar: Jar,
  orderId: string,
  label: string
) {
  const step = async (name: string, path: string, body?: unknown) => {
    const r = await req("POST", `/api/manufacturer/orders/${orderId}/${path}`, {
      jar: mfgJar,
      json: body ?? {},
    });
    assert(r.status === 200, `${label}: ${name}`, `status=${r.status} ${JSON.stringify(await j(r))?.slice(0, 120)}`);
    return r;
  };
  await step("accept", "accept");
  await step("start-printing", "start-printing");
  await step("finish-printing", "finish-printing");

  // QC photo upload (multipart).
  const fd = new FormData();
  fd.append("files", new Blob([new Uint8Array(PNG_1x1)], { type: "image/png" }), "qc.png");
  const up = await fetch(`${BASE}/api/manufacturer/orders/${orderId}/qc-photos`, {
    method: "POST",
    headers: mfgJar.apply({}),
    body: fd,
  });
  assert(up.status === 200, `${label}: QC fotoğraf yükleme`, `status=${up.status}`);
  await step("submit-qc", "submit-qc");

  const qa = await req("POST", `/api/admin/orders/${orderId}/qc-approve`, {
    jar: adminJar,
    json: {},
  });
  assert(qa.status === 200, `${label}: admin QC onayı`, `status=${qa.status}`);

  const ship = await req("POST", `/api/manufacturer/orders/${orderId}/ship`, {
    jar: mfgJar,
    json: { trackingNumber: "E2E123456789TR" },
  });
  assert(ship.status === 200, `${label}: kargoya verildi`, `status=${ship.status}`);

  const o = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    columns: { status: true, manufacturerStatus: true, trackingNumber: true },
  });
  assert(
    o?.status === "shipped" && o.trackingNumber === "E2E123456789TR",
    `${label}: sipariş 'shipped' + takip no kayıtlı`,
    JSON.stringify(o)
  );
}

async function main() {
  section("0) Oturumlar");
  const adminJar = await adminLogin();
  const customerJar = await customerLogin();
  const { jar: mfgJar, id: mfgId } = await manufacturerLogin();

  // Temizlik: önceki e2e koşusunun kalıntıları.
  const me = await db.query.users.findFirst({
    where: eq(users.email, "e2e-customer@demo.local"),
    columns: { id: true },
  });
  if (me) {
    await db.delete(productReviews).where(eq(productReviews.userId, me.id));
  }

  section("1) Sepet (çok satıcılı) → ödeme → alt-siparişler");
  const sellerProduct = await db.query.products.findFirst({
    where: and(eq(products.status, "active"), eq(products.manufacturerId, mfgId)),
    columns: { id: true, title: true, priceKurus: true },
  });
  const platformProduct = await db.query.products.findFirst({
    where: and(eq(products.status, "active"), isNull(products.manufacturerId)),
    columns: { id: true, title: true, priceKurus: true },
  });
  assert(sellerProduct && platformProduct, "katalogda satıcı + platform ürünü var");

  await req("DELETE", "/api/cart", { jar: customerJar });
  const add1 = await req("POST", "/api/cart", {
    jar: customerJar,
    json: { productId: sellerProduct!.id, quantity: 2 },
  });
  const add2 = await req("POST", "/api/cart", {
    jar: customerJar,
    json: { productId: platformProduct!.id, quantity: 1 },
  });
  const cart = await j(add2);
  assert(
    add1.status === 200 && add2.status === 200 && cart?.count === 3,
    "sepete 2 üründen 3 adet eklendi",
    `count=${cart?.count}`
  );

  const orderRes = await req("POST", "/api/orders", {
    jar: customerJar,
    json: {
      orderType: "marketplace",
      items: [
        { productId: sellerProduct!.id, quantity: 2 },
        { productId: platformProduct!.id, quantity: 1 },
      ],
      shippingAddress: ADDRESS,
      paymentMethod: "bank_transfer",
    },
  });
  const orderData = await j(orderRes);
  assert(orderRes.status === 200 && orderData?.reference, "sepet siparişi (havale) oluştu", `status=${orderRes.status}`);

  const draft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.reference, orderData.reference),
  });
  const expectedTotal = sellerProduct!.priceKurus * 2 + platformProduct!.priceKurus;
  assert(
    draft?.amountKurus === expectedTotal && draft?.parentReference === orderData.reference,
    "taslak tutarı sunucuda doğru hesaplandı",
    `amount=${draft?.amountKurus} expected=${expectedTotal}`
  );

  // Gerçek admin yolu: havale dekontu onayı (draft → alt-siparişler).
  const mhp = await req("POST", `/api/admin/orders/${draft!.id}/mark-havale-paid`, {
    jar: adminJar,
    json: { notes: "E2E havale onayı" },
  });
  assert(mhp.status === 200, "admin: havale ödemesi onaylandı", `status=${mhp.status} ${JSON.stringify(await j(mhp))?.slice(0, 120)}`);
  const subs = await db
    .select()
    .from(orders)
    .where(eq(orders.parentReference, draft!.parentReference!));
  assert(subs.length === 2, "promote: satıcı başına 2 alt-sipariş", `count=${subs.length}`);
  const sellerSub = subs.find((o) => o.manufacturerId === mfgId);
  const platformSub = subs.find((o) => o.manufacturerId === null);
  assert(
    sellerSub?.manufacturerStatus === "assigned" && platformSub?.manufacturerStatus === "unassigned",
    "atama: satıcı alt-siparişi assigned, platform unassigned"
  );
  const items = await db.select().from(orderItems).where(eq(orderItems.draftId, draft!.id));
  assert(items.every((i) => i.orderId), "orderItems alt-siparişlere bağlandı");

  section("2) Üretici akışı (satıcı alt-siparişi): accept→print→QC→admin→ship");
  await manufacturerRun(mfgJar, adminJar, sellerSub!.id, "satıcı-sipariş");

  section("3) Admin: teslim + müşteri yorumu + iade");
  const del = await req("POST", `/api/admin/orders/${sellerSub!.id}/deliver`, {
    jar: adminJar,
    json: {},
  });
  assert(del.status === 200, "admin: teslim edildi işareti", `status=${del.status}`);

  const review = await req("POST", `/api/products/${sellerProduct!.id}/reviews`, {
    jar: customerJar,
    json: { rating: 5, body: "E2E: bayıldım, kalite harika." },
  });
  assert(review.status === 200, "müşteri: teslim sonrası yorum kabul edildi", `status=${review.status}`);
  const prodRow = await db.query.products.findFirst({
    where: eq(products.id, sellerProduct!.id),
    columns: { ratingCount: true, ratingAvgX100: true },
  });
  assert(
    (prodRow?.ratingCount ?? 0) >= 1 && (prodRow?.ratingAvgX100 ?? 0) === 500,
    "yorum: denorm puan karta yansıdı (5.0)",
    JSON.stringify(prodRow)
  );
  const gate = await req("POST", `/api/products/${platformProduct!.id}/reviews`, {
    jar: customerJar,
    json: { rating: 4 },
  });
  assert(gate.status === 403, "yorum kapısı: teslim edilmemiş ürüne yorum reddedildi", `status=${gate.status}`);

  const refund = await req("POST", `/api/admin/orders/${sellerSub!.id}/refund`, {
    jar: adminJar,
    json: { reason: "E2E iade testi" },
  });
  assert(refund.status === 200, "admin: iade işlendi", `status=${refund.status}`);
  const refunded = await db.query.orders.findFirst({
    where: eq(orders.id, sellerSub!.id),
    columns: { paymentStatus: true },
  });
  assert(refunded?.paymentStatus === "refunded", "iade: paymentStatus=refunded");
  const earn = await db.query.manufacturerEarnings.findFirst({
    where: eq(manufacturerEarnings.orderId, sellerSub!.id),
    columns: { status: true },
  });
  assert(earn?.status === "reversed", "iade: üretici kazancı geri alındı (reversed)", `status=${earn?.status}`);
  if (me) {
    const notif = await db.query.customerNotifications.findFirst({
      where: and(eq(customerNotifications.userId, me.id), eq(customerNotifications.type, "order_refunded")),
    });
    assert(!!notif, "iade: müşteri uygulama-içi bildirim aldı");
  }

  section("4) Platform alt-siparişi: admin manuel atama → üretici akışı");
  const assign = await req("POST", `/api/admin/orders/${platformSub!.id}/assign-manufacturer`, {
    jar: adminJar,
    json: { manufacturerId: mfgId },
  });
  if (assign.status === 200) {
    ok("admin: platform siparişine üretici atandı");
    await manufacturerRun(mfgJar, adminJar, platformSub!.id, "platform-sipariş");
  } else {
    bad("admin: platform siparişine üretici atandı", `status=${assign.status} ${JSON.stringify(await j(assign))?.slice(0, 160)}`);
  }

  section("5) Upload siparişi: hazır model → sipariş → review → atama → indirme");
  await db.delete(uploadedModels).where(like(uploadedModels.fileName, "E2E-lifecycle%"));
  const [um] = await db
    .insert(uploadedModels)
    .values({
      userId: me?.id ?? null,
      sourceKey: "models-upload/e2e-test.stl",
      sourceFormat: "stl",
      fileName: "E2E-lifecycle.stl",
      fileSizeBytes: 200,
      targetHeightMm: 80,
      material: "resin",
      status: "ready",
      isVolume: true,
      volumeMm3: 12000,
      priceKurus: 24900,
      needsQuote: false,
    })
    .returning();
  const upOrder = await req("POST", "/api/orders", {
    jar: customerJar,
    json: {
      orderType: "upload",
      uploadedModelId: um.id,
      shippingAddress: ADDRESS,
      paymentMethod: "bank_transfer",
    },
  });
  const upData = await j(upOrder);
  assert(upOrder.status === 200, "upload: sipariş oluştu", `status=${upOrder.status}`);
  const upDraft = await db.query.orderDrafts.findFirst({
    where: eq(orderDrafts.reference, upData.reference),
  });
  const upMhp = await req("POST", `/api/admin/orders/${upDraft!.id}/mark-havale-paid`, {
    jar: adminJar,
    json: {},
  });
  assert(upMhp.status === 200, "upload: admin havale onayı", `status=${upMhp.status}`);
  const upOrd = await db.query.orders.findFirst({
    where: eq(orders.draftId, upDraft!.id),
  });
  assert(upOrd?.status === "review" && upOrd.orderType === "upload", "upload: promote → status=review (AI yok)", `status=${upOrd?.status}`);

  const upApprove = await req("POST", `/api/admin/orders/${upOrd!.id}/approve`, {
    jar: adminJar,
    json: {},
  });
  const upAssign = await req("POST", `/api/admin/orders/${upOrd!.id}/assign-manufacturer`, {
    jar: adminJar,
    json: { manufacturerId: mfgId },
  });
  assert(
    upApprove.status === 200 && upAssign.status === 200,
    "upload: admin onay + üretici ataması",
    `approve=${upApprove.status} assign=${upAssign.status}`
  );
  const dl = await fetch(`${BASE}/api/manufacturer/orders/${upOrd!.id}/download-upload`, {
    headers: mfgJar.apply({}),
  });
  const dlBody = dl.status === 200 ? await dl.arrayBuffer() : null;
  assert(
    dl.status === 200 && (dlBody?.byteLength ?? 0) > 50 && dl.headers.get("content-type")?.includes("octet-stream"),
    "upload: üretici orijinal STL'i indirdi",
    `status=${dl.status} bytes=${dlBody?.byteLength}`
  );

  section("6) Teklif köprüsü: needsQuote → admin fiyat → müşteri kabul");
  const [qm] = await db
    .insert(uploadedModels)
    .values({
      userId: me?.id ?? null,
      sourceKey: "models-upload/e2e-test.stl",
      sourceFormat: "stl",
      fileName: "E2E-lifecycle-quote.stl",
      fileSizeBytes: 200,
      targetHeightMm: 200,
      material: "filament",
      status: "review",
      needsQuote: true,
      contactEmail: "e2e-customer@demo.local",
    })
    .returning();
  const quote = await req("POST", `/api/admin/upload-quotes/${qm.id}/quote`, {
    jar: adminJar,
    json: { priceKurus: 59900 },
  });
  assert(quote.status === 200, "quote: admin fiyat verdi (₺599)", `status=${quote.status}`);
  const qInfo = await j(await req("GET", `/api/upload/model/${qm.id}`));
  assert(qInfo?.quoteStatus === "quoted" && qInfo?.quotedPriceKurus === 59900, "quote: müşteri API'sinde teklif görünür");
  const qOrder = await req("POST", "/api/orders", {
    jar: customerJar,
    json: {
      orderType: "upload",
      uploadedModelId: qm.id,
      shippingAddress: ADDRESS,
      paymentMethod: "bank_transfer",
    },
  });
  const qData = await j(qOrder);
  const qDraft = qData?.reference
    ? await db.query.orderDrafts.findFirst({ where: eq(orderDrafts.reference, qData.reference) })
    : null;
  assert(
    qOrder.status === 200 && qDraft?.amountKurus === 59900,
    "quote: sipariş teklif fiyatından oluştu",
    `status=${qOrder.status} amount=${qDraft?.amountKurus}`
  );

  section("7) Kazanç + ödeme talebi → admin öder");
  const pending = await db
    .select()
    .from(manufacturerEarnings)
    .where(and(eq(manufacturerEarnings.manufacturerId, mfgId), eq(manufacturerEarnings.status, "pending"), isNull(manufacturerEarnings.payoutId)));
  if (pending.length === 0) {
    bad("payout: bekleyen kazanç bulunamadı (platform alt-siparişi kargolanamadıysa beklenebilir)");
  } else {
    const pr = await req("POST", "/api/manufacturer/payout-request", { jar: mfgJar, json: {} });
    const prData = await j(pr);
    assert(pr.status === 200 && prData?.payoutId, "payout: üretici ödeme talep etti", `status=${pr.status}`);
    if (prData?.payoutId) {
      const mp = await req("POST", `/api/admin/payouts/${prData.payoutId}/mark-paid`, { jar: adminJar, json: {} });
      assert(mp.status === 200, "payout: admin ödendi işaretledi", `status=${mp.status}`);
    }
  }

  section("8) Fiyat değişiklikleri canlıda");
  const createPage = await fetch(`${BASE}/create?path=figure`, {
    headers: { cookie: "locale=tr" },
  }).then((r) => r.text());
  assert(createPage.includes("899"), "figür sayfası ₺899 filament tabanını içeriyor");
  const home = await fetch(`${BASE}/`, { headers: { cookie: "locale=tr" } }).then((r) => r.text());
  assert(home.includes("899"), "anasayfa CTA ₺899'a güncellendi");

  console.log(`\n══════════ SONUÇ: ${pass} PASS / ${fail} FAIL ══════════`);
  if (failures.length) {
    console.log("Başarısızlar:");
    for (const f of failures) console.log("  • " + f);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
