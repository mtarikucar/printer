/**
 * HESAPLANAN ETKİ ALANI — planın testleri (Faz 5).
 *
 * İki iş yapar:
 *  1. SAF HESABI sınar (DB yok): en yakın atölye, yarıçap, malzeme, kapasite,
 *     pin/dışlama önceliği, kararlılık ve sahipsiz il satırı.
 *  2. TEK HESAP SÖZLEŞMESİNİ tarar: ikinci bir "en yakın atölye" hesabı ya da
 *     kuralların ikinci bir kopyası belirirse DÜŞER. Public harita hesabı okur;
 *     canlı sıralama elle yazılan listeyi, gölge sıralama planı okur.
 *  3. İsteğe bağlı gerçek PostgreSQL testi: QA_MIGRATION_PG_URL yalnız
 *     localhost:55433/postgres olabilir. Benzersiz bir scratch DB oluşturur,
 *     0058 geri alma güvenliğini sınar ve yalnız kendi DB'sini kaldırır.
 *
 * Çalıştır: npx tsx scripts/test-coverage-plan.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { canonicalProvince } from "../src/lib/data/province-distance";
import { PROVINCES } from "../src/lib/data/turkey-address";
import { buildNetworkMap } from "../src/lib/config/network-map";
import {
  COVERAGE_MATERIALS,
  COVERAGE_RADIUS_KM,
  COVERAGE_RADIUS_UNITS,
  computeCoveragePlan,
  coveragePlanResolver,
  plannedCoverageFor,
  plannedOwnerOf,
  type CoverageOverrideRow,
  type CoverageWorkshop,
} from "../src/lib/services/coverage-plan";

const ROOT = join(__dirname, "..");
const OWNER = "src/lib/services/coverage-plan.ts";
const ownerSrc = readFileSync(join(ROOT, OWNER), "utf8");

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log("  ok  ", name);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.error("  FAIL", name, detail ?? "");
  }
}

/**
 * Yorumları at: yargı KODA bakmalı, kodun anlatısına değil. Bu dosyadaki ve
 * taranan dosyalardaki açıklamalar "Math.hypot" ya da "material_" gibi dizeleri
 * ANLATTIĞI için, yorumlar koddan sayılmazsa tarama kendi anlatısını kod sanar.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

const ownerCode = stripComments(ownerSrc);

function shop(input: {
  id: string;
  name?: string;
  il: string | null;
  capabilities?: string[] | null;
  acceptingOrders?: boolean;
  hasRoom?: boolean;
  loadUnits?: number;
  max?: number;
  typedCoverage?: string[];
}): CoverageWorkshop {
  return {
    manufacturerId: input.id,
    companyName: input.name ?? `Atölye ${input.id}`,
    il: input.il,
    canonicalIl: canonicalProvince(input.il),
    capabilities: input.capabilities ?? null,
    acceptingOrders: input.acceptingOrders ?? true,
    hasRoom: input.hasRoom ?? true,
    loadUnits: input.loadUnits ?? 0,
    maxConcurrentOrders: input.max ?? 5,
    typedCoverage: input.typedCoverage ?? [],
  };
}

function ov(
  input: Partial<CoverageOverrideRow> & { il: string; material: string }
): CoverageOverrideRow {
  return {
    kind: "pin",
    manufacturerId: null,
    note: null,
    createdBy: "test@figurunica",
    updatedAt: null,
    ...input,
  } as CoverageOverrideRow;
}

const RESIN = COVERAGE_MATERIALS[0];
const MAT = [RESIN] as const;

// ─── 1. EN YAKIN ATÖLYE ─────────────────────────────────────────────────────
console.log("\nen yakın atölye kazanır");

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "izmir", il: "İzmir" }), shop({ id: "ankara", il: "Ankara" })],
    overrides: [],
    provinces: ["Manisa", "Kırıkkale"],
    materials: [...MAT],
  });
  check(
    "Manisa İzmir'e düşer",
    plannedOwnerOf(plan, "Manisa", RESIN)?.manufacturerId === "izmir",
    plannedOwnerOf(plan, "Manisa", RESIN)?.companyName ?? "yok"
  );
  check(
    "Kırıkkale Ankara'ya düşer",
    plannedOwnerOf(plan, "Kırıkkale", RESIN)?.manufacturerId === "ankara"
  );
  check(
    "aynı il mesafesi 0 ve gerekçe 'aynı ilde'",
    (() => {
      const p = computeCoveragePlan({
        workshops: [shop({ id: "izmir", il: "İzmir" })],
        overrides: [],
        provinces: ["İzmir"],
        materials: [...MAT],
      });
      const row = plannedOwnerOf(p, "İzmir", RESIN);
      return row?.distanceUnits === 0 && row.reason.includes("aynı ilde");
    })()
  );
}

// ─── 2. YARIÇAP: uzaktaki atölyeye ZORLANMAZ ────────────────────────────────
console.log("\nyarıçap dışı → SAHİPSİZ");

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "edirne", il: "Edirne" })],
    overrides: [],
    provinces: ["Hakkari"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Hakkari", RESIN);
  check("Hakkari, Edirne'deki atölyeye YAZILMAZ", row?.manufacturerId === null);
  check("satır 'unowned' olarak işaretlenir", row?.source === "unowned");
  check(
    "sahipsiz satır en yakın atölyeyi ve engelini SÖYLER",
    !!row?.nearestMiss &&
      row.nearestMiss.manufacturerId === "edirne" &&
      row.nearestMiss.blockedBy.includes("Menzil dışı")
  );
  check(
    "sahipsiz iller ayrı listeye de düşer",
    plan.unowned.length === 1 && plan.unowned[0].il === "Hakkari"
  );
  check(
    "yarıçap, sıralayıcının 'yakın' sınırından okunur (kopya sabit yok)",
    COVERAGE_RADIUS_UNITS === 200 && COVERAGE_RADIUS_KM === 300,
    `${COVERAGE_RADIUS_UNITS} birim / ${COVERAGE_RADIUS_KM} km`
  );
}

// ─── 3. UYGUNLUK KAPILARI ───────────────────────────────────────────────────
console.log("\nkapasite / sipariş almama / malzeme");

{
  const plan = computeCoveragePlan({
    workshops: [
      shop({ id: "dolu", il: "İzmir", hasRoom: false, loadUnits: 5, max: 5 }),
      shop({ id: "uzak", il: "Ankara" }),
    ],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Manisa", RESIN);
  check(
    "kapasitesi dolu atölye ili ALMAZ (yakın olsa bile)",
    row?.manufacturerId !== "dolu",
    String(row?.manufacturerId)
  );
  check(
    "dolu atölye engel gerekçesinde ağırlıklı birimle yazılır",
    (() => {
      const only = computeCoveragePlan({
        workshops: [shop({ id: "dolu", il: "İzmir", hasRoom: false, loadUnits: 5, max: 5 })],
        overrides: [],
        provinces: ["Manisa"],
        materials: [...MAT],
      });
      const r = plannedOwnerOf(only, "Manisa", RESIN);
      return r?.source === "unowned" && !!r.nearestMiss?.blockedBy.includes("5/5 birim");
    })()
  );
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "kapali", il: "İzmir", acceptingOrders: false })],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  check(
    "sipariş almayan atölye il almaz",
    plannedOwnerOf(plan, "Manisa", RESIN)?.nearestMiss?.blockedBy === "Sipariş almıyor"
  );
}

{
  const filamentOnly = shop({ id: "fil", il: "İzmir", capabilities: ["material_filament"] });
  const plan = computeCoveragePlan({
    workshops: [filamentOnly],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...COVERAGE_MATERIALS],
  });
  check(
    "filament atölyesi REÇİNE ilini almaz",
    plannedOwnerOf(plan, "Manisa", "resin")?.manufacturerId === null
  );
  check(
    "aynı atölye FİLAMENT ilini alır",
    plannedOwnerOf(plan, "Manisa", "filament")?.manufacturerId === "fil"
  );
  check(
    "etiketsiz atölye her malzemeyi basar (sıralayıcı mirası)",
    (() => {
      const p = computeCoveragePlan({
        workshops: [shop({ id: "eski", il: "İzmir", capabilities: null })],
        overrides: [],
        provinces: ["Manisa"],
        materials: [...COVERAGE_MATERIALS],
      });
      return COVERAGE_MATERIALS.every(
        (m) => plannedOwnerOf(p, "Manisa", m)?.manufacturerId === "eski"
      );
    })()
  );
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "adressiz", il: null })],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  check(
    "adresinde il olmayan atölye hesaba giremez",
    plannedOwnerOf(plan, "Manisa", RESIN)?.nearestMiss?.blockedBy ===
      "Adresinde tanınan il yok"
  );
}

// ─── 4. PİN ve DIŞLAMA: sahibin kaldıraçları ────────────────────────────────
console.log("\npin / dışlama");

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "yakin", il: "İzmir" }), shop({ id: "uzak", il: "Van" })],
    overrides: [ov({ il: "Manisa", material: RESIN, kind: "pin", manufacturerId: "uzak" })],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Manisa", RESIN);
  check("pin mesafeyi yener", row?.manufacturerId === "uzak" && row.source === "pinned");
  check("pinli satırda uyarı yok (atölye uygun)", row?.warning === undefined);
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "dolu", il: "Van", hasRoom: false, loadUnits: 9, max: 5 })],
    overrides: [ov({ il: "Manisa", material: RESIN, kind: "pin", manufacturerId: "dolu" })],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Manisa", RESIN);
  check("pin kapasiteye BAKMAZ: sahip yine pinli atölyedir", row?.manufacturerId === "dolu");
  check(
    "ama satır uyarı taşır (yönetici kendi kaldıracı hakkında yanıltılmaz)",
    !!row?.warning && row.warning.includes("Kapasite dolu")
  );
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "yakin", il: "İzmir" })],
    overrides: [ov({ il: "Manisa", material: RESIN, kind: "exclude", note: "kargo yok" })],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Manisa", RESIN);
  check("dışlanan il hesaba rağmen sahipsizdir", row?.manufacturerId === null);
  check(
    "kaynak 'excluded' ve not gerekçeye girer",
    row?.source === "excluded" && row.reason.includes("kargo yok")
  );
  check(
    "dışlanan il SAHİPSİZ listesine girmez (bilinçli karar, boşluk değil)",
    plan.unowned.length === 0
  );
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "yakin", il: "İzmir" })],
    overrides: [ov({ il: "Manisa", material: RESIN, kind: "pin", manufacturerId: "silinmis" })],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  const row = plannedOwnerOf(plan, "Manisa", RESIN);
  check("listede olmayan atölyeye pin hesaba DÜŞER", row?.manufacturerId === "yakin");
  check("ve satır bunu söyler", !!row?.warning && row.warning.includes("listede yok"));
}

{
  const plan = computeCoveragePlan({
    workshops: [shop({ id: "a", il: "İzmir" })],
    overrides: [ov({ il: "Manisa", material: "filament", kind: "exclude" })],
    provinces: ["Manisa"],
    materials: [...COVERAGE_MATERIALS],
  });
  check(
    "müdahale YALNIZ kendi malzemesini etkiler",
    plannedOwnerOf(plan, "Manisa", "resin")?.manufacturerId === "a" &&
      plannedOwnerOf(plan, "Manisa", "filament")?.source === "excluded"
  );
}

// ─── 5. KARARLILIK ve EŞİTLİK BOZUCU ────────────────────────────────────────
console.log("\nkararlılık");

{
  const a = shop({ id: "a", name: "B Atölye", il: "İzmir", loadUnits: 3 });
  const b = shop({ id: "b", name: "A Atölye", il: "İzmir", loadUnits: 1 });
  const plan = computeCoveragePlan({
    workshops: [a, b],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  check(
    "eşit mesafede AZ YÜKLÜ olan kazanır",
    plannedOwnerOf(plan, "Manisa", RESIN)?.manufacturerId === "b"
  );

  const c = shop({ id: "c", name: "Z Atölye", il: "İzmir", loadUnits: 1 });
  const d = shop({ id: "d", name: "A Atölye", il: "İzmir", loadUnits: 1 });
  const tie = computeCoveragePlan({
    workshops: [c, d],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  check(
    "mesafe ve yük eşitse unvan (Türkçe) belirler",
    plannedOwnerOf(tie, "Manisa", RESIN)?.manufacturerId === "d"
  );

  const again = computeCoveragePlan({
    workshops: [c, d],
    overrides: [],
    provinces: ["Manisa"],
    materials: [...MAT],
  });
  check(
    "aynı girdi → aynı çıktı (plan kararlıdır)",
    JSON.stringify(again.assignments) === JSON.stringify(tie.assignments)
  );
}

// ─── 6. BÜTÜNLÜK: 81 il × malzeme ───────────────────────────────────────────
console.log("\nbütünlük ve istatistik");

{
  const plan = computeCoveragePlan({
    workshops: [
      shop({ id: "ist", il: "İstanbul", typedCoverage: ["Ankara"] }),
      shop({ id: "ank", il: "Ankara" }),
    ],
    overrides: [],
  });
  check(
    "her il × malzeme için TEK satır üretilir",
    plan.assignments.length === PROVINCES.length * COVERAGE_MATERIALS.length,
    String(plan.assignments.length)
  );
  check(
    "hiçbir hücre boş kalmaz (81 ilin tamamı cevaplanır)",
    COVERAGE_MATERIALS.every((m) =>
      PROVINCES.every((il) => plannedOwnerOf(plan, il, m) !== null)
    )
  );
  check(
    "istatistik toplamı hücre sayısını verir",
    plan.stats.owned + plan.stats.unowned + plan.stats.excluded === plan.stats.cells
  );
  check(
    "SAHİPSİZ İL GERÇEKTEN ÖLÇÜLÜYOR: iki atölyelik ağda boş iller kalır",
    plan.stats.unowned > 0,
    `sahipsiz hücre: ${plan.stats.unowned}`
  );
  check(
    "plannedCoverageFor, atamalardan türeyen İL listesini verir",
    (() => {
      const list = plannedCoverageFor(plan, "ist");
      const fromRows = [
        ...new Set(
          plan.assignments.filter((x) => x.manufacturerId === "ist").map((x) => x.il)
        ),
      ].sort((x, y) => x.localeCompare(y, "tr"));
      return JSON.stringify(list) === JSON.stringify(fromRows) && list.includes("İstanbul");
    })()
  );
  const diff = plan.diff.find((d) => d.manufacturerId === "ist");
  check(
    "fark: elle yazılan ama hesapta olmayan il 'removed'a düşer",
    !!diff && diff.typed.includes("Ankara") && diff.removed.includes("Ankara"),
    diff ? diff.removed.join(",") : "satır yok"
  );
  check(
    "fark: konum ili elle yazılan listeye otomatik girer (effectiveCoverage)",
    !!diff && diff.typed.includes("İstanbul")
  );

  // ── Sıralayıcının yuvasına takılan fiş, PLANIN KENDİSİNİ okur ──
  const resolver = coveragePlanResolver(plan);
  check(
    "coveragePlanResolver, plannedCoverageFor ile AYNI listeyi verir",
    JSON.stringify(
      resolver({ manufacturerId: "ist", il: "İstanbul", coverageProvinces: ["Ankara"] })
    ) === JSON.stringify(plannedCoverageFor(plan, "ist"))
  );
  check(
    "fiş, elle yazılmış listeyi YOK SAYAR (hesaplanan yolu temsil eder)",
    !resolver({
      manufacturerId: "ist",
      il: "İstanbul",
      coverageProvinces: ["Hakkari"],
    }).includes("Hakkari")
  );
  check(
    "tanınmayan atölye için boş liste döner (uydurma kapsama yok)",
    resolver({ manufacturerId: "yok", il: null, coverageProvinces: null }).length === 0
  );
}

// ─── 7. TEK HESAP SÖZLEŞMESİ: kural kopyası YOK ─────────────────────────────
console.log("\ntek hesap sözleşmesi");

check(
  "mesafe yeniden türetilmez (provinceDistanceUnits import edilir)",
  ownerCode.includes("provinceDistanceUnits") && !/Math\.hypot/.test(ownerCode)
);
check(
  "malzeme kuralı yeniden türetilmez (manufacturerSupportsMaterial import edilir)",
  ownerCode.includes("manufacturerSupportsMaterial") && !/material_/.test(ownerCode)
);
check(
  "kapasite ölçüsü tek sahibinden gelir (manufacturer-capacity import edilir)",
  ownerCode.includes("manufacturer-capacity") && ownerCode.includes("manufacturerHasRoom")
);
check(
  "plan kendi yük sayımını KURMAZ (ağırlık kuralı burada yazılmaz)",
  !/1\s*\+\s*Math\.floor/.test(ownerCode) && !ownerCode.includes("painterLoadUnits")
);
check(
  "kapasite eşiği yeniden yazılmaz",
  !/loadUnits\s*[<>]=?\s*maxConcurrentOrders/.test(ownerCode)
);
check(
  "elle yazılmış listenin etkin hâli effectiveCoverage'tan gelir",
  ownerCode.includes("effectiveCoverage")
);
check(
  "malzeme listesi pg enum'undan okunur (elle yazılmış dizi yok)",
  ownerCode.includes("figurineMaterialEnum.enumValues")
);
check(
  "sıralayıcının yuvasına takılan fiş var (CoverageResolver)",
  ownerCode.includes("CoverageResolver") && ownerCode.includes("coveragePlanResolver")
);
check("plan modülü server-only import ETMEZ", !/["']server-only["']/.test(ownerCode));

/**
 * TARAYICI — ikinci bir "en yakın atölye" hesabı var mı?
 *
 * ESKİ İMZA SÖZÜNDEN DARDI: yalnız `src/` altına bakıyor ve tam olarak
 * `provinceDistanceUnits` + `PROVINCES` ÇİFTİNİ arıyordu. Başka isimlerle
 * yazılmış bir ikinci hesap (kendi haversine'i olan, modülü takma adla ya da
 * `import * as` ile alan) veya `scripts/` ya da `workers/` altına konmuş bir
 * kopya fark edilmeden geçerdi. Guard, vaat ettiği şeyi ölçmek zorunda.
 *
 * YENİ İMZA — ÜÇ EKSENİN KESİŞİMİ. Üçü birden varsa dosya "hangi il hangi
 * atölyenin" sorusunu yeniden cevaplıyor demektir:
 *   1. MESAFE   : il mesafesini ölçüyor mu? Modül YOLU da sayılır — yol
 *                 eşleşmesi takma adla atlatılamaz — ve yanında el yapımı
 *                 yöntemler (haversine, hypot, atan2) da aranır.
 *   2. İL KÜMESİ: 81 ilin listesini geziyor mu?
 *   3. ATÖLYE   : sonucu bir partnere bağlıyor mu?
 *
 * Üçüncü eksen, il geometrisiyle uğraşan ama kimseye il DAĞITMAYAN dosyaları
 * (mesafe verisinin kendisi, SVG yol üreteci) kendiliğinden dışarıda bırakır;
 * onlar için muafiyet yazmak gerekmez.
 *
 * MUAFİYET İLKESİ: planı IMPORT eden dosya tek hesabı OKUYOR demektir,
 * kopyalamıyor. Bunun dışındaki her muafiyet elle ve GEREKÇESİYLE yazılır, yani
 * bir kopyayı görünmez kılmak ancak bilinçli bir hamle olabilir.
 */
const SCAN_ROOTS = ["src", "scripts", "workers"] as const;
/** Bu dosya kuralın KENDİSİNİ yazıyor; tarama kendi imzasını kopya sanmamalı. */
const SELF = "scripts/test-coverage-plan.ts";

const DISTANCE_SIGNALS: RegExp[] = [
  /from\s+["'][^"']*data\/province-distance["']/,
  /provinceDistanceUnits|provinceDistanceKm|provinceAnchor/,
  /MAP_UNIT_KM/,
  /haversine/i,
  /Math\.hypot/,
  /Math\.atan2/,
];
const PROVINCE_SET_SIGNALS: RegExp[] = [
  /from\s+["'][^"']*data\/turkey-address["']/,
  /\bPROVINCES\b/,
  /PROVINCES_BY_REGION/,
];
const WORKSHOP_SIGNALS: RegExp[] = [
  /manufacturer/i,
  /workshop/i,
  /painter/i,
  /CoverageWorkshop/,
];
const READS_THE_PLAN = /from\s+["'][^"']*services\/coverage-plan["']/;

/** Elle yazılmış muafiyetler — her satır NEDEN kopya olmadığını söyler. */
const SCAN_ALLOW: Record<string, string> = {
  "scripts/test-province-distance.ts":
    "mesafe verisini ve sıralayıcının mesafe kademelerini sınar; il -> atölye eşlemesi kurmaz",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Taranan dosyalar BİR KEZ okunur; iki tarama da aynı kümeyi kullanır. */
const SCANNED: { rel: string; code: string }[] = [];
for (const root of SCAN_ROOTS) {
  const full = join(ROOT, root);
  if (!existsSync(full)) continue;
  for (const file of walk(full)) {
    SCANNED.push({
      rel: relative(ROOT, file),
      code: stripComments(readFileSync(file, "utf8")),
    });
  }
}

check(
  "tarama üç kökü de geziyor (sessizce boş kalan bir kök guard'ı yok ederdi)",
  SCAN_ROOTS.every((r) => SCANNED.some((f) => f.rel.startsWith(r + "/"))),
  `${SCANNED.length} dosya`
);

/**
 * NEGATİF KONTROL: hiç ateşleyemeyen bir guard, guard değildir. Aşağıdaki
 * uydurma dosya ikinci hesabı BAŞKA isimlerle yazıyor (provinceDistanceUnits
 * yerine Math.hypot) — eski imza bunu kaçırırdı, yenisi yakalamak zorunda.
 */
check(
  "tarayıcı başka isimlerle yazılmış bir ikinci hesabı da yakalar",
  (() => {
    const fake = [
      'import { PROVINCES } from "@/lib/data/turkey-address";',
      "function nearestShop(m: { manufacturerId: string }) {",
      "  return Math.hypot(1, 2) + PROVINCES.length + m.manufacturerId.length;",
      "}",
    ].join("\n");
    return (
      DISTANCE_SIGNALS.some((re) => re.test(fake)) &&
      PROVINCE_SET_SIGNALS.some((re) => re.test(fake)) &&
      WORKSHOP_SIGNALS.some((re) => re.test(fake))
    );
  })()
);

const copies: string[] = [];
for (const f of SCANNED) {
  if (f.rel === OWNER || f.rel === SELF) continue;
  if (SCAN_ALLOW[f.rel]) continue;
  // Planı okuyan dosya tek hesabı tüketiyor demektir.
  if (READS_THE_PLAN.test(f.code)) continue;
  const measuresDistance = DISTANCE_SIGNALS.some((re) => re.test(f.code));
  const walksProvinces = PROVINCE_SET_SIGNALS.some((re) => re.test(f.code));
  const picksWorkshop = WORKSHOP_SIGNALS.some((re) => re.test(f.code));
  if (measuresDistance && walksProvinces && picksWorkshop) copies.push(f.rel);
}
check(
  `"en yakın atölye" hesabı YALNIZ ${OWNER} içinde`,
  copies.length === 0,
  copies.length
    ? `ikinci kopya: ${copies.join(", ")} — harita ve atama skoru tek hesabı okumak zorunda`
    : undefined
);

// Pin/dışlama kuralını da yalnız plan ve onu YAZAN uç bilebilir. Bu tarama da
// artık üç kökü birden geziyor: tabloyu okuyan bir worker ya da script, en az
// bir ekran kadar tehlikelidir (kimse görmeden ikinci bir yorum kurar).
const overrideReaders: string[] = [];
for (const f of SCANNED) {
  if (
    f.rel === OWNER ||
    f.rel === SELF ||
    f.rel === "src/lib/db/schema.ts" ||
    f.rel.startsWith("src/app/api/admin/coverage/")
  ) {
    continue;
  }
  if (/coverageOverrides\b/.test(f.code)) overrideReaders.push(f.rel);
}
check(
  "müdahale tablosunu plan ve yazan uç dışında kimse okumuyor",
  overrideReaders.length === 0,
  overrideReaders.join(", ")
);

check(
  "admin istemci bileşeni servis modülünden YALNIZCA tip import eder",
  !/^import\s+(?!type\b)[^;]*from\s+"@\/lib\/services\//m.test(
    readFileSync(join(ROOT, "src/app/admin/coverage/coverage-client.tsx"), "utf8")
  )
);

// ─── 8. KAPASİTE ÖLÇÜSÜNÜN TEK SAHİBİ ───────────────────────────────────────
//
// Plan hiçbir tezgâh sorgusu kurmaz: üretici yükünün tek sahibi K2'nin
// modülüdür. İkinci bir yükleyici, Faz 4'ün boyacı tarafında ölçülen kusurun
// (ekran bir ölçüyle kapatırken ucun başka bir ölçüyle kabul etmesi) üretici
// tarafındaki tıpatıp aynısını doğurur.
console.log("\nkapasite ölçüsünün tek sahibi");

const MFG_CAPACITY = "src/lib/services/manufacturer-capacity.ts";
check(`${MFG_CAPACITY} var`, existsSync(join(ROOT, MFG_CAPACITY)));
check(
  "plan kendi tezgâh sorgusunu KURMAZ",
  !/from\(orders\)/.test(ownerCode) && !ownerCode.includes("ACTIVE_MFG_STATUSES"),
  "kapasite yalnız manufacturer-capacity.ts'ten okunmalı"
);
check(
  "plan kapasite yükleyicisini çağırır",
  ownerCode.includes("loadManufacturerCapacities")
);

// ─── 9. MIGRATION ÇİFTİ ─────────────────────────────────────────────────────
console.log("\nmigration 0058 (geri alınabilir çift)");

const migrations = readdirSync(join(ROOT, "drizzle")).filter((f) => f.startsWith("0058_"));
const upFile = migrations.find((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"));
const downFile = migrations.find((f) => f.endsWith(".down.sql"));
check("0058 up dosyası var", !!upFile, migrations.join(", "));
check("0058 down dosyası var", !!downFile);

if (upFile && downFile) {
  const up = readFileSync(join(ROOT, "drizzle", upFile), "utf8");
  const down = readFileSync(join(ROOT, "drizzle", downFile), "utf8");
  /**
   * SQL yorumlarını at — TS tarafındaki `stripComments` ile BİREBİR aynı
   * gerekçe: geri alma dosyasının başlığı, yapılmaması gerekeni ("ORDER BY
   * created_at DESC LIMIT 1") ve dokunulmayan tabloların adlarını
   * (`manufacturers.coverage_provinces`) ANLATIYOR. Yorumları koddan saymayan
   * bir tarama, dosyanın kendi uyarısını ihlal sanar ve doğru yazılmış bir geri
   * almayı reddeder. Yargı KODA bakar: aşağıdaki denetimler yalnız çalışan
   * ifadeleri görür, yani etiket numarası da gerçekten DELETE'in içinde olmak
   * zorundadır.
   */
  const downCode = down.replace(/--.*$/gm, "");
  const journal = JSON.parse(
    readFileSync(join(ROOT, "drizzle/meta/_journal.json"), "utf8")
  ) as { entries: { idx: number; when: number; tag: string }[] };
  const entry = journal.entries.find((e) => e.tag === upFile.replace(/\.sql$/, ""));

  check("up: lock_timeout kurulu", /SET lock_timeout\s*=\s*'5s'/.test(up));
  check("up: IF NOT EXISTS ile tekrar çalıştırılabilir", /CREATE TABLE IF NOT EXISTS/.test(up));
  check(
    "up: indeksler de IF NOT EXISTS",
    (up.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length === 2
  );
  check("up: statement-breakpoint ayırıcıları var", up.includes("--> statement-breakpoint"));
  check("journal kaydı var", !!entry, journal.entries.map((e) => e.tag).join(", "));
  check(
    "down: KENDİ satırını etiketiyle siler ('en yenisini' DEĞİL)",
    !!entry &&
      downCode.includes(String(entry.when)) &&
      !/ORDER BY created_at DESC/i.test(downCode)
  );
  check(
    "down: yalnız kendi tablosunu düşürür",
    /DROP TABLE IF EXISTS (?:public\.)?"coverage_overrides"/.test(downCode)
  );
  check(
    "down: operatör/müşteri verisine dokunmaz",
    !/DROP TABLE(?!\s+IF EXISTS\s+(?:public\.)?"coverage_overrides")/i.test(downCode) &&
      !/\b(orders|manufacturers|painters|users|order_items)\b/.test(downCode)
  );
  check("down: lock_timeout kurulu", /SET (?:LOCAL )?lock_timeout\s*=\s*'5s'/.test(downCode));
  check(
    "anlık görüntü dosyası var",
    existsSync(join(ROOT, `drizzle/meta/${String(entry?.idx).padStart(4, "0")}_snapshot.json`))
  );
  check(
    "up'taki kısıt/indeks adları anlık görüntüyle birebir",
    (() => {
      if (!entry) return false;
      const snap = readFileSync(
        join(ROOT, `drizzle/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`),
        "utf8"
      );
      return [
        "coverage_overrides_manufacturer_id_manufacturers_id_fk",
        "coverage_overrides_il_material_idx",
        "coverage_overrides_manufacturer_idx",
      ].every((name) => up.includes(name) && snap.includes(name));
    })()
  );
}

// ─── 10. PLAN → HARİTA KÖPRÜSÜ ──────────────────────────────────────────────
//
// Fazın müşteriye bakan hedefi: yöneticinin PİNİ ve DIŞLAMASI anasayfa
// haritasında görünmeli. Ölçülen kusur, haritanın hâlâ elle yazılan kolonu
// okumasıydı — plan ekranı reçine için 25 il derken harita 9 diyordu ve iki
// kaldıraç da public yüzeyde hiçbir şey yapmıyordu.
//
// Harita planı okur, ama bu bir SIRALAMA kararı DEĞİLDİR: harita kimseye iş ya
// da gelir yazmaz, bu yüzden ranker-rollout = B'nin (yeni sinyaller önce
// gölgede) kapsamına girmez. Canlı atama skoru elle yazılan listeyi okumaya
// devam eder ve bu ayrımın ekranlarda yazılı olması aşağıda ayrıca sınanır.
console.log("\nplan → harita köprüsü");

{
  const izmirOnly = [shop({ id: "izmir", il: "İzmir" })];

  const excluded = computeCoveragePlan({
    workshops: izmirOnly,
    overrides: [ov({ il: "Manisa", material: RESIN, kind: "exclude" })],
    provinces: ["İzmir", "Manisa"],
    materials: [...MAT],
  });
  const excludedMap = buildNetworkMap([
    {
      kind: "manufacturer",
      il: "İzmir",
      plannedCoverage: plannedCoverageFor(excluded, "izmir"),
    },
  ]);
  check(
    "DIŞLANAN il public haritada kapsanmış görünmez",
    (excludedMap.provinces["Manisa"]?.covered.length ?? 0) === 0
  );
  check(
    "plandaki il public haritada kapsanmış görünür",
    excludedMap.provinces["İzmir"]?.covered.length === 1
  );

  // Atölyenin KENDİ ili dışlanmışsa: atölye haritada durur (orada gerçekten
  // var), ama il "hizmet veriliyor" diye SAYILMAZ. Eski yol bunu yapamazdı,
  // çünkü `effectiveCoverage` konum ilini her zaman kapsamaya ekliyordu.
  const ownExcluded = computeCoveragePlan({
    workshops: izmirOnly,
    overrides: [ov({ il: "İzmir", material: RESIN, kind: "exclude" })],
    provinces: ["İzmir"],
    materials: [...MAT],
  });
  const ownMap = buildNetworkMap([
    {
      kind: "manufacturer",
      il: "İzmir",
      plannedCoverage: plannedCoverageFor(ownExcluded, "izmir"),
    },
  ]);
  check(
    "dışlanan konum ili: atölye haritada, il kapsanmamış ve sayaçta yok",
    ownMap.provinces["İzmir"].located.length === 1 &&
      ownMap.provinces["İzmir"].covered.length === 0 &&
      ownMap.stats.coveredProvinces === 0,
    `covered=${ownMap.provinces["İzmir"].covered.length}, sayaç=${ownMap.stats.coveredProvinces}`
  );

  // PİN: mesafeyi yenen il, haritada da pinli atölyenin kapsamasında.
  const pinned = computeCoveragePlan({
    workshops: [shop({ id: "izmir", il: "İzmir" }), shop({ id: "van", il: "Van" })],
    overrides: [ov({ il: "Ankara", material: RESIN, kind: "pin", manufacturerId: "van" })],
    provinces: ["Ankara"],
    materials: [...MAT],
  });
  const pinMap = buildNetworkMap([
    { kind: "manufacturer", il: "Van", plannedCoverage: plannedCoverageFor(pinned, "van") },
  ]);
  check(
    "PİNLENEN il public haritada pinli atölyeye yazılır",
    pinMap.provinces["Ankara"]?.covered.length === 1
  );

  // Plan bir atölyeye hiç il vermediyse BOŞ DİZİ gider; bu, elle yazılan
  // listeye düşmek için bir sebep değildir (düşseydi dışlama iptal olurdu).
  const emptyMap = buildNetworkMap([
    { kind: "manufacturer", il: "İzmir", coverageProvinces: ["Manisa"], plannedCoverage: [] },
  ]);
  check(
    "boş plan elle yazılan listeye DÜŞMEZ",
    (emptyMap.provinces["Manisa"]?.covered.length ?? 0) === 0 &&
      emptyMap.partners[0].coverage.length === 0
  );

  // Boyacı plana girmez (plan, ilin nerede BASILDIĞININ hesabıdır): satırı
  // plansız geçer ve konum ilini kapsama olarak korur.
  const painterMap = buildNetworkMap([{ kind: "painter", il: "Ankara" }]);
  check(
    "boyacı plansız geçer, konum ili kapsama sayılır",
    painterMap.provinces["Ankara"]?.covered.length === 1
  );
}

// ── Kablolama: harita servisi planı OKUMAK zorunda, kolonu değil ──
{
  const mapCode = stripComments(
    readFileSync(join(ROOT, "src/lib/services/network-map.ts"), "utf8")
  );
  check(
    "harita servisi tek hesabı yükler",
    mapCode.includes("loadCoveragePlan") && mapCode.includes("plannedCoverageFor")
  );
  // Dosyada İKİ yükleyici var ve yalnız biri public. `getNetworkMapData`
  // (anasayfa) planı okur; `getAdminNetworkPartners` ise elle-seçim editörünü
  // besler ve elle yazılan kolonu okumak ZORUNDADIR, çünkü canlı atama skoru bu
  // fazda hâlâ o listeyi okuyor (ranker-rollout = B). Denetim bu yüzden dosyanın
  // tamamına değil PUBLIC fonksiyonun gövdesine bakar; tamamına bakan bir kural
  // editörü de sökmeye zorlardı ve yöneticiyi kendi listesine kör bırakırdı.
  const publicStart = mapCode.indexOf("export async function getNetworkMapData");
  const adminStart = mapCode.indexOf("export interface AdminNetworkPartner");
  const publicMapFn =
    publicStart >= 0 && adminStart > publicStart
      ? mapCode.slice(publicStart, adminStart)
      : "";
  check(
    "public harita fonksiyonu elle yazılan kolonu ARTIK okumaz",
    publicMapFn.length > 0 && !publicMapFn.includes("coverageProvinces"),
    "kolonu okumayan bir harita eski hikâyeyi yanlışlıkla da anlatamaz"
  );
  check(
    "elle-seçim editörünün yükleyicisi kolonu okumaya DEVAM eder",
    adminStart >= 0 && mapCode.slice(adminStart).includes("coverageProvinces"),
    "canlı sıralama hâlâ bu listeyi okuyor; editör boş gösterirse yönetici kör kalır"
  );
  check(
    "public harita yalnız görünür partnerleri yayımlar",
    mapCode.includes("mapVisible")
  );

  const routeCode = stripComments(
    readFileSync(join(ROOT, "src/app/api/admin/coverage/route.ts"), "utf8")
  );
  check(
    "müdahale ucu anasayfayı da tazeler (pin bir dakika gecikmez)",
    (routeCode.match(/revalidatePath\("\/"\)/g) ?? []).length === 2,
    "PUT ve DELETE'in ikisinde de olmalı"
  );
  check(
    "müdahale ucu plan ekranını da tazeler",
    (routeCode.match(/revalidatePath\("\/admin\/coverage"\)/g) ?? []).length === 2
  );

  const sidebarCode = stripComments(
    readFileSync(join(ROOT, "src/app/admin/sidebar.tsx"), "utf8")
  );
  check(
    "fazın ana ekranı admin menüsünde (yalnız URL yazarak açılmıyor)",
    sidebarCode.includes('href: "/admin/coverage"')
  );

  // İki ekran aynı konuda konuşuyor; hangisinin hangi yüzeyi beslediği YAZILI
  // olmalı, yoksa yönetici aynı panelde iki etki alanı hikâyesi okur.
  const editorCode = readFileSync(
    join(ROOT, "src/app/admin/network-map/network-map-client.tsx"),
    "utf8"
  );
  check(
    "elle seçim ekranı hangi yüzeyi beslediğini söylüyor ve plana yönlendiriyor",
    editorCode.includes("/admin/coverage") && /public harita/i.test(editorCode)
  );
}

/**
 * SQL'i gerçekten çalıştırır: koşulsuz DROP, kontrol/kilit yarışı veya ayrı
 * işlemde journal silme operatör kararını kaybetmemeli. DATABASE_URL kullanılmaz.
 */
async function testRollbackDatabase(): Promise<void> {
  const connectionString = process.env.QA_MIGRATION_PG_URL;
  if (!connectionString) return;
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "55433" || url.pathname !== "/postgres" || url.search
  ) throw new Error("QA_MIGRATION_PG_URL must target localhost:55433/postgres without query options");

  const { Client } = await import("pg");
  const { randomUUID } = await import("node:crypto");
  const database = `coverage_0058_${randomUUID().replaceAll("-", "")}`;
  const control = new Client({ connectionString });
  const scratchUrl = new URL(url);
  scratchUrl.pathname = `/${database}`;
  const db = new Client({ connectionString: scratchUrl.href });
  const writer = new Client({ connectionString: scratchUrl.href });
  let created = false;
  try {
    await control.connect();
    await control.query(`CREATE DATABASE "${database}"`);
    created = true;
    await db.connect();
    await writer.connect();
    console.log(`\n0058 PostgreSQL scratch: ${database} (:55433)`);
    const up = readFileSync(join(ROOT, "drizzle", upFile!), "utf8");
    const down = readFileSync(join(ROOT, "drizzle", downFile!), "utf8");
    // Match a runner sending individual top-level statements, not pg's implicit
    // transaction for a whole SQL file. DO's internal semicolons stay intact.
    const runDown = async () => {
      const code = down.replace(/--.*$/gm, "");
      const statements = code.match(/\s*DO\s+\$\$[\s\S]*?\$\$\s*;|[^;]+;/gi) ?? [];
      for (const statement of statements) await db.query(statement);
    };
    await db.query(`CREATE TABLE public.manufacturers (id uuid PRIMARY KEY);
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
        ('previous', 1789582571938), ('0058', 1789582571939), ('later', 1789582571940)`);
    const journal = async () => (await db.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    const tableExists = async () => (await db.query("SELECT to_regclass('public.coverage_overrides') AS name")).rows[0].name !== null;
    await db.query(up);
    await db.query(up);
    await runDown();
    check("DB: boş down yalnız kendi tablosunu ve journal satırını kaldırır",
      !(await tableExists()) && (await journal()).map(r => r.hash).join(",") === "previous,later");
    await runDown();
    await db.query(up);
    check("DB: boş up → down → down → up tekrar çalışır", await tableExists());
    await db.query("INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0058', 1789582571939)");
    const rowId = "00580000-0000-4000-8000-000000000001";
    const insert = `INSERT INTO coverage_overrides (id, il, material, kind, created_by, note)
      VALUES ($1, 'Ankara', 'resin', 'exclude', 'rollback-test', 'operator decision')`;
    await db.query(insert, [rowId]);
    const beforeRows = (await db.query("SELECT * FROM coverage_overrides")).rows;
    const beforeJournal = await journal();
    let refused = false;
    try { await runDown(); } catch (error) { refused = (error as { code?: string }).code === "P0001"; }
    check("DB: dolu tablo geri almayı reddeder", refused);
    const preserved = await tableExists();
    check("DB: reddedilen down operatör satırını aynen korur", preserved &&
      JSON.stringify((await db.query("SELECT * FROM coverage_overrides")).rows) === JSON.stringify(beforeRows));
    check("DB: reddedilen down journal kaydını aynen korur", JSON.stringify(await journal()) === JSON.stringify(beforeJournal));
    if (!preserved) return; // Old unsafe SQL failed; don't mask it with missing-table errors.

    // A writer owns the table lock first. Down must wait, then observe its
    // committed row and refuse; a pre-lock empty check would lose this row.
    await db.query("DELETE FROM coverage_overrides WHERE id = $1", [rowId]);
    await writer.query("BEGIN");
    await writer.query(insert, [rowId]);
    const pid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const pending = runDown().then(() => false, error => error.code === "P0001");
    let waiting = false;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const activity = await control.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
      if (activity.rows[0]?.wait_event_type === "Lock") { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await writer.query("COMMIT");
    const concurrentRefusal = await pending;
    check("DB: eşzamanlı yazarı bekler ve commit sonrası dolu tabloyu reddeder", waiting && concurrentRefusal);
    check("DB: eşzamanlı satır ve journal kaybolmaz", await tableExists() &&
      (await db.query("SELECT id FROM coverage_overrides WHERE id = $1", [rowId])).rowCount === 1 &&
      JSON.stringify(await journal()) === JSON.stringify(beforeJournal));

    // A journal failure after DROP must roll the DROP back, even without an
    // explicit transaction supplied by the migration runner.
    await db.query("DELETE FROM coverage_overrides WHERE id = $1", [rowId]);
    await db.query(`CREATE FUNCTION refuse_journal_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'journal failure fixture'; END $$;
      CREATE TRIGGER refuse_delete BEFORE DELETE ON drizzle.__drizzle_migrations
      FOR EACH ROW EXECUTE FUNCTION refuse_journal_delete()`);
    try { await runDown(); } catch { /* Assert both effects below. */ }
    check("DB: journal silme hatası DROP işlemini de geri alır", await tableExists() &&
      JSON.stringify(await journal()) === JSON.stringify(beforeJournal));
    await db.query("DROP TRIGGER refuse_delete ON drizzle.__drizzle_migrations");
    await runDown();
    await runDown();
    await db.query(up);
    check("DB: ret sonrası boşaltılan scratch tabloda roundtrip başarılı", await tableExists());
    await db.query("DROP SCHEMA drizzle CASCADE");
    await runDown();
    await runDown();
    check("DB: journal şeması yokken de down idempotent", !(await tableExists()));
  } finally {
    await writer.end();
    await db.end();
    if (created) {
      await control.query(`DROP DATABASE "${database}"`);
      console.log(`scratch temizlendi: ${database}`);
    }
    await control.end();
  }
}

// ─── Sonuç ──────────────────────────────────────────────────────────────────
testRollbackDatabase().catch((error) => {
  check("DB: rollback testi tamamlandı", false, String(error));
}).then(() => {
console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail > 0) {
  console.log("\nBaşarısızlar:");
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
});
