import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  products,
  productFiles,
  productComponents,
  productAssemblySteps,
  orders,
  orderDrafts,
} from "../src/lib/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Product spec (STL + BOM + recipe) lifecycle against the LIVE :4320 server:
// seller creates a product → publish gate blocks without an STL → upload STL +
// BOM + recipe → submit → admin approve → buyer order → manufacturer downloads
// the part + sees BOM/recipe → storefront shows 3D + box contents.
// Needs: dev on :4320 with ADMIN_EMAIL=admin@test.local + ADMIN_PASSWORD_HASH,
// scripts/_e2e-prep.ts run first (manufacturer password + STL on disk).
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "http://127.0.0.1:4320";
let pass = 0;
let fail = 0;
const failures: string[] = [];
const ok = (n: string) => {
  pass++;
  console.log(`  ✓ ${n}`);
};
const bad = (n: string, d?: string) => {
  fail++;
  failures.push(n + (d ? ` — ${d}` : ""));
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
const STL_PATH = `${process.env.UPLOAD_DIR || "./uploads"}/models-upload/e2e-test.stl`;

async function main() {
  // ── Logins ──
  const adminJar = makeJar();
  const csrf = (await j(await req("GET", "/api/auth/csrf", { jar: adminJar })))?.csrfToken;
  await req("POST", "/api/auth/callback/credentials", {
    jar: adminJar,
    form: { csrfToken: String(csrf), email: "admin@test.local", password: "verify1234", redirect: "false" },
  });
  const adminOk = (await j(await req("GET", "/api/auth/session", { jar: adminJar })))?.user?.email === "admin@test.local";
  assert(adminOk, "admin girişi");

  const mfgJar = makeJar();
  const mfgLogin = await req("POST", "/api/manufacturer/auth/login", {
    jar: mfgJar,
    json: { email: "atolye3d@demo.local", password: "test1234" },
  });
  assert(mfgLogin.status === 200, "üretici girişi");

  const custJar = makeJar();
  const email = "e2e-spec-customer@demo.local";
  const reg = await req("POST", "/api/auth/register", {
    jar: custJar,
    json: { email, password: "customer123", fullName: "Spec Müşteri", phone: "+905321110000" },
  });
  if (reg.status !== 200)
    await req("POST", "/api/auth/login", { jar: custJar, json: { email, password: "customer123" } });

  // ── 1) Create product (draft) ──
  console.log("\n— 1) Ürün oluştur + yayın kapısı —");
  const create = await req("POST", "/api/manufacturer/products", {
    jar: mfgJar,
    json: {
      title: "E2E Masa Lambası",
      description: "Reçine gövde + LED. E2E spec testi.",
      priceKurus: 89900,
      material: "resin",
      category: "home_decor",
      leadTimeDays: 5,
    },
  });
  const productId = (await j(create))?.product?.id;
  assert(create.status === 200 && productId, "ürün oluşturuldu (draft)", `status=${create.status}`);

  // image (so the gate trips on files, not images)
  const imgForm = new FormData();
  imgForm.append("file", new Blob([new Uint8Array(PNG_1x1)], { type: "image/png" }), "cover.png");
  const imgRes = await fetch(`${BASE}/api/manufacturer/products/${productId}/images`, {
    method: "POST",
    headers: mfgJar.apply({}),
    body: imgForm,
  });
  assert(imgRes.status === 200, "kapak görseli yüklendi");

  // submit WITHOUT a print file → blocked
  const earlySubmit = await req("POST", `/api/manufacturer/products/${productId}/submit`, { jar: mfgJar });
  const earlyData = await j(earlySubmit);
  assert(
    earlySubmit.status === 400 && earlyData?.code === "no_files",
    "STL'siz yayın ENGELLENDİ (no_files)",
    `status=${earlySubmit.status} code=${earlyData?.code}`
  );

  // ── 2) Upload STL + BOM + recipe ──
  console.log("\n— 2) STL + BOM + reçete —");
  const stl = readFileSync(STL_PATH);
  const fileForm = new FormData();
  fileForm.append("file", new Blob([new Uint8Array(stl)]), "govde.stl");
  fileForm.append("partName", "Gövde");
  fileForm.append("quantity", "1");
  const fileRes = await fetch(`${BASE}/api/manufacturer/products/${productId}/files`, {
    method: "POST",
    headers: mfgJar.apply({}),
    body: fileForm,
  });
  assert(fileRes.status === 200, "STL parçası yüklendi", `status=${fileRes.status} ${JSON.stringify(await j(fileRes))?.slice(0, 120)}`);

  const specRes = await req("PATCH", `/api/manufacturer/products/${productId}/spec`, {
    jar: mfgJar,
    json: {
      components: [
        { name: "LED ışık 3W", quantity: 1, unit: "adet", notes: "E27 duy" },
        { name: "Adaptör 12V", quantity: 1, unit: "adet" },
      ],
      assemblySteps: [
        { instruction: "LED'i duya tak." },
        { instruction: "Adaptörü gövdeye bağla ve test et." },
      ],
    },
  });
  assert(specRes.status === 200, "BOM + reçete kaydedildi", `status=${specRes.status}`);

  const fileCount = (await db.select().from(productFiles).where(eq(productFiles.productId, productId))).length;
  const compCount = (await db.select().from(productComponents).where(eq(productComponents.productId, productId))).length;
  const stepCount = (await db.select().from(productAssemblySteps).where(eq(productAssemblySteps.productId, productId))).length;
  assert(fileCount === 1 && compCount === 2 && stepCount === 2, "DB: 1 dosya + 2 bileşen + 2 adım", `f=${fileCount} c=${compCount} s=${stepCount}`);

  // ── 3) Submit + admin approve ──
  console.log("\n— 3) Yayına gönder + admin onay —");
  const submit = await req("POST", `/api/manufacturer/products/${productId}/submit`, { jar: mfgJar });
  assert(submit.status === 200, "STL'li yayın GEÇTİ → pending_review", `status=${submit.status}`);
  const approve = await req("POST", `/api/admin/products/${productId}/approve`, { jar: adminJar, json: {} });
  assert(approve.status === 200, "admin onayladı → active", `status=${approve.status}`);
  const slug = (await db.query.products.findFirst({ where: eq(products.id, productId), columns: { slug: true, status: true } }));
  assert(slug?.status === "active" && !!slug.slug, "ürün yayında + slug üretildi");

  // ── 4) Buyer order → manufacturer downloads the part ──
  console.log("\n— 4) Sipariş → üretici parçayı indirir —");
  const order = await req("POST", "/api/orders", {
    jar: custJar,
    json: {
      orderType: "marketplace",
      productId,
      quantity: 1,
      shippingAddress: { adres: "Test 1", mahalle: "M", ilce: "Çankaya", il: "Ankara", postaKodu: "06100", telefon: "+905321110000" },
      paymentMethod: "bank_transfer",
    },
  });
  const ref = (await j(order))?.reference;
  assert(order.status === 200 && ref, "alıcı pazaryeri siparişi verdi (havale)", `status=${order.status}`);
  const draft = await db.query.orderDrafts.findFirst({ where: eq(orderDrafts.reference, ref) });
  await req("POST", `/api/admin/orders/${draft!.id}/mark-havale-paid`, { jar: adminJar, json: {} });
  const ord = await db.query.orders.findFirst({ where: eq(orders.draftId, draft!.id), columns: { id: true } });
  assert(!!ord, "havale onayı → sipariş oluştu");

  const fileRow = await db.query.productFiles.findFirst({ where: eq(productFiles.productId, productId), columns: { id: true } });
  const dl = await fetch(`${BASE}/api/manufacturer/orders/${ord!.id}/product-files/${fileRow!.id}/download`, {
    headers: mfgJar.apply({}),
  });
  const dlBytes = dl.status === 200 ? (await dl.arrayBuffer()).byteLength : 0;
  assert(
    dl.status === 200 && dlBytes > 50 && dl.headers.get("content-type")?.includes("octet-stream"),
    "üretici siparişin STL parçasını indirdi",
    `status=${dl.status} bytes=${dlBytes}`
  );

  // ── 5) Storefront box contents ──
  console.log("\n— 5) Mağaza kutu içeriği —");
  const page = await fetch(`${BASE}/shop/${slug!.slug}`, { headers: { cookie: "locale=tr" } }).then((r) => r.text());
  assert(page.includes("Kutu içeriği") && page.includes("LED ışık 3W"), "ürün sayfası 'Kutu içeriği' + LED gösteriyor");
  // recipe / internal notes must NOT leak to buyers
  assert(!page.includes("E27 duy") && !page.includes("duya tak"), "mağaza dahili notu/reçeteyi SIZDIRMADI");

  console.log(`\n══════════ SPEC E2E: ${pass} PASS / ${fail} FAIL ══════════`);
  if (failures.length) failures.forEach((f) => console.log("  • " + f));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
