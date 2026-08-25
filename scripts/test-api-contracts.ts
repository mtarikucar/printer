import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createOrderSchema } from "../src/lib/validators/order";
import { generateSchema } from "../src/app/api/preview/generate/route";
import { SIZE_PRESETS, SIZE_PRESET_KEYS } from "../src/lib/config/sizes";
import { reorderBlocked } from "../src/app/api/customer/orders/[orderNumber]/reorder/route";

/**
 * Static contract check between the client and the App Router API.
 *
 * A `fetch("/api/…", { method: "POST" })` against a route.ts that only exports
 * PATCH does not fail at build time or under `tsc` — it fails in the browser
 * with a 405 the first time a real user clicks the button. This walks every
 * literal fetch call in the app and asserts the target route actually exports
 * the method being used.
 *
 * Dynamic URLs (`/api/painter/orders/${id}/accept`) are supported: an
 * interpolated segment matches a `[param]` directory.
 */

const ROOT = join(import.meta.dirname, "..");
const API_ROOT = join(ROOT, "src/app/api");
const SCAN_DIRS = [join(ROOT, "src/app"), join(ROOT, "src/components")];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

interface Call {
  file: string;
  line: number;
  url: string;
  method: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Collect `fetch("/api/…", { method })` calls. The method is read from the
 * init object that follows the URL, bounded by the next `fetch(` so a
 * neighbouring call's method is never attributed to this one.
 */
function collectCalls(file: string): Call[] {
  const src = readFileSync(file, "utf8");
  const calls: Call[] = [];
  const re = /fetch\(\s*[`"'](\/api\/[^`"']*)[`"']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const rest = src.slice(m.index + m[0].length);
    const nextFetch = rest.indexOf("fetch(");
    const window = rest.slice(0, nextFetch === -1 ? 600 : Math.min(nextFetch, 600));
    const methodMatch = window.match(/method:\s*["'](\w+)["']/);
    calls.push({
      file: relative(ROOT, file),
      line: src.slice(0, m.index).split("\n").length,
      url: m[1],
      method: (methodMatch?.[1] ?? "GET").toUpperCase(),
    });
  }
  return calls;
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
  } catch {
    return [];
  }
}

function routeFileIn(dir: string): string | null {
  const route = join(dir, "route.ts");
  try {
    statSync(route);
    return route;
  } catch {
    return null;
  }
}

/**
 * Resolve a URL path to every route.ts it could hit. An interpolated segment
 * standing in for an id (`${order.id}`) resolves to the `[param]` dir; one
 * standing in for a verb (`.../${action}`) fans out to every literal sibling,
 * and the caller treats that as unverifiable rather than guessing.
 */
function resolveRoutes(urlPath: string): string[] {
  const q = urlPath.indexOf("?");
  const segments = (q === -1 ? urlPath : urlPath.slice(0, q))
    .split("/")
    .filter(Boolean)
    .slice(1); // drop the leading "api"

  let dirs = [API_ROOT];
  for (const segment of segments) {
    const next: string[] = [];
    for (const dir of dirs) {
      const entries = subdirs(dir);
      if (segment.includes("${")) {
        // Could be an id (matches `[param]`) or a verb (matches a literal dir).
        for (const e of entries) next.push(join(dir, e));
      } else {
        const literal = entries.find((e) => e === segment);
        const param = entries.find((e) => e.startsWith("[") && e.endsWith("]"));
        const hit = literal ?? param;
        if (hit) next.push(join(dir, hit));
      }
    }
    dirs = next;
    if (dirs.length === 0) return [];
  }

  return dirs.map(routeFileIn).filter((r): r is string => r !== null);
}

function exportedMethods(routeFile: string): string[] {
  const src = readFileSync(routeFile, "utf8");
  return HTTP_METHODS.filter((verb) =>
    new RegExp(`export\\s+(async\\s+function|function|const)\\s+${verb}\\b`).test(src)
  );
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const files = SCAN_DIRS.flatMap((d) => walk(d));
const calls = files.flatMap(collectCalls);

check("found API calls to check", () => {
  assert.ok(calls.length > 50, `only found ${calls.length} fetch calls — the scanner is broken`);
});

const unresolved: Call[] = [];
const ambiguous: Call[] = [];
const mismatched: (Call & { exports: string[] })[] = [];

for (const call of calls) {
  const routeFiles = resolveRoutes(call.url);
  if (routeFiles.length === 0) {
    unresolved.push(call);
    continue;
  }
  if (routeFiles.length > 1) {
    // A `/${action}` tail — which sibling route runs depends on a runtime value.
    ambiguous.push(call);
    continue;
  }
  const methods = exportedMethods(routeFiles[0]);
  if (!methods.includes(call.method)) {
    mismatched.push({ ...call, exports: methods });
  }
}

check("every fetched /api path has a route.ts", () => {
  const detail = unresolved
    .map((c) => `    ${c.file}:${c.line} → ${c.method} ${c.url}`)
    .join("\n");
  assert.strictEqual(unresolved.length, 0, `\n  Unroutable API calls (404):\n${detail}\n`);
});

check("every fetch method is exported by its route handler", () => {
  const detail = mismatched
    .map(
      (c) =>
        `    ${c.file}:${c.line} → ${c.method} ${c.url}  (route exports: ${
          c.exports.join(", ") || "nothing"
        })`
    )
    .join("\n");
  assert.strictEqual(mismatched.length, 0, `\n  Method mismatches (405):\n${detail}\n`);
});

// ---------------------------------------------------------------------------
// Order-schema contract: one product, one material, one size (2026-08-24).
// ---------------------------------------------------------------------------
// A hardcoded `figurineSize: "<key>"` anywhere in the app is the exact shape of
// the 2026-08-24 regression: /urunler and the 2D-design flow kept sending the
// retired "orta" long after SIZE_PRESET_KEYS collapsed to one preset, so their
// preview generation AND checkout 400'd — invisibly to tsc, lint and the type
// system, because it is just a string. Every legitimate literal must be a
// currently sellable preset; a bespoke measurement always arrives in a variable.
check("hiçbir dosya geçersiz bir figurineSize literali göndermiyor", () => {
  const bad: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const re = /figurineSize:\s*["'`]([^"'`]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (!(SIZE_PRESET_KEYS as readonly string[]).includes(m[1])) {
        bad.push(
          `    ${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length} → "${m[1]}"`
        );
      }
    }
  }
  assert.strictEqual(
    bad.length,
    0,
    `\n  Satılamayan figurineSize literalleri (şema 400 döner):\n${bad.join("\n")}\n` +
      `  Satılabilir preset(ler): ${SIZE_PRESET_KEYS.join(", ")}. ` +
      `Sabit yazmak yerine SIZE_PRESETS[0].key kullanın.\n`
  );
});


check("sipariş doğrulama: yalnızca reçine ve standart boyut kabul edilir", () => {
  const base = {
    photoKey: "uploads/x.webp",
    figurineSize: "standart",
    style: "realistic",
    material: "resin",
    finish: "hand_painted",
    shippingAddress: {
      adres: "Test Mahallesi 1",
      mahalle: "Test Mahallesi",
      il: "Ankara",
      ilce: "Etimesgut",
      postaKodu: "06790",
      telefon: "+905551112233",
    },
  };
  assert.equal(createOrderSchema("tr").safeParse(base).success, true);
  // Filament artık satılmıyor.
  assert.equal(
    createOrderSchema("tr").safeParse({ ...base, material: "filament" }).success,
    false
  );
  // Emekli tier'lar reddedilir.
  assert.equal(
    createOrderSchema("tr").safeParse({ ...base, figurineSize: "orta" }).success,
    false
  );
});

// ─── Reorder-guard contract: object/design must never reach itemPriceKurus ──
// Regresyon koruması (2026-08-24): reorder route'unun eski guard'ı yalnızca
// `!isFlatPriced && (!figurineSize || !isPriceableSize(figurineSize))`
// koşuluna bakıyordu. `figurineSize === "standart"` + kind "object" bu
// koşulu GEÇERDİ (isPriceableSize("standart") true), guard'ı atlayıp
// itemPriceKurus'a ulaşırdı — orası artık UnpricedSizeError fırlatıyor ve
// route'ta bunu yakalayan try/catch yok → yakalanmamış 500. reorderBlocked
// artık kind "object" olan her siparişi, boyuttan bağımsız, baştan engelliyor.
check("reorderBlocked: obje/standart artık itemPriceKurus'a hiç ulaşmadan engellenir", () => {
  assert.equal(
    reorderBlocked({ orderType: "custom", style: "object", figurineSize: "standart" }),
    true,
    "object/standart guard'ı geçip 500'e düşüyor"
  );
  // Emekli tier'lı obje siparişleri zaten engelleniyordu — regresyon değil,
  // ama reorderBlocked'ın hâlâ doğru sonucu verdiğini doğrular.
  assert.equal(
    reorderBlocked({ orderType: "custom", style: "object", figurineSize: "orta" }),
    true
  );
});

check("reorderBlocked: figür ve Creative Lab reorder yolu BOZULMADI", () => {
  assert.equal(
    reorderBlocked({ orderType: "custom", style: "realistic", figurineSize: "standart" }),
    false,
    "satılabilir figür reorder edilemez hale geldi"
  );
  assert.equal(
    reorderBlocked({ orderType: "custom", style: "realistic", figurineSize: "orta" }),
    true,
    "emekli boyutlu figür hâlâ engellenmeli"
  );
  // Creative Lab: figurineSize nötr "orta" olarak saklanır ve isPriceableSize
  // için geçersizdir — flat-priced kind olduğu için yine de izin verilmeli.
  for (const style of ["keychain", "fridge_magnet", "lamp"]) {
    assert.equal(
      reorderBlocked({ orderType: "custom", style, figurineSize: "orta" }),
      false,
      `${style} Creative Lab reorder'ı yanlışlıkla engellendi`
    );
  }
  assert.equal(
    reorderBlocked({ orderType: "marketplace", style: "realistic", figurineSize: "standart" }),
    true,
    "marketplace siparişleri hâlâ engellenmeli"
  );
});

// ─── Creative Lab + 2D-design contract (2026-08-25) ─────────────────────────
// Bu blok, `SIZE_PRESET_KEYS` daralmasının açtığı deliğin nöbetçisidir.
// SIZE_PRESET_KEYS `["standart"]`'a indirildiğinde /urunler (anahtarlık,
// buzdolabı magneti, gece lambası) ve /create?path=design hâlâ emekli
// `figurineSize: "orta"` gönderiyordu; iki şema da `z.enum(SIZE_PRESET_KEYS)`
// kullandığı için hem önizleme üretimi hem checkout sessizce 400 döndü. Hiçbir
// tsc/lint hatası vermedi, çünkü gönderilen değer düz bir string literaliydi.
// Buradaki case'ler payload'ları ŞEMALARIN KENDİSİNE parse ettirir: bir preset
// yeniden adlandırılır/emekliye ayrılırsa test kırmızıya döner, müşteri değil.

const ADDRESS = {
  adres: "Akın 688 Sitesi B32",
  mahalle: "Şehit Osman Avcı Mahallesi",
  ilce: "Etimesgut",
  il: "Ankara",
  postaKodu: "06790",
  telefon: "+905551112233",
} as const;

/** /urunler'in CheckoutForm'a verdiği orderPayload'ın birebir şekli. */
function creativeLabOrder(style: string, over: Record<string, unknown> = {}) {
  return {
    orderType: "custom",
    photoKey: "photos/x.webp",
    figurineSize: SIZE_PRESETS[0].key,
    style,
    material: "resin",
    finish: "paintable_kit",
    shippingAddress: ADDRESS,
    ...over,
  };
}

const CREATIVE_LAB_STYLES = ["keychain", "fridge_magnet", "lamp"] as const;

check("Creative Lab checkout'u sipariş şemasından GEÇER (üç ürün de)", () => {
  for (const style of CREATIVE_LAB_STYLES) {
    const res = createOrderSchema("tr").safeParse(creativeLabOrder(style));
    assert.equal(
      res.success,
      true,
      `${style} checkout'u 400 dönüyor: ${JSON.stringify(res.error?.issues)}`
    );
  }
});

check("Creative Lab checkout'u emekli tier ile REDDEDİLİR", () => {
  for (const style of CREATIVE_LAB_STYLES) {
    assert.equal(
      createOrderSchema("tr").safeParse(creativeLabOrder(style, { figurineSize: "orta" }))
        .success,
      false,
      `${style} emekli "orta" boyutunu kabul ediyor`
    );
  }
});

check("önizleme şeması: Creative Lab ve 2D-tasarım payload'ları GEÇER", () => {
  for (const style of [...CREATIVE_LAB_STYLES, "object", "realistic"]) {
    const res = generateSchema.safeParse({
      photoKey: "photos/x.webp",
      figurineSize: SIZE_PRESETS[0].key,
      style,
      modifiers: [],
    });
    assert.equal(
      res.success,
      true,
      `${style} önizleme üretimi 400 dönüyor: ${JSON.stringify(res.error?.issues)}`
    );
  }
});

check("önizleme şeması: emekli tier REDDEDİLİR", () => {
  for (const size of ["orta", "kucuk", "buyuk"]) {
    assert.equal(
      generateSchema.safeParse({
        photoKey: "photos/x.webp",
        figurineSize: size,
        style: "keychain",
        modifiers: [],
      }).success,
      false,
      `önizleme şeması emekli "${size}" boyutunu kabul ediyor`
    );
  }
});

// ─── Finish gating: boyacı ₺0 deliği (2026-08-25) ───────────────────────────
// `figurineSize`/`material` tek ürüne sabitlenmişti ama `finish` sabitlenmemiş
// ve varsayılanı emekli `paintable_kit` kalmıştı. Tüm surcharge'lar 0 olduğu
// için fiyat yine ₺3.499 çıkıyor, ancak `finishNeedsPainter("paintable_kit")`
// false → sipariş boyacıya HİÇ yönlendirilmiyor (boyacı ₺0 alır, payı
// üreticinin tabanına geçer) ve kargo e-postası kutuda olmayan boya kiti
// içeriğini listeliyor. Bunu kapalı tutan tek şey /create'in client sabitiydi.

function figureOrder(over: Record<string, unknown> = {}) {
  return {
    photoKey: "photos/x.webp",
    figurineSize: SIZE_PRESETS[0].key,
    style: "realistic",
    material: "resin",
    finish: "hand_painted",
    shippingAddress: ADDRESS,
    ...over,
  };
}

check("figür siparişi: yalnızca hand_painted kabul edilir", () => {
  assert.equal(createOrderSchema("tr").safeParse(figureOrder()).success, true);
  for (const finish of ["paintable_kit", "collector_raw", "luxe_display", "raw"]) {
    assert.equal(
      createOrderSchema("tr").safeParse(figureOrder({ finish })).success,
      false,
      `figür siparişi emekli "${finish}" bitişini kabul ediyor — boyacı ₺0 alır`
    );
  }
});

check("finish atlanırsa varsayılan, ürün türüne göre doldurulur", () => {
  const fig = createOrderSchema("tr").safeParse(figureOrder({ finish: undefined }));
  assert.equal(fig.success, true);
  assert.equal(
    fig.data?.finish,
    "hand_painted",
    "figür varsayılanı hand_painted değil — sipariş boyacıya gitmez"
  );
  // Düz fiyatlı Creative Lab ürünlerinin finish ekseni yok: sabit bir
  // varsayılan burada refine'a takılıp checkout'u 400'lerdi.
  for (const style of CREATIVE_LAB_STYLES) {
    const cl = createOrderSchema("tr").safeParse(
      creativeLabOrder(style, { finish: undefined })
    );
    assert.equal(cl.success, true, `${style} finish'siz payload'da 400 dönüyor`);
    assert.equal(cl.data?.finish, "paintable_kit");
  }
});

check("Creative Lab hand_painted'i REDDEDER (ödenmemiş boyama)", () => {
  for (const style of CREATIVE_LAB_STYLES) {
    assert.equal(
      createOrderSchema("tr").safeParse(creativeLabOrder(style, { finish: "hand_painted" }))
        .success,
      false,
      `${style} hand_painted kabul ediyor — düz fiyata ücretsiz boyama işaretlenir`
    );
  }
});


console.log(
  `\n✅ api-contracts: ${passed} checks passed ` +
    `(${calls.length - ambiguous.length} fetch calls verified, ` +
    `${ambiguous.length} skipped — runtime-chosen route segment)`
);
