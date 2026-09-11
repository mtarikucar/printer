// Üretim ağı haritası — saf mantık testleri (DB gerekmez).
//
// Kapsam: üretilmiş harita verisinin bütünlüğü, bölge tabloları,
// normalizeCoverage, buildNetworkMap (indeks + istatistik + GİZLİLİK) ve
// distanceScore'un kapsama kademesi.
//
// Çalıştırma: npx tsx scripts/test-network-map.ts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROVINCES } from "../src/lib/data/turkey-address";
import {
  IL_TO_REGION,
  PROVINCES_BY_REGION,
  REGION_IDS,
  REGION_LABELS,
} from "../src/lib/data/turkey-regions";
import {
  TURKEY_MAP_PROVINCES,
  TURKEY_MAP_VIEWBOX,
  provincePath,
} from "../src/lib/data/turkey-map";
import { normalizeCoverage } from "../src/lib/validators/network-map";
import {
  buildNetworkMap,
  effectiveCoverage,
  materialsOf,
  type PartnerRow,
} from "../src/lib/config/network-map";
import { distanceScore } from "../src/lib/services/manufacturer-assignment";

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

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ─── Harita verisi bütünlüğü ────────────────────────────────────────────────

check("81 il var ve plakalar tekrarsız", () => {
  assert.equal(TURKEY_MAP_PROVINCES.length, 81);
  const plates = new Set(TURKEY_MAP_PROVINCES.map((p) => p.plate));
  assert.equal(plates.size, 81);
  for (const p of TURKEY_MAP_PROVINCES) {
    assert.ok(p.plate >= 1 && p.plate <= 81, `plaka aralık dışı: ${p.il}=${p.plate}`);
  }
});

check("il adları PROVINCES ile BİREBİR", () => {
  const mapNames = [...TURKEY_MAP_PROVINCES.map((p) => p.il)].sort();
  const provNames = [...PROVINCES].sort();
  assert.deepEqual(mapNames, provNames);
});

check("her ilin path'i dolu ve yalnız M/L/Z komutları içerir", () => {
  for (const p of TURKEY_MAP_PROVINCES) {
    assert.ok(p.d.length > 20, `path çok kısa: ${p.il}`);
    const cmds = new Set(p.d.match(/[A-Za-z]/g) ?? []);
    for (const c of cmds) {
      assert.ok(["M", "L", "Z"].includes(c), `beklenmeyen komut '${c}' (${p.il})`);
    }
  }
});

check("centroid'ler viewBox içinde", () => {
  const [x, y, w, h] = TURKEY_MAP_VIEWBOX.split(" ").map(Number);
  for (const p of TURKEY_MAP_PROVINCES) {
    assert.ok(p.cx >= x && p.cx <= x + w, `cx dışarıda: ${p.il}`);
    assert.ok(p.cy >= y && p.cy <= y + h, `cy dışarıda: ${p.il}`);
  }
});

check("provincePath bilinen ili bulur, bilinmeyene undefined döner", () => {
  assert.equal(provincePath("İstanbul")?.plate, 34);
  assert.equal(provincePath("Atlantis"), undefined);
});

check("üretilmiş dosya MIT lisans notunu taşır", () => {
  const src = read("src/lib/data/turkey-map.ts");
  assert.match(src, /MIT License/);
  assert.match(src, /Erdi Gökçe/);
});

// ─── Bölge tabloları ────────────────────────────────────────────────────────

check("her ilin bir bölgesi var ve PROVINCES_BY_REGION 81 ili kapsar", () => {
  for (const il of PROVINCES) {
    assert.ok(IL_TO_REGION[il], `bölgesiz il: ${il}`);
  }
  const flat = REGION_IDS.flatMap((r) => PROVINCES_BY_REGION[r]);
  assert.equal(flat.length, 81);
  assert.equal(new Set(flat).size, 81);
});

check("her bölgenin Türkçe etiketi var", () => {
  for (const r of REGION_IDS) {
    assert.ok(REGION_LABELS[r] && REGION_LABELS[r].length > 2, `etiket yok: ${r}`);
  }
});

// ─── normalizeCoverage ──────────────────────────────────────────────────────

check("normalizeCoverage bilinmeyeni eler, tekrarı temizler, sıralar", () => {
  const out = normalizeCoverage(["Konya", "Ankara", "Ankara", "Atlantis", "", "Adana"]);
  assert.deepEqual(out, ["Adana", "Ankara", "Konya"]);
});

check("normalizeCoverage dizi olmayan girdiye boş döner", () => {
  assert.deepEqual(normalizeCoverage(null), []);
  assert.deepEqual(normalizeCoverage("Ankara"), []);
  assert.deepEqual(normalizeCoverage([1, {}, true]), []);
});

check("effectiveCoverage konum ilini ekler ve tekrarlamaz", () => {
  assert.deepEqual(effectiveCoverage(["Konya"], "Ankara"), ["Ankara", "Konya"]);
  assert.deepEqual(effectiveCoverage(["Ankara"], "Ankara"), ["Ankara"]);
  assert.deepEqual(effectiveCoverage([], "Atlantis"), []); // bilinmeyen il yok sayılır
  assert.deepEqual(effectiveCoverage(null, null), []);
});

// ─── materialsOf ────────────────────────────────────────────────────────────

check("etiketi olmayan üretici HİÇBİR malzeme iddiası taşımaz", () => {
  // Atama tarafı etiketsizi "her şeyi basar" sayar; bu İÇ ve hoşgörülü bir
  // varsayılandır. Public haritaya taşınırsa partnerin hiç yapmadığı bir olgu
  // iddiası olurdu (reçineci atölyenin yanında "Filament" rozeti).
  assert.deepEqual(materialsOf(null), []);
  assert.deepEqual(materialsOf([]), []);
  assert.deepEqual(materialsOf(["airbrush"]), []);
});

check("etiketli üretici yalnız kendi malzemelerini gösterir", () => {
  assert.deepEqual(materialsOf(["material_resin", "other"]), ["resin"]);
  assert.deepEqual(materialsOf(["material_resin", "material_filament"]), ["resin", "filament"]);
});

// ─── buildNetworkMap ────────────────────────────────────────────────────────

const ROWS: PartnerRow[] = [
  // 0 — Ankara üreticisi, etiketli malzeme
  { kind: "manufacturer", il: "Ankara", coverageProvinces: ["Konya", "Eskişehir"], capabilities: ["material_resin"] },
  // 1 — İzmir üreticisi, malzeme etiketi YOK
  { kind: "manufacturer", il: "İzmir", coverageProvinces: ["Konya"], capabilities: [] },
  // 2 — Ankara boyacısı
  { kind: "painter", il: "Ankara" },
  // 3 — adressiz ama etki alanı tanımlı (geçerli durum)
  { kind: "manufacturer", il: null, coverageProvinces: ["Van"] },
  // 4 — ne konum ne kapsama → haritaya girmemeli
  { kind: "manufacturer", il: null, coverageProvinces: [] },
  // 5 — PROVINCES'ta olmayan il → konum yok sayılmalı
  { kind: "manufacturer", il: "Atlantis", coverageProvinces: [] },
];

const built = buildNetworkMap(ROWS);

check("konumu ve kapsaması olmayan partner haritaya girmez", () => {
  // 6 satır girdi; #4 (konumsuz+kapsamasız) elenir, #5'in ili geçersiz olduğu
  // için konumu düşer ama kapsaması da boş olduğundan o da elenir.
  assert.equal(built.partners.length, 4);
  assert.equal(built.partners.filter((p) => p.il === null).length, 1, "yalnız adressiz-kapsamalı kalmalı");
  assert.deepEqual(built.partners.find((p) => p.il === null)?.coverage, ["Van"]);
});

check("GİZLİLİK: payload KİMLİK İÇERMEZ — hiçbir partnerin unvanı yok", () => {
  const keys = new Set(built.partners.flatMap((p) => Object.keys(p)));
  for (const forbidden of [
    "name",
    "companyName",
    "id",
    "email",
    "phone",
    "ilce",
    "address",
    "iban",
    "acceptingOrders",
  ]) {
    assert.ok(!keys.has(forbidden), `yasak alan sızdı: ${forbidden}`);
  }
  assert.deepEqual([...keys].sort(), ["coverage", "il", "kind", "materials"]);
});

check("GİZLİLİK: buildNetworkMap unvan KABUL ETMEZ, sızdıramaz", () => {
  // Sözleşmeyi tipin ötesinde de kilitle: çağıran yanlışlıkla unvan geçirse bile
  // payload'da görünmemeli (PartnerRow'da böyle bir alan yok).
  const withName = buildNetworkMap([
    { kind: "manufacturer", il: "Ankara", companyName: "Gizli Atölye" } as PartnerRow,
  ]);
  assert.ok(
    !JSON.stringify(withName).includes("Gizli Atölye"),
    "unvan payload'ın hiçbir yerinde bulunmamalı"
  );
});

check("boyacıya malzeme etiketi yazılmaz", () => {
  const painter = built.partners.find((p) => p.kind === "painter")!;
  assert.deepEqual(painter.materials, []);
});

check("il indeksi located/covered ayrımını doğru kurar", () => {
  const ankara = built.provinces["Ankara"];
  assert.equal(ankara.located.length, 2, "Ankara'da üretici + boyacı");
  const konya = built.provinces["Konya"];
  assert.equal(konya.located.length, 0, "Konya'da atölye yok");
  assert.equal(konya.covered.length, 2, "Konya'ya iki üretici hizmet veriyor");
});

check("konum ili kapsamaya otomatik eklenir", () => {
  const ankara = built.partners.find((p) => p.il === "Ankara" && p.kind === "manufacturer")!;
  assert.ok(ankara.coverage.includes("Ankara"));
  assert.ok(built.provinces["Ankara"].covered.includes(built.partners.indexOf(ankara)));
});

check("etiketsiz üreticinin malzeme rozeti boştur", () => {
  const izmir = built.partners.find((p) => p.il === "İzmir")!;
  assert.deepEqual(izmir.materials, []);
  const ankara = built.partners.find((p) => p.il === "Ankara" && p.kind === "manufacturer")!;
  assert.deepEqual(ankara.materials, ["resin"]);
});

check("istatistikler sayılır", () => {
  assert.equal(built.stats.manufacturers, 3, "Ankara + İzmir + Adressiz");
  assert.equal(built.stats.painters, 1);
  assert.equal(built.stats.homeProvinces, 2, "Ankara ve İzmir");
  assert.deepEqual(
    Object.keys(built.provinces).sort(),
    ["Ankara", "Eskişehir", "Konya", "Van", "İzmir"].sort()
  );
  assert.equal(built.stats.coveredProvinces, 5);
});

check("boş girdi çökmeden boş harita üretir", () => {
  const empty = buildNetworkMap([]);
  assert.deepEqual(empty.partners, []);
  assert.deepEqual(empty.provinces, {});
  assert.equal(empty.stats.coveredProvinces, 0);
});

// ─── distanceScore ──────────────────────────────────────────────────────────

check("kademeler ve gerekçeler", () => {
  assert.deepEqual(distanceScore("Ankara", "Ankara", ["Ankara"]), {
    score: 100,
    kind: "same_il",
  });
  assert.deepEqual(distanceScore("Konya", "Ankara", ["Konya"]), { score: 85, kind: "coverage" });
  assert.deepEqual(distanceScore("Konya", "Ankara", []), { score: 60, kind: "same_region" });
  assert.deepEqual(distanceScore("Van", "Ankara", []), { score: 20, kind: "other" });
  assert.deepEqual(distanceScore(undefined, "Ankara", ["Ankara"]), { score: 30, kind: "unknown" });
  assert.deepEqual(distanceScore("Ankara", undefined, []), { score: 30, kind: "unknown" });
});

check("kapsama, adres yokluğu kontrolünden ÖNCE değerlendirilir", () => {
  // Adresi olmayan ama etki alanı tanımlı atölye geçerli bir durumdur.
  assert.deepEqual(distanceScore("Van", undefined, ["Van"]), { score: 85, kind: "coverage" });
});

check("kapsama, aynı ilin önüne GEÇEMEZ (81 il seçilse bile)", () => {
  const all = [...PROVINCES];
  const wide = distanceScore("Ankara", "Van", all);
  const local = distanceScore("Ankara", "Ankara", []);
  assert.equal(wide.score, 85);
  assert.ok(local.score > wide.score, "kendi ilindeki atölye her zaman önde olmalı");
});

check("kapsama, aynı bölgenin ÜSTÜNDE", () => {
  assert.ok(
    distanceScore("Konya", "Van", ["Konya"]).score > distanceScore("Konya", "Ankara", []).score
  );
});

// ─── Worker/istemci güvenliği ───────────────────────────────────────────────

check("saf modüller server-only import ETMEZ", () => {
  for (const f of [
    "src/lib/config/network-map.ts",
    "src/lib/validators/network-map.ts",
    "src/lib/data/turkey-map.ts",
    "src/lib/data/turkey-regions.ts",
  ]) {
    assert.doesNotMatch(read(f), /^\s*import\s+"server-only"/m, `${f} server-only içeriyor`);
  }
});

check("saf modüller veritabanı import ETMEZ", () => {
  for (const f of ["src/lib/config/network-map.ts", "src/lib/validators/network-map.ts"]) {
    assert.doesNotMatch(read(f), /from "@\/lib\/db"/, `${f} db import ediyor`);
  }
});

check("admin istemci bileşeni servis modülünü YALNIZCA tip olarak import eder", () => {
  // Yaşandı: `import { isPubliclyOnMap } from "@/lib/services/network-map"`
  // eklemek `pg`yi tarayıcı paketine sürükledi ve sayfa "Module not found: pg"
  // ile 500 verdi. Tip importları derlemede silinir, değer importları sürüklenir.
  const src = read("src/app/admin/network-map/network-map-client.tsx");
  const valueImport = /^import\s+(?!type\b)[^;]*from\s+"@\/lib\/services\//m;
  assert.doesNotMatch(src, valueImport, "istemci bileşeni servis modülünden DEĞER import ediyor");
});

// ─── Sonuç ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
