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
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { manufacturerEarnings, painterEarnings } from "../src/lib/db/schema";
import {
  OPEN_EARNING_STATUS,
  claimableEarningWhere,
  openEarningWhere,
  refundedOpenEarningWhere,
  refundedInPayoutEarningWhere,
} from "../src/lib/services/earning-claimable";
import {
  claimEarningsIntoPayout,
  groupPartnerPayables,
  verifyClaimedPayableMembers,
  type PayableSource,
  type PayableMember,
  isPayoutLockBusy,
  payoutHoldsWhatItClaims,
  PayoutClaimRaceError,
  type ClaimedEarning,
  type PayoutClaimOps,
} from "../src/lib/services/payout-claim";
import { REFUNDED_PAYMENT_STATUS } from "../src/lib/config/order-status-policy";
// YALNIZ TİP: `import type` derlemede silinir, yani payouts.ts (ve onunla gelen
// pg havuzu) bu dosyayı DB'siz koşarken hâlâ import edilmez. Statü birliği
// şemadan türer; testin kendi kopyasını yazması tam da yasak olan şeydir.
import type { EarningRowStatus } from "../src/lib/services/payouts";

let passed = 0;
const cases: Array<[string, () => void | Promise<void>]> = [];
function test(name: string, fn: () => void | Promise<void>) {
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

// ─── Ödenebilir hakediş kuralı: EKRAN ile PARTİ aynı satırlarda anlaşır ─────
//
// Kapanan hata: partner ekranı iade edilen siparişin hakedişini "ödeme
// bekleyen"den çıkarıyor, ekranın yanındaki düğmenin partileme sorgusu ise aynı
// satırı süpürüyordu (ekranda ₺838,20, partide ₺1.676,40). Kural tek yerde
// (services/earning-claimable.ts) ve aşağısı iki şeyi pinler: (1) kuralın SQL
// anlamı, (2) ekranların ve partileme sorgularının kuralı KENDİ yazmayıp o tek
// yerden okuduğu.
//
// DB YOK: earning-claimable.ts bilerek `@/lib/db` import etmez (db/index.ts
// import anında pg havuzu kurar), bu yüzden kural burada doğrudan import edilip
// derlenmiş SQL'i karşılaştırılabilir.

const dialect = new PgDialect();
const compile = (q: SQL) => dialect.sqlToQuery(q);

test("talep edilebilir hakediş: bekleyen + partilenmemiş + iade EDİLMEMİŞ", () => {
  const q = compile(claimableEarningWhere(manufacturerEarnings));
  assert.match(q.sql, /"manufacturer_earnings"\."status" = \$\d/);
  assert.match(q.sql, /"manufacturer_earnings"\."payout_id" is null/);
  assert.match(q.sql, /"orders"\."payment_status" is distinct from \$\d/);
  // "is not distinct from" olsaydı kural TERSİNE dönerdi: yalnız iade edilenler.
  assert.ok(!/is not distinct from/.test(q.sql), q.sql);
  assert.deepEqual(q.params, [OPEN_EARNING_STATUS, REFUNDED_PAYMENT_STATUS]);
});

test("iade edilen açık hakediş, talep edilebilirin TAM tümleyenidir", () => {
  const claim = compile(claimableEarningWhere(painterEarnings));
  const refunded = compile(refundedOpenEarningWhere(painterEarnings));
  // Aynı "açık satır" tanımı; yalnız iade terimi ters. Biri gevşerse (ör. biri
  // partilenmiş satırları da sayarsa) tutar iki toplamda birden görünürdü.
  assert.equal(
    claim.sql.replace(" is distinct from ", " <IADE> "),
    refunded.sql.replace(" is not distinct from ", " <IADE> ")
  );
  assert.deepEqual(claim.params, refunded.params);
});

test("kural iki tabloda da AYNI (üretici ve boyacı tarafı ayrışamaz)", () => {
  const m = compile(claimableEarningWhere(manufacturerEarnings)).sql.replaceAll(
    '"manufacturer_earnings"',
    '"T"'
  );
  const p = compile(claimableEarningWhere(painterEarnings)).sql.replaceAll(
    '"painter_earnings"',
    '"T"'
  );
  assert.equal(m, p);
});

test("partiye girmiş iade hakedişi ayrı sorulur (eski kayıtlar görünür kalsın)", () => {
  const q = compile(refundedInPayoutEarningWhere(manufacturerEarnings));
  assert.match(q.sql, /"payout_id" is not null/);
  assert.match(q.sql, /is not distinct from/);
});

// Kuralı okuması ZORUNLU yerler: ödenebilirliğe karar veren HER ekran ve HER
// partileme sorgusu. (Liste bilinen yerleri pinler; aşağıdaki ağaç taraması
// listede olmayan yeni bir yeri de yakalar.)
const CLAIMABLE_RULE_SITES: readonly string[] = [
  // /api/painter/payout-request BURADA DEĞİL: artık kendi partilemesini
  // kurmaz, createPayoutForPainter'a devreder (aşağıda ayrıca pinli).
  "src/app/admin/payouts/page.tsx",
  "src/app/manufacturer/earnings/page.tsx",
  "src/app/painter/earnings/page.tsx",
  "src/app/painter/dashboard/page.tsx",
];

// Partiyi YAZAN sorgular: kural siparişin ödeme durumunu okuduğu için birleşim
// şart, damga da sayılan id'lere vurulmalı. İKİ tane: üretici partisi ve boyacı
// partisi. Boyacının kendi talebi ÜÇÜNCÜ bir kopya DEĞİL, ikincisini çağırır.
const BATCHING_SITES: readonly string[] = ["src/lib/services/partner-payables.ts"];

// Toplamı SQL'den (satır listesinden DEĞİL) çıkarması gereken partner ekranları.
// Admin kuyruğu bu listede yok: o, satır satır listeleyip ödenebilir/ödenmez
// diye ayırır, toplamayla değil.
const SCREEN_TOTAL_SITES: readonly string[] = [
  "src/app/manufacturer/earnings/page.tsx",
  "src/app/painter/earnings/page.tsx",
  "src/app/painter/dashboard/page.tsx",
];

const readSite = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

test("ekran ve partileme kuralı TEK yerden okur, kendi yazmaz", () => {
  for (const rel of CLAIMABLE_RULE_SITES) {
    const text = readSite(rel);
    assert.ok(
      /from "@\/lib\/services\/partner-payables"/.test(text),
      `${rel}: kural modülünü import etmiyor`
    );
    assert.ok(
      text.includes("readPartnerPayables(") && text.includes(".claimableNet"),
      `${rel}: payable totals must come from readPartnerPayables`
    );
    // Kuralın elle yeniden kurulması: tam da ayrışmanın başladığı yer.
    assert.ok(
      !/isNull\(\s*\w*[Ee]arnings\.payoutId\s*\)/.test(text),
      `${rel}: payoutId filtresini elle kuruyor — claimableEarningWhere kullanın`
    );
    assert.ok(
      !text.includes(`"${REFUNDED_PAYMENT_STATUS}"`) &&
        !text.includes(`'${REFUNDED_PAYMENT_STATUS}'`),
      `${rel}: iade değerini elle yazıyor — kural earning-claimable.ts'den gelir`
    );
  }
});

test("partileme sorguları siparişle birleşir ve damgayı sayılan satırlara vurur", () => {
  for (const rel of BATCHING_SITES) {
    const text = readSite(rel);
    assert.ok(
      text.includes("leftJoin(orders"),
      `${rel}: kural siparişin ödeme durumunu okur, birleşim olmadan kurulamaz`
    );
    assert.ok(
      text.includes("inArray("),
      `${rel}: damga sayılan id listesine vurulmalı; WHERE'i ikinci kez çalıştırmak arada tahakkuk eden hakedişi sayılmadan partiye sokar`
    );
    // Sayım KİLİTLİ okunmazsa iki eşzamanlı partileme aynı satırları alır ve
    // ikisi de başarılı döner (ölçülen yarış: iki parti, aynı 6 hakediş).
    assert.ok(
      /\.for\(\s*"update"/.test(text),
      `${rel}: talep edilebilir satırlar "for update" ile kilitlenmeli, yoksa aynı hakediş iki partiye girer`
    );
    // Toplam, damganın kendisinden yazılmalı: ortak algoritma bunu zorlar.
    assert.ok(
      text.includes("verifyClaimedPayableMembers("),
      `${rel}: partileme ortak atomik algoritmadan geçmeli (payout-claim.ts)`
    );
    // Ödendi işaretleme, partinin GERÇEKTEN tuttuğu parayı doğrulamalı.
    assert.ok(
      text.includes("payoutHoldsWhatItClaims("),
      `${rel}: "Ödendi işaretle" partinin tuttuğu parayı doğrulamadan yazamaz`
    );
  }
});

// ─── Partiyi KURAN tek yol ──────────────────────────────────────────────────
//
// NEDEN LİSTE YETMEZ: kopya partileme tam da böyle doğdu — /api/painter/
// payout-request kendi kopyasını taşıyordu ve kural bir turda yalnız servis
// tarafında düzeltildi. Aşağıdaki tarama, parti satırı YAZAN her dosyayı bulur;
// iki servis dışında biri çıkarsa düşer.
const PAYOUT_INSERT_RE = /\.insert\(\s*(?:payouts|painterPayouts)\s*\)/;

function filesInsertingPayouts(
  files: ReadonlyArray<{ rel: string; text: string }>
): string[] {
  const out: string[] = [];
  for (const { rel, text } of files) {
    const hit = text
      .split("\n")
      .some((line) => !isCommentLine(line) && PAYOUT_INSERT_RE.test(line));
    if (hit) out.push(rel);
  }
  return out.sort();
}

test("ödeme partisini YALNIZ ortak servis kurar (kopya partileme yok)", () => {
  const files = walkSources(join(REPO_ROOT, "src")).map((full) => ({
    rel: relative(REPO_ROOT, full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));
  assert.deepEqual(filesInsertingPayouts(files), [...BATCHING_SITES].sort());
  // Taramanın kendisi: sentetik bir kopya yakalanmalı, yorum satırı geçmeli.
  assert.deepEqual(
    filesInsertingPayouts([{ rel: "src/app/x/route.ts", text: "await tx.insert(painterPayouts).values({})" }]),
    ["src/app/x/route.ts"]
  );
  assert.deepEqual(
    filesInsertingPayouts([{ rel: "src/app/x/route.ts", text: "// await tx.insert(payouts).values({})" }]),
    []
  );
});

test("boyacının ödeme talebi partiyi KENDİ kurmaz, servise devreder", () => {
  const text = readSite("src/app/api/painter/payout-request/route.ts");
  assert.ok(
    text.includes("createPayoutForPainter("),
    "boyacı talebi partilemeyi servise devretmeli"
  );
  assert.ok(
    !PAYOUT_INSERT_RE.test(text),
    "boyacı talebi parti satırını kendisi yazıyor — ikinci bir partileme kopyası"
  );
});

// ─── Para durumunu DEĞİŞTİREN yol, KARDEŞİNİN aldığı kilidi alır ───────────
//
// Yukarıdaki partileme pini DOSYADA bir `.for("update")` arar; bu YETMEZ:
// payouts.ts'de zaten üç tane var, dolayısıyla geri alma kendi kilidini
// kaybetse bile dosya testi geçerdi. Aşağısı FONKSİYON GÖVDESİNE bakar ve
// denetimi SAF fonksiyonlara ayırır: pinin gerçekten ısırdığı, düzeltmeden
// ÖNCEKİ gövdeler sentetik olarak verilip burada kanıtlanır — gerçek dosyayı
// bozmadan (ağaçta paralel çalışan başka düzeltmeciler var).
//
// KAPANAN HATA: reverseEarning / reversePainterEarning hakedişin parti
// üyeliğini KİLİTSİZ okuyordu. Araya giren partileme satırı P'ye damgalayınca
// geri alma P'yi hiç görmüyor, düşümü atlıyor, ama satırı yine de partiden
// koparıyordu: P artık tutmadığı parayı iddia eder — markPayoutPaid'in kalıcı
// reddettiği, deleteEmptyPayout'un da (parti başka satırlar tutar)
// temizleyemediği çıkışsız hâl. İkinci hata, boyacı tarafının çevirme
// UPDATE'inin YALNIZ id'ye bakmasıydı: parti kilidini tutan "ödendi işaretle"
// araya girdiğinde ÖDENMİŞ hakediş `reversed` yapılabiliyordu.

/**
 * Bir fonksiyonun gövdesi, YORUMLARI ATILMIŞ hâlde.
 *
 * Yorumları atmadan bakmak yanıltır: gövdenin hemen ardından gelen JSDoc
 * (ör. painter-payouts.ts'de createPayoutForPainter'ın "sayım `for update of`
 * ile kilitli okunur" cümlesi) dilime düşer ve kilit KODDAN kalksa bile pin
 * geçerdi.
 */
function functionBody(text: string, signature: string): string {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `kaynakta bulunamadı: ${signature}`);
  const rest = text.slice(start + signature.length);
  const end = rest.indexOf("\nexport ");
  return (end >= 0 ? rest.slice(0, end) : rest)
    .split("\n")
    .filter((l) => !isCommentLine(l))
    .join("\n");
}

/**
 * Geri alma yolunun kusurları. SAF: metin girer, sorun listesi çıkar — gerçek
 * kaynak da sentetik (düzeltme öncesi) gövde de AYNI koddan geçer.
 */
function reversalDefects(body: string, table: string): string[] {
  const out: string[] = [];
  if (!/\.for\(\s*"update"/.test(body)) out.push("parti üyeliğini KİLİTSİZ okuyor");
  if (!body.includes("lock_timeout")) out.push("kilidi sınırsız bekliyor");
  for (const status of ["reversed", "paid"]) {
    if (!new RegExp(`ne\\(\\s*${table}\\.status\\s*,\\s*"${status}"`).test(body)) {
      out.push(`çevirmeyi "${status}" satırlardan ayırmıyor`);
    }
  }
  if (/\.where\(\s*eq\(\s*\w*[Ee]arnings\.id\s*,/.test(body)) {
    out.push("hakedişi yalnız id ile yazıyor");
  }
  return out;
}

/** Damganın kusuru: id listesine EK OLARAK "hâlâ partisiz" yüklemi var mı. */
function stampDefects(body: string): string[] {
  return body.includes("openEarningWhere(")
    ? []
    : ["damgayı yalnız id listesine dayandırıyor"];
}

const REVERSAL_SITES: ReadonlyArray<{ rel: string; signature: string; table: string }> = [
  {
    rel: "src/lib/services/payouts.ts",
    signature: "export async function reverseEarning(",
    table: "manufacturerEarnings",
  },
  {
    rel: "src/lib/services/painter-payouts.ts",
    signature: "export async function reversePainterEarning(",
    table: "painterEarnings",
  },
];

const BATCHING_FUNCTIONS: ReadonlyArray<{ rel: string; signature: string }> = [
  {
    rel: "src/lib/services/payouts.ts",
    signature: "export async function createPayoutForManufacturer(",
  },
  {
    rel: "src/lib/services/painter-payouts.ts",
    signature: "export async function createPayoutForPainter(",
  },
];

test("both reversal adapters delegate to the gated shared source/debit reversal", () => {
  for (const { rel, signature } of REVERSAL_SITES) {
    const body = functionBody(readSite(rel), signature);
    assert.ok(body.includes("reversePartnerEarning("));
    assert.ok(!body.includes("db.transaction("), "adapter must not hold outer locks");
  }
  const shared = functionBody(readSite("src/lib/services/partner-payables.ts"), "export async function reversePartnerEarning(");
  assert.ok(shared.indexOf("lockPartnerMoney(") < shared.indexOf('.for("update")'));
  assert.match(shared, /eq\(t\.earning\.status, "pending"\)/);
  assert.ok(shared.includes('sourceId, earning.id'));
  assert.ok(shared.includes('adjustmentMembership(kind, null)'));
  assert.ok(shared.includes('totalKurus: integerTotal(held.heldNet)'));
  assert.ok(readSite("src/lib/services/money-partner-lock.ts").includes("lock_timeout"));
});

test("handoff recovery gates the exact reversed-row delete without nesting public money transactions", () => {
  const source = readSite("src/lib/services/revoke-after-painter.ts");
  const reversal = source.indexOf("await reverseEarning(orderId)");
  const transaction = source.indexOf("await db.transaction", reversal);
  const gate = source.indexOf("await lockPartnerMoney", transaction);
  const deletion = source.indexOf("await tx.delete(manufacturerEarnings)", gate);
  assert.ok(reversal >= 0 && transaction > reversal && gate > transaction && deletion > gate);
  const body = source.slice(transaction, source.indexOf("\n      });", transaction));
  assert.ok(!body.includes("reverseEarning(") && !body.includes("accrueEarning("));
  assert.ok(body.includes("eq(manufacturerEarnings.id, reversed.id)"));
  assert.ok(body.includes("eq(manufacturerEarnings.manufacturerId, reversed.manufacturerId)"));
  assert.ok(body.includes('eq(manufacturerEarnings.status, "reversed")'));
});

test("pin ISIRIR: düzeltmeden ÖNCEKİ geri alma gövdeleri testi DÜŞÜRÜR", () => {
  // Ölçülen hâlin ta kendisi: kilitsiz okuma + satırı yalnız id ile çeviren
  // boyacı UPDATE'i. Bu gövde bir gün geri gelirse yukarıdaki test düşer.
  const kilitsiz = [
    "const toReverse = await tx",
    "  .select({ id: painterEarnings.id, payoutId: painterEarnings.payoutId })",
    "  .from(painterEarnings)",
    '  .where(and(eq(painterEarnings.orderId, orderId), ne(painterEarnings.status, "reversed"), ne(painterEarnings.status, "paid")));',
    'await tx.update(painterEarnings).set({ status: "reversed" }).where(eq(painterEarnings.id, e.id));',
  ].join("\n");
  assert.deepEqual(reversalDefects(kilitsiz, "painterEarnings"), [
    "parti üyeliğini KİLİTSİZ okuyor",
    "kilidi sınırsız bekliyor",
    "hakedişi yalnız id ile yazıyor",
  ]);
  // Kilit var ama statü yeniden denetlenmiyor: satır iki kez çevrilebilir,
  // ödenmiş satır bile `reversed` olabilir.
  const statusuz = [
    "await tx.execute(\"SET LOCAL lock_timeout = '5s'\");",
    'await tx.select().from(painterEarnings).where(eq(painterEarnings.orderId, orderId)).for("update");',
  ].join("\n");
  assert.deepEqual(reversalDefects(statusuz, "painterEarnings"), [
    'çevirmeyi "reversed" satırlardan ayırmıyor',
    'çevirmeyi "paid" satırlardan ayırmıyor',
  ]);
  // Düzeltilmiş gövde temiz: tarama masum kodu düşürmüyor.
  const duzeltilmis = [
    "await tx.execute(\"SET LOCAL lock_timeout = '5s'\");",
    'await tx.select().from(painterEarnings).where(and(eq(painterEarnings.orderId, orderId), ne(painterEarnings.status, "reversed"), ne(painterEarnings.status, "paid"))).for("update");',
    'await tx.update(painterEarnings).set({ status: "reversed" }).where(and(eq(painterEarnings.orderId, orderId), ne(painterEarnings.status, "reversed"), ne(painterEarnings.status, "paid")));',
  ].join("\n");
  assert.deepEqual(reversalDefects(duzeltilmis, "painterEarnings"), []);
});

test("both claim adapters delegate; shared stamp retains the open-source predicate", () => {
  for (const { rel, signature } of BATCHING_FUNCTIONS) {
    assert.ok(functionBody(readSite(rel), signature).includes("createPartnerPayout("));
  }
  const shared = functionBody(readSite("src/lib/services/partner-payables.ts"), "export async function createPartnerPayout(");
  assert.deepEqual(stampDefects(shared), []);
  assert.ok(shared.indexOf("lockPartnerMoney(") < shared.indexOf("lockPayableOrders("));
  assert.ok(shared.includes("verifyClaimedPayableMembers("));
});

test("pin ISIRIR: yüklemsiz damga testi DÜŞÜRÜR", () => {
  // Düzeltmeden önceki damga: id listesi TEK başına. Kilit delinirse başka
  // partinin satırı sessizce çalınırdı.
  const yuklemsiz =
    "stamp: async (payoutId, ids) => await tx.update(manufacturerEarnings)" +
    ".set({ payoutId }).where(inArray(manufacturerEarnings.id, ids)).returning({ id: manufacturerEarnings.id }),";
  assert.deepEqual(stampDefects(yuklemsiz), ["damgayı yalnız id listesine dayandırıyor"]);
  const yuklemli =
    "stamp: async (payoutId, ids) => await tx.update(manufacturerEarnings)" +
    ".set({ payoutId }).where(and(inArray(manufacturerEarnings.id, ids), openEarningWhere(manufacturerEarnings))),";
  assert.deepEqual(stampDefects(yuklemli), []);
});

test("damga yüklemi: açık satır = bekleyen VE partisiz", () => {
  // Pinin dayandığı ANLAM: yüklem gerçekten "hâlâ talep edilmemiş" der.
  const q = compile(openEarningWhere(manufacturerEarnings));
  assert.match(q.sql, /"manufacturer_earnings"\."payout_id" is null/);
  assert.match(q.sql, /"manufacturer_earnings"\."status" = \$\d/);
  assert.deepEqual(q.params, [OPEN_EARNING_STATUS]);
});

// ─── RET ve YENİDEN DEVİRDE ÜRETİCİNİN BASKI PAYI (Faz 4) ──────────────────
//
// SAHİBİN KARARI: boyacı işi reddettiğinde üreticinin baskı hakedişi DURUR.
// Baskıyı yapmış, QC'den geçmiş, hiçbir hatası olmayan üreticinin parası
// boyacının kararıyla silinemez. Bu kararın bir yan etkisi var ve para deliği
// tam oradaydı: hakediş satırı sipariş üzerinde TEKİLDİR, oysa retten sonra
// siparişin gidebileceği iki sonun tutarları FARKLIDIR:
//
//   • iş sıradaki boyacıya gider → üretici payı = ÜRETİM kalemi (değişmez),
//   • ret hakkı tükenince (DÖRDÜNCÜ ret; config/flags.ts ·
//     PAINTER_MAX_DECLINES) iş admin kuyruğuna düşer ve "kendim boyarım"
//     üreticisi
//     siparişi kendi boyayıp kargolar → üretici payı = ÜRETİM + BOYAMA.
//
// İkinci dalda tahakkuk ikinci kez, DAHA BÜYÜK bir tutarla çağrılır. Eski kural
// (`onConflictDoNothing`) o çağrıyı sessizce yutuyordu: satır küçük tutarda
// kalıyor, üretici boyama payından mahrum kalıyor ve ortada ne hata, ne günlük,
// ne de admin'in görebileceği tek bir iz oluyordu. Aşağısı iki dalın da
// tutarını ÇİVİLER.

/**
 * payouts.ts'i DB'siz sınamak için dinamik olarak yükler.
 *
 * NEDEN GÜVENLİ: o zincirdeki hiçbir bağlantı import anında kurulmaz — pg
 * havuzu ilk sorguda, Redis ilk çağrıda açılır. Kararın KENDİSİ buradan okunur;
 * testin kendi kopyasını yazması tam da bu dosyanın yasakladığı şey olurdu.
 *
 * Üst seviye await yok (tsx bu dosyayı CJS'e çeviriyor), bu yüzden yükleme test
 * gövdesinin içinde ve yalnız bir kez yapılır.
 */
type PayoutsModule = typeof import("../src/lib/services/payouts");
let payoutsCache: PayoutsModule | null = null;
async function payoutsModule(): Promise<PayoutsModule> {
  payoutsCache ??= await import("../src/lib/services/payouts");
  return payoutsCache;
}

/** Siparişin TEK hakediş satırı — UNIQUE(order_id) kısıtının bellekteki eşi. */
interface LedgerRow {
  manufacturerId: string;
  grossKurus: number;
  netKurus: number;
  /** Satır bir ödeme partisine girdi ya da ödendi mi (artık düzeltilemez). */
  settled: boolean;
  /**
   * Satırın statüsü. "reversed" satır DOĞRU tutarı taşısa bile ödenmez —
   * claimableEarningWhere onu hiçbir partiye almaz — o yüzden karar tutardan
   * ÖNCE buna bakmak zorundadır.
   */
  status: EarningRowStatus;
}

/**
 * Tek bir tahakkuk çağrısını satıra uygular.
 *
 * Karar GERÇEK koddan (reconcileAccrual), tutar gerçek türetimden
 * (manufacturerBaseKurus + computeEarning) gelir; burada ikinci bir para kuralı
 * YOKTUR. `settled` satırın düzeltilemezliği, sunucudaki `openEarningWhere`
 * yükleminin ("bekleyen VE partisiz") bellekteki karşılığıdır.
 */
async function applyAccrual(
  row: LedgerRow | null,
  incoming: { manufacturerId: string; grossKurus: number }
): Promise<{ row: LedgerRow; outcome: string }> {
  const { reconcileAccrual } = await payoutsModule();
  const e = computeEarning(incoming.grossKurus, PLATFORM_COMMISSION_RATE_BPS);
  if (!row) {
    return {
      row: {
        manufacturerId: incoming.manufacturerId,
        grossKurus: e.grossKurus,
        netKurus: e.netKurus,
        settled: false,
        status: "pending",
      },
      outcome: "accrued",
    };
  }
  const decision = reconcileAccrual({
    existing: row,
    incoming: { manufacturerId: incoming.manufacturerId, grossKurus: e.grossKurus },
  });
  if (decision.action === "keep") return { row, outcome: "already_accrued" };
  if (decision.action === "refuse") {
    return { row, outcome: `mismatch_refused:${decision.reason}` };
  }
  // Düzeltme YALNIZ açık satırda; kapalı satırda sunucu yüklemi 0 satır döner.
  if (row.settled) return { row, outcome: "mismatch_refused:settled" };
  return {
    row: { ...row, grossKurus: e.grossKurus, netKurus: e.netKurus },
    outcome: "corrected",
  };
}

/** Faz 4 senaryolarının siparişi: ₺3.500 = ₺2.400 üretim + ₺1.100 boyama. */
const PAINTING_ORDER = {
  amountKurus: 350000,
  productionBaseKurus: 240000,
  paintingPriceKurus: 110000,
};

test("devreden üretici: ret ve yeniden devir baskı payını DEĞİŞTİRMEZ", async () => {
  const mfg = "uretici-1";

  // 1) Devir: taban ÜRETİM kalemidir — boyama payı boyacınındır.
  let s = await applyAccrual(null, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: "boyaci-1",
      paintsInHouse: false,
    }),
  });
  assert.equal(s.outcome, "accrued");
  assert.equal(s.row.grossKurus, 240000);

  // 2) Boyacı reddetti: para yoluna HİÇ dokunulmaz (ne çevirme ne silme) —
  //    satır olduğu gibi durur. Ret rotasının kaynağı da aşağıda çivileniyor.

  // 3) Sıradaki boyacıya yeniden devir: aynı taban, İKİNCİ KEZ ÖDEME YOK.
  s = await applyAccrual(s.row, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: "boyaci-2",
      paintsInHouse: false,
    }),
  });
  assert.equal(s.outcome, "already_accrued");
  assert.equal(s.row.grossKurus, 240000);
  assert.equal(s.row.netKurus, computeEarning(240000, PLATFORM_COMMISSION_RATE_BPS).netKurus);
  assert.equal(s.row.netKurus, 144000);
});

test("kendim boyarım üreticisi: ret hakkı tükenince kendi kargolayınca EKSİK ödenmez", async () => {
  const mfg = "uretici-2";

  // 1) Admin işi bir boyacıya devretti: üretici "kendim boyarım" olsa bile iş
  //    fiilen boyacıdadır, yani taban yalnız ÜRETİM kalemidir.
  let s = await applyAccrual(null, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: "boyaci-1",
      paintsInHouse: true,
    }),
  });
  assert.equal(s.outcome, "accrued");
  assert.equal(s.row.grossKurus, 240000, "devirde boyama payı üreticiye yazılamaz");

  // 2) Üç boyacı da reddetti → iş admin kuyruğunda, siparişte boyacı yok.
  //    Hakediş satırı (sahibin kararı) 240000 kuruşta duruyor.

  // 3) Üretici siparişi KENDİ boyayıp kargoladı → taban ÜRETİM + BOYAMA.
  s = await applyAccrual(s.row, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: null,
      paintsInHouse: true,
    }),
  });
  assert.equal(s.outcome, "corrected");
  assert.equal(s.row.grossKurus, 350000);
  assert.equal(s.row.netKurus, 210000);

  // ÖLÇÜLEN DELİĞİN BÜYÜKLÜĞÜ: düzeltme olmasaydı satır 240000'de kalır ve
  // üretici tam olarak boyama kalemi kadar eksik ödenirdi.
  assert.equal(350000 - 240000, PAINTING_ORDER.paintingPriceKurus);
  assert.equal(
    210000 - 144000,
    computeEarning(PAINTING_ORDER.paintingPriceKurus, PLATFORM_COMMISSION_RATE_BPS).netKurus
  );
});

test("partiye girmiş/ödenmiş satır sessizce düzeltilmez — REDDEDİLİR", async () => {
  const mfg = "uretici-3";
  const first = await applyAccrual(null, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: "boyaci-1",
      paintsInHouse: true,
    }),
  });
  // Satır ödeme partisine girdi: parti toplamı bu net'ten yazıldı.
  const settled: LedgerRow = { ...first.row, settled: true };

  const s = await applyAccrual(settled, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: null,
      paintsInHouse: true,
    }),
  });
  assert.equal(s.outcome, "mismatch_refused:settled");
  // Tutar DEĞİŞMEZ: parti, arkasındaki hakedişlerle çelişirse "Ödendi işaretle"
  // onu kalıcı olarak reddeder — bir deliği kapatırken ödemenin tamamı kilitlenir.
  assert.equal(s.row.grossKurus, 240000);
});

test("satır BAŞKA bir üreticiye aitse tutar düzeltilmez", async () => {
  const s = await applyAccrual(
    {
      manufacturerId: "uretici-A",
      grossKurus: 240000,
      netKurus: 144000,
      settled: false,
      status: "pending",
    },
    { manufacturerId: "uretici-B", grossKurus: 350000 }
  );
  assert.equal(s.outcome, "mismatch_refused:other_manufacturer");
  assert.equal(s.row.manufacturerId, "uretici-A");
  assert.equal(s.row.grossKurus, 240000);
});

// ─── GERİ ÇEVRİLMİŞ SATIR: "aynı tutar" her zaman "para yerinde" demek değil ─
//
// ÖLÇÜLEN HÂL: admin kargoyu geri alır (ship-revert) — hakediş satırı SİLİNMEZ,
// "reversed" olur — ve sipariş yeniden kargolanınca tahakkuk aynı tutarla ikinci
// kez çağrılır. Statüye bakmayan karar buna "keep" diyordu; çağıran
// "already_accrued" cevabını alıyor, oysa `reversed` satır hiçbir ödeme
// partisine giremiyordu: üretici o siparişten HİÇ ödenmeyecekti ve ortada tek
// bir iz yoktu.

test("geri çevrilmiş satır, AYNI tutarda bile 'zaten tahakkuk etti' DEMEZ", async () => {
  const mfg = "uretici-5";
  const base = manufacturerBaseKurus({
    ...PAINTING_ORDER,
    painterId: "boyaci-1",
    paintsInHouse: false,
  });
  const first = await applyAccrual(null, { manufacturerId: mfg, grossKurus: base });
  assert.equal(first.outcome, "accrued");

  // Admin kargoyu geri aldı: satır silinmez, "geri çevrildi" olur.
  const reversed: LedgerRow = { ...first.row, status: "reversed" };

  // Sipariş yeniden kargolandı → AYNI taban, ikinci tahakkuk.
  const s = await applyAccrual(reversed, { manufacturerId: mfg, grossKurus: base });
  assert.notEqual(s.outcome, "already_accrued");
  assert.equal(s.outcome, "mismatch_refused:reversed");
  // Satır diriltilmez: çevirme bir insanın/iadenin kararıdır ve net'i bekleyen
  // partiden çoktan düşülmüştür.
  assert.equal(s.row.status, "reversed");
  assert.equal(s.row.grossKurus, 240000);
});

test("geri çevrilmiş satır FARKLI tutarda 'partiye girmiş' DEMEZ", async () => {
  const mfg = "uretici-6";
  const first = await applyAccrual(null, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: "boyaci-1",
      paintsInHouse: true,
    }),
  });
  const reversed: LedgerRow = { ...first.row, status: "reversed" };

  // Üretici siparişi kendi boyayıp yeniden kargoladı → taban ÜRETİM + BOYAMA,
  // yani satırdakinden FARKLI bir tutar.
  const s = await applyAccrual(reversed, {
    manufacturerId: mfg,
    grossKurus: manufacturerBaseKurus({
      ...PAINTING_ORDER,
      painterId: null,
      paintsInHouse: true,
    }),
  });
  assert.equal(s.outcome, "mismatch_refused:reversed");
  // Satır PARTİSİZ ve ÖDENMEMİŞTİ: "settled" demek, admin'i var olmayan bir
  // partiyi aramaya yollardı.
  assert.notEqual(s.outcome, "mismatch_refused:settled");
  assert.equal(s.row.grossKurus, 240000);
  assert.equal(s.row.settled, false);
});

test("red mesajı satırın DURUMUNU söyler (metin, hâlle uyuşur)", async () => {
  const { accrualMismatchNote } = await payoutsModule();
  const arg = { manufacturerId: "uretici-7", wantedGrossKurus: 350000 };

  const reversed = accrualMismatchNote({ ...arg, foundGrossKurus: 240000, reason: "reversed" });
  assert.match(reversed, /geri çevrildi/);
  assert.match(reversed, /240000/);
  assert.match(reversed, /350000/);
  // Eski metnin ta kendisi: partisiz bir satır için "partiye girmiş" demek.
  assert.ok(!reversed.includes("ödeme partisine girmiş"), reversed);

  const settled = accrualMismatchNote({ ...arg, foundGrossKurus: 240000, reason: "settled" });
  assert.match(settled, /ödeme partisine girmiş ya da ödenmiş/);
  assert.ok(!settled.includes("geri çevrildi"), settled);

  const vanished = accrualMismatchNote({ ...arg, foundGrossKurus: null, reason: "vanished" });
  // Olmayan satıra tutar uydurulmaz (eski metin "satır 0 kuruş" yazıyordu).
  assert.ok(!vanished.includes("satır 0 kuruş"), vanished);
  assert.ok(!vanished.includes("null"), vanished);
  assert.match(vanished, /okunabildi|okunamadı/);

  const other = accrualMismatchNote({
    ...arg,
    foundGrossKurus: 240000,
    reason: "other_manufacturer",
  });
  assert.match(other, /BAŞKA bir üreticiye ait/);
  assert.ok(!other.includes("geri çevrildi"), other);
});

/**
 * Tahakkuk yolunun kusurları. SAF: gövde metni girer, sorun listesi çıkar —
 * gerçek kaynak da sentetik (düzeltme öncesi) gövde de AYNI koddan geçer.
 */
function accrualDefects(body: string): string[] {
  const out: string[] = [];
  if (!body.includes("reconcileAccrual(")) out.push("çakışan satırı hiç incelemiyor");
  if (!/\.for\(\s*"update"/.test(body)) out.push("çakışan satırı KİLİTSİZ okuyor");
  if (!/status:\s*manufacturerEarnings\.status/.test(body)) {
    out.push("çakışan satırın STATÜSÜNÜ okumuyor");
  }
  if (!/\.update\(\s*manufacturerEarnings\s*\)/.test(body)) {
    out.push("yanlış tutarı düzeltmiyor");
  }
  if (!body.includes("openEarningWhere(")) out.push("düzeltmeyi AÇIK satırla sınırlamıyor");
  if (!/eq\(\s*manufacturerEarnings\.manufacturerId\s*,/.test(body)) {
    out.push("düzeltmeyi satırın SAHİBİYLE sınırlamıyor");
  }
  if (!body.includes("mismatch_refused")) out.push("düzeltemediğini söylemiyor");
  // İz, kararı veren İŞLEMİN İÇİNDE yazılmalı: dışarıda, başka bir bağlantıda
  // ve hatası yutularak yazılan not hiç yazılmayabilir — red o zaman kalıcı
  // hiçbir kayıt bırakmadan biter.
  if (!/writeMismatchNote\(\s*\{?\s*tx\b/.test(body)) {
    out.push("reddin izini İŞLEMİN DIŞINDA bırakıyor");
  }
  return out;
}

test("tahakkuk: yanlış tutarlı satır ya DÜZELTİLİR ya da gürültüyle reddedilir", () => {
  assert.deepEqual(
    accrualDefects(
      functionBody(
        readSite("src/lib/services/payouts.ts"),
        "export async function accrueEarning("
      )
    ),
    []
  );
});

test("pin ISIRIR: çakışmayı YUTAN eski tahakkuk gövdesi testi DÜŞÜRÜR", () => {
  // Düzeltmeden önceki gövdenin ta kendisi: çakışma sessizce yutuluyor ve
  // "already_accrued" deniyordu — satır küçük tutarda kalsa bile.
  const yutan = [
    "const e = computeEarning(grossKurus, rateBps);",
    "const inserted = await tx",
    "  .insert(manufacturerEarnings)",
    "  .values({ orderId, manufacturerId, grossKurus: e.grossKurus })",
    "  .onConflictDoNothing({ target: manufacturerEarnings.orderId })",
    "  .returning({ id: manufacturerEarnings.id });",
    'return inserted.length > 0 ? "accrued" : "already_accrued";',
  ].join("\n");
  assert.deepEqual(accrualDefects(yutan), [
    "çakışan satırı hiç incelemiyor",
    "çakışan satırı KİLİTSİZ okuyor",
    "çakışan satırın STATÜSÜNÜ okumuyor",
    "yanlış tutarı düzeltmiyor",
    "düzeltmeyi AÇIK satırla sınırlamıyor",
    "düzeltmeyi satırın SAHİBİYLE sınırlamıyor",
    "düzeltemediğini söylemiyor",
    "reddin izini İŞLEMİN DIŞINDA bırakıyor",
  ]);

  // Düzeltilmiş gövde temiz: tarama masum kodu düşürmüyor.
  const duzeltilmis = [
    'const [existing] = await tx.select({ manufacturerId: manufacturerEarnings.manufacturerId, grossKurus: manufacturerEarnings.grossKurus, status: manufacturerEarnings.status }).from(manufacturerEarnings).where(eq(manufacturerEarnings.orderId, orderId)).for("update");',
    "const decision = reconcileAccrual({ existing, incoming: { manufacturerId, grossKurus: e.grossKurus } });",
    "const fixed = await tx.update(manufacturerEarnings).set({ grossKurus: e.grossKurus }).where(and(eq(manufacturerEarnings.orderId, orderId), eq(manufacturerEarnings.manufacturerId, manufacturerId), openEarningWhere(manufacturerEarnings))).returning({ id: manufacturerEarnings.id });",
    'if (fixed.length === 0) { await writeMismatchNote({ tx, orderId, reason: "settled" }); return { outcome: "mismatch_refused" }; }',
  ].join("\n");
  assert.deepEqual(accrualDefects(duzeltilmis), []);
});

test("boyacı reddi üreticinin baskı hakedişine DOKUNMAZ", () => {
  // Sahibin kararı KODA bakılarak sınanır: kaldırılan çağrıyı anlatan yorum,
  // çağrının kendisi sayılmamalı.
  const code = readSite("src/app/api/painter/orders/[id]/decline/route.ts")
    .split("\n")
    .filter((l) => !isCommentLine(l))
    .join("\n");
  assert.ok(
    !code.includes("reverseEarning("),
    "ret, üreticinin baskı hakedişini geri alıyor"
  );
  assert.ok(
    !/delete\(\s*manufacturerEarnings\s*\)/.test(code),
    "ret, üreticinin hakediş satırını siliyor"
  );
  assert.ok(
    !code.includes("accrueEarning("),
    "ret, hakediş yazıyor — tutarı belirleyen yer ret değil, devir/kargo adımıdır"
  );
});

test("screen totals use the full shared payable reader, never a truncated display list", () => {
  for (const rel of SCREEN_TOTAL_SITES) {
    const text = readSite(rel);
    assert.ok(
      text.includes("readPartnerPayables(") && text.includes(".claimableNet"),
      `${rel}: payable totals must delegate to the shared reader`
    );
    // Eski hata: toplam, 200 satırlık listeden reduce ile çıkarılıyordu; 200.
    // satırdan eskide kalan iade hakedişi ne toplama ne uyarıya giriyordu.
    assert.ok(
      !/\.reduce\(\(s, e\) => s \+ e\.netKurus/.test(text),
      `${rel}: toplamı satır listesinden hesaplıyor — listelenmeyen kayıt toplamdan düşer`
    );
  }
});

test("shared payable read has no page limit and owns group assessment", () => {
  const source = readSite("src/lib/services/partner-payables.ts");
  const body = functionBody(source, "export async function loadPartnerPayables(");
  assert.ok(!body.includes(".limit("));
  assert.ok(body.includes("groupPartnerPayables("));
  assert.ok(body.includes("REFUNDED_PAYMENT_STATUS"));
  assert.ok(body.includes("heldMembers"));
});

test("source groups cannot offset unrelated work; zero net stays claimable", () => {
  const original: PayableSource = { sourceKind: "manufacturer_earning", id: "source", orderId: "order", netKurus: 6000, status: "pending", payoutId: null, eligible: true };
  const offset: PayableMember = { sourceKind: "adjustment", id: "offset", orderId: "order", netKurus: -6000, status: "pending", payoutId: null, offsetSourceKind: "manufacturer_earning", sourceId: "source" };
  const unrelated: PayableSource = { ...original, id: "other", netKurus: 2000 };
  assert.deepEqual(groupPartnerPayables([original, unrelated], [offset]).groups.map(g => g.netKurus), [0, 2000]);
  const reduced = groupPartnerPayables([{ ...original, netKurus: 3000 }, unrelated], [offset]);
  assert.deepEqual(reduced.groups.map(g => g.sourceId), ["other"]);
  assert.equal(reduced.blockedGroups[0].reason, "offset_exceeds_source");
  assert.equal(groupPartnerPayables([], [offset]).blockedGroups[0].reason, "missing");
  assert.equal(groupPartnerPayables([{ ...original, eligible: false }], [offset]).blockedGroups[0].reason, "source_ineligible");
  assert.equal(groupPartnerPayables([original], [{ ...offset, orderId: "foreign-order" }]).blockedGroups[0].reason, "invalid_group");
  // IDs alone are insufficient: a credit with the same UUID is another source.
  const credit: PayableSource = { ...original, sourceKind: "adjustment" };
  assert.equal(groupPartnerPayables([credit], [offset]).groups[0].netKurus, 6000);
  assert.equal(groupPartnerPayables([credit], [offset]).blockedGroups[0].reason, "missing");
});

test("mixed stamps compare identities and individual amounts, not only the sum", () => {
  const expected = [{ sourceKind: "manufacturer_earning", id: "x", netKurus: 6000 }, { sourceKind: "adjustment", id: "x", netKurus: -2000 }];
  verifyClaimedPayableMembers(expected, expected);
  assert.throws(() => verifyClaimedPayableMembers(expected, expected.map((m,i) => ({ ...m, netKurus: m.netKurus + (i ? -1 : 1) }))), PayoutClaimRaceError);
  assert.throws(() => verifyClaimedPayableMembers(expected, [expected[0], expected[0]]), PayoutClaimRaceError);
});

/**
 * ÖDENEBİLİRLİK YÜKLEMİNİ ELLE KURAN HER DOSYAYI YAKALAYAN TARAMA.
 *
 * NEDEN LİSTE YETMEZ: yukarıdaki iki liste yalnız BİLİNEN yerleri pinler. Bu
 * kural tam da öyle kaybedildi — düzeltme dosya dosya yapıldı, sonra aynı
 * yüklem başka bir dosyada elden yeniden kuruldu (createPayoutForPainter,
 * /admin/payouts, /painter/dashboard) ve liste bundan haberdar olmadı. Tarama
 * listeyi aşar: hakediş tablosuna dokunup "açık satır" yüklemini KENDİ kuran
 * her yeni dosya, listeye eklenmeden de bu testi düşürür.
 *
 * Yalnız ödenebilirlik yüklemi aranır; tahakkuk/çevirme yüklemleri (`ne(status,
 * "reversed")`, `eq(status, "paid")`) ve payout_id üzerinden kurulan sıradan
 * birleşimler serbesttir — onlar "bu para ödenir mi" sorusunu sormaz.
 */
const PAYABILITY_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  {
    re: /is(?:Not)?Null\(\s*\w*[Ee]arnings\.payoutId\s*\)/,
    why: "payout_id yüklemini elle kuruyor",
  },
  {
    re: /\$\{\s*\w*[Ee]arnings\.payoutId\s*\}\s*is\s+(?:not\s+)?null/i,
    why: "payout_id yüklemini SQL içinde elle kuruyor",
  },
  {
    re: /\w*[Ee]arnings\.status\s*,\s*["']pending["']/,
    why: "açık hakediş statüsünü elle yazıyor",
  },
  {
    re: /\$\{\s*\w*[Ee]arnings\.status\s*\}\s*=\s*['"]pending['"]/,
    why: "açık hakediş statüsünü SQL içinde elle yazıyor",
  },
];

/** Kuralın KENDİ tanımlandığı yer; yüklemi elbette orada kurulur. */
const PAYABILITY_RULE_MODULE = "src/lib/services/earning-claimable.ts";

function scanForHandBuiltPayability(
  files: ReadonlyArray<{ rel: string; text: string }>
): string[] {
  const offenders: string[] = [];
  for (const { rel, text } of files) {
    if (rel === PAYABILITY_RULE_MODULE) continue;
    // Hakediş tablolarına hiç dokunmayan dosya bu kararı veremez.
    if (!/manufacturerEarnings|painterEarnings/.test(text)) continue;
    text.split("\n").forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const { re, why } of PAYABILITY_PATTERNS) {
        if (re.test(line)) {
          offenders.push(`${rel}:${i + 1} ${why} — claimableEarningWhere / openEarningWhere kullanın`);
          return;
        }
      }
    });
  }
  return offenders;
}

test("tarama: elle kurulmuş ödenebilirlik yüklemini yakalar, masum satırları bırakır", () => {
  const rel = "src/app/x/page.tsx";
  const wrap = (body: string) => [{ rel, text: `painterEarnings\n${body}` }];
  // Dört kalıbın dördü de düşer.
  for (const bad of [
    "isNull(painterEarnings.payoutId)",
    "sql`... ${painterEarnings.payoutId} is not null ...`",
    'eq(manufacturerEarnings.status, "pending")',
    "sql`filter (where ${painterEarnings.status} = 'pending')`",
  ]) {
    assert.equal(scanForHandBuiltPayability(wrap(bad)).length, 1, bad);
  }
  // Tahakkuk/çevirme yüklemleri ve sıradan birleşim serbest.
  for (const ok of [
    'ne(painterEarnings.status, "reversed")',
    'eq(manufacturerEarnings.status, "paid")',
    "leftJoin(payouts, eq(payouts.id, manufacturerEarnings.payoutId))",
    "claimableEarningWhere(painterEarnings)",
  ]) {
    assert.deepEqual(scanForHandBuiltPayability(wrap(ok)), [], ok);
  }
  // Yorum satırı kod değildir; hakediş tablosuna dokunmayan dosya taranmaz.
  assert.deepEqual(scanForHandBuiltPayability(wrap("// isNull(painterEarnings.payoutId)")), []);
  assert.deepEqual(
    scanForHandBuiltPayability([{ rel, text: "isNull(giftCards.payoutId)" }]),
    []
  );
  // Kuralın kendi modülü muaf.
  assert.deepEqual(
    scanForHandBuiltPayability([
      { rel: PAYABILITY_RULE_MODULE, text: "painterEarnings\nisNull(painterEarnings.payoutId)" },
    ]),
    []
  );
});

test("src ağacında ödenebilirlik kuralını elle kuran DOSYA YOK", () => {
  const files = walkSources(join(REPO_ROOT, "src")).map((full) => ({
    rel: relative(REPO_ROOT, full).split(sep).join("/"),
    text: readFileSync(full, "utf8"),
  }));
  // Tarama gerçekten bir şey görüyor mu: hakediş tablosuna dokunan dosya
  // kalmadıysa test boş kümeyi doğrulayıp sessizce yeşil kalırdı.
  const touching = files.filter((f) =>
    /manufacturerEarnings|painterEarnings/.test(f.text)
  );
  assert.ok(touching.length >= 5, `tarama kapsamı daraldı: ${touching.length} dosya`);
  assert.deepEqual(scanForHandBuiltPayability(files), []);
});

// ─── Partileme atomik mi: "bir hakediş, tam olarak bir parti" ───────────────
//
// ÖLÇÜLEN HATA (canlı yarış): partnerin "Ödeme talep et"i ile admin'in "Ödeme
// oluştur"u aynı anda çalıştığında İKİSİ DE 200 döndü ve İKİ parti kuruldu;
// 6 hakedişin tamamı ikinci partiye damgalandı, birincisi "6 sipariş ·
// ₺12.600,00" diyen ama ARKASINDA TEK SATIR OLMAYAN bir hayalet parti olarak
// kaldı ve "Ödendi işaretle" ile ödenebildi.
//
// Aşağısı ALGORİTMANIN KENDİSİNİ (payout-claim.ts) sahte `ops` ile çalıştırır —
// DB yok, ama "saydığı ama damgalamadığı" / "damgaladığı ama saymadığı" her hâl
// gerçek kodda denenir. Yapısal pinler (yukarıda) kilidin SQL'de durduğunu
// söyler; bunlar kilit bir gün delinirse ne olacağını söyler: parti kurulmaz.

interface FakeOpsLog {
  opened: number;
  totals: Array<{ payoutId: string; totalKurus: number; earningCount: number }>;
  stampedIds: string[][];
}

function fakeOps(
  claimable: ClaimedEarning[],
  stamp: (ids: string[]) => ClaimedEarning[]
): { ops: PayoutClaimOps; log: FakeOpsLog } {
  const log: FakeOpsLog = { opened: 0, totals: [], stampedIds: [] };
  const ops: PayoutClaimOps = {
    lockClaimable: async () => claimable,
    openBatch: async () => {
      log.opened++;
      return "PAYOUT-1";
    },
    stamp: async (payoutId, ids) => {
      assert.equal(payoutId, "PAYOUT-1");
      log.stampedIds.push([...ids]);
      return stamp(ids);
    },
    writeBatchTotals: async (payoutId, totalKurus, earningCount) => {
      log.totals.push({ payoutId, totalKurus, earningCount });
    },
  };
  return { ops, log };
}

const row = (id: string, netKurus: number): ClaimedEarning => ({ id, netKurus });
const THREE = [row("e1", 100000), row("e2", 60000), row("e3", 40000)];

test("partileme: parti toplamı DAMGALANAN satırlardan yazılır", async () => {
  const { ops, log } = fakeOps(THREE, (ids) => THREE.filter((e) => ids.includes(e.id)));
  const batch = await claimEarningsIntoPayout(ops);
  assert.deepEqual(batch, { payoutId: "PAYOUT-1", totalKurus: 200000, count: 3 });
  // Damga TAM OLARAK sayılan id'lere vuruldu ve toplam damgadan yazıldı.
  assert.deepEqual(log.stampedIds, [["e1", "e2", "e3"]]);
  assert.deepEqual(log.totals, [{ payoutId: "PAYOUT-1", totalKurus: 200000, earningCount: 3 }]);
});

test("partileme: SAYIP damgalayamadığı satır varsa parti KURULMAZ", async () => {
  // Kilit delinirse olan tam budur: bir satır araya giren partiye kaçar.
  const { ops, log } = fakeOps(THREE, (ids) =>
    THREE.filter((e) => ids.includes(e.id) && e.id !== "e3")
  );
  await assert.rejects(() => claimEarningsIntoPayout(ops), PayoutClaimRaceError);
  // Toplam YAZILMADI: işlem geri alınacak, yarım parti kuyrukta kalmayacak.
  assert.deepEqual(log.totals, []);
});

test("partileme: HİÇBİR satır damgalanamazsa parti KURULMAZ (hayalet parti)", async () => {
  // Ölçülen hâlin ta kendisi: bütün satırlar öteki partiye kaçtı.
  const { ops, log } = fakeOps(THREE, () => []);
  await assert.rejects(() => claimEarningsIntoPayout(ops), PayoutClaimRaceError);
  assert.deepEqual(log.totals, []);
});

test("partileme: SAYMADIĞI satırı damgalarsa parti KURULMAZ", async () => {
  const { ops, log } = fakeOps(THREE, (ids) => [
    ...THREE.filter((e) => ids.includes(e.id)),
    row("e9", 500000),
  ]);
  await assert.rejects(() => claimEarningsIntoPayout(ops), PayoutClaimRaceError);
  assert.deepEqual(log.totals, []);
});

test("partileme: aynı hakediş sayımda iki kez görünürse parti KURULMAZ", async () => {
  // Birleşim çoğaltırsa toplam şişerdi; parti hiç açılmamalı.
  const { ops, log } = fakeOps([row("e1", 100000), row("e1", 100000)], (ids) =>
    ids.map((id) => row(id, 100000))
  );
  await assert.rejects(() => claimEarningsIntoPayout(ops), PayoutClaimRaceError);
  assert.equal(log.opened, 0);
});

test("partileme: talep edilebilir satır yoksa parti AÇILMAZ", async () => {
  const { ops, log } = fakeOps([], () => []);
  assert.equal(await claimEarningsIntoPayout(ops), null);
  // Boş parti kurup sonra silmek, hayalet partiyi kuralın kendisi üretmek olurdu.
  assert.equal(log.opened, 0);
  assert.deepEqual(log.totals, []);
});

test("damga yüklemi olmadan ÇALINAN satır görünmez: koruma SQL'de durmak zorunda", async () => {
  // Sahne: e2, sayımdan SONRA başka bir partiye kaçtı.
  //
  // (a) YÜKLEMSİZ damga (`where id in (...)` tek başına) satırı yine de bu
  //     partiye yazardı. Sayım 3, damga 3 — algoritmanın son denetimi EŞİT
  //     görür, hiçbir hata fırlamaz ve e2 öteki partiden SESSİZCE ÇALINIR.
  //     Yani koruma algoritmada DEĞİL, damganın SQL yükleminde olmak zorunda:
  //     yukarıdaki yapısal pin (openEarningWhere) tam da bunu orada tutar.
  const stolen = await claimEarningsIntoPayout(
    fakeOps(THREE, (ids) => THREE.filter((e) => ids.includes(e.id))).ops
  );
  assert.deepEqual(stolen, { payoutId: "PAYOUT-1", totalKurus: 200000, count: 3 });

  // (b) YÜKLEMLİ damga: e2 elenir, damga eksik döner, parti KURULMAZ ve işlem
  //     geri alınır — çalınma yerine temiz bir ret.
  const { ops, log } = fakeOps(THREE, (ids) =>
    THREE.filter((e) => ids.includes(e.id) && e.id !== "e2")
  );
  await assert.rejects(() => claimEarningsIntoPayout(ops), PayoutClaimRaceError);
  assert.deepEqual(log.totals, []);
});

test("kilit meşguliyeti: pg kodu sarmalanmış olsa da tanınır", () => {
  assert.equal(isPayoutLockBusy({ code: "55P03" }), true);
  assert.equal(isPayoutLockBusy({ code: "40P01" }), true);
  // drizzle 0.45 pg hatasını sarar ve kodu `.cause`a saklar.
  assert.equal(isPayoutLockBusy({ cause: { code: "55P03" } }), true);
  assert.equal(isPayoutLockBusy({ cause: { cause: { code: "40P01" } } }), true);
  // Başka hata "meşgul" sayılamaz: sayılsaydı gerçek arıza sessizce
  // "birazdan tekrar deneyin"e dönerdi.
  assert.equal(isPayoutLockBusy({ code: "23505" }), false);
  assert.equal(isPayoutLockBusy(new Error("boom")), false);
  assert.equal(isPayoutLockBusy(null), false);
});

test("ödendi işaretleme: parti tuttuğu parayı söylemiyorsa kapı KAPALI", () => {
  const holds = (a: Partial<Parameters<typeof payoutHoldsWhatItClaims>[0]>) =>
    payoutHoldsWhatItClaims({
      statedKurus: 1260000,
      statedCount: 6,
      heldKurus: 1260000,
      heldCount: 6,
      ...a,
    });
  assert.equal(holds({}), true);
  // Hayalet parti: iddia var, arkasında satır yok.
  assert.equal(holds({ heldKurus: 0, heldCount: 0 }), false);
  // Tutar tutuyor ama satır sayısı tutmuyor (ya da tersi) — ikisi de tutarsız.
  assert.equal(holds({ heldCount: 5 }), false);
  assert.equal(holds({ heldKurus: 1000000 }), false);
  // Boş ama DÜRÜST parti (hepsi geri alınmış): uyuşuyor, kapı açık kalır.
  assert.equal(
    payoutHoldsWhatItClaims({ statedKurus: 0, statedCount: 0, heldKurus: 0, heldCount: 0 }),
    true
  );
});

// Koşucu async: partileme testleri söz döndürür ve `await` olmadan reddedilen
// bir söz sessizce geçerdi (test hiçbir şey sınamamış olurdu). Üst seviye await
// yok — tsx bu dosyayı CJS'e çeviriyor.
async function run() {
  for (const [name, fn] of cases) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`\n${passed}/${cases.length} passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
