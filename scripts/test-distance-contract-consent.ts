/**
 * Mesafeli sözleşme ön bilgilendirme onayının bütünlük kontrolü.
 *
 * Buradaki her iddia hukuki bir gerekliliktir, stil tercihi değil. MSY m.7,
 * eksik ön bilgilendirmede sözleşmeyi "kurulmamış sayılır" der — yani onayı
 * TEK BİR akışta atlamak, kişiye özel üründeki cayma istisnasını da düşürür.
 *
 * Statik tarama kullanmamızın sebebi ampirik: daha önce `/api/orders`'a
 * doğrudan POST atan bir çağıran (Creative Lab) gözden kaçmış ve canlıda
 * checkout'u 400'lemişti. Kapıyı sıkılaştırırken çağıran listesini gözle
 * kontrol etmek yetmiyor; bu test onu kilitler.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PRELIMINARY_INFO_VERSION,
  DISTANCE_CONTRACT_VERSION,
  consentVariantForOrderType,
} from "../src/lib/config/distance-contract";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const FILES = walk("src");
const read = (p: string) => readFileSync(p, "utf8");

console.log("\nmesafeli sözleşme onayı");

check("/api/orders'a POST atan HER çağıran distanceContractConsent gönderir", () => {
  const callers = FILES.filter((p) => read(p).includes('fetch("/api/orders"'));
  assert.ok(callers.length >= 3, `çağıran bulunamadı (${callers.length})`);
  const missing = callers.filter((p) => !read(p).includes("distanceContractConsent"));
  assert.deepEqual(
    missing,
    [],
    `onay göndermeyen çağıran(lar) — bu akışlar 400 alır: ${missing.join(", ")}`
  );
});

check("API kapısı onayı zorunlu tutar ve 400 döner", () => {
  const route = read("src/app/api/orders/route.ts");
  assert.match(
    route,
    /body\?\.distanceContractConsent !== true/,
    "kapı yok — onaysız sipariş geçer"
  );
  assert.match(route, /preliminaryInfoAcceptedAt: new Date\(\)/, "damga yazılmıyor");
  assert.match(route, /preliminaryInfoVersion: PRELIMINARY_INFO_VERSION/, "sürüm yazılmıyor");
  assert.match(route, /distanceContractVersion: DISTANCE_CONTRACT_VERSION/, "sözleşme sürümü yazılmıyor");
});

check("onay damgası taslaktan siparişe kopyalanır", () => {
  // Web akışı önce order_drafts yazar; damga terfide taşınmazsa sipariş
  // üzerinde ispat kaydı KALMAZ ve draft temizlenince kanıt yok olur.
  const promo = read("src/lib/services/order-draft.ts");
  for (const f of [
    "preliminaryInfoAcceptedAt",
    "preliminaryInfoVersion",
    "distanceContractVersion",
    "consentIp",
    "consentUserAgent",
  ]) {
    assert.match(promo, new RegExp(`${f}: draft\\.${f}`), `${f} terfide kopyalanmıyor`);
  }
});

check("WhatsApp /pay akışı da ön bilgilendirme damgası alır", () => {
  // Sohbette ön bilgilendirme yapılamaz (MSY m.6 bütünlük ister); tek geçerli
  // an ödeme sayfasıdır. Damga orada alınmazsa WhatsApp siparişlerinin TAMAMI
  // belgesiz kalır.
  const route = read("src/app/api/pay/[reference]/consent/route.ts");
  assert.match(route, /preliminaryInfoAcceptedAt: new Date\(\)/);
  const gate = read("src/app/pay/[reference]/pay-consent-gate.tsx");
  assert.match(gate, /DistanceContractConsent/, "onay kutusu /pay sayfasında yok");
});

check("hazır ürüne kişiye özel metni GÖSTERİLMEZ", () => {
  // Mağaza ürününde cayma hakkı tam olarak vardır; oraya istisna metnini
  // koymak, tüketiciyi olmayan bir kısıtla bağlamaya çalışmaktır.
  assert.equal(consentVariantForOrderType("marketplace"), "readymade");
  assert.equal(consentVariantForOrderType("cart"), "readymade");
  assert.equal(consentVariantForOrderType("custom"), "personalized");
  assert.equal(consentVariantForOrderType("upload"), "personalized");
  const pdp = read("src/app/shop/[slug]/detail-client.tsx");
  assert.match(pdp, /variant="readymade"/, "PDP yanlış varyant gösteriyor");
});

check("onay kutusu önceden işaretli değildir", () => {
  // MSY m.6: onay tüketicinin fiiliyle verilmeli. useState(true) sessizce
  // "kabul edilmiş" sayardı.
  const c = read("src/components/distance-contract-consent.tsx");
  assert.match(c, /useState\(false\)/, "kutu önceden işaretli");
  assert.doesNotMatch(c, /useState\(true\)/);
});

check("özet blok MSY m.6/2-a'nın dört bendini de taşır", () => {
  const c = read("src/components/distance-contract-consent.tsx");
  assert.match(c, /summaryProduct/, "(a) temel nitelikler yok");
  assert.match(c, /formatCurrency\(priceKurus/, "(d) vergiler dâhil toplam yok");
  assert.match(c, /summaryWithdrawal/, "(g) cayma şartları yok");
  assert.match(c, /summaryWithdrawalNone/, "(h) cayma hakkının olmadığı bilgisi yok");
});

check("sürüm damgaları ISO tarih biçiminde ve boş değil", () => {
  for (const v of [PRELIMINARY_INFO_VERSION, DISTANCE_CONTRACT_VERSION]) {
    assert.match(v, /^\d{4}-\d{2}-\d{2}$/, `geçersiz sürüm: ${v}`);
  }
});

check("config bir worker yolundadır — server-only İÇERMEZ", () => {
  // order-draft.ts'yi BullMQ worker'ı import ediyor; `server-only` standalone
  // Node worker'ını çökertir (2026-06-13 olayı).
  const cfg = read("src/lib/config/distance-contract.ts");
  // Yorumda geçmesi sorun değil; ASIL import satırını arıyoruz.
  assert.doesNotMatch(cfg, /^\s*import\s+"server-only"/m);
});

check("hiçbir sayfada ayıp bildirimi 14 günle sınırlanmaz", () => {
  // TKHK m.12/1 iki yıl verir; daraltan şart m.5/2 uyarınca kesin hükümsüzdür.
  const pages = FILES.filter((p) => p.includes("src/app/") && p.endsWith("page.tsx"));
  const bad = pages.filter((p) => {
    const t = read(p);
    return /teslim tarihinden itibaren 14 gün/.test(t) || /within 14 days of delivery/.test(t);
  });
  assert.deepEqual(bad, [], `ayıp süresini daraltan sayfa(lar): ${bad.join(", ")}`);
});

check("SSS düz 'iade kabul edilmez' demez", () => {
  const tr = read("src/lib/i18n/dictionaries/tr.ts");
  const a7 = tr.match(/"landing\.faq\.a7": "([^"]*)"/)?.[1] ?? "";
  assert.ok(a7.length > 0, "landing.faq.a7 bulunamadı");
  assert.doesNotMatch(a7, /iade kabul edilmem/, "düz ret ifadesi /iade ile çelişiyor");
  assert.match(a7, /iki yıl/, "ayıp haklarının iki yıl sürdüğü söylenmiyor");
});

if (failures > 0) {
  console.error(`\n❌ mesafeli sözleşme onayı: ${failures} kontrol başarısız`);
  process.exit(1);
}
console.log("\n✅ mesafeli sözleşme onayı: tüm kontroller geçti");
