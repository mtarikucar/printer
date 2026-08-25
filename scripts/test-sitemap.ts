import assert from "node:assert/strict";
import { STATIC_ROUTES } from "../src/app/sitemap";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const paths = STATIC_ROUTES.map((r) => r.path);

test("her herkese açık sayfa sitemap'te", () => {
  // Denetimde eksik bulunan 11 route. Sitemap'te olmayan sayfa keşfedilmez.
  const required = [
    "",
    "/shop",
    "/create",
    "/figur",
    "/urunler",
    "/nasil-calisir",
    "/toplu-siparis",
    "/anahtarlik-kutusu",
    "/atolye",
    "/kargo",
    "/iade",
    "/cerez",
    "/mesafeli-satis",
    "/on-bilgilendirme",
    "/ticari-ileti",
    "/contact",
    "/privacy",
    "/terms",
  ];
  for (const p of required) {
    assert.ok(paths.includes(p), `${p || "/"} sitemap'te yok`);
  }
});

test("robots'ta engellenen hiçbir yol sitemap'te değil", () => {
  // Sitemap ile robots çelişirse Search Console uyarı üretir.
  const blocked = ["/admin", "/api", "/manufacturer", "/painter", "/cart", "/checkout"];
  for (const p of paths) {
    for (const b of blocked) {
      assert.ok(!p.startsWith(b), `${p} robots'ta engelli bir prefix altında`);
    }
  }
});

test("priority ve changeFrequency geçerli aralıkta", () => {
  const valid = new Set([
    "always", "hourly", "daily", "weekly", "monthly", "yearly", "never",
  ]);
  for (const r of STATIC_ROUTES) {
    assert.ok(r.priority >= 0 && r.priority <= 1, `${r.path} priority aralık dışı`);
    assert.ok(valid.has(String(r.changeFrequency)), `${r.path} changeFrequency geçersiz`);
  }
});

test("yol tekrarı yok", () => {
  assert.equal(new Set(paths).size, paths.length, "sitemap'te tekrarlanan yol var");
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
console.log(`\n${passed}/${cases.length} sitemap testi geçti`);
