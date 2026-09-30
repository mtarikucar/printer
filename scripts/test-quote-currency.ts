/**
 * Döviz GÖSTERİMİ çekirdeği: saf çevirim, fişin toplamı ve SIZMA ENGELLERİ.
 * DB yok, Redis yok, ağ yok.
 *
 * Dört şeyi kanıtlar:
 *
 * 1. `convertKurusToMinor` altın değerleri ve YÖNÜ doğru üretir, tavanda
 *    taşmaz ve bozuk girdide SESSİZ kalmaz (RangeError).
 * 2. `convertReceipt`in fişi TOPLANIR: `Σ lines.minor + roundingMinor
 *    === totalMinor` ve `|roundingMinor| <= lines.length`. Bir proformada
 *    "toplamı tutmayan satırlar" hatadır; bu yüzden fark gizlice
 *    soğurulmaz, GÖRÜNEN bir satır olur.
 * 3. Döviz kolonu ₺ okumasını ASLA öldürmez: gösterim tavanının dışına düşen
 *    bir teklifte (`MAX_AMOUNT_KURUS` bir ÖDEME tavanıdır, teklif tarafında
 *    uygulanmaz) `convertReceipt` ATMAZ, `null` döner — yani "döviz gösterimi
 *    yok". Kapı fazla geniş de değil: sınırdaki fiş ve 10.000 rastgele fiş
 *    ÇEVRİLİR.
 * 4. Çevrilmiş rakam para taşıyan koda SIZAMAZ: yeni hiçbir ihraç edilen ad
 *    `…Kurus` ile bitmez (`quote-present.ts`in `endsWith("Kurus")` fiyat
 *    kapısı bulanmasın) ve `quote-currency` modülünü import eden dosyalar
 *    kapalı bir listeye eşittir.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MAX_AMOUNT_KURUS } from "../src/lib/config/prices";
import {
  addonReceiptKey,
  convertKurusToMinor,
  convertReceipt,
  isConvertibleAmount,
  type ConvertedReceipt,
} from "../src/lib/config/quote-currency";
import {
  DISPLAY_CURRENCIES,
  FX_CURRENCIES,
  type AddonLine,
  type FrozenFxRate,
  type QuoteTotals,
} from "../src/lib/config/quote-types";

const ROOT = join(import.meta.dirname, "..");

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

/** 1 birim döviz = kaç mikro-TRY (TCMB döviz alış × 1e6). */
const EUR_47_32: FrozenFxRate = { currency: "EUR", microTryPerUnit: 47_320_000 };
/** Aynı gün, birim başına DAHA AZ lira: aynı kuruş DAHA BÜYÜK döviz rakamı verir. */
const EUR_47_00: FrozenFxRate = { currency: "EUR", microTryPerUnit: 47_000_000 };
/** Tam bölünen kur: her satır kuruşuna eşit çıkar, yuvarlama satırı hiç doğmaz. */
const EUR_FLAT_40: FrozenFxRate = { currency: "EUR", microTryPerUnit: 40_000_000 };

function totals(input: {
  partsKurus: number;
  addonLines?: AddonLine[];
  minOrderTopUpKurus?: number;
  totalKurus?: number;
}): QuoteTotals {
  const addonLines = input.addonLines ?? [];
  const addonsKurus = addonLines.reduce((sum, l) => sum + l.kurus, 0);
  const minOrderTopUpKurus = input.minOrderTopUpKurus ?? 0;
  const totalKurus =
    input.totalKurus ?? input.partsKurus + addonsKurus + minOrderTopUpKurus;
  return {
    allPriced: true,
    partsKurus: input.partsKurus,
    addonLines,
    addonsKurus,
    minOrderTopUpKurus,
    totalKurus,
    // KDV toplamın BÖLÜNMESİdir, bir kalem değil: fişin satırlarına girmez.
    kdvExcludedKurus: Math.round((totalKurus * 10000) / 12000),
    kdvKurus: totalKurus - Math.round((totalKurus * 10000) / 12000),
    leadDays: 5,
  };
}

/**
 * `convertReceipt` çevrilemeyen fişte `null` döner. Normal yolu sınayan her
 * vaka bu yardımcıdan geçer, böylece kapı bir gün FAZLA GENİŞ olursa (normal
 * bir fişi reddederse) testler kırmızıya döner — "her şeye null dönerek geçen"
 * bir uygulama mümkün değil.
 */
function mustConvert(input: QuoteTotals, rate: FrozenFxRate): ConvertedReceipt {
  const receipt = convertReceipt(input, rate);
  assert.ok(receipt, "çevrilebilir bir fiş null döndü");
  return receipt;
}

console.log("çevirim");
test("altın değer: ₺10.000,00 · 1 EUR = 47,32 ₺ → €211,33", () => {
  // minor = round(kurus × 1e6 / microTryPerUnit) = round(1e12 / 4,732e7)
  assert.equal(convertKurusToMinor(1_000_000, EUR_47_32.microTryPerUnit), 21_133);
});

test("altın değer: tek kuruş ve tam bölünen kur", () => {
  assert.equal(convertKurusToMinor(0, EUR_47_32.microTryPerUnit), 0);
  // 1 kuruş = 1/47,32 sent = 0,021… → yuvarlanarak 0. Eksik göstermek değil,
  // MINOR biriminin altına düşmektir; fişte fark `roundingMinor`a yazılır.
  assert.equal(convertKurusToMinor(1, EUR_47_32.microTryPerUnit), 0);
  assert.equal(convertKurusToMinor(24, EUR_47_32.microTryPerUnit), 1);
  assert.equal(convertKurusToMinor(4_000, EUR_FLAT_40.microTryPerUnit), 100);
});

test("YÖN: birim başına daha AZ lira → daha BÜYÜK döviz rakamı", () => {
  // TCMB döviz ALIŞ kuru (`ForexBuying`) seçilmesinin aritmetik ayağı: alış
  // kuru satıştan küçüktür, yani aynı kuruş için daha büyük bir döviz rakamı
  // verir ve müşteriye maliyeti EKSİK göstermez.
  const cheaper = convertKurusToMinor(1_000_000, EUR_47_00.microTryPerUnit);
  const dearer = convertKurusToMinor(1_000_000, EUR_47_32.microTryPerUnit);
  assert.ok(cheaper > dearer, `${cheaper} > ${dearer} olmalıydı`);
  assert.equal(cheaper, 21_277);
});

test("tavanda çevirim taşmıyor ve tam sayı kalıyor", () => {
  // Taşma kanıtı: 2e8 × 1e6 = 2e14 < 9,007e15 (Number.MAX_SAFE_INTEGER).
  assert.ok(Number.isSafeInteger(MAX_AMOUNT_KURUS * 1_000_000));
  const minor = convertKurusToMinor(MAX_AMOUNT_KURUS, EUR_47_32.microTryPerUnit);
  assert.ok(Number.isSafeInteger(minor), `${minor} tam sayı değil`);
  assert.equal(minor, 4_226_543);
});

test("tavanın BİR kuruş üstü sessiz yanlış rakam değil, RangeError", () => {
  assert.throws(
    () => convertKurusToMinor(MAX_AMOUNT_KURUS + 1, EUR_47_32.microTryPerUnit),
    RangeError
  );
});

test("bozuk kuruş girdisi RangeError", () => {
  for (const bad of [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => convertKurusToMinor(bad, EUR_47_32.microTryPerUnit), RangeError, `${bad}`);
  }
});

test("bozuk kur satırı ekrana ₺0 ya da Infinity basamaz", () => {
  // `micro_try_per_unit > 0` CHECK'i veritabanında da var; burada ikinci kapı.
  for (const bad of [0, -47_320_000, Number.NaN, 47.32, Number.POSITIVE_INFINITY]) {
    assert.throws(() => convertKurusToMinor(1_000_000, bad), RangeError, `${bad}`);
  }
});

console.log("kapalı küme");
test("FX_CURRENCIES ve DISPLAY_CURRENCIES kapalı, ilk gösterim ₺", () => {
  assert.deepEqual([...FX_CURRENCIES], ["EUR", "USD", "GBP"]);
  assert.deepEqual([...DISPLAY_CURRENCIES], ["TRY", "EUR", "USD", "GBP"]);
  assert.equal(DISPLAY_CURRENCIES[0], "TRY", "bağlayıcı para birimi listenin BAŞINDA durur");
  assert.equal(DISPLAY_CURRENCIES.length, 4);
  assert.equal(FX_CURRENCIES.length, 3, "ekran ile veritabanı CHECK'i aynı listeden beslenir");
});

console.log("fiş");
test("fiş satırları ve toplamı: parça + ek hizmet + asgari tamamlama", () => {
  const receipt = mustConvert(
    totals({
      partsKurus: 1_000_000,
      addonLines: [
        { key: "rohs_beyani", name: "RoHS beyanı", kurus: 25_000 },
        { key: "hizli_kargo", name: "Hızlı kargo", kurus: 7_500 },
      ],
      minOrderTopUpKurus: 0,
    }),
    EUR_47_32
  );
  assert.equal(receipt.currency, "EUR");
  assert.deepEqual(
    receipt.lines.map((l) => l.key),
    ["parts", addonReceiptKey("rohs_beyani"), addonReceiptKey("hizli_kargo")]
  );
  // Ek hizmetin ADI çeviriye girmez: satır yalnız anahtar ve minor taşır.
  assert.deepEqual(Object.keys(receipt.lines[0]!).sort(), ["key", "minor"]);
  assert.equal(receipt.totalMinor, convertKurusToMinor(1_032_500, EUR_47_32.microTryPerUnit));
  assert.equal(
    receipt.lines.reduce((sum, l) => sum + l.minor, 0) + receipt.roundingMinor,
    receipt.totalMinor
  );
});

test("asgari sipariş tamamlaması satır olur, sıfırken satır olmaz", () => {
  const withTopUp = mustConvert(
    totals({ partsKurus: 12_000, minOrderTopUpKurus: 8_000 }),
    EUR_47_32
  );
  assert.deepEqual(
    withTopUp.lines.map((l) => l.key),
    ["parts", "minOrderTopUp"]
  );
  const without = mustConvert(totals({ partsKurus: 20_000 }), EUR_47_32);
  assert.deepEqual(
    without.lines.map((l) => l.key),
    ["parts"]
  );
});

test("yuvarlama farkı SIFIR olabiliyor (ekranda o satır çizilmez)", () => {
  const receipt = mustConvert(
    totals({
      partsKurus: 40_000,
      addonLines: [{ key: "rohs_beyani", name: "RoHS beyanı", kurus: 4_000 }],
    }),
    EUR_FLAT_40
  );
  assert.equal(receipt.roundingMinor, 0);
  assert.deepEqual(
    receipt.lines.map((l) => l.minor),
    [1_000, 100]
  );
  assert.equal(receipt.totalMinor, 1_100);
});

test("boş fiş: satır yok, toplam 0, yuvarlama 0", () => {
  const receipt = mustConvert(totals({ partsKurus: 0 }), EUR_47_32);
  assert.deepEqual(receipt.lines, []);
  assert.equal(receipt.totalMinor, 0);
  assert.equal(receipt.roundingMinor, 0);
});

test("toplamı tutmayan QuoteTotals sessizce çevrilmez: null (döviz yok)", () => {
  // `computeQuote` daima `parts + addons + topUp = total` üretir; tutmayan bir
  // girdi bir PROGRAMLAMA hatasıdır — ama müşteriye dönen yüzeyde cezası
  // "döviz gösterimi yok"tur, teklif sayfasını düşüren bir atma değil.
  assert.equal(
    convertReceipt(totals({ partsKurus: 10_000, totalKurus: 10_001 }), EUR_47_32),
    null
  );
});

test("10.000 rastgele (kur, tutar) çiftinde fişin toplamı TUTAR", () => {
  // Belirlenimci PRNG: aynı tohum → aynı vakalar. Kırmızı bir tur yeniden
  // koşturulduğunda aynı çifti verir.
  let seed = 0x9e3779b9;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let worstRounding = 0;
  let sawRounding = false;
  for (let i = 0; i < 10_000; i++) {
    const rate: FrozenFxRate = {
      currency: FX_CURRENCIES[i % FX_CURRENCIES.length]!,
      // 1 birim = ₺1 … ₺101 arası; TCMB'nin gerçek aralığını kapsar.
      microTryPerUnit: 1_000_000 + Math.floor(next() * 100_000_000),
    };
    const addonCount = Math.floor(next() * 4);
    const addonLines: AddonLine[] = [];
    for (let a = 0; a < addonCount; a++) {
      addonLines.push({
        key: `ek_${a}`,
        name: `Ek hizmet ${a}`,
        kurus: 1 + Math.floor(next() * 500_000),
      });
    }
    const input = totals({
      partsKurus: 1 + Math.floor(next() * 5_000_000),
      addonLines,
      minOrderTopUpKurus: Math.floor(next() * 20_000),
    });
    // `mustConvert`: 10.000 turun HEPSİ çevrilebilir olmalı — gösterim kapısı
    // normal bir fişi reddederse bu havuz kırmızıya döner.
    const receipt = mustConvert(input, rate);
    const summed = receipt.lines.reduce((sum, l) => sum + l.minor, 0);
    assert.equal(
      summed + receipt.roundingMinor,
      receipt.totalMinor,
      `tur ${i}: ${summed} + ${receipt.roundingMinor} ≠ ${receipt.totalMinor}`
    );
    assert.ok(
      Math.abs(receipt.roundingMinor) <= receipt.lines.length,
      `tur ${i}: |${receipt.roundingMinor}| > ${receipt.lines.length}`
    );
    worstRounding = Math.max(worstRounding, Math.abs(receipt.roundingMinor));
    if (receipt.roundingMinor !== 0) sawRounding = true;
  }
  // Sınav gerçekten sınav: yuvarlama farkı bu havuzda EN AZ bir kez doğuyor,
  // yani değişmez "fark hiç oluşmuyor" diye kolayca sağlanmıyor.
  assert.ok(sawRounding, "hiçbir turda yuvarlama farkı doğmadı — vaka havuzu zayıf");
  assert.ok(worstRounding >= 1, `en kötü fark ${worstRounding}`);
});

console.log("gösterim tavanı — döviz kolonu ₺ okumasını ASLA öldürmez");

test("GÖSTERİM KAPISI tavanla aynı sayıda: sınır dahil, bir kuruş üstü hariç", () => {
  // Kapı ile ilkelin tavanı AYNI sayı olmalı; ikisi ayrışırsa ya kapı geçirdiği
  // bir fişte ilkel atar (sayfa düşer) ya da kapı gereksiz yere daraltır.
  assert.equal(isConvertibleAmount(MAX_AMOUNT_KURUS), true);
  assert.equal(isConvertibleAmount(MAX_AMOUNT_KURUS + 1), false);
  assert.equal(isConvertibleAmount(0), true);
  for (const bad of [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isConvertibleAmount(bad), false, `${bad}`);
  }
  // Taşma kanıtı tavana BAĞLI: tavan yükseltilirse bu iddia da yükselmeli.
  assert.ok(Number.isSafeInteger(MAX_AMOUNT_KURUS * 1_000_000));
});

test("tavanı AŞAN teklifin fişi atmaz, null döner (sayfa düşmez)", () => {
  // Bu girdi uydurma DEĞİL: `MAX_AMOUNT_KURUS` bir ÖDEME tavanıdır, teklif
  // tarafında uygulanmaz (adet 1…100.000, elle birim fiyat tek başına tavana
  // kadar, `computeQuote` toplamı kırpmaz), yani ₺2.000.000 üstü bir teklif
  // GÖRÜNTÜLENEBİLİR. Döviz kolonu o sayfada yok olur; ₺ okuması sağlam kalır.
  const overCeiling = totals({ partsKurus: MAX_AMOUNT_KURUS + 1 });
  assert.equal(convertReceipt(overCeiling, EUR_47_32), null);
  // Kapı olmasaydı ne olurdu: ilkel atar, sunucu bileşeninde boş gövdeli 500.
  assert.throws(
    () => convertKurusToMinor(overCeiling.totalKurus, EUR_47_32.microTryPerUnit),
    RangeError
  );
  // Tam sınırdaki teklif ise ÇEVRİLİR — kapı fazla geniş değil.
  const atCeiling = mustConvert(totals({ partsKurus: MAX_AMOUNT_KURUS }), EUR_47_32);
  assert.equal(atCeiling.totalMinor, 4_226_543);
  assert.equal(atCeiling.roundingMinor, 0);
});

test("tavanı aşan tek SATIR da fişi düşürmez, null döner", () => {
  // Negatif bir satır (ileride bir indirim kalemi) toplamı tavanın altında
  // tutarken bir başka satırı tavanın üstüne itebilir: bu yüzden her satır
  // AYRI AYRI sınanır.
  const negativeLine = totals({
    partsKurus: MAX_AMOUNT_KURUS,
    addonLines: [{ key: "indirim", name: "İndirim", kurus: -1_000 }],
  });
  assert.equal(negativeLine.totalKurus, MAX_AMOUNT_KURUS - 1_000);
  assert.equal(isConvertibleAmount(negativeLine.totalKurus), true, "toplam tavanın ALTINDA");
  assert.equal(convertReceipt(negativeLine, EUR_47_32), null);
});

test("donmuş BOZUK kur fişi düşürmez, null döner", () => {
  // `quotes.fx_snapshot` jsonb'dir ve CHECK'i yoktur: `fx_rates` tablosundaki
  // `micro_try_per_unit > 0` kuralı donmuş bir satır için geçerli değil.
  for (const bad of [0, -47_320_000, Number.NaN, 47.32, Number.POSITIVE_INFINITY]) {
    assert.equal(
      convertReceipt(totals({ partsKurus: 20_000 }), { currency: "EUR", microTryPerUnit: bad }),
      null,
      `${bad}`
    );
  }
});

console.log("sızma engelleri");

/** `//` ve `/* *​/` yorumlarını atar: prozada geçen bir ad TANIM sayılmasın. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Kuralın baktığı adlar: ALAN adları (`ad:` / `ad?:` — arayüz üyesi, nesne
 * anahtarı, tipli bağlama) ve İHRAÇ EDİLEN bildirimler.
 *
 * Kapsam KASITLI olarak bu: kapı `quote-present.ts`in `key.endsWith("Kurus")`
 * süzgecini korumak için var ve o süzgeç yalnız SERİLEŞTİRİLEN anahtarlara
 * bakar. Modülün İÇİNDEKİ yerel bir kuruş toplamının adı (`addonsKurus`)
 * dışarıya hiç çıkmaz; onu da yasaklamak, kuruş taşıyan bir değişkene birimini
 * söylemeyen bir ad vermeye zorlardı — ev kuralının tam tersi.
 *
 * Nokta ile erişilen bir ad (`totals.partsKurus`) tanım değildir: kural YENİ
 * adlara bakar, mevcut kuruş alanlarının OKUNMASINA değil.
 */
function declaredNames(source: string): string[] {
  const body = stripComments(source);
  const names: string[] = [];
  for (const m of body.matchAll(/(?:^|[^.\w$"'])([A-Za-z_$][\w$]*)\s*\??\s*:/gm)) {
    names.push(m[1]!);
  }
  for (const m of body.matchAll(
    /\bexport\s+(?:declare\s+)?(?:const|let|var|function|interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.push(m[1]!);
  }
  return names;
}

test("`declaredNames` gerçekten tanım yakalıyor (nöbetçi uyanık)", () => {
  const found = declaredNames(
    [
      "export interface X { fooKurus: number }",
      "export const quxKurus = 1;",
      "const barKurus = 1;",
      "q.bazKurus;",
    ].join("\n")
  );
  assert.ok(found.includes("fooKurus"), "arayüz alanı kaçtı");
  assert.ok(found.includes("quxKurus"), "ihraç edilen bildirim kaçtı");
  assert.ok(!found.includes("barKurus"), "yerel değişken alan sayıldı");
  assert.ok(!found.includes("bazKurus"), "nokta ile ERİŞİM tanım sayıldı");
});

test("ADLANDIRMA KAPISI: yeni hiçbir ad `Kurus` ile bitmiyor", () => {
  // `quote-present.ts:69` fiyat kapısını `key.endsWith("Kurus")` ile uyguluyor.
  // Döviz alanı o eke sahip olsa ya yanlışlıkla filtrelenir ya da kuralın
  // anlamı bulanırdı; bu yüzden `…Minor` / `…Micro` / `…PerUnit` kullanılır.
  const currency = readFileSync(join(ROOT, "src/lib/config/quote-currency.ts"), "utf8");
  const types = readFileSync(join(ROOT, "src/lib/config/quote-types.ts"), "utf8");
  const start = types.indexOf("// ─── Döviz GÖSTERİMİ (0071)");
  assert.ok(start > 0, "quote-types.ts'te döviz bloğunun başlığı yok");
  const end = types.indexOf("\n// ─── ", start + 1);
  assert.ok(end > start, "döviz bloğunun bittiği yer bulunamadı");
  const fxBlock = types.slice(start, end);
  assert.match(fxBlock, /PresentedFxDisplay/, "blok beklenen tipleri taşımıyor");
  for (const [label, source] of [
    ["quote-currency.ts", currency],
    ["quote-types.ts · döviz bloğu", fxBlock],
  ] as const) {
    const offenders = declaredNames(source).filter((n) => n.endsWith("Kurus"));
    assert.deepEqual(offenders, [], `${label}: ${offenders.join(", ")}`);
  }
  // `PresentedQuote`a giren tek yeni alan da aynı kurala uyar.
  assert.match(types, /\n {2}display\?: PresentedFxDisplay \| null;/);
});

/**
 * Çevrilmiş rakamı PARA taşıyan koda sokmak derlemeyi bozmaz, sessizce yanlış
 * bir tahsilat üretir. O yüzden ithalatçı kümesi KAPALIDIR.
 *
 * Bu turda (D1) sunum katmanı henüz yok, yani liste BOŞ: modülü import eden ilk
 * `src/**` dosyası bu testi kırmızıya çevirir ve listeye BİLEREK yazılmasını
 * ister. Beyaz liste D4'te sunum katmanının gerçek dosyalarıyla kilitlenir.
 */
const ALLOWED_IMPORTERS: readonly string[] = [];

/**
 * Listede olması YASAK olan dosyalar. Tek tek yazılıdırlar ki bir yeniden
 * adlandırma nöbetçiyi sessizce boşaltmasın (varlıkları da sınanır).
 */
const FORBIDDEN_IMPORTERS = [
  "src/lib/config/quote-pricing.ts",
  "src/lib/config/quote-compute.ts",
  "src/lib/config/quote-tender.ts",
  "src/lib/config/prices.ts",
  "src/lib/config/payment.ts",
  "src/lib/config/cost-lines.ts",
  "src/lib/config/order-refund.ts",
  "src/lib/config/partner-adjustments.ts",
  "src/lib/config/dispute-resolution.ts",
  "src/lib/config/order-money.ts",
  "src/lib/services/finance.ts",
  "src/lib/services/quote-checkout.ts",
  "src/lib/services/quote-order.ts",
  "src/lib/services/order-money.ts",
  "src/lib/services/manufacturer-assignment.ts",
] as const;

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Dosya `quote-currency`yi import ediyor mu? Yalnız MODÜL ADI konumuna bakar:
 * yorumda geçen bir söz import değildir. `import type` de sayılır — kapı
 * "bu modülün adı para yolunda hiç geçmiyor" diye okunur.
 */
function importsCurrency(text: string): boolean {
  return /(?:from|import|require)\s*\(?\s*["'][^"']*quote-currency["']/.test(text);
}

test("`importsCurrency` gerçekten import yakalıyor (nöbetçi uyanık)", () => {
  assert.ok(importsCurrency('import { x } from "@/lib/config/quote-currency";'));
  assert.ok(importsCurrency('import type { ConvertedReceipt } from "../config/quote-currency";'));
  assert.ok(importsCurrency('await import("@/lib/config/quote-currency")'));
  assert.ok(!importsCurrency("// quote-currency yalnız sunum katmanında kullanılır"));
});

test("KAPALI İTHALATÇI KÜMESİ: `src/**` listesi beyaz listeye eşit", () => {
  const importers = walkSources(join(ROOT, "src"))
    .filter((f) => importsCurrency(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f).split(sep).join("/"))
    .sort();
  assert.deepEqual(importers, [...ALLOWED_IMPORTERS].sort());
});

test("PARA yolundaki modüller çevirim modülünü import ETMİYOR", () => {
  for (const rel of FORBIDDEN_IMPORTERS) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(!importsCurrency(text), `${rel} quote-currency'yi import ediyor`);
  }
});

console.log(
  failures === 0
    ? "\n✅ quote-currency: all checks passed"
    : `\n❌ quote-currency: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
