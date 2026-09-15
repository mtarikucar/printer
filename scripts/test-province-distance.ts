// İl mesafesi + sürekli mesafe skoru — saf mantık testleri.
//
// Kapsam: province-distance.ts (çapa tablosu, Türkçe yazım toleransı, mesafe)
// ve manufacturer-assignment.ts'teki `distanceScoreContinuous` (v3 gölge
// profilinin mesafe alt-skoru) + CANLI `distanceScore`'un değişmediğinin
// kanıtı.
//
// DB gerekmez: manufacturer-assignment @/lib/db'yi import eder ama modül
// yüklenirken sorgu çalışmaz (test-network-map.ts da aynısını yapıyor).
//
// Çalıştırma: npx tsx scripts/test-province-distance.ts

import assert from "node:assert/strict";
import { PROVINCES } from "../src/lib/data/turkey-address";
import {
  MAP_UNIT_KM,
  canonicalProvince,
  foldProvinceName,
  provinceAnchor,
  provinceDistanceKm,
  provinceDistanceUnits,
  sameProvinceName,
} from "../src/lib/data/province-distance";
import {
  COVERAGE_PIN_FLOOR,
  DISTANCE_FLOOR_SCORE,
  DISTANCE_NEAR_SCORE,
  DISTANCE_NEAR_UNITS,
  DISTANCE_UNKNOWN_SCORE,
  distanceScore,
  distanceScoreContinuous,
  loadScore,
  weightedTotal,
} from "../src/lib/services/manufacturer-assignment";
import { V1_WEIGHTS } from "../src/lib/config/manufacturer-scoring";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name} — ${msg}`);
    console.log(`✗ ${name} — ${msg}`);
  }
}

// ─── Çapa tablosu ───────────────────────────────────────────────────────────

check("81 ilin hepsinin çapası var", () => {
  for (const il of PROVINCES) {
    assert.ok(provinceAnchor(il), `çapa yok: ${il}`);
  }
});

check("katlanmış il adları tekrarsız (sessiz üzerine yazma yok)", () => {
  const seen = new Map<string, string>();
  for (const il of PROVINCES) {
    const key = foldProvinceName(il);
    assert.ok(key, `katlanamadı: ${il}`);
    const prev = seen.get(key!);
    assert.ok(!prev, `çakışma: ${prev} ve ${il} aynı anahtara düşüyor (${key})`);
    seen.set(key!, il);
  }
});

check("canonicalProvince serbest yazımı kanonik ada çevirir", () => {
  assert.equal(canonicalProvince("istanbul"), "İstanbul");
  assert.equal(canonicalProvince("ISTANBUL"), "İstanbul");
  assert.equal(canonicalProvince("İSTANBUL"), "İstanbul");
  assert.equal(canonicalProvince("  istanbul  "), "İstanbul");
  assert.equal(canonicalProvince("hakkâri"), "Hakkari");
  assert.equal(canonicalProvince("SANLIURFA"), "Şanlıurfa");
  assert.equal(canonicalProvince("afyon karahisar"), "Afyonkarahisar");
  // Türkiye ili olmayan ad tanınmaz — uydurulmuş bir çapa üretilmez.
  assert.equal(canonicalProvince("Lefkoşa"), null);
  assert.equal(canonicalProvince(""), null);
  assert.equal(canonicalProvince(null), null);
});

check("sameProvinceName yazım farkına takılmaz", () => {
  assert.equal(sameProvinceName("ISTANBUL", "İstanbul"), true);
  assert.equal(sameProvinceName("Hakkâri", "hakkari"), true);
  assert.equal(sameProvinceName("Ankara", "Konya"), false);
  assert.equal(sameProvinceName(null, null), false);
  assert.equal(sameProvinceName("Ankara", null), false);
  // Haritada olmayan ama birebir aynı yazılmış ad: aynı yer olduğu kesin.
  assert.equal(sameProvinceName("Lefkoşa", "lefkoşa"), true);
});

// ─── Mesafe ─────────────────────────────────────────────────────────────────

check("İstanbul–Ankara ≈ 230 birim (~350 km)", () => {
  const units = provinceDistanceUnits("İstanbul", "Ankara");
  assert.ok(units !== null && units > 225 && units < 235, `birim: ${units}`);
  const km = provinceDistanceKm("İstanbul", "Ankara");
  assert.ok(km !== null && km > 320 && km < 370, `km: ${km}`);
  assert.equal(MAP_UNIT_KM, 1.5);
});

check("mesafe simetrik ve kendisiyle sıfır", () => {
  assert.equal(
    provinceDistanceUnits("İzmir", "Manisa"),
    provinceDistanceUnits("Manisa", "İzmir")
  );
  assert.equal(provinceDistanceUnits("Ankara", "ankara"), 0);
});

check("tanınmayan il null döner (0 DEĞİL)", () => {
  assert.equal(provinceDistanceUnits("Lefkoşa", "Ankara"), null);
  assert.equal(provinceDistanceUnits("Ankara", "Lefkoşa"), null);
  assert.equal(provinceDistanceUnits(null, "Ankara"), null);
  assert.equal(provinceDistanceUnits("Ankara", undefined), null);
  assert.equal(provinceDistanceKm("Ankara", "Lefkoşa"), null);
});

check("komşu iller uzak illerden yakın çıkar", () => {
  const komsu = provinceDistanceUnits("Kocaeli", "Düzce")!;
  const orta = provinceDistanceUnits("İstanbul", "Ankara")!;
  const uzak = provinceDistanceUnits("Van", "Ankara")!;
  const enUzak = provinceDistanceUnits("Edirne", "Hakkari")!;
  assert.ok(komsu < orta, `${komsu} < ${orta}`);
  assert.ok(orta < uzak, `${orta} < ${uzak}`);
  assert.ok(uzak < enUzak, `${uzak} < ${enUzak}`);
});

// ─── Sürekli mesafe skoru (v3 gölge) ────────────────────────────────────────

check("aynı il → 100 / same_il", () => {
  assert.deepEqual(distanceScoreContinuous("Ankara", "Ankara"), {
    score: 100,
    kind: "same_il",
    units: 0,
  });
  // Yazım farkı aynı ili başka bir yer yapmaz.
  assert.equal(distanceScoreContinuous("ISTANBUL", "İstanbul").score, 100);
});

check("sipariş ili bilinmiyorsa 30 / unknown — pin bile kurtarmaz", () => {
  assert.deepEqual(distanceScoreContinuous(undefined, "Ankara", ["Ankara"]), {
    score: DISTANCE_UNKNOWN_SCORE,
    kind: "unknown",
    units: null,
  });
  assert.equal(distanceScoreContinuous(null, "Ankara").score, 30);
});

check("atölyenin ili bilinmiyorsa 30 / unknown", () => {
  assert.deepEqual(distanceScoreContinuous("Ankara", null), {
    score: DISTANCE_UNKNOWN_SCORE,
    kind: "unknown",
    units: null,
  });
  // Haritada olmayan bir ad da "bilinmiyor"dur.
  assert.equal(distanceScoreContinuous("Ankara", "Lefkoşa").kind, "unknown");
});

check("mesafeyle azalır: yakın komşu > orta > uzak", () => {
  const komsu = distanceScoreContinuous("Kocaeli", "Düzce");
  const orta = distanceScoreContinuous("İstanbul", "Ankara");
  const uzak = distanceScoreContinuous("Van", "Ankara");
  assert.ok(komsu.score > orta.score, `${komsu.score} > ${orta.score}`);
  assert.ok(orta.score > uzak.score, `${orta.score} > ${uzak.score}`);
  // Kademeli modelde ikisi de 20'ydi; ayrım tam olarak bu fazın amacı.
  assert.ok(komsu.score >= 80, `komşu skoru: ${komsu.score}`);
  assert.equal(komsu.kind, "near");
  assert.equal(uzak.kind, "far");
});

check("İstanbul–Ankara (~346 km) yakın yarıçapın dışında ve 55'in altında", () => {
  const v = distanceScoreContinuous("İstanbul", "Ankara");
  // Kalibrasyon sonrası: 230 birim, kırılma noktasının (200) ötesi → 53.
  assert.ok(v.score > 48 && v.score <= DISTANCE_NEAR_SCORE, `skor: ${v.score}`);
  assert.equal(v.kind, "far"); // 230 birim > 200 birimlik "yakın" yarıçapı
  assert.ok(v.units !== null && v.units > 225 && v.units < 235);
});

check("en uzak çift tabanda kalır ve taban 20'dir", () => {
  const v = distanceScoreContinuous("Edirne", "Hakkari");
  assert.equal(v.score, DISTANCE_FLOOR_SCORE);
  assert.equal(v.kind, "far");
});

check("hiçbir çift 100'ü aşmaz, hiçbiri 20'nin altına düşmez", () => {
  for (const a of PROVINCES) {
    for (const b of PROVINCES) {
      const v = distanceScoreContinuous(a, b);
      assert.ok(v.score >= DISTANCE_FLOOR_SCORE, `${a}→${b} = ${v.score}`);
      assert.ok(v.score <= 100, `${a}→${b} = ${v.score}`);
      if (a === b) assert.equal(v.score, 100, `${a} kendine 100 değil`);
      else assert.ok(v.score < 100, `${a}→${b} farklı il ama 100`);
    }
  }
});

check("near/far eşiği DISTANCE_NEAR_UNITS'ten okunur", () => {
  for (const [a, b] of [
    ["İstanbul", "Kocaeli"],
    ["İstanbul", "Ankara"],
    ["Van", "Ankara"],
    ["Adana", "Mersin"],
  ] as const) {
    const v = distanceScoreContinuous(a, b);
    const expected = v.units! <= DISTANCE_NEAR_UNITS ? "near" : "far";
    assert.equal(v.kind, expected, `${a}→${b} (${v.units} birim)`);
  }
});

// ─── Eğrinin kalibrasyonu: YAKINLIK KISA MESAFEDE BASKIN ────────────────────
// Bunlar "skor kaç" testleri değil, KİMİN İŞİ ALDIĞI testleridir: mesafe
// skorunu tek başına okumak bir şey söylemez, çünkü kararı mesafe ile yükün
// ağırlıklı toplamı verir. Bu yüzden sıralayıcının KENDİ `weightedTotal` ve
// `loadScore` fonksiyonları kullanılıyor — formülü teste kopyalasaydık, ranker
// kaydığında test yine geçerdi.
//
// Sabitlenen olay: sürekli mesafe gölgesi, çalışma anındaki örneklemede 6
// siparişin 4'ünde işi siparişin KENDİ ilinden ~300 km öteye taşıyordu.

/** Diğer bütün sinyaller eşit; değişen yalnız mesafe ve yük. */
function totalWith(distance: number, load: number): number {
  return weightedTotal(
    {
      distance,
      load,
      reliability: 70,
      onTimeDelivery: 70,
      compliance: 100,
      batchAffinity: 0,
    },
    V1_WEIGHTS
  );
}

/** ~292 km: örneklemede işin kaçtığı gerçek mesafe (İstanbul → İzmir). */
const UZAK_SKOR = distanceScoreContinuous("İstanbul", "İzmir").score;

check("eğri ~300 km'de kalibrasyon noktasına iner", () => {
  const v = distanceScoreContinuous("İstanbul", "İzmir");
  assert.ok(v.units !== null && v.units > 190 && v.units < 200, `birim: ${v.units}`);
  // 195 birim, 200 birimlik kırılmanın hemen berisi: skor 55'in hemen üstü.
  assert.ok(
    v.score >= DISTANCE_NEAR_SCORE && v.score <= DISTANCE_NEAR_SCORE + 3,
    `skor: ${v.score}`
  );
});

check("yakın yarıçapın içi ≥ 55, dışı ≤ 55 (81×81)", () => {
  for (const a of PROVINCES) {
    for (const b of PROVINCES) {
      const v = distanceScoreContinuous(a, b);
      if (v.units === null) continue;
      if (v.units <= DISTANCE_NEAR_UNITS) {
        assert.ok(v.score >= DISTANCE_NEAR_SCORE, `${a}→${b}: ${v.score}`);
      } else {
        assert.ok(v.score <= DISTANCE_NEAR_SCORE, `${a}→${b}: ${v.score}`);
      }
    }
  }
});

check("skor mesafeyle asla artmaz (81×81 monotonluk)", () => {
  const pairs: Array<{ units: number; score: number }> = [];
  for (const a of PROVINCES) {
    for (const b of PROVINCES) {
      const v = distanceScoreContinuous(a, b);
      if (v.units !== null) pairs.push({ units: v.units, score: v.score });
    }
  }
  pairs.sort((x, y) => x.units - y.units);
  for (let i = 1; i < pairs.length; i++) {
    assert.ok(
      pairs[i].score <= pairs[i - 1].score,
      `${pairs[i - 1].units}→${pairs[i - 1].score} sonrası ${pairs[i].units}→${pairs[i].score}`
    );
  }
});

check("eşit yüklü YEREL atölye, ~300 km ötedekini geçer", () => {
  const yukSkoru = loadScore(3, 10);
  const yerel = totalWith(100, yukSkoru);
  const uzak = totalWith(UZAK_SKOR, yukSkoru);
  assert.ok(yerel > uzak, `yerel ${yerel} vs uzak ${uzak}`);
});

check("35 puan daha yüklü YEREL atölye hâlâ kazanır (örneklemedeki durum)", () => {
  // Örneklemede işi kaçıran tam bu farktı: yerel 7/20 dolu, uzak bomboş.
  const yerel = totalWith(100, loadScore(7, 20)); // yük 65
  const uzak = totalWith(UZAK_SKOR, loadScore(0, 20)); // yük 100
  assert.equal(loadScore(7, 20), 65);
  assert.ok(yerel > uzak, `yerel ${yerel} vs uzak ${uzak}`);
});

check("YARI dolu yerel atölye, boştaki uzak atölyeyi geçer", () => {
  const yerel = totalWith(100, loadScore(5, 10)); // yük 50
  const uzak = totalWith(UZAK_SKOR, loadScore(0, 10)); // yük 100
  assert.ok(yerel > uzak, `yerel ${yerel} vs uzak ${uzak}`);
});

check("yakınlık MUTLAK değil: neredeyse dolu yerel atölye kaybeder", () => {
  const yerel = totalWith(100, loadScore(9, 10)); // yük 10
  const uzak = totalWith(UZAK_SKOR, loadScore(0, 10)); // yük 100
  assert.ok(uzak > yerel, `uzak ${uzak} vs yerel ${yerel}`);
});

check("ülkenin öbür ucundaki boş atölye, hafif yüklü yereli geçemez", () => {
  const yerel = totalWith(100, loadScore(6, 10)); // yük 40
  const uzak = totalWith(
    distanceScoreContinuous("Edirne", "Hakkari").score, // taban 20
    loadScore(0, 10)
  );
  assert.ok(yerel > uzak, `yerel ${yerel} vs uzak ${uzak}`);
});

// ─── Etki alanı pini ────────────────────────────────────────────────────────

check("pin 85 TABANI verir (uzak atölye de olsa)", () => {
  const v = distanceScoreContinuous("Van", "Ankara", ["Van"]);
  assert.equal(v.score, COVERAGE_PIN_FLOOR);
  assert.equal(v.kind, "coverage_pin");
  // Pinsiz hâli belirgin biçimde düşük — taban gerçekten iş yapıyor.
  assert.ok(distanceScoreContinuous("Van", "Ankara").score < 50);
});

check("pin yazım toleranslı", () => {
  assert.equal(distanceScoreContinuous("Van", "Ankara", ["van"]).score, 85);
  assert.equal(
    distanceScoreContinuous("Şanlıurfa", "Ankara", ["SANLIURFA"]).kind,
    "coverage_pin"
  );
});

check("pin hak edilmiş yüksek skoru DÜŞÜRMEZ", () => {
  // İzmir–Manisa 47 birim → ~89; pin tabanı 85 bunu 85'e çekmemeli.
  const v = distanceScoreContinuous("İzmir", "Manisa", ["İzmir"]);
  assert.ok(v.score > COVERAGE_PIN_FLOOR, `skor: ${v.score}`);
  assert.equal(v.kind, "near");
});

check("pin, atölyenin ili bilinmese de geçerli", () => {
  const v = distanceScoreContinuous("Van", null, ["Van"]);
  assert.equal(v.score, COVERAGE_PIN_FLOOR);
  assert.equal(v.kind, "coverage_pin");
  assert.equal(v.units, null);
});

check("siparişin kendi ilindeki atölye pinli rakibi geçer", () => {
  const yerli = distanceScoreContinuous("Van", "Van", []);
  const pinli = distanceScoreContinuous("Van", "Ankara", ["Van"]);
  assert.ok(yerli.score > pinli.score, `${yerli.score} > ${pinli.score}`);
});

// ─── CANLI kademeli skor DEĞİŞMEDİ ──────────────────────────────────────────
// ranker-rollout kararı: bu fazda canlı atamanın kimi seçtiği değişmemeli.
// Aşağıdakiler kademeli sürümün sözleşmesidir; kırılırsa canlı yönlendirme
// kaymış demektir.

check("kademeli distanceScore aynı kademeleri veriyor", () => {
  assert.deepEqual(distanceScore("Ankara", "Ankara", ["Ankara"]), {
    score: 100,
    kind: "same_il",
  });
  assert.deepEqual(distanceScore("Konya", "Ankara", ["Konya"]), {
    score: 85,
    kind: "coverage",
  });
  assert.deepEqual(distanceScore("Konya", "Ankara", []), {
    score: 60,
    kind: "same_region",
  });
  assert.deepEqual(distanceScore("Van", "Ankara", []), {
    score: 20,
    kind: "other",
  });
  assert.deepEqual(distanceScore(undefined, "Ankara", ["Ankara"]), {
    score: 30,
    kind: "unknown",
  });
  assert.deepEqual(distanceScore("Ankara", undefined, []), {
    score: 30,
    kind: "unknown",
  });
});

check("kademeli sürüm hâlâ komşu ile ülkenin öbür ucunu ayırt ETMİYOR", () => {
  // Bu bir hata değil, değiştirilmemiş canlı davranışın kanıtı: sürekli model
  // devreye alındığında (Phase 5) bu iki değer ayrışacak.
  assert.equal(distanceScore("Kocaeli", "Düzce", []).score, 20);
  assert.equal(distanceScore("Edirne", "Hakkari", []).score, 20);
  assert.ok(
    distanceScoreContinuous("Kocaeli", "Düzce").score >
      distanceScoreContinuous("Edirne", "Hakkari").score
  );
});

// ─── Özet ───────────────────────────────────────────────────────────────────

console.log(`\n${pass}/${pass + fail} il-mesafesi kontrolü geçti`);
if (fail > 0) {
  console.log("\nHatalar:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
