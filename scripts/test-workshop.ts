import assert from "node:assert/strict";
import {
  WORKSHOP_FIGURE_PRICE_KURUS,
  WORKSHOP_COMMISSION_TIERS,
  workshopCommissionRateBps,
  deriveSessionDates,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
  WORKSHOP_DELIVER_DAYS_BEFORE,
  assessSessionRisk,
} from "../src/lib/config/workshop";
import { itemPriceKurus } from "../src/lib/config/prices";
import {
  allowedFinishesForKind,
  coerceFinishForKind,
  coerceFinishForStyle,
} from "../src/lib/validators/order";
import { joinSessionSchema, isSafePhotoKey } from "../src/lib/validators/workshop";

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

// ─── workshop_figure fiyat türü ─────────────────────────────────────────────

test("workshop_figure düz fiyatlıdır: boyut/malzeme/yüzey etkilemez", () => {
  const a = itemPriceKurus({ kind: "workshop_figure", material: "resin" });
  const b = itemPriceKurus({
    kind: "workshop_figure",
    material: "filament",
    size: "her ne ise",
    finish: "paintable_kit",
  });
  assert.equal(a, WORKSHOP_FIGURE_PRICE_KURUS);
  assert.equal(b, WORKSHOP_FIGURE_PRICE_KURUS);
});

test("workshop_figure yüzeyi paintable_kit'tir ve KORUNUR", () => {
  assert.deepEqual(allowedFinishesForKind("workshop_figure"), ["paintable_kit"]);
  assert.equal(coerceFinishForKind("workshop_figure", "paintable_kit"), "paintable_kit");
  // Yanlış yüzey gelirse türün varsayılanına düşer, hand_painted'e KAÇMAZ.
  assert.equal(coerceFinishForKind("workshop_figure", "hand_painted"), "paintable_kit");
  assert.equal(coerceFinishForKind("workshop_figure", undefined), "paintable_kit");
});

test("normal figür davranışı DEĞİŞMEDİ (regresyon)", () => {
  // Bu, atölye türünün mevcut tek ürün kuralını kırmadığının kanıtı.
  assert.deepEqual(allowedFinishesForKind("figure"), ["hand_painted"]);
  assert.equal(coerceFinishForStyle("realistic", "paintable_kit"), "hand_painted");
});

test("atölye siparişi kalem invariantını korur", () => {
  const amountKurus = itemPriceKurus({ kind: "workshop_figure", material: "resin" });
  const paintingPriceKurus = 0; // boyama seansın kendisi, boyacı payı yok
  const productionBaseKurus = amountKurus - paintingPriceKurus;
  assert.equal(productionBaseKurus + paintingPriceKurus, amountKurus);
  assert.equal(productionBaseKurus, 135000);
});

// ─── Fiyat ──────────────────────────────────────────────────────────────────

test("atölye figürü ₺1.350", () => {
  assert.equal(WORKSHOP_FIGURE_PRICE_KURUS, 135000);
});

// ─── Komisyon merdiveni ─────────────────────────────────────────────────────
// commissionRateBps PLATFORMUN payıdır; üreticinin net payı 10000 − bps.

test("merdiven kademe sınırları", () => {
  const expected: Array<[number, number]> = [
    [1, 4000], [2, 4000],
    [3, 4500], [5, 4500],
    [6, 5000], [10, 5000],
    [11, 5500], [15, 5500],
    [16, 6000], [17, 6000], [100, 6000],
  ];
  for (const [n, bps] of expected) {
    assert.equal(
      workshopCommissionRateBps(n),
      bps,
      `${n} sipariş için ${bps} bekleniyordu, ${workshopCommissionRateBps(n)} geldi`
    );
  }
});

test("üretici payı sipariş arttıkça ASLA artmaz (monotonluk)", () => {
  let prev = -1;
  for (let n = 1; n <= 200; n++) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= prev, `n=${n}: komisyon geriledi (${prev} → ${bps})`);
    prev = bps;
  }
});

test("oran her zaman [4000, 6000] aralığında", () => {
  for (const n of [0, 1, 7, 50, 1000, -3]) {
    const bps = workshopCommissionRateBps(n);
    assert.ok(bps >= 4000 && bps <= 6000, `n=${n} → ${bps}`);
  }
});

test("sıfır ve negatif sipariş en düşük komisyona düşer", () => {
  // Parti yoksa merdivenin ilk basamağı geçerlidir; üreticiyi cezalandırmaz.
  assert.equal(workshopCommissionRateBps(0), 4000);
  assert.equal(workshopCommissionRateBps(-1), 4000);
});

test("merdiven tanımı artan sırada ve boşluksuz", () => {
  let prevMin = 0;
  for (const t of WORKSHOP_COMMISSION_TIERS) {
    assert.ok(t.minOrders > prevMin, "minOrders artan olmalı");
    prevMin = t.minOrders;
  }
  assert.equal(WORKSHOP_COMMISSION_TIERS[0].minOrders, 1);
});

// ─── Tarih türetme ──────────────────────────────────────────────────────────

test("kapanış seanstan 5 gün, teslim 1 gün önce", () => {
  assert.equal(WORKSHOP_JOIN_CLOSES_DAYS_BEFORE, 5);
  assert.equal(WORKSHOP_DELIVER_DAYS_BEFORE, 1);
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const d = deriveSessionDates(startsAt);
  assert.equal(d.joinClosesAt.toISOString(), "2026-10-15T18:00:00.000Z");
  assert.equal(d.deliverBy.toISOString(), "2026-10-19T18:00:00.000Z");
});

test("tarih türetme girdiyi değiştirmez", () => {
  const startsAt = new Date("2026-10-20T18:00:00.000Z");
  const before = startsAt.toISOString();
  deriveSessionDates(startsAt);
  assert.equal(startsAt.toISOString(), before, "startsAt mutasyona uğradı");
});

// ─── Seans risk hesabı ──────────────────────────────────────────────────────
// Saf fonksiyon: DB'ye gitmez, girdi hesaplanıp verilir. Kapasite dolu →
// önce o kontrol eder; değilse teslim tarihine kalan gün üreticinin ortalama
// baskı süresiyle karşılaştırılır. ASLA engellemez, sadece uyarır.

test("risk: bol süre → ok", () => {
  const r = assessSessionRisk({ daysUntilSession: 21, avgPrintDays: 5, currentLoad: 1, maxConcurrentOrders: 5 });
  assert.equal(r.level, "ok");
});

test("risk: süre üreticinin ortalamasına yakın → warn", () => {
  const r = assessSessionRisk({ daysUntilSession: 7, avgPrintDays: 6, currentLoad: 2, maxConcurrentOrders: 5 });
  assert.equal(r.level, "warn");
});

test("risk: süre ortalamadan AZ → danger", () => {
  const r = assessSessionRisk({ daysUntilSession: 4, avgPrintDays: 7, currentLoad: 1, maxConcurrentOrders: 5 });
  assert.equal(r.level, "danger");
  assert.ok(r.message.length > 0, "uyarı metni boş olamaz");
});

test("risk: kapasitesi dolu üretici → danger", () => {
  const r = assessSessionRisk({ daysUntilSession: 30, avgPrintDays: 3, currentLoad: 5, maxConcurrentOrders: 5 });
  assert.equal(r.level, "danger");
});

// ─── Katılım formu doğrulaması ──────────────────────────────────────────────

const validJoin = {
  fullName: "Ayşe Yılmaz",
  email: "Ayse@Example.com",
  phone: "0532 123 45 67",
  photoKey: "photos/abc123.jpg",
  kvkkConsent: true,
  contentConsent: true,
};

test("katılım formu telefonu E.164'e normalleştirir", () => {
  // workshop_participants.phone sözleşme gereği E.164; aynı numara siparişin
  // kargo adresine de yazılır ve kurye teslimatta onu arar.
  const parsed = joinSessionSchema.parse({ ...validJoin });
  assert.equal(parsed.phone, "+905321234567");
});

test("geçersiz telefon reddedilir", () => {
  const r = joinSessionSchema.safeParse({ ...validJoin, phone: "123" });
  assert.equal(r.success, false);
});

test("onay kutuları olmadan katılım reddedilir", () => {
  // KVKK açık rızası ve içerik hakları onayı zorunludur: fotoğraftaki kişi
  // çocuk olabilir (doğum günü / okul etkinliği).
  for (const missing of ["kvkkConsent", "contentConsent"] as const) {
    const r = joinSessionSchema.safeParse({ ...validJoin, [missing]: false });
    assert.equal(r.success, false, `${missing} olmadan geçmemeliydi`);
  }
});

// ─── Fotoğraf anahtarı kapısı ───────────────────────────────────────────────
// /api/orders'daki kapının aynısı: katılımcı, sipariş fotoğrafı olarak
// depodaki başka bir dosyayı gösterememeli.

test("yalnızca photos/ ön ekli anahtarlar kabul edilir", () => {
  assert.equal(isSafePhotoKey("photos/abc123.jpg"), true);
  assert.equal(isSafePhotoKey("models/gizli.stl"), false);
  assert.equal(isSafePhotoKey("dekont/odeme.pdf"), false);
  assert.equal(isSafePhotoKey(""), false);
});

test("dizin çıkışı (..) reddedilir", () => {
  assert.equal(isSafePhotoKey("photos/../dekont/odeme.pdf"), false);
  assert.equal(isSafePhotoKey("photos/..%2Fx.jpg"), false);
  assert.equal(isSafePhotoKey("../photos/x.jpg"), false);
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
