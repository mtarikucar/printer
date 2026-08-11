import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  products,
  orders,
  orderDrafts,
  orderItems,
  manufacturers,
  productFiles,
} from "../src/lib/db/schema";

// Multi-product cart sub-order → the manufacturer order detail must render ONE
// production panel PER product. Two active atolye3d products are carted by one
// customer → a single atolye3d sub-order with 2 line items → 2 panels.

const BASE = "http://127.0.0.1:4320";
const STL_PATH = `${process.env.UPLOAD_DIR || "./uploads"}/models-upload/e2e-test.stl`;
let pass = 0,
  fail = 0;
const ok = (n: string) => {
  pass++;
  console.log(`  ✓ ${n}`);
};
const bad = (n: string, d?: string) => {
  fail++;
  console.log(`  ✗ ${n}${d ? " — " + d : ""}`);
};
const assert = (c: unknown, n: string, d?: string) => (c ? ok(n) : bad(n, d));

function makeJar() {
  const jar = new Map<string, string>();
  return {
    apply(h: Record<string, string> = {}) {
      if (jar.size) h["cookie"] = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
      return h;
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
async function req(method: string, path: string, o: { jar?: Jar; json?: unknown } = {}) {
  const h: Record<string, string> = {};
  let body: string | undefined;
  if (o.json !== undefined) {
    h["content-type"] = "application/json";
    body = JSON.stringify(o.json);
  }
  o.jar?.apply(h);
  const res = await fetch(BASE + path, { method, headers: h, body, redirect: "manual" });
  o.jar?.store(res);
  return res;
}
const j = async (r: Response) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};
const ADDR = { adres: "T 1", mahalle: "M", ilce: "Çankaya", il: "Ankara", postaKodu: "06100", telefon: "+905321112233" };

async function ensureSpecFile(jar: Jar, productId: string) {
  const have = await db.select().from(productFiles).where(eq(productFiles.productId, productId));
  if (have.length) return;
  const stl = readFileSync(STL_PATH);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(stl)]), "part.stl");
  form.append("partName", "Gövde");
  await fetch(`${BASE}/api/manufacturer/products/${productId}/files`, {
    method: "POST",
    headers: jar.apply({}),
    body: form,
  });
}

async function main() {
  // logins
  const adminJar = makeJar();
  const csrf = (await j(await req("GET", "/api/auth/csrf", { jar: adminJar })))?.csrfToken;
  await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: adminJar.apply({ "content-type": "application/x-www-form-urlencoded" }),
    body: new URLSearchParams({ csrfToken: String(csrf), email: "admin@test.local", password: "verify1234", redirect: "false" }).toString(),
    redirect: "manual",
  }).then((r) => adminJar.store(r));

  const mfgJar = makeJar();
  await req("POST", "/api/manufacturer/auth/login", { jar: mfgJar, json: { email: "atolye3d@demo.local", password: "test1234" } });

  const custJar = makeJar();
  const email = "e2e-cartpanel@demo.local";
  const reg = await req("POST", "/api/auth/register", { jar: custJar, json: { email, password: "customer123", fullName: "Cart Panel", phone: "+905321112233" } });
  if (reg.status !== 200) await req("POST", "/api/auth/login", { jar: custJar, json: { email, password: "customer123" } });

  // 2 active atolye3d products
  const mfg = await db.query.manufacturers.findFirst({ where: eq(manufacturers.email, "atolye3d@demo.local"), columns: { id: true } });
  const prods = await db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(and(eq(products.manufacturerId, mfg!.id), eq(products.status, "active")))
    .limit(2);
  assert(prods.length === 2, "katalogda 2 aktif atolye3d ürünü var", `got ${prods.length}`);
  for (const p of prods) await ensureSpecFile(mfgJar, p.id);
  ok("her iki ürüne de baskı dosyası eklendi");

  // cart both → checkout (havale) → admin confirm
  await req("DELETE", "/api/cart", { jar: custJar });
  await req("POST", "/api/cart", { jar: custJar, json: { productId: prods[0].id, quantity: 1 } });
  await req("POST", "/api/cart", { jar: custJar, json: { productId: prods[1].id, quantity: 2 } });
  const order = await req("POST", "/api/orders", {
    jar: custJar,
    json: {
      orderType: "marketplace",
      items: [
        { productId: prods[0].id, quantity: 1 },
        { productId: prods[1].id, quantity: 2 },
      ],
      shippingAddress: ADDR,
      paymentMethod: "bank_transfer",
    },
  });
  const ref = (await j(order))?.reference;
  assert(order.status === 200 && ref, "2 üründen sepet siparişi oluştu");
  const draft = await db.query.orderDrafts.findFirst({ where: eq(orderDrafts.reference, ref) });
  await req("POST", `/api/admin/orders/${draft!.id}/mark-havale-paid`, { jar: adminJar, json: {} });

  const subs = await db.select().from(orders).where(eq(orders.parentReference, draft!.parentReference!));
  const sub = subs.find((o) => o.manufacturerId === mfg!.id);
  assert(!!sub, "atolye3d alt-siparişi oluştu");
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, sub!.id));
  assert(items.length === 2, "alt-sipariş 2 satır kalemi taşıyor", `got ${items.length}`);

  // fetch the manufacturer order page (authed, server-rendered) → 2 panels
  const html = await fetch(`${BASE}/manufacturer/orders/${sub!.id}`, { headers: mfgJar.apply({}) }).then((r) => r.text());
  const panelCount = (html.match(/Üretim dosyaları/g) || []).length;
  assert(panelCount >= 2, "üretici sayfasında 2 üretim paneli render edildi", `count=${panelCount}`);
  assert(
    html.includes(prods[0].title) && html.includes(prods[1].title),
    "her iki ürün başlığı panelde görünüyor"
  );

  console.log(`\n══════════ CART PANEL E2E: ${pass} PASS / ${fail} FAIL ══════════`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
