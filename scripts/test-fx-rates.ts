/**
 * TCMB bülteninin AYRIŞTIRILMASI ve BAYATLIK ölçüsü. Ağ yok, DB yok, Redis yok:
 * bülten `scripts/fixtures/fx/tcmb-today.xml`ten, `fetch` ise yerinde
 * değiştirilmiş bir çakmadan gelir.
 *
 * Beş şeyi kanıtlar:
 *
 * 1. Ayrıştırıcı TCMB **döviz ALIŞ** (`ForexBuying`) kolonunu okur — satış ya
 *    da efektif kolonunu DEĞİL. Fixture'da üç kolon da AYRI sayılar taşır ki
 *    bu ayırt edilebilsin (gerekçe `fx-rates.ts` dosya başlığında: eksik
 *    gösterilen bir fiyat sorumluluk doğurur, fazla gösterilen doğurmaz).
 * 2. `Unit` alanı GERÇEKTEN okunur ve bölünür; körü körüne 1 varsayılmaz.
 * 3. Bülten tarihi dosyanın KENDİ `Tarih_Date` özniteliğinden okunur,
 *    `new Date()`ten ASLA — test SAATİ KAYDIRARAK sınanır. Hafta sonu/tatilde
 *    TCMB dünkü bülteni verir; onu "bugünün kuru" diye damgalamak bu özelliğin
 *    en sinsi hatası olurdu.
 * 4. Yarım bülten (beklenen üç birimden biri eksik) TAMAMEN reddedilir, ve
 *    bozuk XML / boş gövde / HTTP 404 ETİKETLİ bir başarısızlık döner —
 *    FIRLATMA YOK (`indexnow.ts` sözleşmesi: tur sessizce başarısız olur,
 *    süreç düşmez).
 * 5. Bayatlık TAKVİM günü değil **İŞ GÜNÜ** ile ölçülür: araya giren hafta sonu
 *    ve `holidays` listesindeki bayram SAYILMAZ, sınırın iki yanı da sınanır ve
 *    `addBusinessDays`in akşam kesimi (`cutoffHour`) ölçüyü KAYDIRMAZ.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FX_MAX_AGE_BUSINESS_DAYS,
  TCMB_BULLETIN_URL,
  TCMB_TIMEOUT_MS,
  fetchTcmbBulletin,
  isFxBulletinStale,
  parseTcmbBulletin,
} from "../src/lib/services/fx-rates";

const ROOT = join(import.meta.dirname, "..");
const FIXTURE = readFileSync(join(ROOT, "scripts/fixtures/fx/tcmb-today.xml"), "utf8");

let failures = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        console.log(`  ✓ ${name}`);
      },
      (err: unknown) => {
        failures++;
        console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
      }
    );
}

function okBulletin(xml: string) {
  const result = parseTcmbBulletin(xml);
  assert.equal(result.ok, true, `bülten ayrıştırılamadı: ${result.ok ? "" : result.reason}`);
  assert.ok(result.ok);
  return result.bulletin;
}

function rateOf(xml: string, currency: string) {
  const row = okBulletin(xml).rates.find((r) => r.currency === currency);
  assert.ok(row, `${currency} satırı yok`);
  return row;
}

/**
 * Süreç saatini `iso`ya sabitler.
 *
 * Proxy ile: `new Date()` (argümansız) sabit ana, `new Date(x)` ise olduğu gibi
 * gerçek kurucuya gider. Böylece ayrıştırıcının bülten tarihini "bugün"den mi
 * yoksa dosyadan mı aldığı GERÇEKTEN ayırt edilebilir — yorumuna bakarak değil.
 */
function withFakeClock<T>(iso: string, fn: () => T): T {
  const real = Date;
  const fake = new Proxy(real, {
    construct: (target, args) =>
      Reflect.construct(target, args.length === 0 ? [iso] : args) as Date,
    get: (target, prop, receiver) =>
      prop === "now" ? () => real.parse(iso) : Reflect.get(target, prop, receiver),
  }) as DateConstructor;
  (globalThis as { Date: DateConstructor }).Date = fake;
  try {
    return fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = real;
  }
}

/**
 * `globalThis.fetch`i yerinde değiştirir; ağ ASLA açılmaz.
 *
 * `console.warn` da toplanır: yutulan her arızanın günlüğe yazılması
 * sözleşmenin PARÇASIDIR (sessizce başarısız olan bir tur, kimsenin bakmadığı
 * bir arızadır) — ve testin çıktısı bu sayede tertemiz kalır, yani gerçek bir
 * arıza gürültünün içinde kaybolmaz.
 */
async function withFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>
): Promise<{ result: T; warnings: string[] }> {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const warnings: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init)) as typeof fetch;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    return { result: await fn(), warnings };
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
}

/** Bülten tarihi: 2026-09-25 CUMA (fixture). */
const BULLETIN = "2026-09-25";
/** Bültenden 3 iş günü sonrası: Cuma(0) → Pzt(1) → Salı(2) → Çarşamba(3). */
const THIRD_BUSINESS_DAY = new Date("2026-09-30T09:00:00Z");
/** Dördüncü iş günü: Perşembe. */
const FOURTH_BUSINESS_DAY = new Date("2026-10-01T09:00:00Z");

async function main() {
  console.log("\n── Bülten ayrıştırma ──");

  await test("fixture → üç birim, ForexBuying (satış/efektif DEĞİL)", () => {
    const bulletin = okBulletin(FIXTURE);
    assert.deepEqual(
      bulletin.rates.map((r) => r.currency),
      ["EUR", "USD", "GBP"],
      "sıra tip sözleşmesindeki FX_CURRENCIES sırası olmalı (seçici bu sırayı çizer)"
    );
    // 48.7412 / 41.5231 / 55.9034 ForexBuying; satış (48.8290 / 41.5978 /
    // 56.1946) ve efektif alış (48.7071 / 41.4942 / 55.8643) BAŞKA sayılar.
    assert.equal(rateOf(FIXTURE, "EUR").microTryPerUnit, 48_741_200);
    assert.equal(rateOf(FIXTURE, "USD").microTryPerUnit, 41_523_100);
    assert.equal(rateOf(FIXTURE, "GBP").microTryPerUnit, 55_903_400);
  });

  await test("her satır bültenin KENDİ `Unit` değerini kanıt olarak taşır", () => {
    for (const rate of okBulletin(FIXTURE).rates) {
      assert.equal(rate.bulletinUnit, 1, `${rate.currency} birimi 1 olmalı`);
    }
  });

  await test("`Unit=2` olan bir satırda değer BÖLÜNÜR (körü körüne 1 varsayılmıyor)", () => {
    // EUR bloğunun `Unit`i 2 yapıldı: 48.7412 / 2 = 24.3706.
    const xml = FIXTURE.replace(
      /(<Currency[^>]*CurrencyCode="EUR"[^>]*>\s*<Unit>)1(<\/Unit>)/,
      "$12$2"
    );
    assert.notEqual(xml, FIXTURE, "fixture'daki EUR `Unit` alanı değiştirilemedi");
    const eur = rateOf(xml, "EUR");
    assert.equal(eur.microTryPerUnit, 24_370_600);
    assert.equal(eur.bulletinUnit, 2, "`Unit` kanıt olarak saklanmalı");
    // Öteki birimler etkilenmedi: bölme satır bazında.
    assert.equal(rateOf(xml, "USD").microTryPerUnit, 41_523_100);
  });

  await test("bülten tarihi dosyanın `Tarih_Date`inden gelir, `new Date()`ten DEĞİL", () => {
    // Saat 2027'ye kaydırıldı; bülten hâlâ 2026-09-25 olmalı.
    const shifted = withFakeClock("2027-03-14T10:00:00.000Z", () => okBulletin(FIXTURE));
    assert.equal(shifted.bulletinDate, BULLETIN);
    // Çakmanın gerçekten iş gördüğünün kanıtı: kaydırılmış saatte `new Date()`
    // başka bir gün verir. (Aksi hâlde yukarıdaki iddia bedava yeşil kalırdı.)
    const seenByClock = withFakeClock("2027-03-14T10:00:00.000Z", () =>
      new Date().toISOString().slice(0, 10)
    );
    assert.equal(seenByClock, "2027-03-14");
  });

  await test("GBP satırı silinmiş bülten TAMAMEN reddedilir (yarım bülten yazılmaz)", () => {
    const xml = FIXTURE.replace(/\s*<Currency[^>]*CurrencyCode="GBP"[\s\S]*?<\/Currency>/, "");
    assert.ok(!/CurrencyCode="GBP"/.test(xml), "GBP bloğu silinemedi");
    const result = parseTcmbBulletin(xml);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "missing_currency");
  });

  await test("bozuk XML / boş gövde / geçersiz tarih → etiketli başarısızlık, FIRLATMA YOK", () => {
    const cases: Array<[string, string]> = [
      ["", "empty_body"],
      ["   \n  ", "empty_body"],
      ["<html><body>503 Service Unavailable</body></html>", "malformed_xml"],
      [FIXTURE.replace('Tarih="25.09.2026"', 'Tarih="31.02.2026"'), "invalid_bulletin_date"],
      [FIXTURE.replace("<ForexBuying>48.7412</ForexBuying>", "<ForexBuying></ForexBuying>"), "invalid_rate"],
      [FIXTURE.replace(/(<Currency[^>]*CurrencyCode="USD"[^>]*>\s*<Unit>)1(<\/Unit>)/, "$10$2"), "invalid_rate"],
    ];
    for (const [xml, reason] of cases) {
      const result = parseTcmbBulletin(xml);
      assert.equal(result.ok, false, `"${xml.slice(0, 24)}…" reddedilmeliydi`);
      assert.ok(!result.ok);
      assert.equal(result.reason, reason, `beklenen etiket ${reason}`);
    }
  });

  console.log("\n── Çekme sözleşmesi (ağ yerinde değiştirildi) ──");

  await test("HTTP 404 → `http_error`, FIRLATMA YOK", async () => {
    const { result, warnings } = await withFetch(
      async () => new Response("Not Found", { status: 404 }),
      fetchTcmbBulletin
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "http_error");
    assert.ok(
      warnings.some((w) => w.includes("404")),
      "yutulan arıza günlüğe yazılmadı"
    );
  });

  await test("ağ hatası → `network_error`, FIRLATMA YOK", async () => {
    const { result, warnings } = await withFetch(async () => {
      throw new Error("ECONNRESET");
    }, fetchTcmbBulletin);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "network_error");
    assert.ok(
      warnings.some((w) => w.includes("ECONNRESET")),
      "yutulan arıza günlüğe yazılmadı"
    );
  });

  await test("boş 200 gövdesi → `empty_body`", async () => {
    const { result, warnings } = await withFetch(
      async () => new Response("", { status: 200 }),
      fetchTcmbBulletin
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.reason, "empty_body");
    assert.ok(
      warnings.some((w) => w.includes("empty_body")),
      "reddedilen bülten günlüğe yazılmadı"
    );
  });

  await test("çekme TCMB bültenini ZAMAN AŞIMI sinyaliyle ister", async () => {
    let seenUrl: string | null = null;
    let seenSignal: unknown = null;
    const { result, warnings } = await withFetch(async (url, init) => {
      seenUrl = url;
      seenSignal = init?.signal;
      return new Response(FIXTURE, { status: 200 });
    }, fetchTcmbBulletin);
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.equal(result.bulletin.bulletinDate, BULLETIN);
    assert.equal(seenUrl, TCMB_BULLETIN_URL);
    assert.ok(
      seenSignal instanceof AbortSignal,
      "`AbortSignal.timeout(TCMB_TIMEOUT_MS)` verilmemiş: yanıtsız bir soket turu sonsuza asardı"
    );
    assert.ok(TCMB_TIMEOUT_MS > 0 && TCMB_TIMEOUT_MS <= 30_000, "zaman aşımı makul olmalı");
    assert.deepEqual(warnings, [], "başarılı tur günlüğe uyarı YAZMAMALI");
  });

  console.log("\n── Bayatlık: İŞ GÜNÜ ölçüsü ──");

  await test("eşik ÜÇ İŞ GÜNÜ (tasarımın 7 TAKVİM günü sabiti kullanılmıyor)", () => {
    assert.equal(FX_MAX_AGE_BUSINESS_DAYS, 3);
  });

  await test("3. iş günü GEÇERLİ, 4. iş günü BAYAT (sınırın iki yanı)", () => {
    assert.equal(isFxBulletinStale(BULLETIN, [], THIRD_BUSINESS_DAY), false);
    assert.equal(isFxBulletinStale(BULLETIN, [], FOURTH_BUSINESS_DAY), true);
  });

  await test("araya giren HAFTA SONU sayılmaz (takvim günü ölçüsü olsaydı kayardı)", () => {
    // Cuma bülteni, Pazartesi: 3 TAKVİM günü geçti ama yalnız 1 İŞ günü.
    assert.equal(isFxBulletinStale(BULLETIN, [], new Date("2026-09-28T09:00:00Z")), false);
    // Aynı bülten 3. iş gününde 5 TAKVİM günü eskidir ve hâlâ geçerlidir: ölçü
    // gerçekten iş günü cinsinden.
    assert.equal(
      (THIRD_BUSINESS_DAY.getTime() - new Date(`${BULLETIN}T09:00:00Z`).getTime()) / 86_400_000,
      5
    );
  });

  await test("`holidays` listesindeki BAYRAM da sayılmaz (ikinci takvim icat edilmedi)", () => {
    const holidays = ["2026-09-29"]; // Salı: resmî tatil
    // Tatil listesi olmadan 4. iş günü → bayat; tatil bir iş günü eksiltince
    // aynı an 3. iş gününe düşer → geçerli.
    assert.equal(isFxBulletinStale(BULLETIN, [], FOURTH_BUSINESS_DAY), true);
    assert.equal(isFxBulletinStale(BULLETIN, holidays, FOURTH_BUSINESS_DAY), false);
    // Bir sonraki iş günü yine bayat: tatil ölçüyü bir gün kaydırdı, kaldırmadı.
    assert.equal(isFxBulletinStale(BULLETIN, holidays, new Date("2026-10-02T09:00:00Z")), true);
  });

  await test("`cutoffHour` akşam kesimi ölçüyü KAYDIRMIYOR (23:00 ve 01:00 aynı)", () => {
    // 2026-09-30, İstanbul 23:00 (UTC+3 → 20:00Z) ve İstanbul 01:00 (önceki
    // günün 22:00Z'si). İkisi de AYNI İstanbul gün anahtarıdır; ölçü saate
    // değil güne bakmalı.
    const lateEvening = new Date("2026-09-30T20:00:00Z");
    const afterMidnight = new Date("2026-09-29T22:00:00Z");
    assert.equal(isFxBulletinStale(BULLETIN, [], lateEvening), false);
    assert.equal(isFxBulletinStale(BULLETIN, [], afterMidnight), false);
    // Ertesi günün aynı iki saati de birbiriyle tutarlı olmalı (ikisi de bayat).
    assert.equal(isFxBulletinStale(BULLETIN, [], new Date("2026-10-01T20:00:00Z")), true);
    assert.equal(isFxBulletinStale(BULLETIN, [], new Date("2026-09-30T22:00:00Z")), true);
  });

  await test("bülten tarihi GELECEKTE ise bayat sayılmaz (saat kayması tur kırmaz)", () => {
    assert.equal(isFxBulletinStale("2026-10-05", [], THIRD_BUSINESS_DAY), false);
  });

  console.log("\n── Kaynak denetimi ──");

  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const source = (rel: string) => stripComments(readFileSync(join(ROOT, rel), "utf8"));

  await test("`fx-rates.ts` ve işçisi `server-only` çekmez, ödeme köprüsünü import ETMEZ", () => {
    for (const rel of [
      "src/lib/services/fx-rates.ts",
      "src/lib/queue/workers/fx-refresh.worker.ts",
    ]) {
      const src = source(rel);
      assert.ok(
        !/from "server-only"|import "server-only"/.test(src),
        `${rel} \`server-only\` çekiyor: standalone Node worker'ı crash-loop'a sokar`
      );
      assert.ok(
        !/quote-checkout/.test(src),
        `${rel} quote-checkout'u import ediyor; o da \`attribution-server\` → \`server-only\``
      );
    }
  });

  await test("işçi turun İLK işi olarak bayrağı okur ve kapalıysa çıkar", () => {
    const src = source("src/lib/queue/workers/fx-refresh.worker.ts");
    assert.ok(
      /isFlagEnabled\(\s*"quote_fx_display_enabled"\s*\)/.test(src),
      "bayrak okuması yok: kapalı bayrakta bile TCMB'ye çıkılır"
    );
    const flagAt = src.indexOf("quote_fx_display_enabled");
    const refreshAt = src.indexOf("refreshFxRates(");
    assert.ok(flagAt > 0 && refreshAt > flagAt, "bayrak okuması çekmeden ÖNCE gelmeli");
  });

  await test("admin ucu kuyruğa HİÇ dokunmaz: 'Şimdi çek' aynı gün de iş görür", () => {
    // bullmq, SAKLANAN bir işin kimliğiyle gelen ikinci `add()`i hata vermeden
    // YUTAR (`quote-queues.ts` başlığı) ve `removeOnComplete: { count: 500 }`
    // yüzünden günün işi saatlerce saklanır. Günlük kimlik otomatik tur için
    // doğru, elle tetik için ÖLÜMCÜL olurdu: ekran "başladı" derken hiçbir şey
    // olmazdı. Bu yüzden admin ucu çekme fonksiyonunu DOĞRUDAN çağırır.
    const src = source("src/app/api/admin/fx-rates/route.ts");
    assert.ok(/refreshFxRates\(/.test(src), "admin ucu çekme fonksiyonunu çağırmıyor");
    for (const forbidden of ["getFxRefreshQueue", "enqueueFxRefresh", "quote-queues"]) {
      assert.ok(
        !src.includes(forbidden),
        `admin ucu ${forbidden} kullanıyor: aynı gün ikinci "Şimdi çek" sessizce yutulur`
      );
    }
  });

  console.log(
    failures === 0 ? "\n✅ fx-rates: all checks passed" : `\n❌ fx-rates: ${failures} failed`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
