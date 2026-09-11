import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  COST_LINE_KINDS,
  isCostLineKind,
  splitCostLines,
  allocateBases,
  costLinesTotalKurus,
  parseTryToKurus,
} from "../src/lib/config/cost-lines";
import {
  manufacturerBaseKurus,
  painterBaseKurus,
} from "../src/lib/services/earning-base";
import { computeEarning } from "../src/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS } from "../src/lib/config/prices";
import {
  emptyCostLine,
  costLineRowFromKurus,
} from "../src/lib/config/cost-line-row";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── Kalem türleri ──────────────────────────────────────────────────────────

test("yalnızca iki kalem türü vardır: production + painting", () => {
  assert.deepEqual([...COST_LINE_KINDS], ["production", "painting"]);
});

test("isCostLineKind bilinmeyen türü reddeder", () => {
  assert.equal(isCostLineKind("production"), true);
  assert.equal(isCostLineKind("painting"), true);
  assert.equal(isCostLineKind("material"), false);
  assert.equal(isCostLineKind(""), false);
  assert.equal(isCostLineKind(null), false);
});

// ─── splitCostLines ─────────────────────────────────────────────────────────

test("boş liste → iki taban da 0", () => {
  assert.deepEqual(splitCostLines([]), { productionKurus: 0, paintingKurus: 0 });
});

test("tek tür → diğer taban 0", () => {
  assert.deepEqual(splitCostLines([{ kind: "production", amountKurus: 240000 }]), {
    productionKurus: 240000,
    paintingKurus: 0,
  });
  assert.deepEqual(splitCostLines([{ kind: "painting", amountKurus: 110000 }]), {
    productionKurus: 0,
    paintingKurus: 110000,
  });
});

test("aynı türden birden çok kalem toplanır", () => {
  assert.deepEqual(
    splitCostLines([
      { kind: "production", amountKurus: 100000 },
      { kind: "painting", amountKurus: 60000 },
      { kind: "production", amountKurus: 140000 },
      { kind: "painting", amountKurus: 50000 },
    ]),
    { productionKurus: 240000, paintingKurus: 110000 }
  );
});

test("costLinesTotalKurus iki tabanın toplamıdır", () => {
  const lines = [
    { kind: "production" as const, amountKurus: 240000 },
    { kind: "painting" as const, amountKurus: 110000 },
  ];
  const s = splitCostLines(lines);
  assert.equal(costLinesTotalKurus(lines), 350000);
  assert.equal(costLinesTotalKurus(lines), s.productionKurus + s.paintingKurus);
});

// ─── allocateBases: oran bazlı ölçekleme ────────────────────────────────────

test("ölçekleme yoksa kırılım aynen döner", () => {
  assert.deepEqual(
    allocateBases({ productionKurus: 240000, paintingKurus: 110000, totalKurus: 350000 }),
    { productionKurus: 240000, paintingKurus: 110000 }
  );
});

test("adet ile ölçeklenir (×3)", () => {
  assert.deepEqual(
    allocateBases({ productionKurus: 240000, paintingKurus: 110000, totalKurus: 1050000 }),
    { productionKurus: 720000, paintingKurus: 330000 }
  );
});

test("indirimli tutarda oran korunur", () => {
  // 240/110 oranı ≈ %68,57 / %31,43. 300000 üzerinde 205714 / 94286.
  const r = allocateBases({
    productionKurus: 240000,
    paintingKurus: 110000,
    totalKurus: 300000,
  });
  assert.equal(r.productionKurus + r.paintingKurus, 300000);
  assert.equal(r.productionKurus, 205714);
  assert.equal(r.paintingKurus, 94286);
});

test("ölçekleme toplamı HER ZAMAN korur (fuzz)", () => {
  // Deterministik pseudo-rastgele — Math.random yok, tekrarlanabilir olsun.
  let seed = 987654321;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 10000; i++) {
    const productionKurus = next(500000);
    const paintingKurus = next(500000);
    const totalKurus = next(2_000_000) + 1;
    const r = allocateBases({ productionKurus, paintingKurus, totalKurus });
    assert.equal(
      r.productionKurus + r.paintingKurus,
      totalKurus,
      `toplam kaydı: ${productionKurus}/${paintingKurus} → ${totalKurus}`
    );
    assert.ok(r.productionKurus >= 0 && r.paintingKurus >= 0, "negatif taban");
    assert.ok(Number.isInteger(r.productionKurus), "tam sayı değil");
    assert.ok(Number.isInteger(r.paintingKurus), "tam sayı değil");
  }
});

test("boyama kalemi yoksa tüm tutar üretime gider", () => {
  assert.deepEqual(
    allocateBases({ productionKurus: 240000, paintingKurus: 0, totalKurus: 500000 }),
    { productionKurus: 500000, paintingKurus: 0 }
  );
});

test("üretim kalemi yoksa tüm tutar boyamaya gider", () => {
  assert.deepEqual(
    allocateBases({ productionKurus: 0, paintingKurus: 110000, totalKurus: 500000 }),
    { productionKurus: 0, paintingKurus: 500000 }
  );
});

test("kırılım tamamen boşsa tutarın tamamı üretim sayılır", () => {
  // Kırılımsız (eski) ürün: boyacı payı üretmeden üreticiye yazılır — bugünkü
  // davranışın aynısı.
  assert.deepEqual(
    allocateBases({ productionKurus: 0, paintingKurus: 0, totalKurus: 349900 }),
    { productionKurus: 349900, paintingKurus: 0 }
  );
});

test("sıfır tutar → iki taban da sıfır", () => {
  assert.deepEqual(
    allocateBases({ productionKurus: 240000, paintingKurus: 110000, totalKurus: 0 }),
    { productionKurus: 0, paintingKurus: 0 }
  );
});

test("bölünemeyen 1 kuruş kaybolmaz", () => {
  const r = allocateBases({ productionKurus: 1, paintingKurus: 1, totalKurus: 1 });
  assert.equal(r.productionKurus + r.paintingKurus, 1);
});

// ─── Hakediş tabanları ──────────────────────────────────────────────────────

const withBreakdown = {
  amountKurus: 350000,
  productionBaseKurus: 240000,
  paintingPriceKurus: 110000,
};

test("kırılımlı sipariş, boyacıya devredilmiş → üretici yalnız üretim tabanı", () => {
  assert.equal(
    manufacturerBaseKurus({ ...withBreakdown, painterId: "p1", paintsInHouse: false }),
    240000
  );
  assert.equal(painterBaseKurus(withBreakdown), 110000);
});

test("kırılımlı sipariş, üretici kendi boyuyor → taban ikisinin toplamı", () => {
  assert.equal(
    manufacturerBaseKurus({ ...withBreakdown, painterId: null, paintsInHouse: true }),
    350000
  );
});

test("kırılımlı sipariş, boyama kalemi yok → üretici tutarın tamamı", () => {
  const o = { amountKurus: 350000, productionBaseKurus: 350000, paintingPriceKurus: 0 };
  assert.equal(manufacturerBaseKurus({ ...o, painterId: null, paintsInHouse: false }), 350000);
  assert.equal(painterBaseKurus(o), 0);
});

test("kırılımlı sipariş, devredilmemiş ve kendi boyamıyor → yalnız üretim tabanı", () => {
  // Boyama işi hâlâ bir boyacıya gidecek; boyama payı üreticiye yazılmaz.
  assert.equal(
    manufacturerBaseKurus({ ...withBreakdown, painterId: null, paintsInHouse: false }),
    240000
  );
});

// ─── Eski (kırılımsız) siparişler: bugünkü davranış korunur ────────────────

test("kırılımsız + boyamalı + devredilmiş → tutar − boyama (bugünkü kural)", () => {
  assert.equal(
    manufacturerBaseKurus({
      amountKurus: 349900,
      productionBaseKurus: null,
      paintingPriceKurus: 100000,
      painterId: "p1",
      paintsInHouse: false,
    }),
    249900
  );
});

test("kırılımsız + boyamasız → tutarın tamamı (bugünkü kural)", () => {
  assert.equal(
    manufacturerBaseKurus({
      amountKurus: 349900,
      productionBaseKurus: null,
      paintingPriceKurus: 0,
      painterId: null,
      paintsInHouse: false,
    }),
    349900
  );
});

test("kırılımsız + kendi boyuyor + devretmemiş → tutarın tamamı (bugünkü kural)", () => {
  assert.equal(
    manufacturerBaseKurus({
      amountKurus: 349900,
      productionBaseKurus: null,
      paintingPriceKurus: 100000,
      painterId: null,
      paintsInHouse: true,
    }),
    349900
  );
});

test("taban asla negatif olmaz (boyama tutarı aşarsa 0'a kırpılır)", () => {
  assert.equal(
    manufacturerBaseKurus({
      amountKurus: 50000,
      productionBaseKurus: null,
      paintingPriceKurus: 100000,
      painterId: "p1",
      paintsInHouse: false,
    }),
    0
  );
});

// ─── ANA INVARIANT: hakediş toplamı sipariş tutarını geçemez ───────────────

test("INVARIANT brüt: üretici brüt + boyacı brüt === sipariş tutarı", () => {
  let seed = 24680;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 5000; i++) {
    const totalKurus = next(2_000_000) + 1;
    const bases = allocateBases({
      productionKurus: next(400000),
      paintingKurus: next(400000),
      totalKurus,
    });
    const order = {
      amountKurus: totalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
    };
    // Devredilmiş: iki partner ayrı ayrı tahakkuk eder.
    const mfr = manufacturerBaseKurus({ ...order, painterId: "p", paintsInHouse: false });
    const painter = painterBaseKurus(order);
    assert.equal(mfr + painter, totalKurus, `brüt toplamı ${mfr}+${painter} ≠ ${totalKurus}`);

    // Kendi boyayan üretici: tek tahakkuk, yine tam tutar.
    const inHouse = manufacturerBaseKurus({ ...order, painterId: null, paintsInHouse: true });
    assert.equal(inHouse, totalKurus, "kendi boyayan üretici tabanı tutara eşit değil");
  }
});

test("INVARIANT net: üretici net + boyacı net + platform === sipariş tutarı", () => {
  let seed = 13579;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let i = 0; i < 5000; i++) {
    const totalKurus = next(2_000_000) + 1;
    const bases = allocateBases({
      productionKurus: next(400000),
      paintingKurus: next(400000),
      totalKurus,
    });
    const order = {
      amountKurus: totalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
    };
    const rate = PLATFORM_COMMISSION_RATE_BPS;
    const m = computeEarning(
      manufacturerBaseKurus({ ...order, painterId: "p", paintsInHouse: false }),
      rate
    );
    const p = computeEarning(painterBaseKurus(order), rate);
    const platform = m.commissionKurus + p.commissionKurus;
    assert.equal(
      m.netKurus + p.netKurus + platform,
      totalKurus,
      `net dağılımı ${m.netKurus}+${p.netKurus}+${platform} ≠ ${totalKurus}`
    );
    // Partner payı hiçbir zaman tutarı geçemez.
    assert.ok(m.netKurus + p.netKurus <= totalKurus, "partner payı tutarı aştı");
  }
});

// ─── Yeni oran ──────────────────────────────────────────────────────────────

test("platform komisyonu %40, partner net payı %60", () => {
  assert.equal(PLATFORM_COMMISSION_RATE_BPS, 4000);
  const r = computeEarning(100000, PLATFORM_COMMISSION_RATE_BPS);
  assert.equal(r.commissionKurus, 40000);
  assert.equal(r.netKurus, 60000);
});

test("donmuş eski oran (%35) korunur — geriye dönük uygulanmaz", () => {
  const r = computeEarning(100000, 3500);
  assert.equal(r.netKurus, 65000);
});

// ─── Türkçe para girişi ─────────────────────────────────────────────────────
// Bu fonksiyonu yanlış yapmak DOĞRUDAN DB'ye yanlış fiyat yazar. Naif
// parseFloat(s.replace(",", ".")) yaklaşımı "2.400"ü ₺2,40 olarak okuyordu.

test("binlik ayracı ondalık sanılmaz: 2.400 → ₺2.400", () => {
  assert.equal(parseTryToKurus("2.400"), 240000);
  assert.equal(parseTryToKurus("1.250"), 125000);
  assert.equal(parseTryToKurus("3.499"), 349900);
  assert.equal(parseTryToKurus("1.234.567"), 123456700);
});

test("virgül ondalık ayracıdır", () => {
  assert.equal(parseTryToKurus("1.250,50"), 125050);
  assert.equal(parseTryToKurus("1250,5"), 125050);
  assert.equal(parseTryToKurus("0,05"), 5);
  assert.equal(parseTryToKurus("1,5"), 150);
  assert.equal(parseTryToKurus("1.234.567,89"), 123456789);
});

test("1–2 haneli son grup ondalık noktadır", () => {
  assert.equal(parseTryToKurus("1.50"), 150);
  assert.equal(parseTryToKurus("1250.50"), 125050);
  assert.equal(parseTryToKurus("0.5"), 50);
});

test("düz sayılar", () => {
  assert.equal(parseTryToKurus("12"), 1200);
  assert.equal(parseTryToKurus("0"), 0);
  assert.equal(parseTryToKurus("349900"), 34990000);
});

test("boşluklar yok sayılır, sessizce kırpılmaz", () => {
  assert.equal(parseTryToKurus(" 1 250 "), 125000);
  assert.equal(parseTryToKurus("1 250,50"), 125050);
});

test("geçersiz giriş NaN döner — asla uydurma bir sayı değil", () => {
  for (const bad of ["", "   ", "abc", "-5", "1,2,3", ".5", ",5", "1.2.3,4,5", "₺100", "1e3"]) {
    assert.ok(
      Number.isNaN(parseTryToKurus(bad)),
      `"${bad}" NaN dönmeliydi, ${parseTryToKurus(bad)} döndü`
    );
  }
});

test("bozuk gruplama REDDEDİLİR — sessizce yanlış sayı üretilmez", () => {
  // "1.2345" eskiden ₺1,23 oluyordu; ₺12.345 yazmak isteyen için 10.000× hata.
  for (const bad of ["1.2345", "1.23.456", "12.3456", "10.20.30", "1.2.3"]) {
    assert.ok(
      Number.isNaN(parseTryToKurus(bad)),
      `"${bad}" reddedilmeliydi, ${parseTryToKurus(bad)} döndü`
    );
  }
});

test("2 haneden uzun ondalık reddedilir", () => {
  // Bir fiyat alanında "1,005" büyük olasılıkla "1.005" (₺1.005) yanlış
  // yazımıdır; sessizce ₺1,01'e yuvarlamak yerine kullanıcı yeniden yazsın.
  assert.ok(Number.isNaN(parseTryToKurus("1,005")));
  assert.ok(Number.isNaN(parseTryToKurus("1.005,123")));
  assert.equal(parseTryToKurus("1,00"), 100);
  assert.equal(parseTryToKurus("1,0"), 100);
});

test("binlik grupları TAM 3 hane olmalı", () => {
  assert.equal(parseTryToKurus("1.234.567"), 123456700);
  assert.ok(Number.isNaN(parseTryToKurus("1.23.456")));
  assert.ok(Number.isNaN(parseTryToKurus("1234.5678")));
});

// ─── Satır uid'leri ─────────────────────────────────────────────────────────

test("kayıtlı ve yeni satırların uid'leri çakışmaz", () => {
  // Gerçek senaryo: sunucu kayıtlı iki kalemi forma basar, kullanıcı "+ Boyama"
  // ile üçüncüyü ekler. İki fabrika ORTAK bir "cl-" ön eki kullandığında ilk
  // kayıtlı satır ile ilk eklenen satır aynı React anahtarını alıyordu; tam da
  // uid alanının önlemek için var olduğu hata.
  const uids = [
    costLineRowFromKurus({ kind: "production", amountKurus: 150000 }).uid,
    costLineRowFromKurus({ kind: "painting", amountKurus: 500000 }).uid,
    emptyCostLine("painting").uid,
    emptyCostLine("production").uid,
  ];
  assert.equal(new Set(uids).size, uids.length, `uid çakıştı: ${uids.join(", ")}`);
});

test("aynı fabrikanın ardışık satırları da benzersizdir", () => {
  const many = Array.from({ length: 20 }, () => emptyCostLine().uid);
  assert.equal(new Set(many).size, 20);
});

test("costLineRowFromKurus kuruşu Türkçe ondalıkla forma yazar", () => {
  const row = costLineRowFromKurus({
    kind: "painting",
    label: null,
    amountKurus: 150000,
  });
  assert.equal(row.amountTry, "1500,00");
  assert.equal(row.label, "");
  assert.equal(row.kind, "painting");
  // Forma yazılan metin, geri okunduğunda aynı kuruşu vermeli — aksi hâlde
  // kaydet'e basmak fiyatı sessizce değiştirirdi.
  assert.equal(parseTryToKurus(row.amountTry), 150000);
});

// ─── Grep guard: komisyon matematiği TEK yerde ──────────────────────────────
// Faz 3 denetimi komisyon hesabının (`brüt − round(brüt × bps / 10000)`) beş
// dosyada elle kopyalandığını buldu. Kopya; oran, yuvarlama ya da taban kuralı
// değiştiğinde sessizce ayrışır — partner ekranda başka, hesabında başka rakam
// görür. Hesap yalnızca aşağıdaki türetim modülünde yaşar; diğer herkes
// computeEarning / orderMoneySplit / deriveOrderMoneyBreakdown çağırır.

const SRC_ROOT = join(import.meta.dirname, "..", "src");
const REPO_ROOT = join(import.meta.dirname, "..");

// Kalıbın GERÇEKTEN hesaplandığı tek modül: finance.ts (computeEarning: bps →
// komisyon, computeKdv: bps → KDV tabanı). Öteki türetim modülleri bps
// matematiği yapmaz, finance.ts'e devreder — earning-base.ts (tabanlar),
// config/cost-lines.ts (kalem bölüşümü), config/order-money.ts (para dökümü),
// config/payment.ts (havale indirimi, kendi oran sabitiyle). O yüzden muaf
// DEĞİLLER: oralara sızan bir kopya da testi düşürür.
const DERIVATION_MODULES = new Set(["src/lib/services/finance.ts"]);

/**
 * Sahibine iletilmiş, henüz kaldırılmamış kopyalar: DOSYA + SATIRIN KENDİSİ
 * (trim'lenmiş), asla bütün dosya değil — aynı dosyaya yazılan YENİ bir kopya
 * da testi düşürür. Kopya temizlenince girdi silinmeli; artık hiçbir satırla
 * eşleşmeyen girdi de testi düşürür, yoksa aynı satır sessizce geri dönebilir.
 * Faz 3'ün üç kopyası (yeni sipariş formu, kalem editörü, boyacı işleri)
 * computeEarning'e taşındı; liste boş kalmalı.
 */
const ALLOWED_COPIES: ReadonlyArray<{ file: string; line: string }> = [];

// Sayı kalıbı tek başına para demek değil (`vh * 0.6` bir kaydırma eşiği):
// kalıpların çoğu aynı satırda bir para kelimesi de ister.
const MONEY_WORDS = /kurus|gross|net|commission|komisyon|price|amount|earning|bps/i;
const COPY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp; needsMoneyWord: boolean }> = [
  // bps → tutar: `(x * rateBps) / 10000`, `/ 10_000`, `/ 1e4`. Yüzde GÖSTERİMİ
  // (`bps / 100`) kalıba girmez.
  { name: "bps → tutar (/ 10000)", re: /\/\s*(?:10_?000|1e4)\b/, needsMoneyWord: true },
  // Sabit oranın ondalık kopyası: `amountKurus * 0.6`, `0.4 * grossKurus`.
  { name: "sabit oran (× 0.4 / × 0.6)", re: /\*\s*0\.[46]0?\b|\b0\.[46]0?\s*\*/, needsMoneyWord: true },
  // Sabit oranın yüzde kopyası: `gross * 60 / 100`, `(gross * 40) / 100`,
  // `gross / 100 * 60`.
  {
    name: "sabit oran (× 60 / 100)",
    re: /\*\s*[46]0\s*\)?\s*\/\s*100\b|\/\s*100\s*\)?\s*\*\s*[46]0\b/,
    needsMoneyWord: true,
  },
  // Oranın kendisi: `4000 / 10000` — para kelimesi olmadan da kopyadır.
  { name: "sabit oran (4000 / 10000)", re: /\b[46]000\s*\/\s*(?:10_?000|1e4)\b/, needsMoneyWord: false },
];

/** Satırı yakalayan kalıbın adı; kopya değilse null. */
function copyPatternHit(l: string): string | null {
  for (const p of COPY_PATTERNS) {
    if (p.re.test(l) && (!p.needsMoneyWord || MONEY_WORDS.test(l))) return p.name;
  }
  return null;
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function isCommentLine(l: string): boolean {
  const t = l.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Kopya taraması. Gerçek ağaçta ve aşağıdaki sentetik kaynaklarla AYNI kod
 * çalışır — izin listesinin davranışı da böylece test edilir.
 */
function scanForCopies(
  files: ReadonlyArray<{ rel: string; text: string }>,
  allowed: ReadonlyArray<{ file: string; line: string }>
): { offenders: string[]; staleAllowed: string[] } {
  const offenders: string[] = [];
  const used = new Set<number>();
  for (const { rel, text } of files) {
    if (DERIVATION_MODULES.has(rel)) continue;
    text.split("\n").forEach((l, i) => {
      if (isCommentLine(l)) return;
      const hit = copyPatternHit(l);
      if (!hit) return;
      const trimmed = l.trim();
      const allowedAt = allowed.findIndex((a) => a.file === rel && a.line === trimmed);
      if (allowedAt >= 0) {
        used.add(allowedAt);
        return;
      }
      offenders.push(`${rel}:${i + 1} [${hit}] ${trimmed}`);
    });
  }
  const staleAllowed = allowed.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.line}`);
  return { offenders, staleAllowed };
}

test("komisyon matematiği türetim modülü dışında elle kopyalanmaz (grep guard)", () => {
  const files = walkSources(SRC_ROOT).map((full) => ({
    rel: relative(REPO_ROOT, full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));
  const { offenders, staleAllowed } = scanForCopies(files, ALLOWED_COPIES);
  assert.deepEqual(
    offenders,
    [],
    `komisyon hesabı elle kopyalanmış — computeEarning (services/finance.ts) kullanın:\n${offenders.join("\n")}`
  );
  assert.deepEqual(
    staleAllowed,
    [],
    `ALLOWED_COPIES'te artık hiçbir satırla eşleşmeyen girdi var — silin:\n${staleAllowed.join("\n")}`
  );
});

test("grep guard kalıpları kopyaları yakalar, zararsız satırları geçer", () => {
  const hits = (l: string) => copyPatternHit(l) !== null;
  // Faz 3'te ağaçta bulunan gerçek kopyalar.
  assert.ok(hits("gross - Math.round((gross * PLATFORM_COMMISSION_RATE_BPS) / 10000);"));
  assert.ok(hits("grossKurus - Math.round((grossKurus * PLATFORM_COMMISSION_RATE_BPS) / 10000);"));
  assert.ok(hits("(j.paintingPriceKurus * j.commissionRateBps) / 10000"));
  // Önceki kalıpların KAÇIRDIĞI biçimler.
  assert.ok(hits("const c = Math.round((grossKurus * bps) / 10000);"));
  assert.ok(hits("const c = (gross * rate) / 10_000;"));
  assert.ok(hits("const net = gross * (1 - PLATFORM_COMMISSION_RATE_BPS / 1e4);"));
  assert.ok(hits("const net = gross * 60 / 100;"));
  assert.ok(hits("const net = Math.round(gross * 60 / 100);"));
  assert.ok(hits("const net = Math.round((gross * 40) / 100);"));
  assert.ok(hits("const net = Math.round(amountKurus / 100 * 60);"));
  // Eski kalıpların zaten yakaladıkları.
  assert.ok(hits("const net = amountKurus * 0.6;"));
  assert.ok(hits("const partner = 0.4 * grossKurus;"));
  assert.ok(hits("const share = 4000 / 10000;"));
  // Zararsız: para olmayan oranlar ve yüzde GÖSTERİMİ.
  assert.ok(!hits("setShowFloat(y > vh * 0.6 && y < docH - vh * 1.2);"));
  assert.ok(!hits("style={{ animationDelay: `${(i + p.plate) % 5 * 0.4}s` }}"));
  assert.ok(!hits("const sharePercent = (10000 - tier.commissionRateBps) / 100;"));
  assert.ok(!hits("Platform hizmet bedeli (%{PLATFORM_COMMISSION_RATE_BPS / 100})"));
  assert.ok(!hits("komisyon %{j.commissionRateBps / 100}"));
  assert.ok(!hits('₺{(j.netKurus / 100).toLocaleString("tr-TR")}'));
  assert.ok(!hits("const rounded = Math.round(raw / 100) * 100; // nearest ₺1"));
});

test("grep guard: izin satır METNİNE bağlı, dosyaya değil; eskiyen izin testi düşürür", () => {
  const copy = "const net = gross - Math.round((gross * PLATFORM_COMMISSION_RATE_BPS) / 10000);";
  const other = "const c = Math.round((grossKurus * bps) / 10000);";
  const allowed = [{ file: "src/app/x.tsx", line: copy }];
  // İzinli satır (girintisi ne olursa olsun) geçer…
  let r = scanForCopies([{ rel: "src/app/x.tsx", text: `    ${copy}\n` }], allowed);
  assert.deepEqual(r, { offenders: [], staleAllowed: [] });
  // …ama aynı dosyaya yazılan YENİ bir kopya düşer: dosya muaf değil.
  r = scanForCopies([{ rel: "src/app/x.tsx", text: `${copy}\n${other}` }], allowed);
  assert.equal(r.offenders.length, 1);
  assert.ok(r.offenders[0].startsWith("src/app/x.tsx:2 "), r.offenders[0]);
  // Aynı metin başka dosyada izinli değil; eşleşmeyen izin "eskimiş" sayılır.
  r = scanForCopies([{ rel: "src/app/y.tsx", text: copy }], allowed);
  assert.equal(r.offenders.length, 1);
  assert.deepEqual(r.staleAllowed, [`src/app/x.tsx: ${copy}`]);
  // Türetim modülü muaf; yorum satırı kod değildir.
  r = scanForCopies(
    [
      { rel: "src/lib/services/finance.ts", text: other },
      { rel: "src/app/z.ts", text: `// ${other}\n * ${other}` },
    ],
    []
  );
  assert.deepEqual(r, { offenders: [], staleAllowed: [] });
  // earning-base.ts / order-money.ts hesap yapmaz, finance.ts'e devreder → muaf değil.
  for (const rel of ["src/lib/services/earning-base.ts", "src/lib/config/order-money.ts"]) {
    r = scanForCopies([{ rel, text: other }], []);
    assert.equal(r.offenders.length, 1, rel);
  }
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
console.log(`\n${passed}/${cases.length} passed`);
