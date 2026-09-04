import assert from "node:assert/strict";
import {
  WORKSHOP_FIGURE_PRICE_KURUS,
  WORKSHOP_COMMISSION_TIERS,
  workshopCommissionRateBps,
  workshopCommissionLadderLines,
  deriveSessionDates,
  WORKSHOP_JOIN_CLOSES_DAYS_BEFORE,
  WORKSHOP_DELIVER_DAYS_BEFORE,
  WORKSHOP_SEAT_HOLD_HOURS,
  assessSessionRisk,
  WORKSHOP_SHIP_PENDING_EXCLUDED_STATUSES,
  WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES,
  WORKSHOP_CANCEL_SHIPPED_STATUSES,
  participantCancelDisposition,
  seatReturnsToPool,
  sessionCancellable,
  WORKSHOP_SESSION_UNCANCELLABLE_STATUSES,
  WORKSHOP_SESSION_STATUSES,
  WORKSHOP_BATCH_EXCLUDED_STATUSES,
  WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES,
  WORKSHOP_ORPHAN_HOLD_REPORT_DAYS,
  orderInBatch,
} from "../src/lib/config/workshop";
import { MANUFACTURER_ONBOARDING_TR } from "../src/lib/content/manufacturer-onboarding";
import { MANUFACTURER_CONTRACT_VERSION } from "../src/lib/config/contract-versions";
import { CARD_DEADLINE_HOURS } from "../src/lib/config/payment";
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

// ─── Koltuk tutma süresi ────────────────────────────────────────────────────
// Ödeme başlatıldıktan sonra koltuğun tutulduğu süre. Bu, ödeme gelmezse
// koltuğu havuza döndüren destek işinin gecikmesidir.

test("koltuk tutma süresi 6 saattir", () => {
  assert.equal(WORKSHOP_SEAT_HOLD_HOURS, 6);
});

test("koltuk tutma süresi kart taslağının süresini KULLANMAZ", () => {
  // CARD_DEADLINE_HOURS 72 saat. Katılım penceresi toplamda 5 gün olduğu için
  // 72 saatlik tutma, ilk gün terk edilen koltuğu dördüncü güne kadar ölü
  // bırakır — ~20 kişilik bir seansta kontenjanı fiilen yok eder.
  assert.ok(
    WORKSHOP_SEAT_HOLD_HOURS < CARD_DEADLINE_HOURS,
    "atölye koltuğu kart taslağından önce serbest kalmalı"
  );
  // Terk edilen koltuk AYNI iş günü içinde havuza dönmeli…
  assert.ok(WORKSHOP_SEAT_HOLD_HOURS <= 12);
  // …ama yarıda kalan bir mobil ödemeyi kesecek kadar kısa olmamalı.
  assert.ok(WORKSHOP_SEAT_HOLD_HOURS >= 1);
});

test("koltuk tutma süresi katılım penceresinin küçük bir dilimidir", () => {
  const joinWindowHours = WORKSHOP_JOIN_CLOSES_DAYS_BEFORE * 24;
  assert.ok(
    WORKSHOP_SEAT_HOLD_HOURS * 4 < joinWindowHours,
    "tutma süresi katılım penceresinin dörtte birinden kısa olmalı"
  );
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

// Üreticiye gönderilen bildirimdeki merdiven tablosu. Elle yazılmış bir tablo,
// WORKSHOP_COMMISSION_TIERS değiştiği gün sessizce yalan söyler; bu yüzden metin
// merdivenden ÜRETİLİR ve testi merdivenin kendisiyle karşılaştırılır.

test("merdiven tablosu üreticinin payını satır satır yazar", () => {
  assert.deepEqual(workshopCommissionLadderLines(), [
    "1–2 sipariş → üretici payı %60",
    "3–5 sipariş → üretici payı %55",
    "6–10 sipariş → üretici payı %50",
    "11–15 sipariş → üretici payı %45",
    "16+ sipariş → üretici payı %40",
  ]);
});

test("tablodaki her satır merdivenin gerçek oranını gösterir", () => {
  const lines = workshopCommissionLadderLines();
  assert.equal(lines.length, WORKSHOP_COMMISSION_TIERS.length);
  WORKSHOP_COMMISSION_TIERS.forEach((tier, i) => {
    // Satırdaki yüzde, o kademenin ilk sipariş adedinde merdivenin döndürdüğü
    // orandan hesaplanan üretici payı olmalı.
    const share = (10000 - workshopCommissionRateBps(tier.minOrders)) / 100;
    assert.ok(
      lines[i].includes(`%${share}`),
      `${i}. satır ${share} payını göstermiyordu: ${lines[i]}`
    );
    assert.ok(lines[i].startsWith(String(tier.minOrders)), lines[i]);
  });
});

test("son kademe açık uçludur, aradakiler kapalı aralık", () => {
  const lines = workshopCommissionLadderLines();
  assert.ok(lines[lines.length - 1].startsWith("16+"), lines[lines.length - 1]);
  for (const line of lines.slice(0, -1)) {
    assert.ok(line.includes("–"), `kapalı aralık bekleniyordu: ${line}`);
  }
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

// ─── Toplu sevk/teslim: bekleme listesi PIN'i ──────────────────────────────
// Round 1'in scratch doğrulamasında yakalanan gerçek regresyon: ship/route.ts
// bir zamanlar yalnızca `ne(orders.status, "shipped")` kullanıyordu — bu,
// zaten `delivered`e geçmiş bir siparişi "sevk edilmemiş" sanıp tekrar
// `shipped`e GERİ ALIYORDU (takip numarasını eziyor, hakedişi anlamsızca
// yeniden deniyor, teslim almış katılımcıya "seni bekliyor" mailini ikinci
// kez atıyordu). Bu testler o listenin GERİ GEVŞETİLMEDİĞİNİ pinler: biri
// `WORKSHOP_SHIP_PENDING_EXCLUDED_STATUSES`i `["shipped"]`e indirgerse (ya da
// `delivered`i çıkarırsa) burada patlar.

test("toplu sevk bekleme listesi shipped+delivered+rejected'i hariç tutar (round-1 regresyonu)", () => {
  assert.deepEqual(
    [...WORKSHOP_SHIP_PENDING_EXCLUDED_STATUSES].sort(),
    ["delivered", "rejected", "shipped"]
  );
});

test("toplu teslim bekleme listesi yalnızca delivered+rejected'i hariç tutar (shipped HÂLÂ bekliyor demektir)", () => {
  assert.deepEqual(
    [...WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES].sort(),
    ["delivered", "rejected"]
  );
  // Ship'in tam tersi: 'shipped' burada YOK, çünkü 'shipped' bir sipariş
  // tam olarak "teslim edilmeyi bekliyor" demektir.
  assert.equal(
    (WORKSHOP_DELIVER_PENDING_EXCLUDED_STATUSES as readonly string[]).includes("shipped"),
    false
  );
});

// ─── Partiye ait olmanın tanımı: İADE EDİLMİŞ sipariş partide DEĞİLDİR ─────
// Bu, canlıda para kaybettiren gerçek bir açıktı: `refundOrder`
// `payment_status`ü `refunded` yapıyor ama `orders.status`e HİÇ DOKUNMUYOR
// (`rejected` yazan tek yer admin'in sipariş red rotası ve iade yolları oradan
// geçmiyor). Yalnızca `status <> 'rejected'` bakan yüklemler iade edilmiş
// siparişi partide TUTUYORDU: merdiven şişiyor, üretici geri yapıştırılıyor,
// sevkte gerçek hakediş tahakkuk ediyor ve seans asla `shipped`e ulaşamıyordu.
//
// Aşağıdakiler tanımın İKİ ayağını da pinler. Biri `orderInBatch`ten ödeme
// kontrolünü çıkarırsa (ya da diziyi boşaltırsa) burası patlar. SQL tarafının
// aynı diziden okuduğu `batchOrderFilter` DB'li testte doğrulanıyor
// (scripts/test-workshop-cancel.ts, bölüm 8).

test("iade edilmiş sipariş partiye GİRMEZ (payment_status ayağı)", () => {
  assert.equal(
    orderInBatch({ status: "approved", paymentStatus: "refunded" }),
    false
  );
  assert.equal(orderInBatch({ status: "shipped", paymentStatus: "refunded" }), false);
});

test("reddedilmiş sipariş partiye GİRMEZ (status ayağı)", () => {
  assert.equal(orderInBatch({ status: "rejected", paymentStatus: "succeeded" }), false);
});

test("normal ödenmiş sipariş partiye GİRER", () => {
  assert.equal(orderInBatch({ status: "approved", paymentStatus: "succeeded" }), true);
  assert.equal(orderInBatch({ status: "shipped", paymentStatus: "succeeded" }), true);
  assert.equal(orderInBatch({ status: "delivered", paymentStatus: "succeeded" }), true);
});

test("parti dışı kümeler beklenen değerleri taşır", () => {
  assert.deepEqual([...WORKSHOP_BATCH_EXCLUDED_STATUSES], ["rejected"]);
  assert.deepEqual([...WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES], ["refunded"]);
});

// Taslaksız koltuk tutmalarının saatlik hata log'u sonsuza kadar tekrarlanmasın
// diye sınırlandı; pencere ne 0 (hiç bildirilmez) ne de ayları bulmalı.
test("taslaksız koltuk tutması raporlama penceresi makul", () => {
  assert.ok(WORKSHOP_ORPHAN_HOLD_REPORT_DAYS >= 1);
  assert.ok(WORKSHOP_ORPHAN_HOLD_REPORT_DAYS <= 30);
});

// ─── İptal kararları (Görev 12b) ────────────────────────────────────────────
// Seans/katılımcı iptalinin ÜÇ ayrı davranışı saf bir karar fonksiyonunda
// toplanır: rota da servis de aynı yerden okur, testi DB'siz çalışır.

test("ödemeye hiç gelmemiş katılımcıda iade edilecek para yoktur", () => {
  // `orderId` yalnızca sipariş terfisinde yazılır — "bu kişi gerçekten ödedi
  // mi" sorusunun tek işareti budur.
  assert.equal(
    participantCancelDisposition({ orderId: null, orderStatus: null }),
    "no_payment"
  );
  // Sipariş yoksa siparişin durumu ne olursa olsun sonuç değişmez.
  assert.equal(
    participantCancelDisposition({ orderId: null, orderStatus: "shipped" }),
    "no_payment"
  );
});

test("sevk edilmiş/teslim edilmiş sipariş OTOMATİK iade edilmez", () => {
  // Figür fiziksel olarak var ve yola çıktı; otomatik iade ürünü bedava
  // vermek olurdu. Seans iptalinde isimle raporlanır, tek katılımcı
  // iptalinde 409 döner.
  for (const st of WORKSHOP_CANCEL_SHIPPED_STATUSES) {
    assert.equal(
      participantCancelDisposition({ orderId: "o1", orderStatus: st }),
      "already_shipped",
      `${st} durumu sevk edilmiş sayılmalıydı`
    );
  }
  assert.deepEqual([...WORKSHOP_CANCEL_SHIPPED_STATUSES].sort(), ["delivered", "shipped"]);
});

test("ödenmiş ama yola çıkmamış sipariş iade edilir", () => {
  for (const st of ["paid", "approved", "printing", "awaiting_model", "qc_pending", null]) {
    assert.equal(
      participantCancelDisposition({ orderId: "o1", orderStatus: st }),
      "refund",
      `${st} durumunda iade beklenirdi`
    );
  }
});

test("koltuk YALNIZCA seans hâlâ open iken havuza döner", () => {
  // Kapanmış bir seansta bookedCount'u düşürmek, partinin DONMUŞ komisyon
  // oranıyla (parti büyüklüğünden hesaplandı) gerçek sipariş sayısını
  // çelişkiye düşürür; üretici zaten o büyüklükteki partiyi taahhüt etti.
  assert.equal(seatReturnsToPool("open"), true);
  for (const st of WORKSHOP_SESSION_STATUSES) {
    if (st === "open") continue;
    assert.equal(seatReturnsToPool(st), false, `${st} seansında koltuk bırakılmamalı`);
  }
});

test("teslim edilmiş/tamamlanmış seans iptal EDİLEMEZ", () => {
  // Parti mekana ulaşmış ve hakediş tahakkuk etmişse `cancelled` damgası
  // hiçbir parayı geri getirmez, yalnızca olan biteni yalanlar. Aynı fonksiyonu
  // hem uç hem admin butonu okur — ayrışamasınlar.
  assert.deepEqual(
    [...WORKSHOP_SESSION_UNCANCELLABLE_STATUSES].sort(),
    ["completed", "delivered"]
  );
  for (const st of WORKSHOP_SESSION_UNCANCELLABLE_STATUSES) {
    assert.equal(sessionCancellable(st), false, `${st} iptal edilebilir görünüyor`);
  }
  for (const st of WORKSHOP_SESSION_STATUSES) {
    if ((WORKSHOP_SESSION_UNCANCELLABLE_STATUSES as readonly string[]).includes(st)) continue;
    assert.equal(sessionCancellable(st), true, `${st} iptal edilebilmeliydi`);
  }
  // Zaten `cancelled` bir seans YİNE iptal edilebilir olmalı: bu uç aynı
  // zamanda başarısız kalan iade/taslak çıkışlarının yeniden deneme yoludur.
  assert.equal(sessionCancellable("cancelled"), true);
});

// ─── Sözleşme metni ↔ merdiven (Görev 12b) ─────────────────────────────────
// Sözleşmedeki hacim merdiveni üreticiye VERİLEN bir taahhüttür. Metin ile
// WORKSHOP_COMMISSION_TIERS ayrışırsa üreticiye yanlış oran vaat etmiş
// oluruz — bu testler ikisini birbirine çiviler.

/** Sözleşme metnindeki atölye merdivenini ayrıştırır. */
function contractLadder(): Array<{ from: number; to: number | null; sharePercent: number }> {
  const flat = MANUFACTURER_ONBOARDING_TR.replace(/\s+/g, " ");
  const m = flat.match(/net payınız hacme göre kademelenir: ([^.]+)\./);
  if (!m) throw new Error("Sözleşmede atölye komisyon merdiveni bulunamadı");
  return m[1].split(",").map((part) => {
    const text = part.trim();
    const share = text.match(/%(\d+)/);
    if (!share) throw new Error(`Kademe yüzdesi okunamadı: ${text}`);
    const open = text.match(/^(\d+) ve üzeri/);
    if (open) return { from: Number(open[1]), to: null, sharePercent: Number(share[1]) };
    const closed = text.match(/^(\d+)–(\d+)/);
    if (closed) {
      return {
        from: Number(closed[1]),
        to: Number(closed[2]),
        sharePercent: Number(share[1]),
      };
    }
    const single = text.match(/^(\d+)/);
    if (!single) throw new Error(`Kademe aralığı okunamadı: ${text}`);
    return { from: Number(single[1]), to: Number(single[1]), sharePercent: Number(share[1]) };
  });
}

test("sözleşmedeki merdiven kademe SAYISI ve sınırları koda eşit", () => {
  const ladder = contractLadder();
  assert.equal(
    ladder.length,
    WORKSHOP_COMMISSION_TIERS.length,
    `sözleşmede ${ladder.length}, kodda ${WORKSHOP_COMMISSION_TIERS.length} kademe var`
  );
  WORKSHOP_COMMISSION_TIERS.forEach((tier, i) => {
    assert.equal(ladder[i].from, tier.minOrders, `${i}. kademenin başlangıcı tutmuyor`);
    const next = WORKSHOP_COMMISSION_TIERS[i + 1];
    assert.equal(
      ladder[i].to,
      next ? next.minOrders - 1 : null,
      `${i}. kademenin bitişi tutmuyor`
    );
  });
});

test("sözleşmedeki her yüzde, o adette kodun döndürdüğü NET payla aynı", () => {
  for (const step of contractLadder()) {
    const atStart = (10000 - workshopCommissionRateBps(step.from)) / 100;
    assert.equal(
      step.sharePercent,
      atStart,
      `${step.from} siparişte sözleşme %${step.sharePercent} diyor, kod %${atStart} veriyor`
    );
    if (step.to !== null) {
      // Aralığın SONU da aynı oranda olmalı, bir fazlası ise olmamalı —
      // aksi hâlde metindeki üst sınır yalan söylüyordur.
      const atEnd = (10000 - workshopCommissionRateBps(step.to)) / 100;
      assert.equal(step.sharePercent, atEnd, `${step.to} siparişte oran kaymış`);
      const beyond = (10000 - workshopCommissionRateBps(step.to + 1)) / 100;
      assert.notEqual(
        beyond,
        step.sharePercent,
        `${step.to + 1} siparişte hâlâ %${beyond} — sözleşmedeki üst sınır yanlış`
      );
    }
  }
});

test("sözleşme sürümü, metnin başlığındaki sürümle aynı", () => {
  // Kabul edilen sürüm `onboarding_version`a yazılır; metnin başlığı ile
  // sabit ayrışırsa hangi metnin imzalandığı bilinemez hâle gelir.
  assert.equal(MANUFACTURER_CONTRACT_VERSION, "3.1");
  assert.ok(
    MANUFACTURER_ONBOARDING_TR.includes(`**Sürüm: ${MANUFACTURER_CONTRACT_VERSION} —`),
    "sözleşme metnindeki sürüm satırı MANUFACTURER_CONTRACT_VERSION ile aynı değil"
  );
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
