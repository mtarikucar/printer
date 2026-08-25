import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DESIGN_TEMPLATES,
  isQuoteOnlyKind,
  isRestorableCreateStyle,
  priceKindForStyle,
} from "../src/lib/create/design-templates";
import {
  itemPriceKurus,
  isFlatPricedKind,
  UnpricedSizeError,
  FIGURINE_PRICE_KURUS,
} from "../src/lib/config/prices";
import { SIZE_PRESETS } from "../src/lib/config/sizes";

/**
 * `/create` flow contracts.
 *
 * The page sells ONE product (15 cm figurine, FIGURINE_PRICE_KURUS). Object /
 * 2D-design work is quote-only: it has no list price and goes to a hand quote
 * over WhatsApp, exactly as /nasil-calisir promises. Two regressions have
 * already been shipped around that boundary, so both directions are pinned:
 *
 *   1. A quote-only preview must NEVER reach the fixed-price checkout. The
 *      2D-design flow hands its preview to /create via `?previewId=`; if the
 *      page falls back to a figure style there, the customer is shown a
 *      ₺3.499 figurine checkout for a design they expected to be quoted.
 *   2. Creative Lab styles (keychain / fridge_magnet / lamp) must NOT be
 *      restored on /create at all — that regression (fixed in 5b738d9) ran the
 *      whole figurine form on a "modify and reorder" link and only failed
 *      server-side at submit.
 */

const ROOT = join(import.meta.dirname, "..");
const CREATE_PAGE = readFileSync(join(ROOT, "src/app/create/page.tsx"), "utf8");

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

/** Body of a top-level `const <name> = ... => { ... }` in create/page.tsx. */
function handlerBody(name: string): string {
  const start = CREATE_PAGE.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `${name} bulunamadı — create/page.tsx yeniden yazılmış olabilir`);
  const open = CREATE_PAGE.indexOf("{", CREATE_PAGE.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < CREATE_PAGE.length; i++) {
    if (CREATE_PAGE[i] === "{") depth++;
    else if (CREATE_PAGE[i] === "}") {
      depth--;
      if (depth === 0) return CREATE_PAGE.slice(open, i + 1);
    }
  }
  throw new Error(`${name} gövdesi kapanmadı`);
}

test("obje kind teklif-only, figür ve Creative Lab değil", () => {
  assert.equal(isQuoteOnlyKind("object"), true);
  assert.equal(isQuoteOnlyKind("figure"), false);
  assert.equal(isQuoteOnlyKind("keychain"), false);
  assert.equal(isQuoteOnlyKind("fridge_magnet"), false);
  assert.equal(isQuoteOnlyKind("lamp"), false);
});

test("teklif-only kind'ler SABİT FİYATLA fiyatlanamaz", () => {
  // Bu, sorunun para tarafı: teklif-only bir kind checkout'a girse bile
  // itemPriceKurus onu fiyatlandırmayı reddeder (₺0 sipariş deliği kapalı).
  for (const kind of ["object", "design"] as const) {
    assert.equal(isQuoteOnlyKind("object"), true);
    assert.throws(
      () =>
        itemPriceKurus({
          kind,
          size: SIZE_PRESETS[0].key,
          material: "resin",
          finish: "hand_painted",
        }),
      UnpricedSizeError,
      `${kind} tek satılabilir boyutta fiyatlanabiliyor — sabit fiyatlı checkout deliği`
    );
  }
});

test("Creative Lab stilleri /create'te ASLA restore edilmez (5b738d9 regresyonu)", () => {
  for (const slug of ["keychain", "fridge_magnet", "lamp"]) {
    assert.equal(isFlatPricedKind(priceKindForStyle(slug)), true, `${slug} düz fiyatlı olmalı`);
    assert.equal(
      isRestorableCreateStyle(slug),
      false,
      `${slug} /create'te restore ediliyor — "değiştir ve yeniden sipariş ver" yine 400'e çarpar`
    );
  }
});

test("figür stilleri restore edilmeye devam ediyor", () => {
  for (const t of DESIGN_TEMPLATES.filter((t) => t.priceKind === "figure")) {
    assert.equal(isRestorableCreateStyle(t.slug), true, `${t.slug} restore edilmiyor`);
  }
  // Bilinmeyen bir slug figüre düşer (priceKindForStyle varsayılanı) ve restore edilebilir.
  assert.equal(isRestorableCreateStyle("bilinmeyen-slug"), true);
});

test("obje stili restore EDİLİR — teklif kartına düşmesinin tek yolu bu", () => {
  // Regresyon koruması: obje restore edilmezse selectedStyle varsayılan figür
  // stiline düşer, isObjectStyle false olur ve 2D tasarım müşterisi ₺3.499
  // sabit fiyatlı figür checkout'una yönlendirilir.
  assert.equal(isRestorableCreateStyle("object"), true);
  assert.equal(priceKindForStyle("object"), "object");
});

test("restore edilebilen HER stil ya sabit fiyatlı figürdür ya da teklif-only", () => {
  // Değişmez: /create'in geri yükleyebildiği bir stil ya tam olarak
  // FIGURINE_PRICE_KURUS eder, ya da hiç fiyatlanamaz (teklif akışı).
  // Arada bir şey olması, ₺0/yanlış fiyatlı bir sipariş demektir.
  for (const t of DESIGN_TEMPLATES) {
    if (!isRestorableCreateStyle(t.slug)) continue;
    const args = {
      kind: t.priceKind,
      size: SIZE_PRESETS[0].key,
      material: "resin",
      finish: "hand_painted",
    } as const;
    if (isQuoteOnlyKind(t.priceKind)) {
      assert.throws(() => itemPriceKurus(args), UnpricedSizeError, `${t.slug} fiyatlanabiliyor`);
    } else {
      assert.equal(itemPriceKurus(args), FIGURINE_PRICE_KURUS, `${t.slug} tek fiyatta değil`);
    }
  }
});

test("create/page.tsx restore effect'leri isRestorableCreateStyle kullanır", () => {
  assert.match(
    CREATE_PAGE,
    /import \{[\s\S]*?isRestorableCreateStyle[\s\S]*?\} from "@\/lib\/create\/design-templates";/,
    "isRestorableCreateStyle import edilmemiş"
  );
  const restores = CREATE_PAGE.match(/setSelectedStyle\(data\.style\)/g) ?? [];
  assert.equal(restores.length, 2, "beklenen iki restore çağrısı (?previewId= ve ?fromOrder=) bulunamadı");
  const guarded =
    CREATE_PAGE.match(/isRestorableCreateStyle\(data\.style\)\) setSelectedStyle\(data\.style\)/g) ?? [];
  assert.equal(
    guarded.length,
    2,
    "restore çağrıları isRestorableCreateStyle ile korunmuyor — Creative Lab/obje stili sızabilir"
  );
});

test("handleApprove teklif-only önizlemeyi checkout'a (step 3) sokmaz", () => {
  const body = handlerBody("handleApprove");
  assert.match(
    body,
    /if \(isObjectStyle\) return;/,
    "handleApprove'da isObjectStyle guard'ı yok — obje önizlemesi sabit fiyatlı checkout'a girebilir"
  );
  assert.ok(
    body.indexOf("if (isObjectStyle) return;") < body.indexOf("setStep(3)"),
    "isObjectStyle guard'ı setStep(3)'ten SONRA geliyor"
  );
});

test("handleSubmit teklif-only bir kind için sipariş POST etmez", () => {
  const body = handlerBody("handleSubmit");
  assert.match(
    body,
    /if \(isObjectStyle\) \{/,
    "handleSubmit'te isObjectStyle guard'ı yok — obje siparişi /api/orders'a gidebilir"
  );
  assert.ok(
    body.indexOf("if (isObjectStyle) {") < body.indexOf('fetch("/api/orders"'),
    "isObjectStyle guard'ı /api/orders çağrısından SONRA geliyor"
  );
});

test("step 2'de sabit fiyat pili teklif-only önizlemede gizli", () => {
  assert.match(
    CREATE_PAGE,
    /\{!isObjectStyle && \([\s\S]{0,600}?create\.preview\.priceLabel/,
    "₺ fiyat pili !isObjectStyle ile kapatılmamış — teklif-only önizlemede sabit fiyat görünür"
  );
  assert.match(
    CREATE_PAGE,
    /\{isObjectStyle && \([\s\S]{0,600}?create\.customDesign\.quoteNext/,
    "step 2'de teklif kartı yok"
  );
});

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}
console.log(`\n${passed}/${cases.length} create-flow checks passed`);
