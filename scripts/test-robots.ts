import assert from "node:assert/strict";
import robots from "../src/app/robots";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const r = robots();
const rules = Array.isArray(r.rules) ? r.rules : [r.rules!];
const agentsOf = (rule: (typeof rules)[number]) =>
  Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent!];
const ruleFor = (ua: string) =>
  rules.find((rule) => agentsOf(rule).includes(ua));
const asList = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []);

// The bots that decide whether we appear in AI answers. OpenAI's own docs:
// "Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT
// search answers." Blocking any of these makes the site uncitable.
const RETRIEVAL = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "Googlebot",
  "bingbot",
  "Applebot",
];

// Pure training crawlers — blocking them costs zero citations.
const TRAINING = ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "Bytespider"];

test("her alıntılayıcı bot açıkça allow edilmiş", () => {
  for (const ua of RETRIEVAL) {
    const rule = ruleFor(ua);
    assert.ok(rule, `${ua} için kural yok`);
    assert.ok(
      asList(rule!.allow).includes("/"),
      `${ua} kök dizine allow almamış`
    );
  }
});

test("saf eğitim botları disallow edilmiş", () => {
  for (const ua of TRAINING) {
    const rule = ruleFor(ua);
    assert.ok(rule, `${ua} için kural yok`);
    assert.ok(
      asList(rule!.disallow).includes("/"),
      `${ua} disallow edilmemiş`
    );
  }
});

test("ürün görselleri taranabilir, diğer /api kapalı", () => {
  for (const ua of [...RETRIEVAL, "*"]) {
    const rule = ruleFor(ua);
    if (!rule) continue;
    assert.ok(
      asList(rule.allow).includes("/api/files/products/"),
      `${ua} ürün görsellerini çekemez`
    );
    assert.ok(asList(rule.disallow).includes("/api/"), `${ua} için /api/ açık kalmış`);
  }
});

test("partner panelleri ve işlemsel URL'ler kapalı", () => {
  const wildcard = ruleFor("*");
  assert.ok(wildcard, "* kuralı yok");
  const dis = asList(wildcard!.disallow);
  for (const p of ["/admin/", "/manufacturer/", "/painter/", "/cart", "/checkout"]) {
    assert.ok(dis.includes(p), `${p} disallow listesinde yok`);
  }
});

test("facebookexternalhit asla bloklanmaz", () => {
  // WhatsApp link önizlemesini öldürür; siparişler WhatsApp'tan geliyor.
  const rule = ruleFor("facebookexternalhit");
  if (rule) {
    assert.ok(!asList(rule.disallow).includes("/"), "facebookexternalhit bloklanmış");
  }
});

test("sitemap ve host beyan edilmiş", () => {
  assert.match(String(r.sitemap), /\/sitemap\.xml$/);
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
console.log(`\n${passed}/${cases.length} robots testi geçti`);
