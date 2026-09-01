import assert from "node:assert/strict";
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

test("kuruşa yuvarlar, taşmaz", () => {
  assert.equal(parseTryToKurus("1,005"), 101); // 1,005 → 100,5 kuruş → 101
  assert.equal(parseTryToKurus("1,004"), 100);
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
