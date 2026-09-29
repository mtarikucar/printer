/**
 * Hediye kartı rezervasyon KARARI: altın değerler + `/api/orders` denkliği.
 * DB yok, Redis yok.
 *
 * Karar modülü (`src/lib/config/gift-card-reservation.ts`) kartın rezerve
 * edilebilir OLUP OLMADIĞINI söyler; rezerve edilecek TUTARI söylemez (o
 * `quote-tender.ts`in işi). Bu test iki şeyi çiviler:
 *
 * 1. `/api/orders`ın satır içi kapılarının (kilitli kart bloğu) her dalı:
 *    bakiye 0, kullanılamaz durum, süresi geçmiş kart, kullanım limiti; ve
 *    kabul dalında yeni bakiye/durum. Reddin SIRASI da sınanır — hem süresi
 *    geçmiş hem limiti dolmuş bir kart müşteriye HANGİ cümleyi görecek, o
 *    sıraya bağlı.
 * 2. Kullanılamaz DURUM KÜMESİNİN `/api/orders` ile aynı olduğu: küme orada
 *    satır içi yazılı ve bu dosya onu kaynaktan çıkarıp karşılaştırır. İki
 *    kopya bir süre yan yana yaşayacak (route.ts bu programda DEĞİŞTİRİLMİYOR)
 *    ve kaymaları "aynı kart iki yolda farklı davranır" demek olurdu.
 * 3. Sıranın ÜRETİMDE koşan yolda da geçerli olduğu: rezervasyon servisi
 *    (`src/lib/services/gift-card-reservation.ts`) karardan önce kendi red
 *    kapısını KURMUYOR. Kursa, yukarıdaki sıra vakaları yalnız saf modülü
 *    kapsadığı için yanlış güven verirdi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GIFT_CARD_UNUSABLE_STATUSES,
  giftCardReservationDecision,
  type GiftCardReservationInput,
} from "../src/lib/config/gift-card-reservation";

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

const NOW = new Date("2026-09-29T12:00:00.000Z");
const LATER = new Date("2026-12-31T00:00:00.000Z");

/** Kabul edilen bir kart; vakalar yalnız ilgilendikleri alanı değiştirir. */
function args(over: {
  card?: Partial<GiftCardReservationInput["card"]>;
  liveUses?: number;
  reserveKurus?: number;
  now?: Date;
} = {}): GiftCardReservationInput {
  return {
    card: {
      balanceKurus: 50_000,
      status: "active",
      expiresAt: LATER,
      maxRedemptions: null,
      ...over.card,
    },
    liveUses: over.liveUses ?? 0,
    reserveKurus: over.reserveKurus ?? 20_000,
    now: over.now ?? NOW,
  };
}

console.log("hediye kartı rezervasyon kararı — altın değerler");

test("kısmi kullanım: bakiye düşer, durum partially_used olur", () => {
  assert.deepEqual(giftCardReservationDecision(args()), {
    ok: true,
    newBalanceKurus: 30_000,
    newStatus: "partially_used",
  });
});

test("bakiyenin tamamı rezerve edilirse durum fully_used olur", () => {
  assert.deepEqual(giftCardReservationDecision(args({ reserveKurus: 50_000 })), {
    ok: true,
    newBalanceKurus: 0,
    newStatus: "fully_used",
  });
});

test("bakiyesi 0 olan kart reddedilir (insufficient)", () => {
  // `reserveKurus` bu dalda hiç okunmaz: bakiye kapısı ondan ÖNCE gelir, yoksa
  // "0 bakiyeden 1 kuruş rezerve" bir programlama hatası olarak patlardı ve
  // müşteri 400 yerine 500 görürdü.
  assert.deepEqual(
    giftCardReservationDecision(args({ card: { balanceKurus: 0 }, reserveKurus: 1 })),
    { ok: false, code: "insufficient" }
  );
});

test("kullanılamaz durumların HEPSİ reddedilir", () => {
  for (const status of GIFT_CARD_UNUSABLE_STATUSES) {
    assert.deepEqual(
      giftCardReservationDecision(args({ card: { status } })),
      { ok: false, code: "insufficient" },
      status
    );
  }
});

test("bilinmeyen bir durum kapıyı GEÇMEZ", () => {
  // Kapalı liste "kullanılabilir" tarafta durur: `gift_cards.status`a yarın
  // eklenecek bir değer (ör. `refunded`) sessizce harcanabilir olmamalı.
  assert.deepEqual(giftCardReservationDecision(args({ card: { status: "refunded" } })), {
    ok: false,
    code: "insufficient",
  });
});

test("kısmen kullanılmış kart harcanabilir", () => {
  assert.equal(
    giftCardReservationDecision(args({ card: { status: "partially_used" } })).ok,
    true
  );
});

test("süresi GEÇMİŞ kart reddedilir, tam o an dolan kart GEÇER", () => {
  assert.deepEqual(
    giftCardReservationDecision(
      args({ card: { expiresAt: new Date(NOW.getTime() - 1) } })
    ),
    { ok: false, code: "insufficient" }
  );
  // `/api/orders` sınırı KATI karşılaştırır (`expiresAt < now`): son saniyesinde
  // ödeme yapan müşterinin kartı geçerlidir.
  assert.equal(giftCardReservationDecision(args({ card: { expiresAt: NOW } })).ok, true);
});

test("kullanım limiti dolmuş kart reddedilir (limit_reached)", () => {
  assert.deepEqual(
    giftCardReservationDecision(args({ card: { maxRedemptions: 2 }, liveUses: 2 })),
    { ok: false, code: "limit_reached" }
  );
  assert.equal(
    giftCardReservationDecision(args({ card: { maxRedemptions: 2 }, liveUses: 1 })).ok,
    true
  );
});

test("limit YOKSA kullanım sayısı hiç engellemez", () => {
  assert.equal(
    giftCardReservationDecision(args({ card: { maxRedemptions: null }, liveUses: 99 })).ok,
    true
  );
});

test("red SIRASI: hem süresi geçmiş hem limiti dolmuş kart insufficient der", () => {
  // Müşterinin göreceği cümle bu sıraya bağlı ve `/api/orders` ile aynı olmalı:
  // bakiye/durum/süre kapıları limitten ÖNCE gelir.
  assert.deepEqual(
    giftCardReservationDecision(
      args({
        card: { expiresAt: new Date(NOW.getTime() - 1), maxRedemptions: 1 },
        liveUses: 5,
      })
    ),
    { ok: false, code: "insufficient" }
  );
});

console.log("hediye kartı rezervasyon kararı — programlama hataları");

test("bakiyeden BÜYÜK rezervasyon isteği patlar (sessizce kırpılmaz)", () => {
  // Zincir (`computeTender`) tutarı KİLİTLİ bakiyeden türetir; bakiyeyi aşan bir
  // istek bayat bir bakiyeyle hesaplandığı anlamına gelir. Kırpmak, taslağa
  // kartın karşılamadığı bir tutar yazmak olurdu.
  assert.throws(
    () => giftCardReservationDecision(args({ reserveKurus: 50_001 })),
    /bakiye/i
  );
});

test("sıfır / negatif / kesirli rezervasyon isteği patlar", () => {
  for (const reserveKurus of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => giftCardReservationDecision(args({ reserveKurus })),
      RangeError,
      String(reserveKurus)
    );
  }
});

test("negatif / kesirli kullanım sayısı patlar", () => {
  for (const liveUses of [-1, 0.5]) {
    assert.throws(
      () => giftCardReservationDecision(args({ card: { maxRedemptions: 3 }, liveUses })),
      RangeError,
      String(liveUses)
    );
  }
});

console.log("hediye kartı rezervasyon kararı — /api/orders denkliği");

const ROUTE_PATH = "src/app/api/orders/route.ts";
const routeSource = fs.readFileSync(ROUTE_PATH, "utf8");

test("kullanılamaz durum kümesi route.ts ile AYNI", () => {
  // Kaynaktan çıkarım: elle kopyalanmış bir liste bugün doğru olsa da yarın
  // sessizce kayardı. Çıkarım boş dönerse test PATLAR (route.ts satır içi
  // kopyasını kaybetmişse bu vaka silinmeli, susturulmamalı).
  const statuses = [...routeSource.matchAll(/card\.status === "([a-z_]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(
    statuses.length > 0,
    `${ROUTE_PATH} içinde satır içi kart durumu kapısı bulunamadı — ` +
      "kopya yeni servise taşındıysa bu vaka kaldırılmalı"
  );
  assert.deepEqual(
    [...new Set(statuses)].sort(),
    [...GIFT_CARD_UNUSABLE_STATUSES].sort(),
    "kullanılamaz durum kümesi iki yolda ayrıştı"
  );
});

test("route.ts'in limit kapısı da AYNI karşılaştırma", () => {
  assert.match(
    routeSource,
    /redemptionCount >= card\.maxRedemptions/,
    "limit kapısı route.ts'te bu biçimde duruyor olmalı"
  );
});

console.log("hediye kartı rezervasyon kararı — reddin TEK yetkilisi");

// Sıra ancak ÜRETİMDE koşan yolda (servis) da geçerliyse bir şey ifade eder:
// servis kendi kapısını kurarsa yukarıdaki sıra vakaları yanlış güven verir.
// Davranış çivisi QA veritabanı isteyen `scripts/test-quote-checkout-db.ts`te
// (`rezervasyon reddinin SIRASI …`, servis doğrudan çağrılıyor); buradaki
// KAYNAK pini her `test:unit` turunda koşar ve kapının geri gelmesini yakalar.
const SERVICE_PATH = "src/lib/services/gift-card-reservation.ts";
const serviceSource = fs.readFileSync(SERVICE_PATH, "utf8");

test("servis, karardan ÖNCE hiçbir red kapısı kurmaz (not_found dışında)", () => {
  const decisionAt = serviceSource.indexOf("giftCardReservationDecision({");
  assert.ok(decisionAt > 0, `${SERVICE_PATH} kararı çağırmıyor`);
  const early = [
    ...serviceSource.matchAll(/throw new GiftCardReservationError\("([a-z_]+)"\)/g),
  ]
    .filter((m) => m.index! < decisionAt)
    .map((m) => m[1]);
  assert.deepEqual(
    early,
    ["not_found"],
    "karardan önce atılan tek red `not_found` olabilir — başka bir kapı red " +
      "SIRASINI atlar (ör. limit) ve müşteri `/api/orders` ile farklı cümle görür"
  );
});

test("servisin reddi kararın kodundan geliyor", () => {
  assert.match(
    serviceSource,
    /if \(!decision\.ok\) throw new GiftCardReservationError\(decision\.code\);/,
    "red kodu kararın kendisinden okunmalı (ikinci bir eşleme kayabilir)"
  );
});

console.log(
  failures === 0
    ? "\n✅ gift-card-reservation: all checks passed"
    : `\n❌ gift-card-reservation: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
