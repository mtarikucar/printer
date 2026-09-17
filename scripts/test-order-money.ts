import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "../src/lib/i18n/locale-context";
import { MoneyBreakdownCard } from "../src/components/admin/money-breakdown-card";
import {
  EARNING_REVERSAL_PARTNER_SENTENCES,
  MONEY_LINE_KIND_LABELS_TR,
  SHIP_REVERT_AUDIT_PREFIX,
  SHIP_REVERT_EARNING_AUDIT,
  SHIP_REVERT_EARNING_REVERSED_MARKERS,
  cashCollectedKurus,
  countsAsRevenue,
  earningReversalAdminWarning,
  earningReversalCause,
  isEarningPaidOut,
  revenueKurus,
  classifyMoneyOrder,
  deriveOrderMoneyBreakdown,
  formatTry,
  shipRevertEarningAuditSentence,
  type EarningMoneySnapshot,
  type AdjustmentMoneySnapshot,
  type EarningReversalCause,
  type MoneyLine,
  type MoneyReversalParty,
  type MoneyReversalRecord,
  type OrderMoneyBreakdown,
  type OrderMoneySnapshot,
  type ShipRevertEarningOutcome,
} from "../src/lib/config/order-money";
// Yükleyicinin KENDİSİ import edilir: denetim kaydını okuyan kod ile o kaydı
// yazan rotanın aynı cümleyi paylaştığı burada kanıtlanır. (Modül @/lib/db'yi
// import eder ama bu testte hiçbir sorgu çalışmaz; havuz bağlantı açmaz.)
import { shipRevertCauseFromAuditNotes } from "../src/lib/services/order-money";
import {
  carvePaintingShare,
  effectiveProductionBaseKurus,
  manufacturerBaseKurus,
  orderMoneySplit,
} from "../src/lib/services/earning-base";
import { allocateBases } from "../src/lib/config/cost-lines";
import { computeEarning } from "../src/lib/services/finance";
import { PLATFORM_COMMISSION_RATE_BPS, UPSELL_PRICES_KURUS } from "../src/lib/config/prices";

// Sipariş para dökümünün SAF kısmı (config/order-money.ts + earning-base.ts'teki
// orderMoneySplit). Yükleyici DB okur ve burada test edilmez; tüm hesap
// deriveOrderMoneyBreakdown'da olduğu için kapsanan kısım hesabın tamamıdır.

let passed = 0;
const cases: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

/** Varsayılan: boyamalı kişiye özel figür, üretici kabul etmiş, boyacı yok. */
function snap(over: Partial<OrderMoneySnapshot> = {}): OrderMoneySnapshot {
  return {
    orderType: "custom",
    amountKurus: 349900,
    productionBaseKurus: 249900,
    paintingPriceKurus: 100000,
    giftCardAmountKurus: 0,
    havaleDiscountKurus: 0,
    upsells: [],
    upsellAmountKurus: 0,
    quantity: 1,
    productId: null,
    productTitleSnapshot: null,
    parentReference: null,
    workshopSessionId: null,
    selectedOptions: null,
    selectedAddons: null,
    paymentMethod: "card",
    paymentStatus: "succeeded",
    commissionRateBps: 4000,
    manufacturerId: "m1",
    manufacturerName: "Atölye A",
    paintsInHouse: false,
    manufacturerStatus: "accepted",
    painterId: null,
    painterName: null,
    painterStatus: null,
    shippedAt: null,
    items: [],
    siblings: [],
    cartDraftAmountKurus: null,
    manufacturerEarning: null,
    painterEarning: null,
    ...over,
  };
}

/** Tahakkuk etmiş hakediş satırı; komisyon tek kaynaktan (computeEarning). */
function earning(grossKurus: number, over: Partial<EarningMoneySnapshot> = {}): EarningMoneySnapshot {
  return {
    partnerId: "m1",
    partnerName: "Atölye A",
    ...computeEarning(grossKurus, 4000),
    rateBps: 4000,
    status: "pending",
    payout: null,
    ...over,
  };
}

const PAID_PAYOUT = { id: "po1", status: "paid", reference: "EFT-1", paidAt: "2026-09-01T09:00:00.000Z" };
const SHIPPED_AT = "2026-09-10T10:00:00.000Z";

/** İade servisi (refundOrder) partnerleri böyle koparır. */
const DETACHED: Partial<OrderMoneySnapshot> = {
  paymentStatus: "refunded",
  manufacturerId: null,
  manufacturerName: null,
  manufacturerStatus: "unassigned",
  painterId: null,
  painterName: null,
  painterStatus: "unassigned",
  // Yükleyici bayrağı atanmış üreticiden okur; üretici koptuysa false.
  paintsInHouse: false,
};

const sumOf = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const total = (ls: MoneyLine[]) => sumOf(ls.map((l) => l.amountKurus));
const totalOf = (ls: MoneyLine[], kinds: MoneyLine["kind"][]) =>
  total(ls.filter((l) => kinds.includes(l.kind)));
const share = (b: OrderMoneyBreakdown, party: "manufacturer" | "painter") =>
  b.shares.find((s) => s.party === party);
const hasWarning = (b: OrderMoneyBreakdown, needle: string) =>
  b.warnings.some((w) => w.includes(needle));
const isSelectionRow = (l: MoneyLine) =>
  !!l.note && (l.note.startsWith("Opsiyon farkı") || l.note.startsWith("Ürün eki"));

/**
 * mulberry32. Önceki LCG'nin düşük bitleri kısa periyotla dönüyordu (`% 2`
 * ardışık çağrılarda 0,1,0,1…); küçük n'li ardışık çekilişler birbirine bağlı
 * kaldığı için fuzz bazı şekilleri (boyamalı + seçimli sepet satırı) neredeyse
 * hiç üretmiyordu.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

// ─── Sözleşme C2'' denetçileri ──────────────────────────────────────────────

/** React Flight -0'ı istemciye taşır ve "-₺0,00" yazdırır: dökümde hiç olmamalı. */
function assertNoNegativeZero(v: unknown, ctx: string, path = "döküm"): void {
  if (typeof v === "number") {
    assert.ok(!Object.is(v, -0), `eksi sıfır: ${path} ${ctx}`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => assertNoNegativeZero(x, ctx, `${path}[${i}]`));
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) assertNoNegativeZero(x, ctx, `${path}.${k}`);
  }
}

/**
 * Üç invariant + satır biçimi:
 *   Σ tutar = sipariş tutarı;
 *   Σ(production + addon) + Σ price.split.production = üretim tabanı;
 *   Σ painting + Σ price.split.painting = boyama tabanı;
 *   split yalnızca ve her zaman fiyat satırında, payları satırı verir ve satırla
 *   aynı işarette kalır; qty × birim, ikisi varsa, tutardır.
 */
function assertInvariants(b: OrderMoneyBreakdown, ctx = ""): void {
  const ls = b.lines;
  const splitProduction = sumOf(ls.map((l) => l.split?.productionKurus ?? 0));
  const splitPainting = sumOf(ls.map((l) => l.split?.paintingKurus ?? 0));
  assert.equal(total(ls), b.totals.amountKurus, `Σ tutar ≠ sipariş tutarı ${ctx}`);
  assert.equal(
    totalOf(ls, ["production", "addon"]) + splitProduction,
    b.totals.productionBaseKurus,
    `Σ üretim ≠ üretim tabanı ${ctx}`
  );
  assert.equal(
    totalOf(ls, ["painting"]) + splitPainting,
    b.totals.paintingPriceKurus,
    `Σ boyama ≠ boyama tabanı ${ctx}`
  );
  for (const l of ls) {
    const where = `${l.label} ${ctx}`;
    if (l.kind === "price") {
      assert.ok(l.split, `fiyat satırında split yok: ${where}`);
      assert.equal(l.split.productionKurus + l.split.paintingKurus, l.amountKurus, `split ≠ tutar: ${where}`);
      for (const part of [l.split.productionKurus, l.split.paintingKurus]) {
        assert.ok(
          l.amountKurus >= 0 ? part >= 0 && part <= l.amountKurus : part <= 0 && part >= l.amountKurus,
          `pay satırın dışında: ${where} ${JSON.stringify(l.split)}`
        );
      }
    } else {
      assert.equal(l.split, undefined, `fiyat olmayan satırda split: ${where}`);
    }
    if (l.qty !== undefined && l.unitKurus !== undefined) {
      assert.equal(l.qty * l.unitKurus, l.amountKurus, `adet × birim ≠ tutar: ${where}`);
    }
  }
  assertNoNegativeZero(b, ctx);
}

function derive(s: OrderMoneySnapshot, ctx = ""): OrderMoneyBreakdown {
  const b = deriveOrderMoneyBreakdown(s);
  assertInvariants(b, ctx);
  return b;
}

/**
 * Kahin: fiyat satırının üretim payı, tam orantılı payından (tutar × P / T)
 * 1 kuruştan az sapar. Tam sayılarla: |pay × T − tutar × P| < T.
 */
function assertNearProportional(rows: MoneyLine[], productionKurus: number, totalKurus: number, ctx: string) {
  for (const r of rows) {
    assert.ok(r.split, `fiyat satırı değil: ${r.label} ${ctx}`);
    const dev = Math.abs(r.split.productionKurus * totalKurus - r.amountKurus * productionKurus);
    assert.ok(dev < totalKurus, `orantıdan ≥1 kuruş sapma: ${r.label} ${JSON.stringify(r.split)} ${ctx}`);
  }
}

/**
 * QA b (FIG-B4TN8WRC): Kapadokya Balon Figürü × 2 — kalem 350 üretim + 100
 * boyama; Büyük +150, El boyaması +200, Hediye kutusu +50 (adet başı). Üretici
 * kendi boyar, kargoladı, hakediş ödendi. Tabanlar api/orders gibi: ürünün
 * kalem oranı satır tutarının TAMAMINA (allocateBases).
 */
function balloonSnap(): OrderMoneySnapshot {
  const lineTotal = (45000 + 15000 + 20000 + 5000) * 2;
  const bases = allocateBases({ productionKurus: 35000, paintingKurus: 10000, totalKurus: lineTotal });
  return snap({
    orderType: "marketplace",
    productId: "p-balon",
    productTitleSnapshot: "Kapadokya Balon Figürü",
    quantity: 2,
    amountKurus: lineTotal,
    productionBaseKurus: lineTotal - bases.paintingKurus,
    paintingPriceKurus: bases.paintingKurus,
    selectedOptions: [
      { groupName: "Boyut", choiceName: "Büyük (18 cm)", priceDeltaKurus: 15000 },
      { groupName: "Boyama", choiceName: "El boyaması", priceDeltaKurus: 20000 },
    ],
    selectedAddons: [{ name: "Hediye kutusu", priceKurus: 5000 }],
    manufacturerName: "Nokta Figür Atölyesi",
    paintsInHouse: true,
    manufacturerStatus: "shipped",
    shippedAt: SHIPPED_AT,
    manufacturerEarning: earning(lineTotal, {
      partnerName: "Nokta Figür Atölyesi",
      status: "paid",
      payout: PAID_PAYOUT,
    }),
  });
}

// ─── C3: tek ciro tanımı ────────────────────────────────────────────────────

test("tahsilat = tutar − hediye çeki − havale indirimi", () => {
  assert.equal(
    cashCollectedKurus({ amountKurus: 100000, giftCardAmountKurus: 20000, havaleDiscountKurus: 2400 }),
    77600
  );
  // Tam hediye çekiyle ödenmiş sipariş: nakit 0, asla eksi değil.
  assert.equal(
    cashCollectedKurus({ amountKurus: 50000, giftCardAmountKurus: 50000, havaleDiscountKurus: 0 }),
    0
  );
});

test("ciro yalnızca başarılı ödemede sayılır; iade ciro değildir", () => {
  assert.equal(countsAsRevenue("succeeded"), true);
  assert.equal(countsAsRevenue("refunded"), false);
  assert.equal(countsAsRevenue(null), false);
  const o = { amountKurus: 100000, giftCardAmountKurus: 0, havaleDiscountKurus: 3000 };
  assert.equal(revenueKurus({ ...o, paymentStatus: "succeeded" }), 97000);
  assert.equal(revenueKurus({ ...o, paymentStatus: "refunded" }), 0);
});

// ─── earning-base: yeni yardımcılar mevcut türetimle birebir ───────────────

test("effectiveProductionBaseKurus = devredilmiş üreticinin tabanı (fuzz, eski + yeni)", () => {
  const next = rng(4242);
  for (let i = 0; i < 5000; i++) {
    const amountKurus = next(2_000_000) + 1;
    const paintingPriceKurus = next(3) === 0 ? 0 : next(amountKurus + 50000);
    const legacy = next(2) === 0;
    const o = {
      amountKurus,
      paintingPriceKurus,
      productionBaseKurus: legacy ? null : Math.max(0, amountKurus - paintingPriceKurus),
    };
    assert.equal(
      effectiveProductionBaseKurus(o),
      manufacturerBaseKurus({ ...o, painterId: "p", paintsInHouse: false }),
      JSON.stringify(o)
    );
  }
});

test("orderMoneySplit: iki taban toplamı her üç durumda da tutara eşit (fuzz)", () => {
  const next = rng(777);
  for (let i = 0; i < 5000; i++) {
    const totalKurus = next(2_000_000) + 1;
    const bases = allocateBases({
      productionKurus: next(400000),
      paintingKurus: next(400000),
      totalKurus,
    });
    const o = {
      amountKurus: totalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
    };
    for (const [painterId, paintsInHouse] of [
      ["p", false],
      [null, false],
      [null, true],
    ] as const) {
      const s = orderMoneySplit({ ...o, painterId, paintsInHouse });
      assert.equal(s.splitMatches, true);
      assert.equal(
        s.manufacturerBaseKurus + s.painterBaseKurus,
        totalKurus,
        `${JSON.stringify(o)} painter=${painterId} inHouse=${paintsInHouse}`
      );
    }
  }
});

test("kendi boyayan üreticide boyacı tabanı 0 — aynı pay iki partnere vaat edilmez", () => {
  const s = orderMoneySplit({
    amountKurus: 349900,
    productionBaseKurus: 249900,
    paintingPriceKurus: 100000,
    painterId: null,
    paintsInHouse: true,
  });
  assert.equal(s.paintsItself, true);
  assert.equal(s.manufacturerBaseKurus, 349900);
  assert.equal(s.painterBaseKurus, 0);
});

// ─── Sipariş türü ve etiketler ─────────────────────────────────────────────

test("classifyMoneyOrder her sipariş türünü doğru kaynağa yönlendirir", () => {
  const item = snap().items;
  assert.equal(classifyMoneyOrder(snap({ workshopSessionId: "w1" })), "workshop");
  assert.equal(classifyMoneyOrder(snap({ orderType: "upload" })), "upload");
  assert.equal(
    classifyMoneyOrder(snap({ orderType: "marketplace", parentReference: "SEP-1", items: item })),
    "cart"
  );
  assert.equal(classifyMoneyOrder(snap({ orderType: "marketplace", productId: "p1" })), "product");
  // Manuel admin siparişi: marketplace taslağı, ürün yok, sepet yok.
  assert.equal(classifyMoneyOrder(snap({ orderType: "marketplace" })), "manual");
  assert.equal(classifyMoneyOrder(snap()), "custom");
});

test("her satır türünün Türkçe etiketi var; fiyat satırı 'Fiyat'", () => {
  assert.equal(MONEY_LINE_KIND_LABELS_TR.price, "Fiyat");
  for (const k of ["production", "painting", "addon", "discount", "price"] as const) {
    assert.ok(MONEY_LINE_KIND_LABELS_TR[k], k);
  }
});

// ─── Kalemler: kişiye özel figür + ek hizmetler ─────────────────────────────

test("figür + boyama + her ek hizmet ayrı satır, gerçek türleriyle (oranla bölünmez)", () => {
  const upsellKurus = UPSELL_PRICES_KURUS.extra_paint + UPSELL_PRICES_KURUS.gift_wrap;
  const b = derive(
    snap({
      amountKurus: 349900 + upsellKurus,
      productionBaseKurus: 249900 + upsellKurus,
      upsells: ["extra_paint", "gift_wrap"],
      upsellAmountKurus: upsellKurus,
    })
  );
  assert.ok(!b.lines.some((l) => l.kind === "price"), "figürün boyama payı sabit bir tutar, oran değil");
  const figure = b.lines[0];
  assert.equal(figure.kind, "production");
  assert.equal(figure.amountKurus, 249900);
  assert.equal(figure.recomputed, undefined, "kayıtlı kolondan okunan satır yeniden hesaplanmış değildir");
  assert.deepEqual(
    b.lines.filter((l) => l.kind === "painting").map((l) => l.amountKurus),
    [100000]
  );
  const addons = b.lines.filter((l) => l.kind === "addon");
  assert.equal(addons.length, 2);
  assert.ok(addons.every((l) => l.recomputed === true), "ek hizmet bugünkü fiyattan → yeniden hesaplandı");
  assert.deepEqual(b.warnings, []);
});

test("ek hizmet fiyatı sonradan değiştiyse fark satırı toplamı korur + uyarı", () => {
  const today = UPSELL_PRICES_KURUS.extra_paint;
  const stored = today - 900; // satış anında daha ucuzdu
  const b = derive(
    snap({
      amountKurus: 349900 + stored,
      productionBaseKurus: 249900 + stored,
      upsells: ["extra_paint"],
      upsellAmountKurus: stored,
    })
  );
  assert.equal(totalOf(b.lines, ["addon"]), stored);
  assert.ok(b.lines.some((l) => l.label === "Ek hizmet fiyat farkı" && l.amountKurus === -900));
  assert.ok(hasWarning(b, "yeniden hesaplandı"));
});

test("kalem öncesi (NULL taban) sipariş: eski kural + rozet + yeniden hesaplandı", () => {
  const b = derive(snap({ productionBaseKurus: null }));
  assert.equal(b.totals.legacySplit, true);
  assert.equal(b.totals.productionBaseKurus, 249900);
  assert.equal(b.totals.splitMatches, true);
  assert.equal(b.lines[0].recomputed, true);
  assert.ok(hasWarning(b, "Kalem öncesi"));
});

test("kalem öncesi (QA e): boyacıya devredilmiş eski sipariş — eski kural tabanları, iki açık pay", () => {
  const b = derive(
    snap({
      productionBaseKurus: null,
      manufacturerId: "m2",
      manufacturerName: "Ege Reçine Atölyesi",
      manufacturerStatus: "qc_approved",
      painterId: "p1",
      painterName: "Boyacı B",
      painterStatus: "shipped",
      shippedAt: SHIPPED_AT,
      manufacturerEarning: earning(249900, {
        partnerId: "m2",
        partnerName: "Ege Reçine Atölyesi",
        status: "paid",
        payout: PAID_PAYOUT,
      }),
      painterEarning: earning(100000, { partnerId: "p1", partnerName: "Boyacı B" }),
    })
  );
  assert.deepEqual(
    b.shares.map((s) => [s.party, s.baseKurus, s.voided, s.includesPainting, s.accrualMissing]),
    [
      ["manufacturer", 249900, null, false, false],
      ["painter", 100000, null, false, false],
    ]
  );
  assert.equal(b.warnings.length, 1);
  assert.ok(hasWarning(b, "Kalem öncesi"));
});

test("üretim + boyama ≠ tutar → kırmızı uyarı (ve çift uyarı yok)", () => {
  const b = deriveOrderMoneyBreakdown(snap({ productionBaseKurus: 250000 }));
  assert.equal(b.totals.splitMatches, false);
  assert.ok(hasWarning(b, "Kalem bölüşümü tutmuyor"));
  assert.ok(!hasWarning(b, "Kalemlerin toplamı"), "bölüşüm uyarısı zaten söylüyor");
});

// ─── Kalemler: manuel admin siparişi ────────────────────────────────────────

test("manuel sipariş: selectedAddons kalemleri birebir satır olur", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      amountKurus: 400000,
      productionBaseKurus: 300000,
      paintingPriceKurus: 100000,
      selectedAddons: [
        { name: "Figür × 2", priceKurus: 300000, kind: "production" },
        { name: "El boyama", priceKurus: 100000, kind: "painting" },
      ],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.label, l.kind, l.amountKurus, l.recomputed ?? false]),
    [
      ["Figür × 2", "production", 300000, false],
      ["El boyama", "painting", 100000, false],
    ]
  );
  assert.deepEqual(b.warnings, []);
});

test("manuel sipariş + sonradan 'Boyama ekle': düzeltme çifti türleri kayıtlı bölüşüme eşitler", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      amountKurus: 400000,
      productionBaseKurus: 300000, // admin 100000'i boyamaya ayırdı
      paintingPriceKurus: 100000,
      selectedAddons: [{ name: "Figür", priceKurus: 400000, kind: "production" }],
    })
  );
  const fix = b.lines.filter((l) => l.recomputed);
  assert.equal(fix.length, 2);
  assert.deepEqual(b.warnings, []);
});

test("türsüz eski manuel kalem üretim sayılır (splitCostLines kuralı)", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      amountKurus: 150000,
      productionBaseKurus: null,
      paintingPriceKurus: 0,
      selectedAddons: [{ name: "Özel parça", priceKurus: 150000 }],
    })
  );
  assert.equal(b.lines[0].kind, "production");
});

// ─── Kalemler: sepet alt siparişi ───────────────────────────────────────────

const cartItems: OrderMoneySnapshot["items"] = [
  {
    title: "Anahtarlık",
    quantity: 12,
    unitPriceKurus: 9000,
    lineTotalKurus: 108000,
    listUnitPriceKurus: 10000,
    appliedTierMinQuantity: 10,
    productionBaseKurus: 108000,
    isBoxItem: false,
    selectedOptions: [{ groupName: "Renk", choiceName: "Kırmızı", priceDeltaKurus: 500 }],
    selectedAddons: null,
  },
  {
    title: "Figür",
    quantity: 1,
    unitPriceKurus: 350000,
    lineTotalKurus: 350000,
    listUnitPriceKurus: 350000,
    appliedTierMinQuantity: null,
    productionBaseKurus: 240000,
    isBoxItem: false,
    selectedOptions: null,
    selectedAddons: [{ name: "Kaide", priceKurus: 20000 }],
  },
];

/** Aynı sepetin başka satıcıya düşen alt siparişi — kendi kolonlarıyla. */
const cartSibling: OrderMoneySnapshot["siblings"][number] = {
  id: "o2",
  orderNumber: "SEP-1-2",
  status: "approved",
  paymentStatus: "succeeded",
  amountKurus: 50000,
  giftCardAmountKurus: 5000,
  havaleDiscountKurus: 1350,
};

test("sepet: boyamasız satır üretim; boyama paylı satır fiyat kırılımı (taban + ek), payı split'te", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-1",
      items: cartItems,
      amountKurus: 458000,
      productionBaseKurus: 348000,
      paintingPriceKurus: 110000,
      siblings: [cartSibling],
      cartDraftAmountKurus: 508000,
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.qty, l.unitKurus, l.amountKurus, l.split]),
    [
      ["production", "Anahtarlık", 12, 9000, 108000, undefined],
      // 350000 satır = 240000 üretim + 110000 boyama; oran her fiyat satırına.
      ["price", "Figür", 1, 330000, 330000, { productionKurus: 226285, paintingKurus: 103715 }],
      ["price", "Kaide", 1, 20000, 20000, { productionKurus: 13715, paintingKurus: 6285 }],
    ]
  );
  const [key, fig, kaide] = b.lines;
  assert.ok(key.note?.includes("10+ adet kademesi"), key.note);
  assert.ok(key.note?.includes("Renk: Kırmızı"), key.note);
  assert.ok(fig.note?.includes("Opsiyon ve ekler hariç taban fiyat"), fig.note);
  assert.ok(fig.note?.includes("üretim ₺2.400,00 + boyama ₺1.100,00"), fig.note);
  assert.ok(kaide.note?.startsWith("Ürün eki (Figür)"), kaide.note);
  assert.ok(!b.lines.some((l) => l.kind === "painting"), "boyama payı kalan satırı yok");
  assert.ok(b.lines.every((l) => !l.recomputed), "donmuş satırlar yeniden hesaplanmış değildir");
  // Kardeş kendi kolonlarından: sepetin hediye çeki / havale payı ödemede dağıtıldı.
  assert.deepEqual(b.collection.siblings, [
    {
      id: "o2",
      orderNumber: "SEP-1-2",
      status: "approved",
      paymentStatus: "succeeded",
      amountKurus: 50000,
      giftCardKurus: 5000,
      havaleDiscountKurus: 1350,
      cashCollectedKurus: 50000 - 5000 - 1350,
    },
  ]);
  assert.deepEqual(b.warnings, []);
});

test("sepet: kademe + opsiyon + ek + boyama, tek kuruşlu tutarlar — taban satırı kademe tabanıyla", () => {
  // Taban ₺100,00, 10+ kademesi ₺90,01; Altın +₺12,34, İsim baskısı +₺3,33; 11 adet.
  const unitPriceKurus = 9001 + 1234 + 333;
  const lineTotalKurus = unitPriceKurus * 11;
  const bases = allocateBases({ productionKurus: 6000, paintingKurus: 4000, totalKurus: lineTotalKurus });
  const b = derive(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-3",
      items: [
        {
          title: "Kupa",
          quantity: 11,
          unitPriceKurus,
          lineTotalKurus,
          listUnitPriceKurus: 10000 + 1234 + 333,
          appliedTierMinQuantity: 10,
          productionBaseKurus: bases.productionKurus,
          isBoxItem: false,
          selectedOptions: [{ groupName: "Renk", choiceName: "Altın", priceDeltaKurus: 1234 }],
          selectedAddons: [{ name: "İsim baskısı", priceKurus: 333 }],
        },
      ],
      amountKurus: lineTotalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.qty, l.unitKurus, l.amountKurus]),
    [
      ["price", "Kupa", 11, 9001, 99011],
      ["price", "Renk: Altın", 11, 1234, 13574],
      ["price", "İsim baskısı", 11, 333, 3663],
    ]
  );
  assert.ok(b.lines[0].note?.includes("Liste ₺100,00/adet → 10+ adet kademesi ₺90,01/adet"), b.lines[0].note);
  assertNearProportional(b.lines, bases.productionKurus, lineTotalKurus, "kupa");
});

test("sepet + sonradan 'Boyama ekle': fiyat satırlarının boyama payı sayılır, düzeltme çifti farkı taşır", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-1",
      items: cartItems,
      amountKurus: 458000,
      productionBaseKurus: 348000 - 15000,
      paintingPriceKurus: 110000 + 15000,
    })
  );
  const fix = b.lines.filter((l) => l.recomputed);
  assert.deepEqual(
    fix.map((l) => [l.kind, l.amountKurus]),
    [
      ["painting", 15000],
      ["production", -15000],
    ]
  );
  assert.deepEqual(b.warnings, []);
});

test("sepet: tahsil edilmiş ek hizmet payı güncel fiyatla yeniden yazılmaz", () => {
  const b = deriveOrderMoneyBreakdown(snap({
    orderType: "marketplace", parentReference: "SEP-1", items: cartItems,
    amountKurus: 460475, productionBaseKurus: 350475, paintingPriceKurus: 110000,
    upsells: ["digital_files"], upsellAmountKurus: 2475,
  }));
  const service = b.lines.find(l => l.label.includes("Ek hizmetler (sepet payı)"));
  assert.equal(service?.amountKurus, 2475);
  assert.equal(Boolean(service?.recomputed), false);
  assert.equal(b.lines.reduce((n,l) => n + l.amountKurus, 0), 460475);
  assert.deepEqual(b.warnings, []);
});

test("sepet: alt siparişler taslak tutarını tutmuyorsa uyarı (sepetteki ek hizmet kaybı)", () => {
  const b = deriveOrderMoneyBreakdown(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-1",
      items: cartItems,
      amountKurus: 458000,
      productionBaseKurus: 348000,
      paintingPriceKurus: 110000,
      siblings: [cartSibling],
      cartDraftAmountKurus: 515900,
    })
  );
  assert.ok(hasWarning(b, "hiçbir alt siparişe yazılmamış"));
});

test("kardeş alt sipariş: iade edilmiş olsa da tahsilatı alınan nakittir", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-1",
      items: cartItems,
      amountKurus: 458000,
      productionBaseKurus: 348000,
      paintingPriceKurus: 110000,
      siblings: [{ ...cartSibling, status: "rejected", paymentStatus: "refunded" }],
    })
  );
  const [sib] = b.collection.siblings;
  assert.equal(sib.status, "rejected");
  assert.equal(sib.paymentStatus, "refunded");
  assert.equal(sib.cashCollectedKurus, 50000 - 5000 - 1350);
});

test("sepet: kalem öncesi order_items satırı tamamı üretim + yeniden hesaplandı", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      parentReference: "SEP-2",
      items: [{ ...cartItems[0], productionBaseKurus: null }],
      amountKurus: 108000,
      productionBaseKurus: 108000,
      paintingPriceKurus: 0,
    })
  );
  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0].kind, "production");
  assert.equal(b.lines[0].recomputed, true);
});

test("sepet alt siparişi: karışık satırlarda üç invariant ve kuruş kesinliği (fuzz)", () => {
  const next = rng(8080);
  let priceItems = 0;
  let plainItems = 0;
  let carvedItems = 0;
  for (let i = 0; i < 1500; i++) {
    const items: OrderMoneySnapshot["items"] = [];
    const n = next(4) + 1;
    for (let k = 0; k < n; k++) {
      const quantity = next(12) + 1;
      const base = next(90000) + 1;
      const tierUnit = next(3) === 0 ? Math.max(0, base - next(5000)) : null;
      const options = Array.from({ length: next(3) }, (_, j) => ({
        groupName: `G${j}`,
        choiceName: `C${j}`,
        priceDeltaKurus: next(4) === 0 ? 0 : next(20000) - 5000,
      }));
      const addons = Array.from({ length: next(2) }, (_, j) => ({ name: `E${j}`, priceKurus: next(7000) + 1 }));
      const perUnit =
        sumOf(options.map((o) => o.priceDeltaKurus)) + sumOf(addons.map((a) => a.priceKurus));
      // computeSelectionPrice: kademe tabanı yerine geçer, farklar üstüne biner, eksi 0'a çekilir.
      const unitPriceKurus = Math.max(0, (tierUnit ?? base) + perUnit);
      const lineTotalKurus = unitPriceKurus * quantity;
      const shape = next(10);
      const productionBaseKurus =
        shape === 0
          ? null
          : shape < 5
            ? lineTotalKurus
            : allocateBases({
                productionKurus: next(50000),
                paintingKurus: next(50000) + 1,
                totalKurus: lineTotalKurus,
              }).productionKurus;
      items.push({
        title: `Ü${k}`,
        quantity,
        unitPriceKurus,
        lineTotalKurus,
        listUnitPriceKurus: Math.max(0, base + perUnit),
        appliedTierMinQuantity: tierUnit === null ? null : 10,
        productionBaseKurus,
        isBoxItem: next(8) === 0,
        selectedOptions: options.length > 0 ? options : null,
        selectedAddons: addons.length > 0 ? addons : null,
      });
    }
    const amountKurus = sumOf(items.map((it) => it.lineTotalKurus));
    const productionBaseKurus = sumOf(items.map((it) => it.productionBaseKurus ?? it.lineTotalKurus));
    const ctx = JSON.stringify(items);
    const b = derive(
      snap({
        orderType: "marketplace",
        parentReference: "SEP-F",
        items,
        amountKurus,
        productionBaseKurus,
        paintingPriceKurus: amountKurus - productionBaseKurus,
      }),
      ctx
    );
    // Satırları kalemlere ayır: her kalemin başlığı ("Ü<k>") yeni bir grup açar.
    const groups = new Map<string, MoneyLine[]>();
    let current = "";
    for (const l of b.lines) {
      if (/^Ü\d+$/.test(l.label)) current = l.label;
      if (!groups.has(current)) groups.set(current, []);
      groups.get(current)!.push(l);
    }
    for (const it of items) {
      const g = groups.get(it.title)!;
      const production = it.productionBaseKurus ?? it.lineTotalKurus;
      assert.equal(total(g), it.lineTotalKurus, ctx);
      if (it.lineTotalKurus - production > 0) {
        priceItems++;
        if (g.length > 1) carvedItems++;
        assert.ok(g.every((l) => l.kind === "price"), ctx);
        assert.equal(sumOf(g.map((l) => l.split!.productionKurus)), production, ctx);
        assertNearProportional(g, production, it.lineTotalKurus, ctx);
      } else {
        plainItems++;
        assert.deepEqual(g.map((l) => l.kind), ["production"], ctx);
      }
    }
    assert.deepEqual(b.warnings, [], ctx);
  }
  assert.ok(
    priceItems > 500 && plainItems > 500 && carvedItems > 200,
    `price=${priceItems} plain=${plainItems} carved=${carvedItems}`
  );
});

// ─── Kalemler: tek ürünlü mağaza siparişi, yükleme, atölye ─────────────────

test("tek ürün: opsiyon farkı ve ürün eki KENDİ satırında, ana satır kalan (boyamasız)", () => {
  // 2 × (taban 130000 + Büyük 20000 + Kaide 5000) = 310000
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Ejderha",
      quantity: 2,
      amountKurus: 310000,
      productionBaseKurus: 310000,
      paintingPriceKurus: 0,
      selectedOptions: [
        { groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 20000 },
        { groupName: "Renk", choiceName: "Gri", priceDeltaKurus: 0 },
      ],
      selectedAddons: [{ name: "Kaide", priceKurus: 5000 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.label, l.kind, l.amountKurus, l.qty, l.unitKurus, l.recomputed ?? false]),
    [
      ["Ejderha", "production", 260000, 2, 130000, false],
      ["Boyut: Büyük", "production", 40000, 2, 20000, false],
      ["Kaide", "addon", 10000, 2, 5000, false],
    ]
  );
  assert.deepEqual(b.warnings, []);
});

test("QA b: boyama kalemli tek ürün × 2 — her opsiyon/ek kendi fiyat satırında, kendi boyama payıyla", () => {
  const s = balloonSnap();
  assert.equal(s.amountKurus, 170000);
  assert.equal(s.paintingPriceKurus, 37778, "allocateBases(35000, 10000, 170000)");
  const b = derive(s);
  assert.deepEqual(
    b.lines.map((l) => [
      l.kind,
      l.label,
      l.qty,
      l.unitKurus,
      l.amountKurus,
      l.split?.productionKurus,
      l.split?.paintingKurus,
    ]),
    [
      ["price", "Kapadokya Balon Figürü", 2, 45000, 90000, 69999, 20001],
      ["price", "Boyut: Büyük (18 cm)", 2, 15000, 30000, 23334, 6666],
      // q1-05: "El boyaması" opsiyonunun boyacı tabanına giren kısmı kendi satırında.
      ["price", "Boyama: El boyaması", 2, 20000, 40000, 31111, 8889],
      ["price", "Hediye kutusu", 2, 5000, 10000, 7778, 2222],
    ]
  );
  assert.ok(
    !b.lines.some((l) => l.kind === "painting" || l.label.includes("boyama payı")),
    "kalan 'boyama payı' satırı yok"
  );
  assertNearProportional(b.lines, s.amountKurus - s.paintingPriceKurus, s.amountKurus, "b");
  // Üretici kendi boyadı: tek pay, taban boyama dahil.
  assert.equal(b.shares.length, 1);
  const m = share(b, "manufacturer")!;
  assert.equal(m.baseKurus, 170000);
  assert.equal(m.includesPainting, true);
  assert.equal(m.voided, null);
  assert.equal(m.accrualEvent, "Kendi boyayıp kargoladığında");
  assert.equal(m.earning?.status, "paid");
  assert.deepEqual(b.warnings, []);
});

test("tek ürün + boyama: taban ve opsiyon fiyat satırı; boyama payı her satırın split'inde", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Ejderha",
      quantity: 2,
      amountKurus: 300000,
      productionBaseKurus: 210000,
      paintingPriceKurus: 90000,
      selectedOptions: [
        { groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 20000 },
        { groupName: "Kaide", choiceName: "Yok", priceDeltaKurus: 0 },
      ],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.qty, l.unitKurus, l.amountKurus, l.split]),
    [
      ["price", "Ejderha", 2, 130000, 260000, { productionKurus: 182000, paintingKurus: 78000 }],
      ["price", "Boyut: Büyük", 2, 20000, 40000, { productionKurus: 28000, paintingKurus: 12000 }],
    ]
  );
  assert.ok(b.lines[0].note?.includes("Opsiyon ve ekler hariç taban fiyat"), b.lines[0].note);
  assert.ok(b.lines[0].note?.includes("kalem oranıyla"), b.lines[0].note);
  assert.ok(!b.lines.some((l) => l.label.includes("Kaide")), "fiyatı değiştirmeyen opsiyon para satırı olmaz");
  assert.deepEqual(
    b.shares.map((x) => [x.party, x.baseKurus, x.includesPainting]),
    [
      ["manufacturer", 210000, false],
      ["painter", 90000, false],
    ]
  );
  assert.deepEqual(b.warnings, []);
});

test("tek ürün + boyama: boyama payı büyük olsa da seçimler ayrılır (ana satır eksiye düşmez)", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Ejderha",
      quantity: 1,
      amountKurus: 100000,
      productionBaseKurus: 20000,
      paintingPriceKurus: 80000,
      selectedAddons: [{ name: "Vitrin kutusu", priceKurus: 40000 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.unitKurus, l.amountKurus, l.split]),
    [
      ["price", "Ejderha", 60000, 60000, { productionKurus: 12000, paintingKurus: 48000 }],
      ["price", "Vitrin kutusu", 40000, 40000, { productionKurus: 8000, paintingKurus: 32000 }],
    ]
  );
});

test("tek ürün + boyama: eksi opsiyon, ek, ek hizmet ve tek kuruşlu tutarlar — kuruşu kuruşuna", () => {
  // 3 × (33333 − 3333 + 1111) = 93333; kalem 70/30; + hediye paketi.
  const itemAmount = (33333 - 3333 + 1111) * 3;
  const bases = allocateBases({ productionKurus: 7000, paintingKurus: 3000, totalKurus: itemAmount });
  const up = UPSELL_PRICES_KURUS.gift_wrap;
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Vazo",
      quantity: 3,
      amountKurus: itemAmount + up,
      productionBaseKurus: itemAmount + up - bases.paintingKurus,
      paintingPriceKurus: bases.paintingKurus,
      upsells: ["gift_wrap"],
      upsellAmountKurus: up,
      selectedOptions: [{ groupName: "Boyut", choiceName: "Küçük", priceDeltaKurus: -3333 }],
      selectedAddons: [{ name: "Kaide", priceKurus: 1111 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.qty, l.unitKurus, l.amountKurus]),
    [
      ["price", "Vazo", 3, 33333, 99999],
      ["price", "Boyut: Küçük", 3, -3333, -9999],
      ["price", "Kaide", 3, 1111, 3333],
      ["addon", "Hediye paketi", undefined, undefined, up],
    ]
  );
  const price = b.lines.filter((l) => l.kind === "price");
  assert.equal(sumOf(price.map((l) => l.split!.productionKurus)), bases.productionKurus);
  assert.equal(sumOf(price.map((l) => l.split!.paintingKurus)), bases.paintingKurus);
  assertNearProportional(price, bases.productionKurus, itemAmount, "vazo");
  assert.deepEqual(b.warnings, []);
});

test("tek ürün: eksi opsiyon farkı eksi satır, ana satır taban fiyattan (boyamasız)", () => {
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Vazo",
      quantity: 1,
      amountKurus: 130000,
      productionBaseKurus: 130000,
      paintingPriceKurus: 0,
      selectedOptions: [{ groupName: "Boyut", choiceName: "Küçük", priceDeltaKurus: -20000 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.label, l.amountKurus, l.unitKurus]),
    [
      ["Vazo", 150000, 150000],
      ["Boyut: Küçük", -20000, -20000],
    ]
  );
});

test("tek ürün + ek hizmet: ek hizmet satırı yeniden hesaplanmış, ürün satırları değil", () => {
  const up = UPSELL_PRICES_KURUS.gift_wrap;
  const b = derive(
    snap({
      orderType: "marketplace",
      productId: "p1",
      productTitleSnapshot: "Ejderha",
      quantity: 1,
      amountKurus: 155000 + up,
      productionBaseKurus: 155000 + up,
      paintingPriceKurus: 0,
      upsells: ["gift_wrap"],
      upsellAmountKurus: up,
      selectedAddons: [{ name: "Kaide", priceKurus: 5000 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.label, l.kind, l.amountKurus, l.recomputed ?? false]),
    [
      ["Ejderha", "production", 150000, false],
      ["Kaide", "addon", 5000, false],
      ["Hediye paketi", "addon", up, true],
    ]
  );
  assert.deepEqual(b.warnings, []);
});

test("tek ürün: kesin satır değeri çıkmıyorsa tek satır + nedeni notta (rakam uydurulmaz)", () => {
  const product = { orderType: "marketplace", productId: "p1", productTitleSnapshot: "Ejderha" } as const;
  type Expect = { kind: MoneyLine["kind"]; split?: MoneyLine["split"]; unitKurus?: number };
  const scenarios: Array<[string, Partial<OrderMoneySnapshot>, string, Expect]> = [
    [
      "birim fiyat 0'a çekilmiş",
      {
        quantity: 1,
        amountKurus: 0,
        productionBaseKurus: 0,
        paintingPriceKurus: 0,
        selectedOptions: [{ groupName: "Boyut", choiceName: "Mini", priceDeltaKurus: -50000 }],
      },
      "ürün tutarı 0",
      { kind: "production", unitKurus: 0 },
    ],
    [
      "anlık görüntü tutarla uyuşmuyor",
      {
        quantity: 1,
        amountKurus: 10000,
        productionBaseKurus: 10000,
        paintingPriceKurus: 0,
        selectedOptions: [{ groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 20000 }],
      },
      "seçim farkları ödenen birim fiyatı aşıyor",
      { kind: "production", unitKurus: 10000 },
    ],
    [
      "tutar birim × adet değil",
      {
        quantity: 3,
        amountKurus: 100000,
        productionBaseKurus: 100000,
        paintingPriceKurus: 0,
        selectedAddons: [{ name: "Kaide", priceKurus: 1000 }],
      },
      "birim fiyat × adet değil",
      { kind: "production" },
    ],
    [
      "kalem bölüşümü tutmuyor",
      {
        quantity: 1,
        amountKurus: 100000,
        productionBaseKurus: 90000,
        paintingPriceKurus: 0,
        selectedAddons: [{ name: "Kaide", priceKurus: 1000 }],
      },
      "kalem bölüşümü tutmuyor",
      // Üretim payı (90000) 1 × 100000 değil: birim yazılmaz.
      { kind: "production" },
    ],
    [
      "boyamalı: anlık görüntü tutarla uyuşmuyor",
      {
        quantity: 1,
        amountKurus: 10000,
        productionBaseKurus: 7000,
        paintingPriceKurus: 3000,
        selectedOptions: [{ groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 20000 }],
      },
      "seçim farkları ödenen birim fiyatı aşıyor",
      { kind: "price", unitKurus: 10000, split: { productionKurus: 7000, paintingKurus: 3000 } },
    ],
    [
      "boyamalı: tutar birim × adet değil",
      {
        quantity: 3,
        amountKurus: 100000,
        productionBaseKurus: 70000,
        paintingPriceKurus: 30000,
        selectedAddons: [{ name: "Kaide", priceKurus: 1000 }],
      },
      "birim fiyat × adet değil",
      { kind: "price", split: { productionKurus: 70000, paintingKurus: 30000 } },
    ],
    [
      "boyamalı: kalem bölüşümü tutmuyor (oran kurulamaz, kayıtlı satırlar)",
      {
        quantity: 1,
        amountKurus: 100000,
        productionBaseKurus: 60000,
        paintingPriceKurus: 30000,
        selectedAddons: [{ name: "Kaide", priceKurus: 1000 }],
      },
      "kalem bölüşümü tutmuyor",
      { kind: "production" },
    ],
  ];
  for (const [name, over, reason, expect] of scenarios) {
    const b = deriveOrderMoneyBreakdown(snap({ ...product, ...over }));
    if (b.totals.splitMatches) assertInvariants(b, name);
    const main = b.lines[0];
    assert.equal(main.label, "Ejderha", name);
    assert.equal(main.kind, expect.kind, name);
    assert.deepEqual(main.split, expect.split, name);
    assert.equal(main.unitKurus, expect.unitKurus, name);
    assert.equal(main.qty, over.quantity, name);
    assert.ok(main.note?.includes("ayrı satır olarak gösterilmedi"), `${name}: ${main.note}`);
    assert.ok(main.note?.includes(reason), `${name}: ${main.note}`);
    assert.ok(!b.lines.some(isSelectionRow), `${name}: ayrı seçim satırı üretilmemeli`);
    // Seçim yine notta görünür — bilgi kaybolmaz, yalnızca tutara dönüşmez.
    const picked = over.selectedOptions?.[0]?.choiceName ?? over.selectedAddons?.[0]?.name ?? "";
    assert.ok(main.note?.includes(picked), `${name}: ${main.note}`);
  }
});

test("tek ürün: rota gibi kurulan siparişte üç invariant, seçim satırları birim × adet, oran kuruşu tam (fuzz)", () => {
  const next = rng(2027);
  const keys = Object.keys(UPSELL_PRICES_KURUS);
  let carvedCount = 0;
  let fallbackCount = 0;
  let priceCount = 0;
  for (let i = 0; i < 3000; i++) {
    const qty = next(5) + 1;
    const unitBase = next(300000);
    const options = Array.from({ length: next(3) }, (_, k) => ({
      groupName: `G${k}`,
      choiceName: `C${k}`,
      priceDeltaKurus: next(4) === 0 ? 0 : next(60000) - 15000,
    }));
    const addons = Array.from({ length: next(3) }, (_, k) => ({ name: `E${k}`, priceKurus: next(30000) }));
    // Rastgele çekilişte nadir olduğu için açıkça: ~15 siparişte bir, ucuzlatan
    // bir opsiyon birim fiyatı eksiye iter, computeSelectionPrice 0'a çeker ve
    // "ayrı satır olarak gösterilmedi" yolu denenir.
    if (next(15) === 0) {
      const sofar =
        options.reduce((a, o) => a + o.priceDeltaKurus, 0) + addons.reduce((a, x) => a + x.priceKurus, 0);
      options.push({ groupName: "Boyut", choiceName: "Mini", priceDeltaKurus: 0 - (unitBase + sofar + next(5000) + 1) });
    }
    const perUnit =
      options.reduce((a, o) => a + o.priceDeltaKurus, 0) + addons.reduce((a, x) => a + x.priceKurus, 0);
    // computeSelectionPrice: farklar taban (ya da kademe) fiyatın üstüne biner,
    // eksi birim fiyat 0'a çekilir.
    const itemAmount = Math.max(0, unitBase + perUnit) * qty;
    // basesForLineTotal: ürünün kalem oranı satırın TAMAMINA uygulanır.
    const bases = allocateBases({
      productionKurus: next(200000),
      paintingKurus: next(3) === 0 ? next(200000) : 0,
      totalKurus: itemAmount,
    });
    const picked = keys.filter(() => next(3) === 0);
    const upsellAmountKurus = picked.reduce((a, k) => a + UPSELL_PRICES_KURUS[k], 0);
    const amountKurus = itemAmount + upsellAmountKurus;
    const ctx = JSON.stringify({ qty, unitBase, options, addons, bases, picked });
    const b = derive(
      snap({
        orderType: "marketplace",
        productId: "p1",
        productTitleSnapshot: "Ürün",
        quantity: qty,
        amountKurus,
        paintingPriceKurus: bases.paintingKurus,
        productionBaseKurus: amountKurus - bases.paintingKurus,
        upsells: picked,
        upsellAmountKurus,
        selectedOptions: options.length > 0 ? options : null,
        selectedAddons: addons.length > 0 ? addons : null,
      }),
      ctx
    );
    const ratioSplit = bases.paintingKurus > 0;
    const main = b.lines[0];
    assert.equal(main.kind, ratioSplit ? "price" : "production", ctx);
    assert.ok(main.amountKurus >= 0, `ana satır eksi: ${ctx}`);
    if (ratioSplit) {
      priceCount++;
      assert.ok(!b.lines.some((l) => l.kind === "painting"), `oranla bölünen üründe boyama kalan satırı: ${ctx}`);
      assertNearProportional(
        b.lines.filter((l) => l.kind === "price"),
        bases.productionKurus,
        itemAmount,
        ctx
      );
    }
    const selRows = b.lines.filter(isSelectionRow);
    if (selRows.length > 0) {
      carvedCount++;
      // Her ayrılan satır birebir birim fark × adet; ana satırın birimi taban fiyat.
      for (const r of selRows) {
        assert.equal(r.qty, qty, ctx);
        assert.equal(r.amountKurus, (r.unitKurus ?? Number.NaN) * qty, ctx);
        assert.equal(r.recomputed, undefined, ctx);
        const plainKind = r.note!.startsWith("Opsiyon farkı") ? "production" : "addon";
        assert.equal(r.kind, ratioSplit ? "price" : plainKind, ctx);
      }
      assert.equal(main.unitKurus, unitBase, ctx);
    } else if (options.some((o) => o.priceDeltaKurus !== 0) || addons.some((a) => a.priceKurus !== 0)) {
      fallbackCount++;
      assert.ok(main.note?.includes("ayrı satır olarak gösterilmedi"), ctx);
    }
    assert.deepEqual(b.warnings, [], ctx);
  }
  assert.ok(
    carvedCount > 100 && fallbackCount > 5 && priceCount > 300,
    `carved=${carvedCount} fallback=${fallbackCount} price=${priceCount}`
  );
});

// ─── Tek ürün + sonradan "Boyama ekle" (C2'') ───────────────────────────────

/**
 * QA probe E: Ejderha 1 × (taban 80000 + Büyük 20000) = 100000. Ürünün kalemi
 * yalnız üretim; admin sonradan boyama payı ayırdı. Tabanlar rotanın kendi saf
 * fonksiyonundan (carvePaintingShare) — elle yazılsaydı test rotanın
 * yazmadığı bir şekli sınayabilirdi.
 */
function carvedSnap(paintingKurus: number, over: Partial<OrderMoneySnapshot> = {}): OrderMoneySnapshot {
  const amountKurus = over.amountKurus ?? 100000;
  // Boyama kalemsiz ürünün siparişi: tutarın tamamı üretim (basesForLineTotal).
  const carve = carvePaintingShare({ amountKurus, productionBaseKurus: amountKurus, paintingPriceKurus: 0 }, paintingKurus);
  assert.ok(carve.ok, "ayırma geçerli olmalı");
  return snap({
    orderType: "marketplace",
    productId: "p1",
    productTitleSnapshot: "Ejderha",
    quantity: 1,
    amountKurus,
    selectedOptions: [{ groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 20000 }],
    productCostBases: { productionKurus: 80000, paintingKurus: 0 },
    ...over,
    productionBaseKurus: carve.productionAfter,
    paintingPriceKurus: carve.paintingAfter,
  });
}

test("tek ürün + sonradan 'Boyama ekle', ürünün kaleminde boyama yok: satırlar gerçek türünde + tek boyama satırı", () => {
  const cases: Array<[string, OrderMoneySnapshot["productCostBases"]]> = [
    ["kalemi yalnız üretim", { productionKurus: 80000, paintingKurus: 0 }],
    ["kırılımsız ürün", null],
  ];
  for (const [name, productCostBases] of cases) {
    // Boyacıya devredildi: devir üreticinin baskı payını tahakkuk ettirir
    // (brüt = 80000). Satır olmasa döküm doğru olarak "Tahakkuk eksik" derdi.
    const b = derive(
      carvedSnap(20000, {
        productCostBases,
        painterId: "p1",
        painterName: "Boya Evi",
        painterStatus: "accepted",
        manufacturerEarning: earning(80000),
      }),
      name
    );
    assert.deepEqual(
      b.lines.map((l) => [l.kind, l.label, l.qty, l.unitKurus, l.amountKurus, l.split]),
      [
        // Ayrılan pay tek parça üretimden çıktı: taban satırı 80000 − 20000,
        // birim yazılmaz (1 × 80000 artık satırın tutarı değil).
        ["production", "Ejderha", 1, undefined, 60000, undefined],
        // Opsiyon farkı satış anındaki değeriyle ve gerçek türüyle — oranla
        // bölünseydi p16000/b4000 gibi hiç olmamış bir pay taşırdı (probe E).
        ["production", "Boyut: Büyük", 1, 20000, 20000, undefined],
        ["painting", "Ejderha — boyama payı", undefined, undefined, 20000, undefined],
      ],
      name
    );
    assert.ok(b.lines[0].note?.includes("Boyama ekle"), `${name}: ${b.lines[0].note}`);
    assert.equal(b.lines[2].note, "Sonradan üretim payından ayrıldı · Boyacının hakediş tabanı", name);
    assert.deepEqual(
      b.shares.map((x) => [x.party, x.baseKurus]),
      [
        ["manufacturer", 80000],
        ["painter", 20000],
      ],
      name
    );
    assert.deepEqual(b.warnings, [], name);
  }
});

test("tek ürün + 'Boyama ekle', kendi boyayan üretici: ürün eki 'Ek hizmet' türünde, boyama satırı üreticide", () => {
  const gift = UPSELL_PRICES_KURUS.gift_wrap;
  // 2 × (taban 50000 + Büyük 20000 + Kaide 5000) = 150000, + hediye paketi; 30000 ayrıldı.
  const b = derive(
    carvedSnap(30000, {
      quantity: 2,
      amountKurus: 150000 + gift,
      selectedAddons: [{ name: "Kaide", priceKurus: 5000 }],
      upsells: ["gift_wrap"],
      upsellAmountKurus: gift,
      paintsInHouse: true,
      manufacturerStatus: "printing",
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.amountKurus]),
    [
      ["production", "Ejderha", 70000],
      ["production", "Boyut: Büyük", 40000],
      ["addon", "Kaide", 10000],
      ["painting", "Ejderha — boyama payı", 30000],
      ["addon", "Hediye paketi", gift],
    ]
  );
  assert.ok(
    b.lines[3].note?.startsWith("Sonradan üretim payından ayrıldı · Üreticinin hakediş tabanında"),
    b.lines[3].note
  );
  assert.deepEqual(
    b.shares.map((x) => [x.party, x.baseKurus, x.includesPainting]),
    [["manufacturer", 150000 + gift, true]]
  );
  assert.deepEqual(b.warnings, []);
});

test("tek ürün + 'Boyama ekle' seçimleri karşılamıyorsa seçimler ayrılmaz, nedeni notta (rakam uydurulmaz)", () => {
  // Taban 40000 + Büyük 60000 = 100000; 50000 ayrıldı → üretim 50000 < opsiyon 60000.
  const b = derive(
    carvedSnap(50000, {
      selectedOptions: [{ groupName: "Boyut", choiceName: "Büyük", priceDeltaKurus: 60000 }],
    })
  );
  assert.deepEqual(
    b.lines.map((l) => [l.kind, l.label, l.amountKurus]),
    [
      ["production", "Ejderha", 50000],
      ["painting", "Ejderha — boyama payı", 50000],
    ]
  );
  assert.ok(b.lines[0].note?.includes("üretim payı opsiyon ve ekleri karşılamıyor"), b.lines[0].note);
  assert.ok(b.lines[0].note?.includes("Büyük"), b.lines[0].note);
  assert.ok(!b.lines.some(isSelectionRow));
});

test("tek ürün + boyama: ürünün kaleminde boyama varsa, kırılım yüklenmediyse ya da kalem öncesiyse oranla bölünür", () => {
  const cases: Array<[string, OrderMoneySnapshot]> = [
    ["ürünün boyama kalemi var", carvedSnap(20000, { productCostBases: { productionKurus: 80000, paintingKurus: 20000 } })],
    ["kırılım yüklenmedi (bilinmiyor)", carvedSnap(20000, { productCostBases: undefined })],
    [
      // "Boyama ekle" üretim tabanını hep yazar; NULL tabanlı boyamalı sipariş ayırma değildir.
      "kalem öncesi sipariş",
      { ...carvedSnap(20000, { productCostBases: null }), productionBaseKurus: null },
    ],
  ];
  for (const [name, s] of cases) {
    const b = derive(s, name);
    assert.ok(b.lines.length > 0 && b.lines.every((l) => l.kind === "price"), name);
  }
});

test("tek ürün + 'Boyama ekle' (fuzz): oran yok, tek boyama satırı = ayrılan pay, seçim satırları satış değerinde", () => {
  const next = rng(4242);
  const keys = Object.keys(UPSELL_PRICES_KURUS);
  let separated = 0;
  let kept = 0;
  for (let i = 0; i < 1500; i++) {
    const qty = next(4) + 1;
    const unitBase = next(200000) + 1000;
    const options = Array.from({ length: next(3) }, (_, k) => ({
      groupName: `G${k}`,
      choiceName: `C${k}`,
      priceDeltaKurus: next(40000) - 5000,
    }));
    const addons = Array.from({ length: next(2) }, (_, k) => ({ name: `E${k}`, priceKurus: next(20000) }));
    const perUnit =
      options.reduce((a, o) => a + o.priceDeltaKurus, 0) + addons.reduce((a, x) => a + x.priceKurus, 0);
    const itemAmount = Math.max(0, unitBase + perUnit) * qty;
    if (itemAmount < 2) continue;
    const picked = keys.filter(() => next(3) === 0);
    const upsellAmountKurus = picked.reduce((a, k) => a + UPSELL_PRICES_KURUS[k], 0);
    const amountKurus = itemAmount + upsellAmountKurus;
    const carve = carvePaintingShare(
      { amountKurus, productionBaseKurus: amountKurus, paintingPriceKurus: 0 },
      next(itemAmount - 1) + 1
    );
    assert.ok(carve.ok);
    const ctx = JSON.stringify({ qty, unitBase, options, addons, picked, painting: carve.paintingAfter });
    const b = derive(
      snap({
        orderType: "marketplace",
        productId: "p1",
        productTitleSnapshot: "Ürün",
        quantity: qty,
        amountKurus,
        productionBaseKurus: carve.productionAfter,
        paintingPriceKurus: carve.paintingAfter,
        upsells: picked,
        upsellAmountKurus,
        selectedOptions: options.length > 0 ? options : null,
        selectedAddons: addons.length > 0 ? addons : null,
        productCostBases: next(2) === 0 ? null : { productionKurus: unitBase, paintingKurus: 0 },
        paintsInHouse: next(2) === 0,
      }),
      ctx
    );
    assert.ok(!b.lines.some((l) => l.kind === "price"), `ayrılan boyama oranla bölündü: ${ctx}`);
    assert.deepEqual(
      b.lines.filter((l) => l.kind === "painting").map((l) => l.amountKurus),
      [carve.paintingAfter],
      ctx
    );
    assert.ok(b.lines[0].amountKurus >= 0, `ana satır eksi: ${ctx}`);
    const selRows = b.lines.filter(isSelectionRow);
    for (const r of selRows) {
      assert.equal(r.amountKurus, (r.unitKurus ?? Number.NaN) * qty, ctx);
    }
    if (selRows.length > 0) separated++;
    else if (options.some((o) => o.priceDeltaKurus !== 0) || addons.some((a) => a.priceKurus !== 0)) kept++;
    assert.deepEqual(b.warnings, [], ctx);
  }
  assert.ok(separated > 200 && kept > 50, `separated=${separated} kept=${kept}`);
});

test("yüklenen model: boyamasız tek üretim satırı + ek hizmetler", () => {
  const up = UPSELL_PRICES_KURUS.rush_shipping;
  const b = derive(
    snap({
      orderType: "upload",
      amountKurus: 60000 + up,
      productionBaseKurus: 60000 + up,
      paintingPriceKurus: 0,
      upsells: ["rush_shipping"],
      upsellAmountKurus: up,
    })
  );
  assert.equal(b.lines[0].amountKurus, 60000);
  assert.equal(b.shares.length, 1, "boyama payı yoksa boyacı payı listelenmez");
});

test("atölye koltuğu: tek üretim satırı, tahakkuk olayı toplu sevk", () => {
  const b = derive(
    snap({ workshopSessionId: "w1", amountKurus: 150000, productionBaseKurus: 150000, paintingPriceKurus: 0 })
  );
  assert.equal(b.lines.length, 1);
  assert.ok(b.lines[0].label.startsWith("Atölye"));
  assert.ok(share(b, "manufacturer")!.accrualEvent.includes("Atölye partisi"));
});

test("Σ satırlar === tutar — figür / ürün / yükleme, rastgele ek hizmetlerle (fuzz)", () => {
  const next = rng(99);
  const keys = Object.keys(UPSELL_PRICES_KURUS);
  for (let i = 0; i < 2000; i++) {
    const picked = keys.filter(() => next(2) === 0);
    const upsellAmountKurus = picked.reduce((a, k) => a + UPSELL_PRICES_KURUS[k], 0);
    const item = next(1_000_000) + 1000;
    const amountKurus = item + upsellAmountKurus;
    const paintingPriceKurus = next(2) === 0 ? 0 : next(item);
    const orderType = ["custom", "upload", "marketplace"][next(3)];
    const b = derive(
      snap({
        orderType,
        productId: orderType === "marketplace" ? "p1" : null,
        quantity: 1,
        amountKurus,
        paintingPriceKurus,
        productionBaseKurus: amountKurus - paintingPriceKurus,
        upsells: picked,
        upsellAmountKurus,
      }),
      `${orderType} ${amountKurus}/${paintingPriceKurus}`
    );
    assert.deepEqual(b.warnings, []);
  }
});

// ─── Kim ne alır + tahakkuk ─────────────────────────────────────────────────

test("pay tabloları tek türetimden: beklenen komisyon/net = computeEarning(taban, oran)", () => {
  const b = derive(snap({ painterId: "p1", painterName: "Boyacı B" }));
  const m = share(b, "manufacturer")!;
  const p = share(b, "painter")!;
  assert.equal(m.baseKurus, 249900);
  assert.equal(p.baseKurus, 100000);
  const em = computeEarning(249900, 4000);
  assert.equal(m.expectedCommissionKurus, em.commissionKurus);
  assert.equal(m.expectedNetKurus, em.netKurus);
  assert.equal(p.expectedNetKurus, computeEarning(100000, 4000).netKurus);
  assert.equal(m.rateIsEstimate, false);
  assert.ok(m.accrualEvent.includes("Boyacıya devredildiğinde"));
  assert.equal(p.accrualEvent, "Boyacı kargoladığında");
  // Ödenmiş sipariş: paylar açık, boyama boyacıda.
  assert.deepEqual(
    b.shares.map((x) => [x.voided, x.includesPainting]),
    [
      [null, false],
      [null, false],
    ]
  );
});

test("oran henüz dondurulmadıysa bugünkü oran, 'tahmini' işaretli", () => {
  const b = derive(snap({ commissionRateBps: null }));
  const m = share(b, "manufacturer")!;
  assert.equal(m.rateBps, PLATFORM_COMMISSION_RATE_BPS);
  assert.equal(m.rateIsEstimate, true);
});

test("tahakkuk eksik: üretici kargoladı / devretti ama hakediş satırı yok", () => {
  const shipped = derive(
    snap({
      productionBaseKurus: 349900,
      paintingPriceKurus: 0,
      manufacturerStatus: "shipped",
      shippedAt: SHIPPED_AT,
    })
  );
  assert.equal(share(shipped, "manufacturer")!.accrualMissing, true);
  assert.ok(hasWarning(shipped, "Tahakkuk eksik"));

  const handedOff = derive(snap({ painterId: "p1", painterStatus: "accepted" }));
  assert.equal(share(handedOff, "manufacturer")!.accrualMissing, true);
  assert.equal(share(handedOff, "painter")!.accrualMissing, false, "boyacı henüz kargolamadı");

  const withRow = derive(
    snap({ painterId: "p1", painterStatus: "accepted", manufacturerEarning: earning(249900) })
  );
  assert.equal(share(withRow, "manufacturer")!.accrualMissing, false);
  assert.deepEqual(withRow.warnings, []);
});

test("tahakkuk eksik değil: admin kargosu (üretici yok) ve iade edilmiş sipariş", () => {
  const adminShipped = derive(
    snap({
      paintingPriceKurus: 0,
      productionBaseKurus: 349900,
      manufacturerId: null,
      manufacturerName: null,
      shippedAt: SHIPPED_AT,
    })
  );
  assert.equal(share(adminShipped, "manufacturer")!.accrualMissing, false);
  // Kopmamış (eski) iade: partnerler hâlâ bağlı, olay gerçekleşmiş olsa da alarm yok.
  const refunded = derive(snap({ paymentStatus: "refunded", painterId: "p1" }));
  assert.deepEqual(
    refunded.shares.map((x) => [x.party, x.voided, x.accrualMissing]),
    [
      ["manufacturer", "refunded", false],
      ["painter", "refunded", false],
    ]
  );
});

test("tahakkuk eksik: boyacı kargoladı ama boyacı hakedişi yok", () => {
  const b = derive(
    snap({
      painterId: "p1",
      painterStatus: "shipped",
      shippedAt: SHIPPED_AT,
      manufacturerEarning: earning(249900),
    })
  );
  assert.equal(share(b, "painter")!.accrualMissing, true);
  assert.ok(hasWarning(b, "Boyacı"));
});

test("hakediş brütü beklenen tabandan farklı → uyarı", () => {
  const b = derive(
    snap({
      painterId: "p1",
      manufacturerEarning: earning(349900), // boyama payı dahil tahakkuk etmiş — yanlış
    })
  );
  assert.ok(hasWarning(b, "beklenen taban"));
});

test("kendi boyayıp kargolayan üretici: profil bayrağı sonradan kapansa da tek pay, uyarı yok", () => {
  const b = derive(
    snap({
      paintsInHouse: false, // bayrak sonradan kapandı
      manufacturerStatus: "shipped",
      shippedAt: SHIPPED_AT,
      manufacturerEarning: earning(349900),
    })
  );
  const m = share(b, "manufacturer")!;
  assert.equal(m.baseKurus, 349900);
  assert.equal(m.includesPainting, true);
  assert.equal(share(b, "painter"), undefined, "boyama üreticide: boyacı payı yok");
  assert.deepEqual(b.warnings, []);
});

test("üretici kendi boyuyor (QA d/h): boyacı payı YOK, üretici payı boyamayı kapsar", () => {
  const rush = UPSELL_PRICES_KURUS.rush_shipping;
  const fixtures: Array<[string, OrderMoneySnapshot]> = [
    [
      "h: özel figür + hızlı kargo, kalite kontrolde",
      snap({
        amountKurus: 349900 + rush,
        productionBaseKurus: 249900 + rush,
        upsells: ["rush_shipping"],
        upsellAmountKurus: rush,
        manufacturerName: "Nokta Figür Atölyesi",
        paintsInHouse: true,
        manufacturerStatus: "qc_pending",
      }),
    ],
    [
      "d: manuel (WhatsApp) sipariş, türlü kalemler, baskıda",
      snap({
        orderType: "marketplace",
        amountKurus: 625000,
        productionBaseKurus: 475000,
        paintingPriceKurus: 150000,
        selectedAddons: [
          { name: "Aile figürü (3 kişi, 20 cm)", priceKurus: 420000, kind: "production" },
          { name: "El boyaması (3 figür)", priceKurus: 150000, kind: "painting" },
          { name: "Ceviz kaide + pirinç isim plakası", priceKurus: 30000, kind: "production" },
          { name: "Yedek anahtarlık kopyası × 2", priceKurus: 25000, kind: "production" },
        ],
        manufacturerName: "Nokta Figür Atölyesi",
        paintsInHouse: true,
        manufacturerStatus: "printing",
      }),
    ],
    ["b: boyama kalemli tek ürün, kargolandı", balloonSnap()],
  ];
  for (const [name, s] of fixtures) {
    const b = derive(s, name);
    assert.deepEqual(b.shares.map((x) => x.party), ["manufacturer"], name);
    const m = b.shares[0];
    assert.equal(m.includesPainting, true, name);
    assert.equal(m.baseKurus, s.amountKurus, name);
    assert.equal(m.accrualEvent, "Kendi boyayıp kargoladığında", name);
    assert.equal(m.voided, null, name);
    assert.equal(b.platform.unassignedBaseKurus, 0, name);
  }
});

test("kendim boyarım üreticisi, siparişte boyama kalemi yok: includesPainting false", () => {
  const b = derive(
    snap({
      orderType: "upload",
      amountKurus: 84900,
      productionBaseKurus: 84900,
      paintingPriceKurus: 0,
      paintsInHouse: true,
      manufacturerStatus: "printing",
    })
  );
  assert.deepEqual(
    b.shares.map((x) => [x.party, x.includesPainting]),
    [["manufacturer", false]]
  );
  assert.equal(b.shares[0].accrualEvent, "Üretici kargoladığında");
});

test("b1-01: boyama satırı tabanın kimin olduğunu söyler — kendi boyayan üreticide 'boyacının' demez", () => {
  const paintingNotes = (b: OrderMoneyBreakdown) =>
    b.lines.filter((l) => l.kind === "painting").map((l) => l.note ?? "");
  const inHouse: Array<[string, OrderMoneySnapshot]> = [
    ["h: özel figür, kalite kontrolde", snap({ paintsInHouse: true, manufacturerStatus: "qc_pending" })],
    ["yüklenen model, baskıda", snap({ orderType: "upload", paintsInHouse: true, manufacturerStatus: "printing" })],
    [
      // İade partnerleri kopardı; kendi boyama olgusu hakediş satırından okunur.
      "iade: kopmuş sipariş, hakediş boyamayı kapsıyor",
      snap({ ...DETACHED, manufacturerEarning: earning(349900, { status: "paid", payout: PAID_PAYOUT }) }),
    ],
  ];
  for (const [name, s] of inHouse) {
    const b = derive(s, name);
    assert.deepEqual(b.shares.map((x) => [x.party, x.includesPainting]), [["manufacturer", true]], name);
    const notes = paintingNotes(b);
    assert.equal(notes.length, 1, name);
    assert.ok(!notes[0].includes("Boyacının"), `${name}: ${notes[0]}`);
    assert.ok(notes[0].includes("Üreticinin hakediş tabanında"), `${name}: ${notes[0]}`);
  }
  // Boyama başkasında ya da henüz kimsede değil: taban boyacınındır.
  const elsewhere: Array<[string, OrderMoneySnapshot]> = [
    ["boyacıya devredildi", snap({ painterId: "p1", painterName: "Boya Evi", painterStatus: "accepted" })],
    ["boyacı henüz atanmadı", snap()],
  ];
  for (const [name, s] of elsewhere) {
    assert.deepEqual(paintingNotes(derive(s, name)), ["Boyacının hakediş tabanı"], name);
  }
});

// ─── İade ───────────────────────────────────────────────────────────────────

test("iade (QA f/m): iki pay da 'refunded' ile kapanır, tahakkuk eksik değil, platform neti +0", () => {
  const b = derive(snap({ ...DETACHED }));
  assert.deepEqual(
    b.shares.map((x) => [x.party, x.voided, x.accrualMissing, x.includesPainting, x.earning]),
    [
      ["manufacturer", "refunded", false, false, null],
      ["painter", "refunded", false, false, null],
    ]
  );
  assert.ok(Object.is(b.platform.netKurus, 0), "platform neti -0 değil, +0");
  assert.ok(hasWarning(b, "gerçekleşen tutarı bilinmiyor"));
  assert.ok(!hasWarning(b, "platform zararı"));
});

test("iade (QA g/l): yüklenen model — üretici bağlı kalmış ya da kopmuş, pay kapanır", () => {
  const upload = { orderType: "upload", amountKurus: 84900, productionBaseKurus: 84900, paintingPriceKurus: 0 };
  const attached = derive(
    snap({
      ...upload,
      paymentStatus: "refunded",
      manufacturerName: "Nokta Figür Atölyesi",
      paintsInHouse: true,
      manufacturerStatus: "printing",
    })
  );
  const detached = derive(snap({ ...upload, ...DETACHED }));
  for (const b of [attached, detached]) {
    assert.deepEqual(
      b.shares.map((x) => [x.party, x.voided, x.accrualMissing, x.includesPainting]),
      [["manufacturer", "refunded", false, false]]
    );
    assert.ok(Object.is(b.platform.netKurus, 0));
  }
});

test("iade: ciro 0 (tahsilat korunur), ödenmiş hakediş platform zararı olarak görünür", () => {
  const paid = earning(249900, { status: "paid", payout: PAID_PAYOUT });
  const b = derive(snap({ ...DETACHED, manufacturerEarning: paid }));
  // D3: tahsil edilen nakit iadeden bağımsızdır (alınmış para); ciro 0.
  assert.equal(b.collection.cashCollectedKurus, 349900);
  assert.equal(b.collection.revenueKurus, 0);
  assert.equal(b.platform.netKurus, -paid.netKurus);
  const m = share(b, "manufacturer")!;
  assert.equal(m.partnerName, "Atölye A", "hakediş kime yazıldıysa o görünür");
  assert.equal(m.voided, "refunded");
  assert.equal(m.earning?.status, "paid", "ödenmiş satır kendi durumunu korur");
  assert.ok(hasWarning(b, "gerçekleşen tutarı bilinmiyor"));
  assert.ok(hasWarning(b, "platform zararı"));
});

test("iade: kendi boyayıp kargolamış üretici — kopmuş siparişte de boyacı payı yok (hakediş olgusu)", () => {
  for (const status of ["reversed", "paid"] as const) {
    const e = earning(349900, {
      partnerName: "Nokta Figür Atölyesi",
      status,
      payout: status === "paid" ? PAID_PAYOUT : null,
    });
    const b = derive(snap({ ...DETACHED, shippedAt: SHIPPED_AT, manufacturerEarning: e }), status);
    assert.deepEqual(b.shares.map((x) => x.party), ["manufacturer"], status);
    const m = b.shares[0];
    assert.equal(m.baseKurus, 349900, status);
    assert.equal(m.includesPainting, true, status);
    assert.equal(m.voided, "refunded", status);
    assert.equal(m.earning?.status, status, status);
    assert.ok(Object.is(b.platform.netKurus, status === "paid" ? -e.netKurus : 0), status);
  }
});

test("iade: boyacı boyayıp kargolamış — boyacı hakedişi varken kendi boyama varsayılmaz", () => {
  const me = earning(249900, { status: "paid", payout: PAID_PAYOUT });
  const pe = earning(100000, { partnerId: "p1", partnerName: "Boyacı B", status: "paid", payout: PAID_PAYOUT });
  // İkincisi savunma: üretici durumu "shipped" kalmış olsa bile boyacı payı düşmez.
  for (const manufacturerStatus of ["unassigned", "shipped"]) {
    const b = derive(
      snap({
        ...DETACHED,
        manufacturerStatus,
        shippedAt: SHIPPED_AT,
        manufacturerEarning: me,
        painterEarning: pe,
      }),
      manufacturerStatus
    );
    assert.deepEqual(
      b.shares.map((x) => [x.party, x.baseKurus, x.voided, x.includesPainting, x.earning?.status]),
      [
        ["manufacturer", 249900, "refunded", false, "paid"],
        ["painter", 100000, "refunded", false, "paid"],
      ],
      manufacturerStatus
    );
    assert.equal(b.platform.netKurus, -(me.netKurus + pe.netKurus), manufacturerStatus);
  }
});

test("iade: tahsilat hediye çeki ve havale düşülmüş hâliyle kalır, ciro 0", () => {
  const b = derive(snap({ ...DETACHED, giftCardAmountKurus: 50000, havaleDiscountKurus: 8997 }));
  assert.equal(b.collection.cashCollectedKurus, 349900 - 50000 - 8997);
  assert.equal(b.collection.revenueKurus, 0);
});

test("iade: boyama kalemli tek ürün — satırlar yine fiyat kırılımı, paylar kapanır", () => {
  const s = balloonSnap();
  const b = derive({
    ...s,
    ...DETACHED,
    manufacturerEarning: s.manufacturerEarning ? { ...s.manufacturerEarning, status: "reversed", payout: null } : null,
  });
  assert.ok(b.lines.every((l) => l.kind === "price"));
  assert.deepEqual(
    b.shares.map((x) => [x.party, x.voided, x.includesPainting]),
    [["manufacturer", "refunded", true]]
  );
  assert.ok(Object.is(b.platform.netKurus, 0));
});

// ─── Platform ───────────────────────────────────────────────────────────────

test("platform = komisyonlar + partnersiz taban − hediye çeki − havale", () => {
  const b = derive(snap({ giftCardAmountKurus: 50000, havaleDiscountKurus: 8997 }));
  // Boyacı atanmamış: boyama tabanı platformda bekler.
  const mComm = computeEarning(249900, 4000).commissionKurus;
  assert.equal(b.platform.commissionKurus, mComm);
  assert.equal(b.platform.unassignedBaseKurus, 100000);
  assert.equal(b.platform.netKurus, mComm + 100000 - 50000 - 8997);
  assert.equal(b.collection.cashCollectedKurus, 349900 - 50000 - 8997);
  assert.equal(b.collection.revenueKurus, b.collection.cashCollectedKurus, "başarılı ödemede ciro = tahsilat");
});

test("KİMLİK: tahsilat = partner netleri + platform neti (fuzz, başarılı ödeme, kendi boyama dahil)", () => {
  const next = rng(31337);
  for (let i = 0; i < 3000; i++) {
    const totalKurus = next(2_000_000) + 1;
    const bases = allocateBases({
      productionKurus: next(400000),
      paintingKurus: next(400000),
      totalKurus,
    });
    const rate = [3500, 4000, 4500][next(3)];
    const gift = next(3) === 0 ? next(totalKurus) : 0;
    const havale = next(2) === 0 ? Math.floor((totalKurus - gift) * 0.03) : 0;
    const painterAssigned = next(2) === 0;
    const mfrAssigned = next(4) !== 0;
    const mAccrued = mfrAssigned && next(2) === 0;
    const s = snap({
      amountKurus: totalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
      giftCardAmountKurus: gift,
      havaleDiscountKurus: havale,
      commissionRateBps: rate,
      manufacturerId: mfrAssigned ? "m1" : null,
      paintsInHouse: mfrAssigned && next(3) === 0,
      painterId: painterAssigned ? "p1" : null,
      manufacturerEarning: mAccrued
        ? {
            partnerId: "m1",
            partnerName: "A",
            ...computeEarning(bases.productionKurus, rate),
            rateBps: rate,
            status: "pending",
            payout: null,
          }
        : null,
    });
    const ctx = JSON.stringify({ totalKurus, bases, gift, havale, rate, painterAssigned, mfrAssigned });
    const b = derive(s, ctx);
    const partnerNet = b.shares.reduce((a, sh) => {
      if (sh.earning) return a + (sh.earning.status === "reversed" ? 0 : sh.earning.netKurus);
      const assigned = sh.party === "manufacturer" ? s.manufacturerId !== null : s.painterId !== null;
      return a + (assigned ? sh.expectedNetKurus : 0);
    }, 0);
    // Kimlik üç terimlidir: geri alınmış taban platform netine KATILMAZ, kendi
    // kovasında durur (bu fuzz turu geri alınmış satır üretmez, terim 0'dır).
    assert.equal(
      partnerNet + b.platform.netKurus + b.platform.reversedBaseKurus,
      b.collection.cashCollectedKurus,
      ctx
    );
    assert.equal(b.collection.revenueKurus, b.collection.cashCollectedKurus);
    if (b.shares.some((x) => x.includesPainting)) {
      assert.equal(share(b, "painter"), undefined, `kendi boyamada boyacı payı: ${ctx}`);
    }
  }
});

test("geri alınmış hakediş: platform GELİRİNE girmez, ayrı kovada raporlanır", () => {
  const b = derive(
    snap({
      paintingPriceKurus: 0,
      productionBaseKurus: 349900,
      manufacturerEarning: earning(349900, { status: "reversed" }),
      earningReversal: null,
    })
  );
  assert.ok(hasWarning(b, "geri alındı"));
  // Geri alınmış taban "partneri olmayan taban" DEĞİLDİR: o hiç kimsenin
  // kazanmadığı tabandır, bu ise kazanılmış ama geri alınmıştır. Platform, hiç
  // kalmadığı parayı kâr yazmaz (canlı siparişte tüm tutar kâr görünüyordu).
  assert.equal(b.platform.reversedBaseKurus, 349900);
  assert.equal(b.platform.unassignedBaseKurus, 0);
  assert.ok(Object.is(b.platform.netKurus, 0), "geri alınmış taban platform neti değil");
  assert.ok(hasWarning(b, "platform gelirine yazılmadı"));
});

// ─── Geri almanın sebebi: yalnızca KAYITLI olan söylenir ────────────────────

/** Kargo geri alma denetim kaydı (yükleyici admin_actions'tan doldurur). */
const SHIP_REVERT_RECORD = {
  cause: "ship_revert",
  // Geri alma yalnızca KARGOLAYAN partnerin hakedişini çevirir; kayıt hangi paya
  // dokunduğunu taşır.
  party: "manufacturer",
  at: "2026-09-12T08:00:00.000Z",
} as const;

test("geri alma sebebi: kayıtlı kargo geri alma, sipariş YENİDEN KARGOLANDIKTAN sonra da aynı sebeptir", () => {
  // Kargo damgası geri almadan sonra yeniden basılır. Sebebi damgadan tahmin
  // eden kart, aynı satıra önce "kargo geri alma" sonra "iade" diyordu.
  for (const shippedAt of [null, SHIPPED_AT]) {
    const ctx = shippedAt === null ? "geri alınmış" : "yeniden kargolanmış";
    const b = derive(
      snap({
        shippedAt,
        manufacturerEarning: earning(249900, { status: "reversed" }),
        earningReversal: SHIP_REVERT_RECORD,
      }),
      ctx
    );
    assert.ok(hasWarning(b, "(kargo kaydı geri alındığı için)"), ctx);
    assert.ok(hasWarning(b, "elle düzeltilir"), ctx);
    assert.ok(!hasWarning(b, "iade"), `iade edilmemiş sipariş iade diye anılmaz: ${ctx}`);
    // Sebep cümlesi değişse de tutar tek satırdan gelir.
    assert.ok(hasWarning(b, formatTry(earning(249900).netKurus)), ctx);
  }
});

test("geri alma sebebi: kayıt yoksa sebep UYDURULMAZ", () => {
  // Eski kart bu şekli (iade değil + kargo damgası yok + partner bağlı) kargo
  // geri alma SANIYORDU; oysa itiraz clawback'i de tam olarak böyle görünür.
  const b = derive(
    snap({
      shippedAt: null,
      manufacturerEarning: earning(249900, { status: "reversed" }),
      earningReversal: null,
    })
  );
  assert.ok(hasWarning(b, "Sebebi kayıtlı değil"));
  assert.ok(!hasWarning(b, "kargo kaydı geri alındığı için"));
  assert.ok(!hasWarning(b, "iade"));
});

test("geri alma sebebi: sebep kaydı OKUNAMADIYSA 'kayıtlı değil' denmez", () => {
  // undefined = bakılmadı/okunamadı. "Kayıtlı değil" demek, bakılmamış bir şey
  // hakkında olumsuz bir iddiadır.
  const b = derive(snap({ manufacturerEarning: earning(249900, { status: "reversed" }) }));
  assert.ok(hasWarning(b, "Sebep kaydı okunamadı"));
  assert.ok(!hasWarning(b, "Sebebi kayıtlı değil"));
});

test("geri alma sebebi: iade edilmiş siparişte sebep iadedir; geri alınmış taban ayrıca raporlanmaz", () => {
  const b = derive(
    snap({
      ...DETACHED,
      manufacturerEarning: earning(249900, { status: "reversed" }),
      earningReversal: null,
    })
  );
  assert.ok(hasWarning(b, "(sipariş iade edildiği için)"));
  // İadede ileriye dönük bekleyen tutar yoktur: para müşteriye döndü.
  assert.equal(b.platform.reversedBaseKurus, 0);
  assert.ok(Object.is(b.platform.netKurus, 0));
  assert.ok(!hasWarning(b, "platform gelirine yazılmadı"));
});

test("geri alma sebebi: iki kayıt da varsa ikisi de yazılır", () => {
  const b = derive(
    snap({
      ...DETACHED,
      manufacturerEarning: earning(249900, { status: "reversed" }),
      earningReversal: SHIP_REVERT_RECORD,
    })
  );
  assert.ok(hasWarning(b, "kayıtlı sebepler: kargo kaydının geri alınması ve iade"));
});

test("KİMLİK: geri alınmış hakediş kimliği bozmaz — tahsilat = partner netleri + platform neti + geri alınmış taban (fuzz)", () => {
  const next = rng(90210);
  for (let i = 0; i < 1500; i++) {
    const totalKurus = next(2_000_000) + 1;
    const bases = allocateBases({
      productionKurus: next(400000),
      paintingKurus: next(400000),
      totalKurus,
    });
    const rate = [3500, 4000, 4500][next(3)];
    const gift = next(3) === 0 ? next(totalKurus) : 0;
    const havale = next(2) === 0 ? Math.floor((totalKurus - gift) * 0.03) : 0;
    const painterAssigned = next(2) === 0;
    // Kargo damgası: geri alma sonrası yeniden kargolanmış olabilir.
    const reshipped = next(2) === 0;
    const recorded = next(2) === 0;
    const me: EarningMoneySnapshot = {
      partnerId: "m1",
      partnerName: "A",
      ...computeEarning(bases.productionKurus, rate),
      rateBps: rate,
      status: "reversed",
      payout: null,
    };
    const s = snap({
      amountKurus: totalKurus,
      productionBaseKurus: bases.productionKurus,
      paintingPriceKurus: bases.paintingKurus,
      giftCardAmountKurus: gift,
      havaleDiscountKurus: havale,
      commissionRateBps: rate,
      painterId: painterAssigned ? "p1" : null,
      shippedAt: reshipped ? SHIPPED_AT : null,
      manufacturerEarning: me,
      earningReversal: recorded ? SHIP_REVERT_RECORD : null,
    });
    const ctx = JSON.stringify({ totalKurus, bases, gift, havale, rate, painterAssigned, reshipped, recorded });
    const b = derive(s, ctx);
    const partnerNet = b.shares.reduce((a, sh) => {
      if (sh.earning) return a + (sh.earning.status === "reversed" ? 0 : sh.earning.netKurus);
      const assigned = sh.party === "manufacturer" ? s.manufacturerId !== null : s.painterId !== null;
      return a + (assigned ? sh.expectedNetKurus : 0);
    }, 0);
    assert.equal(
      partnerNet + b.platform.netKurus + b.platform.reversedBaseKurus,
      b.collection.cashCollectedKurus,
      ctx
    );
    assert.equal(b.platform.reversedBaseKurus, me.grossKurus, ctx);
    // Sebep KAYITTAN gelir; kargo damgasından değil.
    assert.equal(hasWarning(b, "(kargo kaydı geri alındığı için)"), recorded, ctx);
    assert.equal(hasWarning(b, "Sebebi kayıtlı değil"), !recorded, ctx);
  }
});

// ─── Geri alma kaydı: YAZAN ile OKUYAN aynı cümleyi paylaşır ───────────────

const REPO_ROOT = join(import.meta.dirname, "..");
const readSrc = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const SHIP_ROUTE = "src/app/api/admin/orders/[id]/ship/route.ts";
const MONEY_LOADER = "src/lib/services/order-money.ts";
const MANUFACTURER_PANEL = "src/app/manufacturer/orders/[id]/client.tsx";

/** DELETE /ship'in yazdığı denetim notunun aynısı. */
const auditNote = (outcome: ShipRevertEarningOutcome, party: MoneyReversalParty | null) =>
  `${SHIP_REVERT_AUDIT_PREFIX} → "qc_approved". Takip numarası ve kargo firması temizlendi. ` +
  shipRevertEarningAuditSentence(outcome, party) +
  " Gerekçe: yanlış takip numarası";

const NOTE_AT = new Date("2026-09-12T08:00:00.000Z");

test("denetim kaydı: HAKEDİŞE DOKUNMAYAN geri alma sebep sayılmaz (tam cümle okunur)", () => {
  // P2I: "Partner hakedişi zaten geri çevrilmişti" imzası cümlenin devamıyla
  // ("bu geri alma para tarafında hiçbir şeyi değiştirmedi") tam TERSİNİ
  // söylüyordu; kart yine de "kargo kaydı geri alındığı için" diyordu.
  const rows = (outcome: ShipRevertEarningOutcome, party: MoneyReversalParty | null) => [
    { notes: auditNote(outcome, party), createdAt: NOTE_AT },
  ];
  assert.deepEqual(shipRevertCauseFromAuditNotes(rows("reversed", "manufacturer")), {
    cause: "ship_revert",
    party: "manufacturer",
    at: NOTE_AT.toISOString(),
  });
  assert.deepEqual(shipRevertCauseFromAuditNotes(rows("reversed", "painter")), {
    cause: "ship_revert",
    party: "painter",
    at: NOTE_AT.toISOString(),
  });
  for (const outcome of ["already_reversed", "none", "failed"] as const) {
    assert.equal(
      shipRevertCauseFromAuditNotes(rows(outcome, "manufacturer")),
      null,
      `${outcome} bir geri çevirme DEĞİLDİR`
    );
  }
  // İmza, cümlenin devamı onu yalanlayamayacak kadar TAM olmalı.
  for (const other of [
    SHIP_REVERT_EARNING_AUDIT.already_reversed,
    SHIP_REVERT_EARNING_AUDIT.none,
    SHIP_REVERT_EARNING_AUDIT.failed,
  ]) {
    for (const m of SHIP_REVERT_EARNING_REVERSED_MARKERS) {
      assert.ok(!other.includes(m.sentence), `dokunmayan cümle imzayı içeriyor: ${other}`);
      assert.ok(m.sentence.endsWith("."), "imza tam cümledir");
    }
  }
});

test("denetim kaydı: en yeni kayıt kazanır, dokunmayan kayıt atlanır, boş not çökertmez", () => {
  const older = { notes: auditNote("reversed", "manufacturer"), createdAt: NOTE_AT };
  const newerUntouched = {
    notes: auditNote("already_reversed", "manufacturer"),
    createdAt: new Date("2026-09-13T08:00:00.000Z"),
  };
  // Yükleyici en yeniyi önce verir: dokunmayan kayıt atlanır, altındaki gerçek
  // sebep yine bulunur.
  assert.deepEqual(shipRevertCauseFromAuditNotes([newerUntouched, older]), {
    cause: "ship_revert",
    party: "manufacturer",
    at: NOTE_AT.toISOString(),
  });
  // İki gerçek geri alma varsa sebep SONUNCUSUDUR.
  const newerPainter = {
    notes: auditNote("reversed", "painter"),
    createdAt: new Date("2026-09-14T08:00:00.000Z"),
  };
  assert.equal(shipRevertCauseFromAuditNotes([newerPainter, older])?.party, "painter");
  assert.equal(shipRevertCauseFromAuditNotes([]), null);
  assert.equal(shipRevertCauseFromAuditNotes([{ notes: null, createdAt: NOTE_AT }]), null);
  // Zaman damgası okunamasa da sebep kaybolmaz.
  assert.deepEqual(
    shipRevertCauseFromAuditNotes([{ notes: auditNote("reversed", "painter"), createdAt: null }]),
    { cause: "ship_revert", party: "painter", at: null }
  );
});

test("denetim cümlesi TEK kaynaktan: rota yazar, yükleyici okur, ikisi de kopyalamaz", () => {
  const route = readSrc(SHIP_ROUTE);
  const loader = readSrc(MONEY_LOADER);
  assert.ok(route.includes("shipRevertEarningAuditSentence("), "rota cümleyi türetimden almalı");
  assert.ok(
    loader.includes("SHIP_REVERT_EARNING_REVERSED_MARKERS"),
    "yükleyici imzayı türetimden almalı"
  );
  const sentences = [
    ...SHIP_REVERT_EARNING_REVERSED_MARKERS.map((m) => m.sentence),
    SHIP_REVERT_EARNING_AUDIT.already_reversed,
    SHIP_REVERT_EARNING_AUDIT.none,
    SHIP_REVERT_EARNING_AUDIT.failed,
  ];
  for (const file of [SHIP_ROUTE, MONEY_LOADER]) {
    const text = readSrc(file);
    for (const sentence of sentences) {
      assert.ok(!text.includes(sentence), `${file} cümleyi elle kopyalamış: ${sentence}`);
    }
  }
});

// ─── Sebep: tek türetim, doğru PAY ─────────────────────────────────────────

test("sebep türetimi: kayıt yalnızca DOKUNDUĞU payın sebebidir", () => {
  const rec = (party: MoneyReversalParty): MoneyReversalRecord => ({
    cause: "ship_revert",
    party,
    at: NOTE_AT.toISOString(),
  });
  const cause = (
    party: MoneyReversalParty,
    reversal: MoneyReversalRecord | null | undefined,
    refunded = false
  ) => earningReversalCause({ party, reversal, refunded });
  assert.equal(cause("manufacturer", rec("manufacturer")), "ship_revert");
  assert.equal(cause("painter", rec("painter")), "ship_revert");
  // Boyacı kargosunun geri alınması, devirde doğmuş ÜRETİCİ hakedişini açıklamaz.
  assert.equal(cause("manufacturer", rec("painter")), "unrecorded");
  assert.equal(cause("painter", rec("manufacturer")), "unrecorded");
  assert.equal(cause("manufacturer", rec("manufacturer"), true), "ship_revert_and_refund");
  assert.equal(cause("manufacturer", rec("painter"), true), "refund");
  assert.equal(cause("manufacturer", null), "unrecorded");
  // undefined = kayda BAKILAMADI; "kayıtlı değil" olumsuz bir iddia olurdu.
  assert.equal(cause("manufacturer", undefined), "unreadable");
  assert.equal(cause("manufacturer", undefined, true), "refund");
});

test("sebep türetimi: boyacının geri alınan kargosu üreticinin satırına sebep yazmaz", () => {
  const b = derive(
    snap({
      painterId: "p1",
      painterName: "Boya Evi",
      painterStatus: "shipped",
      shippedAt: SHIPPED_AT,
      manufacturerEarning: earning(249900, { status: "reversed" }),
      painterEarning: earning(100000, {
        partnerId: "p1",
        partnerName: "Boya Evi",
        status: "reversed",
      }),
      earningReversal: { cause: "ship_revert", party: "painter", at: NOTE_AT.toISOString() },
    })
  );
  assert.ok(hasWarning(b, "Boyacı hakedişi geri alındı (kargo kaydı geri alındığı için)"));
  assert.ok(hasWarning(b, "Üretici hakedişi geri alındı — "));
  assert.ok(
    !hasWarning(b, "Üretici hakedişi geri alındı (kargo kaydı geri alındığı için)"),
    "dokunulmamış pay için sebep uydurulmaz"
  );
  assert.ok(hasWarning(b, "Sebebi kayıtlı değil"));
});

// ─── Partner ekranı: aynı sebep, partnere söylenen hâli ─────────────────────

test("partner cümlesi: üretici paneli sebebi admin kartıyla AYNI türetimden alır", () => {
  const panel = readSrc(MANUFACTURER_PANEL);
  assert.ok(
    panel.includes("EARNING_REVERSAL_PARTNER_SENTENCES["),
    "panel cümleyi paylaşılan haritadan almalı"
  );
  assert.ok(panel.includes("earningReversalCause("), "panel sebebi tek türetimden sormalı");
  // Eski sabit cümle: kargo kaydı geri alındığında üreticiye olmamış bir iadeyi
  // ya da itirazı anlatıyordu. Aranan şey CÜMLENİN KENDİSİDİR; parçası (dosyanın
  // kendi açıklamasında da geçebilir) bir kopya kanıtı değildir.
  assert.ok(
    !panel.includes("Bu siparişin hak edişi geri alındı (iade / itiraz); ödenmeyecek."),
    "sabitlenmiş sebep cümlesi geri gelmiş"
  );
  const causes: EarningReversalCause[] = [
    "ship_revert_and_refund",
    "ship_revert",
    "refund",
    "unrecorded",
    "unreadable",
  ];
  const seen = new Set<string>();
  for (const c of causes) {
    const line = EARNING_REVERSAL_PARTNER_SENTENCES[c];
    assert.ok(line && line.length > 20, `partner cümlesi eksik: ${c}`);
    assert.ok(!seen.has(line), `iki sebep aynı cümleyi veriyor: ${c}`);
    seen.add(line);
  }
  // Sebebi bilinmeyen iki hâl, bilmediğini SÖYLER.
  assert.ok(EARNING_REVERSAL_PARTNER_SENTENCES.unrecorded.includes("kayıtlı değil"));
  assert.ok(EARNING_REVERSAL_PARTNER_SENTENCES.unreadable.includes("okunamadı"));
  // Kargo geri almada partnere iade/itiraz denmez.
  for (const c of ["ship_revert", "unrecorded", "unreadable"] as const) {
    assert.ok(!EARNING_REVERSAL_PARTNER_SENTENCES[c].includes("iade edildiği"));
  }
  // Admin ile partner AYNI sebebi anlatır (aynı olayda iki panel ayrışmaz).
  const adminLine = earningReversalAdminWarning({
    cause: "ship_revert",
    who: "Üretici",
    amountText: formatTry(149940),
  });
  assert.ok(adminLine.includes("kargo kaydı geri alındığı için"));
  assert.ok(EARNING_REVERSAL_PARTNER_SENTENCES.ship_revert.includes("kargo kaydı geri alındığı için"));
});

// ─── İade: yalnızca GERÇEKTEN ödenen zarardır ───────────────────────────────

test("ödenmişlik tek tanım: satır 'paid' ya da girdiği ödeme partisi ödendi", () => {
  assert.equal(isEarningPaidOut(null), false);
  assert.equal(isEarningPaidOut(undefined), false);
  assert.equal(isEarningPaidOut(earning(249900, { status: "pending" })), false);
  assert.equal(isEarningPaidOut(earning(249900, { status: "reversed" })), false);
  // Partiye girmiş ama partisi ödenmemiş satır geri çevrilebilir → ödenmiş değil.
  assert.equal(
    isEarningPaidOut(
      earning(249900, {
        status: "pending",
        payout: { id: "po2", status: "pending", reference: null, paidAt: null },
      })
    ),
    false
  );
  assert.equal(isEarningPaidOut(earning(249900, { status: "paid" })), true);
  assert.equal(isEarningPaidOut(earning(249900, { status: "pending", payout: PAID_PAYOUT })), true);
});

test("iade: BEKLEYEN hakediş ödenmiş sayılmaz — platform zararı değil, açık risk", () => {
  // P2I: iadenin geri çevirmeyi kaçırdığı satır "ödenmiş" sayılıp platform
  // zararı yazılıyordu; aynı kartın pay bloğu ise doğru olanı ("ödenmedi,
  // partiye girerse ödenir") söylüyordu.
  for (const payout of [null, { id: "po2", status: "pending", reference: null, paidAt: null }]) {
    const pending = earning(249900, { status: "pending", payout });
    const b = derive(snap({ ...DETACHED, manufacturerEarning: pending }), JSON.stringify(payout));
    assert.ok(Object.is(b.platform.netKurus, 0), "ödenmemiş tutar platform zararı değil");
    assert.ok(!hasWarning(b, "platform zararı"));
    assert.ok(hasWarning(b, "geri alınmamış bekleyen partner hakedişi var"));
    assert.ok(hasWarning(b, formatTry(pending.netKurus)));
  }
});

test("iade: ödenmiş zarar ile bekleyen risk aynı kartta AYRI satırlardır", () => {
  const paid = earning(249900, { status: "paid", payout: PAID_PAYOUT });
  const pendingPainter = earning(100000, {
    partnerId: "p1",
    partnerName: "Boya Evi",
    status: "pending",
  });
  const b = derive(
    snap({ ...DETACHED, painterId: null, manufacturerEarning: paid, painterEarning: pendingPainter })
  );
  assert.equal(b.platform.netKurus, -paid.netKurus, "zarar YALNIZ ödenen tutardır");
  assert.ok(hasWarning(b, `İadeye rağmen ödenmiş partner hakedişi geri alınmadı: ${formatTry(paid.netKurus)}`));
  assert.ok(
    hasWarning(b, `geri alınmamış bekleyen partner hakedişi var: ${formatTry(pendingPainter.netKurus)}`)
  );
});

test("iade: geri çevrilmiş satır ne zarardır ne risk", () => {
  const b = derive(snap({ ...DETACHED, manufacturerEarning: earning(249900, { status: "reversed" }) }));
  assert.ok(Object.is(b.platform.netKurus, 0));
  assert.ok(!hasWarning(b, "platform zararı"));
  assert.ok(!hasWarning(b, "geri alınmamış bekleyen"));
});

// ─── Biçim ─────────────────────────────────────────────────────────────────

test("döküm JSON'a birebir serileşir (sunucu → istemci): fiyat satırları ve kapanmış paylar dahil", () => {
  const fixtures = [
    snap({ painterId: "p1", upsells: ["gift_wrap"], upsellAmountKurus: 2900, amountKurus: 352800, productionBaseKurus: 252800 }),
    balloonSnap(),
    snap({ ...DETACHED }),
  ];
  for (const s of fixtures) {
    const b = deriveOrderMoneyBreakdown(s);
    // deepStrictEqual sayıları Object.is ile karşılaştırır: -0 JSON'da 0 olur ve burada yakalanır.
    assert.deepEqual(JSON.parse(JSON.stringify(b)), b);
  }
});

const adjustment = (over: Partial<AdjustmentMoneySnapshot> = {}): AdjustmentMoneySnapshot => ({
  id: "a1", partnerKind: "manufacturer", partnerId: "m1", partnerName: "Atölye A",
  kind: "reprint", netKurus: 2000, status: "pending", activePending: true,
  sourceKind: null, sourceId: null, reason: "Platform funded reprint", createdAt: SHIPPED_AT,
  settledAt: null, voidedAt: null, payoutId: null, settlementKind: null,
  ...over,
});

test("manual credits and source-approved offsets change platform net without rewriting earnings", () => {
  const original = earning(249900);
  const s = snap({ manufacturerEarning: original });
  const before = deriveOrderMoneyBreakdown(s);
  const entries = [adjustment(), adjustment({ id: "offset", kind: "unpaid_offset", netKurus: -500, sourceKind: "manufacturer_earning", sourceId: "earning1" })];
  const after = deriveOrderMoneyBreakdown({ ...s, adjustments: entries });
  assert.equal(after.platform.netKurus, before.platform.netKurus - 1500);
  assert.equal(after.platform.adjustmentNetKurus, 1500);
  assert.deepEqual(after.shares, before.shares);
  assert.deepEqual(after.adjustments, entries);
  assert.deepEqual(original, earning(249900));
});

test("batched valid credits count, voided and missing-source pending offsets do not", () => {
  const s = snap();
  const before = deriveOrderMoneyBreakdown(s);
  const after = deriveOrderMoneyBreakdown({ ...s, adjustments: [
    adjustment({ payoutId: "pending-batch" }),
    adjustment({ id: "void", status: "voided", netKurus: 9000, activePending: false }),
    adjustment({ id: "missing", kind: "unpaid_offset", netKurus: -8000, sourceKind: "manufacturer_earning", sourceId: "missing", activePending: false }),
  ] });
  assert.equal(after.platform.netKurus, before.platform.netKurus - 2000);
  assert.equal(after.adjustments?.length, 3, "ineligible rows stay visible as history");
});

test("settled adjustments count even when their source is no longer eligible", () => {
  const s = snap();
  const before = deriveOrderMoneyBreakdown(s);
  const after = deriveOrderMoneyBreakdown({ ...s, adjustments: [
    adjustment({ status: "settled", activePending: false, payoutId: "paid-batch", settledAt: SHIPPED_AT }),
  ] });
  assert.equal(after.platform.netKurus, before.platform.netKurus - 2000);
});

test("refund separates actual settled adjustments from pending independent compensation risk", () => {
  const original = earning(249900, { status: "paid", payout: PAID_PAYOUT });
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED, manufacturerEarning: original, adjustments: [
    adjustment({ id: "paid-credit", status: "settled", activePending: false, netKurus: 2000, payoutId: "paid-credit-batch", settledAt: SHIPPED_AT }),
    adjustment({ id: "paid-offset", status: "settled", activePending: false, kind: "unpaid_offset", netKurus: -1000, sourceKind: "manufacturer_earning", sourceId: "earning1", payoutId: "po1", settledAt: SHIPPED_AT }),
    adjustment({ id: "owed-credit", netKurus: 3000 }),
    adjustment({ id: "owed-offset", kind: "unpaid_offset", netKurus: -500, sourceKind: "adjustment", sourceId: "owed-credit" }),
    adjustment({ id: "blocked-offset", kind: "unpaid_offset", netKurus: -6000, activePending: false, sourceKind: "manufacturer_earning", sourceId: "refunded" }),
  ] }));
  assert.equal(b.platform.netKurus, -original.netKurus - 1000);
  assert.equal(b.platform.adjustmentNetKurus, 1000);
  assert.equal(b.platform.pendingAdjustmentNetKurus, 2500);
  assert.ok(hasWarning(b, "henüz ödenmedi"));
});

test("zero netting on a refunded order reports zero cash loss, not the original earning as paid cash", () => {
  const original = earning(10000, { status: "paid", payout: { ...PAID_PAYOUT, reference: null, settlementKind: "netting" } });
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED, manufacturerEarning: original, adjustments: [
    adjustment({ kind: "unpaid_offset", netKurus: -6000, status: "settled", activePending: false,
      sourceKind: "manufacturer_earning", sourceId: "earning1", payoutId: "po1", settledAt: SHIPPED_AT, settlementKind: "netting" }),
  ] }));
  assert.ok(Object.is(b.platform.netKurus, 0));
  assert.ok(!hasWarning(b, "platform zararı"));
  assert.equal(b.shares[0].earning?.netKurus, 6000);
});

test("legacy omitted adjustments have the same money as an explicit empty history", () => {
  assert.deepEqual(deriveOrderMoneyBreakdown(snap()), deriveOrderMoneyBreakdown(snap({ adjustments: [] })));
});

const renderMoney = (money: OrderMoneyBreakdown | null) => {
  const props = { locale: "tr" as const, children: createElement(MoneyBreakdownCard, { money, loc: "tr" }) };
  return renderToStaticMarkup(createElement(LocaleProvider, props));
};

test("money card renders separate compensation history and pending refund liability", () => {
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED, adjustments: [adjustment()] }));
  const html = renderMoney(b);
  assert.ok(html.includes("Ek partner düzeltmeleri"));
  assert.ok(html.includes("Platform funded reprint"));
  assert.ok(html.includes("Bekleyen ek partner borcu (henüz ödenmedi)"));
});

test("netting and unavailable money cannot be displayed as a bank payment or a zero balance", () => {
  const original = earning(10000, { status: "paid", payout: { ...PAID_PAYOUT, reference: null, settlementKind: "netting" } });
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED, manufacturerEarning: original, adjustments: [
    adjustment({ kind: "unpaid_offset", netKurus: -6000, status: "settled", activePending: false,
      sourceKind: "manufacturer_earning", sourceId: "earning1", payoutId: "po1", settledAt: SHIPPED_AT, settlementKind: "netting" }),
  ] }));
  const html = renderMoney(b);
  assert.ok(html.includes("Mahsupla kapandı"));
  assert.ok(!html.includes("bu hakediş zaten ödenmişti"));
  const missing = renderMoney(null);
  assert.ok(missing.includes("Para dökümü hesaplanamadı"));
  assert.ok(!missing.includes("Platform net"));
});

test("partial cash returns reduce revenue and platform net without changing sale, tender or original earnings", () => {
  const source = snap({ amountKurus: 10000, productionBaseKurus: 10000, paintingPriceKurus: 0,
    giftCardAmountKurus: 2000, havaleDiscountKurus: 500, manufacturerEarning: earning(10000) });
  const before = deriveOrderMoneyBreakdown(source);
  const after = deriveOrderMoneyBreakdown({ ...source, refunds: [
    { kind: "refund", cashKurus: 3000, giftKurus: 0 },
    { kind: "refund", cashKurus: 1000, giftKurus: 500 },
  ] });
  assert.equal(after.collection.cashCollectedKurus, 7500);
  assert.equal(after.collection.cashReturnedKurus, 4000);
  assert.equal(after.collection.giftReturnedKurus, 500);
  assert.equal(after.collection.cashRemainingKurus, 3500);
  assert.equal(after.collection.revenueKurus, 3500);
  assert.equal(after.platform.netKurus, before.platform.netKurus - 4000);
  assert.deepEqual(after.shares, before.shares);
  assert.deepEqual(after.lines, before.lines);
});

test("gift return is restored tender and never a second cash or invoice discount", () => {
  const source = snap({ giftCardAmountKurus: 2000 });
  const before = deriveOrderMoneyBreakdown(source);
  const after = deriveOrderMoneyBreakdown({ ...source, refunds: [{ kind: "refund", cashKurus: 0, giftKurus: 1200 }] });
  assert.equal(after.collection.giftReturnedKurus, 1200);
  assert.equal(after.collection.giftCardKurus, 2000);
  assert.equal(after.collection.revenueKurus, before.collection.revenueKurus);
  assert.equal(after.platform.netKurus, before.platform.netKurus);
});

test("cancelled succeeded cash is refund-due liability, never earned platform profit", () => {
  const b = deriveOrderMoneyBreakdown(snap({ status: "rejected", manufacturerId: null,
    refunds: [{ kind: "cancellation", cashKurus: 0, giftKurus: 0 }, { kind: "refund", cashKurus: 10000, giftKurus: 0 }],
    adjustments: [adjustment({ netKurus: 3000 })] }));
  assert.equal(b.collection.cashRemainingKurus, 339900);
  assert.equal(b.collection.cashRefundDueKurus, 339900);
  assert.equal(b.collection.revenueKurus, 0);
  assert.equal(b.platform.netKurus, 0);
  assert.equal(b.platform.pendingAdjustmentNetKurus, 3000);
  assert.ok(b.shares.every(s => s.voided === "cancelled" && !s.accrualMissing));
  const html = renderMoney(b);
  assert.ok(html.includes("İade bekleyen nakit yükümlülüğü"));
  assert.ok(!html.includes("İade edildi — hakediş oluşmaz"));
});

test("actual full return retains paid compensation and independent pending reprint risk", () => {
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED,
    manufacturerEarning: earning(10000, { status: "paid", payout: PAID_PAYOUT }),
    refunds: [{ kind: "refund", cashKurus: 349900, giftKurus: 0 }],
    adjustments: [adjustment({ netKurus: 3000 })],
  }));
  assert.equal(b.collection.cashRemainingKurus, 0);
  assert.equal(b.collection.legacyRefundUnknown, false);
  assert.equal(b.platform.netKurus, -6000);
  assert.equal(b.platform.pendingAdjustmentNetKurus, 3000);
});

test("cancelled paid netting has zero retained cash cost and still owes the customer's cash", () => {
  const b = deriveOrderMoneyBreakdown(snap({ status: "rejected",
    manufacturerEarning: earning(10000, { status: "paid", payout: { ...PAID_PAYOUT, settlementKind: "netting", reference: null } }),
    adjustments: [adjustment({ netKurus: -6000, kind: "unpaid_offset", status: "settled", activePending: false,
      sourceKind: "manufacturer_earning", sourceId: "earning1", settlementKind: "netting" })],
  }));
  assert.equal(b.platform.netKurus, 0);
  assert.equal(b.collection.cashRefundDueKurus, 349900);
  assert.equal(b.collection.revenueKurus, 0);
});

test("legacy evidence never fabricates a current cash return or a known remaining balance", () => {
  const b = deriveOrderMoneyBreakdown(snap({ ...DETACHED, refunds: [{ kind: "legacy_evidence", cashKurus: 349900, giftKurus: 0 }] }));
  assert.equal(b.collection.cashReturnedKurus, 0);
  assert.equal(b.collection.cashRemainingKurus, null);
  assert.equal(b.collection.legacyRefundUnknown, true);
  const html = renderMoney(b);
  assert.ok(html.includes("Eski iadenin gerçekleşen tutarı bilinmiyor"));
});

test("return facts reject invalid amounts instead of publishing a plausible zero balance", () => {
  assert.throws(() => deriveOrderMoneyBreakdown(snap({ refunds: [{ kind: "refund", cashKurus: 350000, giftKurus: 0 }] })), /return/i);
  assert.throws(() => deriveOrderMoneyBreakdown(snap({ refunds: [{ kind: "refund", cashKurus: -1, giftKurus: 0 }] })), /return/i);
});

test("cancelled unknown payment basis stays unknown without losing actual returns or retained partner effects", () => {
  const b = deriveOrderMoneyBreakdown(snap({ status: "rejected", amountKurus: 6000,
    productionBaseKurus: 6000, paintingPriceKurus: 0,
    manufacturerEarning: earning(10000, { status: "paid", payout: PAID_PAYOUT }),
    refunds: [{ kind: "cancellation", cashKurus: 0, giftKurus: 0, cancellationCashUnknown: true },
      { kind: "refund", cashKurus: 1000, giftKurus: 0 }],
    adjustments: [adjustment({ netKurus: 3000 })],
  }));
  assert.equal(b.collection.cashRefundDueKurus, null);
  assert.equal(b.collection.cashRemainingKurus, null);
  assert.equal(b.collection.cashCollectedKurus, 6000);
  assert.equal(b.collection.cashReturnedKurus, 1000);
  assert.equal(b.collection.revenueKurus, 0);
  assert.equal(b.collection.legacyRefundUnknown, false);
  assert.equal(b.platform.netKurus, -6000);
  assert.equal(b.platform.pendingAdjustmentNetKurus, 3000);
  const html = renderMoney(b);
  assert.match(html, /İade bekleyen nakit yükümlülüğü<\/dt><dd[^>]*>Bilinmiyor<\/dd>/);
  assert.match(html, /İadeler sonrası kalan nakit<\/dt><dd[^>]*>Bilinmiyor<\/dd>/);
  assert.ok(!html.includes("Eski iadenin gerçekleşen tutarı bilinmiyor"));
  assert.ok(!html.includes("Platform net (iptal yükümlülüğü ayrıldı)"));
});

test("unknown cancellation flag does not change other record kinds or legacy omitted metadata", () => {
  for (const kind of ["refund", "legacy_evidence"] as const) {
    const b = deriveOrderMoneyBreakdown(snap({ refunds: [{ kind, cashKurus: 0, giftKurus: 0, cancellationCashUnknown: true }] }));
    assert.equal(b.collection.cashRemainingKurus, 349900);
    assert.equal(b.collection.cashRefundDueKurus, 0);
  }
  for (const cancellationCashUnknown of [undefined, false]) {
    const b = deriveOrderMoneyBreakdown(snap({ status: "rejected",
      refunds: [{ kind: "cancellation", cashKurus: 0, giftKurus: 0, cancellationCashUnknown }] }));
    assert.equal(b.collection.cashRefundDueKurus, 349900);
  }
});

test("formatTry Türkçe biçim, eksi başta", () => {
  assert.equal(formatTry(123456), "₺1.234,56");
  assert.equal(formatTry(-500), "−₺5,00");
  assert.equal(formatTry(0), "₺0,00");
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
