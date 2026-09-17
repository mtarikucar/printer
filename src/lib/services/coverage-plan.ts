/**
 * ETKİ ALANI PLANI — 81 ilin, MALZEME BAZINDA, hangi atölyeye ait olduğunun
 * TEK hesabı.
 *
 * NEDEN BU DOSYA VAR (ölçülen kusur): etki alanı bugüne kadar ELLE YAZILIYORDU
 * (`manufacturers.coverage_provinces`) ve o listeyi İKİ ayrı yüzey okuyordu:
 * anasayfadaki public harita (`services/network-map.ts` → `buildNetworkMap`) ve
 * atama mesafe skoru (`services/manufacturer-assignment.ts` → `distanceScore` /
 * `distanceScoreContinuous`). İkisi bugün yalnızca AYNI KOLONU okudukları için
 * anlaşıyor — hangi ilin gerçekten karşılandığına dair bir HESAP yok, yalnızca
 * bir beyan var. Beyan boşsa harita "burada üretim yok" der, sıralayıcı ise
 * yine de o ile en yakın atölyeyi atar: iki yüzey aynı soruya iki cevap verir.
 *
 * Faz 5 kararı (coverage-model = B): kapsama TIKLANMAZ, HESAPLANIR. Elle
 * yazılan liste zorunlu olmaktan çıkar; yöneticinin kaldıraçları PİN (bu il her
 * zaman şu atölyenin) ve DIŞLAMA (bu il hiçbir zaman kapsanmaz) olarak kalır.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TEK HESAP SÖZLEŞMESİ — hem harita hem skor BURAYI okumak zorundadır.
 *
 * Bu modül "şu il, şu malzemede kimin?" sorusunun tek cevabıdır. Sıralayıcı
 * tarafındaki bağlantı noktası `config/scoring.ts` · `CoverageResolver`
 * yuvasıdır ve bu dosya o yuvaya takılan fonksiyonu üretir
 * (`coveragePlanResolver`). İkinci bir kopya (harita için ayrı bir yakınlık
 * hesabı, sıralayıcı için ayrı bir kapsama tablosu) tam olarak Faz 5'in
 * kapatmaya çalıştığı kusuru geri getirir: müşteriye "bu ilde üretim var" diyen
 * harita ile işi başka ile gönderen sıralayıcı. `scripts/test-coverage-plan.ts`
 * her koşuda depoyu tarar ve ikinci bir "en yakın atölye" hesabı belirirse
 * düşer.
 *
 * BU FAZDA KİMSENİN İŞİ DEĞİŞMEZ: burada üretilen plan HESAPLANIR ve
 * GÖSTERİLİR. Canlı sıralamanın elle yazılmış listeyi bırakıp bu planı
 * okuması, gölge karşılaştırmasının kararıdır (ranker-rollout = B) ve bu
 * modülün dışındadır. Plan hiçbir yerde bir kapı DEĞİLDİR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YENİDEN TÜRETİLMEYEN KURALLAR (hepsi IMPORT edilir, kopyalanmaz):
 *  - mesafe: `provinceDistanceUnits` (il çapaları; distance-source = A kararı,
 *    yeni bir enlem/boylam tablosu YOK),
 *  - malzeme uygunluğu: `manufacturerSupportsMaterial` — sıralayıcının kapısının
 *    ta kendisi. Haritanın public rozet kuralı (`materialsOf`) BİLEREK
 *    kullanılmaz: o, etiketsiz eski kayda rozet BASMAZ; yönlendirme ise aynı
 *    kayda "her malzemeyi basar" der. Plan bir YÖNLENDİRME belgesidir, bu yüzden
 *    sıralayıcının kuralını okur,
 *  - yük ve kapasite kapısı: `manufacturer-capacity.ts` (capacity-unit = C).
 *    Plan hiçbir yük saymaz, hiçbir eşik yazmaz; ölçüyü olduğu gibi tüketir,
 *  - elle yazılmış listenin etkin hâli: `effectiveCoverage` (haritanın kendi
 *    fonksiyonu), yalnızca FARKI göstermek için.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { coverageOverrides, figurineMaterialEnum, manufacturers } from "@/lib/db/schema";
import type { TurkishAddress } from "@/lib/db/schema";
import { PROVINCES } from "@/lib/data/turkey-address";
import {
  MAP_UNIT_KM,
  canonicalProvince,
  provinceDistanceUnits,
} from "@/lib/data/province-distance";
import { effectiveCoverage } from "@/lib/config/network-map";
import { manufacturerSupportsMaterial } from "@/lib/services/capability";
import { DISTANCE_NEAR_UNITS } from "@/lib/services/manufacturer-assignment";
import {
  loadManufacturerCapacities,
  manufacturerHasRoom,
  type ManufacturerCapacity,
} from "@/lib/services/manufacturer-capacity";
import type { CoverageResolver } from "@/lib/config/scoring";

/**
 * Planın malzeme ekseni. Sipariş malzemesinin pg enum'undan OKUNUR, elle
 * yazılmaz: sıralayıcı `orders.material` üzerinden kapı kuruyor, plan başka bir
 * malzeme listesi tanısaydı hiç sipariş gelmeyen bir malzeme için il dağıtır ya
 * da gerçek bir malzemeyi hiç hesaplamazdı.
 */
export const COVERAGE_MATERIALS = figurineMaterialEnum.enumValues;
export type CoverageMaterial = (typeof COVERAGE_MATERIALS)[number];

/** Malzemenin ekranda yazılan Türkçe adı. */
export const COVERAGE_MATERIAL_LABEL_TR: Record<string, string> = {
  resin: "Reçine",
  filament: "Filament",
};

/**
 * KAPSAMA YARIÇAPI — bu mesafeden uzaktaki atölye bir ili "karşılıyor" SAYILMAZ.
 *
 * Değer uydurulmadı: sıralayıcının kendi kalibrasyonundaki `DISTANCE_NEAR_UNITS`
 * (200 birim ≈ 300 km, "ertesi gün teslim yarıçapı"). Sıralayıcı bu mesafeye
 * kadar olan farkı BASKIN sayıyor (mesafe skoru 100 → 55), ötesinde eğri
 * yatıklaşıyor. Plan aynı sınırı kullanır ki iki yüzey "yakın" kelimesini aynı
 * anlamda kullansın.
 *
 * NEDEN TABAN MESAFESİ (700 birim ≈ 1050 km) DEĞİL: yurt içindeki en uzak çift
 * 948 birim (Edirne–Hakkari). 700'ü sınır yapmak neredeyse her ili "kapsanmış"
 * ilan ederdi ve bu fazın asıl çıktısı olan SAHİPSİZ İL listesi boş çıkardı —
 * yani hesap, cevaplaması istenen soruyu cevaplayamazdı.
 *
 * Sahipsiz il bir ARIZA DEĞİL, bir ÖLÇÜMDÜR: "burada 300 km içinde uygun
 * atölyemiz yok" cümlesi, o ilin işini 900 km öteye yazıp sessiz kalmaktan
 * dürüsttür. Sipariş yine de atanır (sıralayıcı bu planı kapı olarak
 * kullanmaz); plan yalnızca ağın nerede İNCE olduğunu söyler.
 */
export const COVERAGE_RADIUS_UNITS = DISTANCE_NEAR_UNITS;

/** Yarıçapın insan okuyacağı hâli (~300 km). */
export const COVERAGE_RADIUS_KM = Math.round(COVERAGE_RADIUS_UNITS * MAP_UNIT_KM);

/** Yöneticinin plana koyduğu müdahale türü. */
export type CoverageOverrideKind = "pin" | "exclude";

/** `coverage_overrides` satırının hesabın gördüğü hâli. */
export interface CoverageOverrideRow {
  il: string;
  material: string;
  kind: CoverageOverrideKind;
  manufacturerId: string | null;
  note: string | null;
  createdBy: string;
  updatedAt: Date | null;
}

/**
 * Hesabın gördüğü atölye satırı.
 *
 * `hasRoom` ve `loadUnits` BURADA HESAPLANMAZ, satırla birlikte GELİR: kapasite
 * ölçüsünün tek sahibi `services/manufacturer-capacity.ts`tir (capacity-unit =
 * C) ve bu modül onun müşterisidir.
 */
export interface CoverageWorkshop {
  manufacturerId: string;
  companyName: string;
  /** Adresteki il (serbest metin olabilir). */
  il: string | null;
  /** Çapası bilinen kanonik il adı; tanınmıyorsa null. */
  canonicalIl: string | null;
  capabilities: string[] | null;
  acceptingOrders: boolean;
  /** KAPI: ağırlıklı yük sınırın altında mı (`manufacturerHasRoom`). */
  hasRoom: boolean;
  loadUnits: number;
  maxConcurrentOrders: number;
  /** Bugün ELLE YAZILMIŞ liste — yalnız farkı göstermek için taşınır. */
  typedCoverage: string[];
}

/**
 * Bir HÜCRENİN (il × malzeme) sahibinin NEDENİ.
 *
 * `config/scoring.ts`teki `CoverageSource` ile KARIŞTIRILMAMALI: o, kapsamanın
 * hangi KAYNAKTAN okunduğunu söyler ("typed" | "computed"); bu ise hesabın
 * içinde tek bir hücrenin NİYE o sonucu aldığını. İki farklı soruya aynı adı
 * vermek, fazın yasakladığı ikinci sözlüğün ta kendisi olurdu.
 */
export type CoverageCellSource = "pinned" | "excluded" | "computed" | "unowned";

/** "Bu il neden sahipsiz" sorusunun cevabı: en yakın atölye ve onu ENGELLEYEN şey. */
export interface CoverageNearestMiss {
  manufacturerId: string;
  companyName: string;
  distanceUnits: number | null;
  distanceKm: number | null;
  /** Türkçe, ekranda aynen yazılır. */
  blockedBy: string;
}

/** Bir (il, malzeme) hücresinin sonucu. */
export interface CoverageAssignment {
  il: string;
  material: CoverageMaterial;
  manufacturerId: string | null;
  companyName: string | null;
  distanceUnits: number | null;
  distanceKm: number | null;
  source: CoverageCellSource;
  /** Türkçe gerekçe — ekranda aynen yazılır. */
  reason: string;
  /** Sonucu geçersiz kılmayan ama yöneticinin görmesi gereken durum. */
  warning?: string;
  /** Yalnız sahipsiz illerde dolu: en yakın atölye ve engeli. */
  nearestMiss?: CoverageNearestMiss | null;
}

/** Bir atölyenin hesaplanan etki alanı ile elle yazılmış listesinin farkı. */
export interface CoverageDiffRow {
  manufacturerId: string;
  companyName: string;
  /** Bugünkü etkin liste: elle yazılan + konum ili (`effectiveCoverage`). */
  typed: string[];
  /** Hesaplanan plan bu atölyeye hangi illeri veriyor (malzemelerin birleşimi). */
  computed: string[];
  /** Hesapta VAR, elle yazılanda yok. */
  added: string[];
  /** Elle yazılanda VAR, hesapta yok. */
  removed: string[];
}

export interface CoveragePlan {
  materials: CoverageMaterial[];
  /** 81 il × malzeme; il adına ve malzemeye göre sıralı. */
  assignments: CoverageAssignment[];
  /** Sahipsiz hücreler — bu fazın asıl çıktısı. */
  unowned: CoverageAssignment[];
  diff: CoverageDiffRow[];
  stats: {
    provinces: number;
    cells: number;
    owned: number;
    unowned: number;
    pinned: number;
    excluded: number;
    /** Planda en az bir il alan atölye sayısı. */
    workshopsWithCoverage: number;
    /** Hesaba hiç giremeyen atölyeler (il tanınmıyor / yer yok / sipariş almıyor). */
    idleWorkshops: number;
    radiusKm: number;
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * SAF HESAP — DB yok, aynı girdi → aynı çıktı.
 * ────────────────────────────────────────────────────────────────────────── */

function overrideKey(il: string, material: string): string {
  return `${il}|${material}`;
}

/**
 * Bir atölyenin bu MALZEMEDE hesaba girip giremeyeceği ve giremiyorsa Türkçe
 * gerekçesi. Tek yerde durur: aynı cümle hem "sahipsiz" satırının engel
 * açıklamasında hem pin uyarısında kullanılıyor, iki kopya farklı konuşurdu.
 */
function blockerOf(w: CoverageWorkshop, material: CoverageMaterial): string | null {
  if (!manufacturerSupportsMaterial(w.capabilities, material)) {
    return `${COVERAGE_MATERIAL_LABEL_TR[material] ?? material} basmıyor`;
  }
  if (!w.acceptingOrders) return "Sipariş almıyor";
  if (!w.hasRoom) return `Kapasite dolu (${w.loadUnits}/${w.maxConcurrentOrders} birim)`;
  if (!w.canonicalIl) return "Adresinde tanınan il yok";
  return null;
}

/**
 * Adayların SIRASI — kuralın kendisi.
 *
 *  1. mesafe (birim, artan): planın tanımı "en yakın atölye".
 *  2. ağırlıklı yük (artan): eşit mesafede işi daha az olan alır. Yük burada
 *     SIRALAMA değil yalnız EŞİTLİK BOZUCUDUR — plan bir yük dengeleyici değil,
 *     coğrafi bir sorumluluk haritasıdır.
 *  3. unvan (Türkçe alfabetik), 4. id: sonuç KARARLI olmalı. Kararsız bir sıra,
 *     hiçbir şey değişmeden iki koşuda iki farklı plan üretir ve "bugün ne
 *     değişti?" sorusu cevaplanamaz hâle gelirdi.
 */
function compareCandidates(
  a: { units: number; w: CoverageWorkshop },
  b: { units: number; w: CoverageWorkshop }
): number {
  if (a.units !== b.units) return a.units - b.units;
  if (a.w.loadUnits !== b.w.loadUnits) return a.w.loadUnits - b.w.loadUnits;
  const byName = a.w.companyName.localeCompare(b.w.companyName, "tr");
  if (byName !== 0) return byName;
  return a.w.manufacturerId.localeCompare(b.w.manufacturerId);
}

const km = (units: number | null): number | null =>
  units === null ? null : Math.round(units * MAP_UNIT_KM);

/**
 * PLANIN KENDİSİ. Saf: verilen atölyeler ve müdahalelerle 81 ilin her malzemede
 * sahibini hesaplar.
 *
 * SIRA KURALIN KENDİSİDİR:
 *  1. DIŞLAMA — yöneticinin "burayı karşılamıyoruz" beyanı her şeyi yener.
 *     Dışlama ile pin aynı hücrede olamaz (tabloda hücre başına tek satır var),
 *     ama yine de dışlama önce bakılır: güvenli taraf "kapsanmıyor" demektir.
 *  2. PİN — yöneticinin seçtiği atölye, mesafeye bakılmaksızın sahiptir. Pin
 *     KAPASİTEYE de bakmaz: sahibin kaldıracı hesabın üstündedir. Ama pinlenen
 *     atölye o malzemeyi basmıyorsa / yeri yoksa satır UYARI taşır — sessizce
 *     "her şey yolunda" demek, yöneticiyi kendi kaldıracı hakkında yanıltırdı.
 *  3. HESAP — yarıçap içindeki uygun en yakın atölye.
 *  4. SAHİPSİZ — yarıçap içinde uygun atölye yok. Uzaktaki bir atölyeye
 *     zorlanmaz; en yakın atölye ve onu engelleyen şey satıra yazılır.
 */
export function computeCoveragePlan(input: {
  workshops: readonly CoverageWorkshop[];
  overrides: readonly CoverageOverrideRow[];
  /** Varsayılan 81 il; test daha küçük bir küme verebilsin diye dışa açık. */
  provinces?: readonly string[];
  materials?: readonly CoverageMaterial[];
}): CoveragePlan {
  const provinces = input.provinces ?? PROVINCES;
  const materials = (input.materials ?? COVERAGE_MATERIALS) as CoverageMaterial[];
  const byId = new Map(input.workshops.map((w) => [w.manufacturerId, w]));
  const overrideMap = new Map<string, CoverageOverrideRow>();
  for (const o of input.overrides) {
    overrideMap.set(overrideKey(o.il, o.material), o);
  }

  const assignments: CoverageAssignment[] = [];

  for (const il of provinces) {
    for (const material of materials) {
      const override = overrideMap.get(overrideKey(il, material));

      if (override?.kind === "exclude") {
        assignments.push({
          il,
          material,
          manufacturerId: null,
          companyName: null,
          distanceUnits: null,
          distanceKm: null,
          source: "excluded",
          reason: override.note
            ? `Yönetici dışladı — ${override.note}`
            : "Yönetici dışladı: bu il kapsanmıyor.",
        });
        continue;
      }

      if (override?.kind === "pin" && override.manufacturerId) {
        const pinned = byId.get(override.manufacturerId);
        if (pinned) {
          const units = provinceDistanceUnits(il, pinned.canonicalIl);
          const blocker = blockerOf(pinned, material);
          assignments.push({
            il,
            material,
            manufacturerId: pinned.manufacturerId,
            companyName: pinned.companyName,
            distanceUnits: units,
            distanceKm: km(units),
            source: "pinned",
            reason: override.note
              ? `Yönetici pinledi — ${override.note}`
              : "Yönetici pinledi: hesaba bakılmaksızın bu atölyenin.",
            warning: blocker
              ? `Pinli atölye bugün uygun değil: ${blocker}. Pin yine de geçerli.`
              : undefined,
          });
          continue;
        }
        // Pin edilen atölye artık listede yok (silinmiş ya da askıya alınmış).
        // Satır "pinli" diye gösterilemez: yönetici var olmayan bir sorumluya
        // güvenirdi. Hesaba düşülür, uyarı taşınır.
      }

      // ── Hesap ──
      const candidates: Array<{ units: number; w: CoverageWorkshop }> = [];
      // Yarıçap dışında kalanlar da toplanır: sahipsiz bir ilin "en yakın kim,
      // neden olmuyor" cevabı ancak bu listeden çıkar.
      const misses: Array<{ units: number | null; w: CoverageWorkshop; blocker: string }> = [];

      for (const w of input.workshops) {
        const blocker = blockerOf(w, material);
        const units = provinceDistanceUnits(il, w.canonicalIl);
        if (blocker) {
          misses.push({ units, w, blocker });
          continue;
        }
        if (units === null) continue; // blockerOf zaten yakalar; tip daraltma.
        if (units > COVERAGE_RADIUS_UNITS) {
          misses.push({
            units,
            w,
            blocker: `Menzil dışı (~${km(units)} km, sınır ~${COVERAGE_RADIUS_KM} km)`,
          });
          continue;
        }
        candidates.push({ units, w });
      }

      candidates.sort(compareCandidates);
      const winner = candidates[0];

      if (winner) {
        assignments.push({
          il,
          material,
          manufacturerId: winner.w.manufacturerId,
          companyName: winner.w.companyName,
          distanceUnits: winner.units,
          distanceKm: km(winner.units),
          source: "computed",
          reason:
            winner.units === 0
              ? "En yakın uygun atölye: aynı ilde."
              : `En yakın uygun atölye (~${km(winner.units)} km).`,
          warning:
            override?.kind === "pin"
              ? "Pinlenen atölye listede yok; il hesaba düştü."
              : undefined,
        });
        continue;
      }

      // ── Sahipsiz ──
      misses.sort((a, b) => {
        // Çapası olmayan atölye en sona: "en yakın" diye gösterilemez.
        if (a.units === null && b.units === null) {
          return a.w.companyName.localeCompare(b.w.companyName, "tr");
        }
        if (a.units === null) return 1;
        if (b.units === null) return -1;
        return a.units - b.units;
      });
      const nearest = misses[0] ?? null;
      assignments.push({
        il,
        material,
        manufacturerId: null,
        companyName: null,
        distanceUnits: null,
        distanceKm: null,
        source: "unowned",
        reason: nearest
          ? `Yarıçap içinde (~${COVERAGE_RADIUS_KM} km) uygun atölye yok.`
          : "Bu malzeme için hiç uygun atölye yok.",
        warning:
          override?.kind === "pin"
            ? "Pinlenen atölye listede yok; il sahipsiz kaldı."
            : undefined,
        nearestMiss: nearest
          ? {
              manufacturerId: nearest.w.manufacturerId,
              companyName: nearest.w.companyName,
              distanceUnits: nearest.units,
              distanceKm: km(nearest.units),
              blockedBy: nearest.blocker,
            }
          : null,
      });
    }
  }

  // ── Fark: hesaplanan plan ↔ bugün elle yazılmış liste ──
  const computedByWorkshop = new Map<string, Set<string>>();
  for (const a of assignments) {
    if (!a.manufacturerId) continue;
    const set = computedByWorkshop.get(a.manufacturerId) ?? new Set<string>();
    set.add(a.il);
    computedByWorkshop.set(a.manufacturerId, set);
  }

  const diff: CoverageDiffRow[] = input.workshops
    .map((w) => {
      // Elle yazılmış listenin ETKİN hâli haritanın kendi fonksiyonundan gelir:
      // konum ilinin her zaman dâhil olduğu kuralı burada YENİDEN YAZILMAZ.
      const typed = effectiveCoverage(w.typedCoverage, w.canonicalIl ?? w.il);
      const computed = [...(computedByWorkshop.get(w.manufacturerId) ?? new Set<string>())].sort(
        (a, b) => a.localeCompare(b, "tr")
      );
      const typedSet = new Set(typed);
      const computedSet = new Set(computed);
      return {
        manufacturerId: w.manufacturerId,
        companyName: w.companyName,
        typed,
        computed,
        added: computed.filter((il) => !typedSet.has(il)),
        removed: typed.filter((il) => !computedSet.has(il)),
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "tr"));

  const unowned = assignments.filter((a) => a.source === "unowned");

  return {
    materials,
    assignments,
    unowned,
    diff,
    stats: {
      provinces: provinces.length,
      cells: assignments.length,
      owned: assignments.filter((a) => a.manufacturerId !== null).length,
      unowned: unowned.length,
      pinned: assignments.filter((a) => a.source === "pinned").length,
      excluded: assignments.filter((a) => a.source === "excluded").length,
      workshopsWithCoverage: computedByWorkshop.size,
      idleWorkshops: input.workshops.filter((w) => !computedByWorkshop.has(w.manufacturerId))
        .length,
      radiusKm: COVERAGE_RADIUS_KM,
    },
  };
}

/**
 * "Bu atölye hangi illerden sorumlu?" — haritanın ve atama skorunun okuyacağı
 * TEK cevap.
 *
 * Bugün iki yüzey de `manufacturers.coverage_provinces`ı okuyor; plan canlıya
 * alındığında ikisi de BU fonksiyonu çağırmalı. Ayrı ayrı `assignments`
 * süzmeleri, "il sahipliği" tanımının iki kopyası demektir.
 */
export function plannedCoverageFor(plan: CoveragePlan, manufacturerId: string): string[] {
  const set = new Set<string>();
  for (const a of plan.assignments) {
    if (a.manufacturerId === manufacturerId) set.add(a.il);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "tr"));
}

/** "Bu il, bu malzemede kimin?" — tek hücrelik okuma. */
export function plannedOwnerOf(
  plan: CoveragePlan,
  il: string,
  material: CoverageMaterial
): CoverageAssignment | null {
  return (
    plan.assignments.find((a) => a.il === il && a.material === material) ?? null
  );
}

/**
 * SIRALAYICININ YUVASINA TAKILAN FİŞ (`config/scoring.ts` · `CoverageResolver`).
 *
 * Gölge sıralaması "kapsama hesaplansaydı ne olurdu?" sorusunu ancak bu
 * fonksiyonla sorabilir; kendi hesabını kurarsa iki cevap doğar ve karşılaştırma
 * anlamını yitirir. `subject.coverageProvinces` BİLEREK yok sayılır: elle
 * yazılmış listeyi okumak zaten "typed" yoludur, bu fiş HESAPLANMIŞ yolu temsil
 * eder ve ikisini karıştıran bir çözücü, gölgenin neyi ölçtüğünü belirsizleştirir.
 *
 * Planı her çağrıda yeniden hesaplamaz: çağıran planı BİR KEZ yükler
 * (`loadCoveragePlan`) ve fişi o planın üstüne kurar — sıralayıcı atölye başına
 * çağırdığı için burada sorgu açmak N+1 doğururdu.
 */
export function coveragePlanResolver(plan: CoveragePlan): CoverageResolver {
  const cache = new Map<string, readonly string[]>();
  return (subject) => {
    const hit = cache.get(subject.manufacturerId);
    if (hit) return hit;
    const list = plannedCoverageFor(plan, subject.manufacturerId);
    cache.set(subject.manufacturerId, list);
    return list;
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * DB YARISI
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Hesaba giren atölyeler: YALNIZ aktif olanlar.
 *
 * `map_visible` BAKILMAZ: o, public haritada görünürlük kararıdır. Haritadan
 * gizlenmiş bir atölye iş almaya devam eder, yani ili karşılamaya da devam
 * eder; planı görünürlüğe bağlamak, gizlilik düğmesini sessizce bir
 * YÖNLENDİRME düğmesine çevirirdi.
 *
 * Kapasite `manufacturer-capacity.ts`ten gelir — plan hiçbir yük saymaz. Çağıran
 * elinde hazır bir kapasite haritası varsa (aynı istekte başka bir yüzey de
 * yüklemişse) onu geçebilir; yoksa tek ölçü burada çağrılır.
 */
export async function loadCoverageWorkshops(
  capacities?: ReadonlyMap<string, ManufacturerCapacity>
): Promise<CoverageWorkshop[]> {
  const rows = await db.query.manufacturers.findMany({
    where: eq(manufacturers.status, "active"),
    columns: {
      id: true,
      companyName: true,
      address: true,
      capabilities: true,
      acceptingOrders: true,
      maxConcurrentOrders: true,
      coverageProvinces: true,
    },
  });
  if (rows.length === 0) return [];

  const caps = capacities ?? (await loadManufacturerCapacities(rows.map((r) => r.id)));

  return rows.map((r) => {
    const il = (r.address as TurkishAddress | null)?.il ?? null;
    const cap = caps.get(r.id);
    const loadUnits = cap?.loadUnits ?? 0;
    const maxConcurrentOrders = cap?.maxConcurrentOrders ?? r.maxConcurrentOrders;
    return {
      manufacturerId: r.id,
      companyName: r.companyName,
      il,
      canonicalIl: canonicalProvince(il),
      capabilities: r.capabilities,
      acceptingOrders: r.acceptingOrders,
      loadUnits,
      maxConcurrentOrders,
      // Kapasite satırı eksikse kapı YİNE aynı fonksiyondan geçer; elle "true"
      // yazmak, ölçüsü bilinmeyen bir atölyeyi sessizce "boş" ilan ederdi.
      hasRoom: cap?.hasRoom ?? manufacturerHasRoom({ loadUnits, maxConcurrentOrders }),
      typedCoverage: r.coverageProvinces ?? [],
    };
  });
}

/** Yöneticinin kaldıraçları. */
export async function loadCoverageOverrides(): Promise<CoverageOverrideRow[]> {
  const rows = await db
    .select({
      il: coverageOverrides.il,
      material: coverageOverrides.material,
      kind: coverageOverrides.kind,
      manufacturerId: coverageOverrides.manufacturerId,
      note: coverageOverrides.note,
      createdBy: coverageOverrides.createdBy,
      updatedAt: coverageOverrides.updatedAt,
    })
    .from(coverageOverrides);
  return rows
    .filter((r): r is typeof r & { kind: CoverageOverrideKind } =>
      r.kind === "pin" || r.kind === "exclude"
    )
    .map((r) => ({ ...r }));
}

/**
 * Planın TEK yükleyicisi: atölyeler + müdahaleler → hesap.
 *
 * Gölge sıralaması bunu sipariş başına DEĞİL, tarama başına bir kez çağırmalı ve
 * sonucu `coveragePlanResolver` ile fişe çevirmeli.
 */
export async function loadCoveragePlan(
  capacities?: ReadonlyMap<string, ManufacturerCapacity>
): Promise<CoveragePlan> {
  const [workshops, overrides] = await Promise.all([
    loadCoverageWorkshops(capacities),
    loadCoverageOverrides(),
  ]);
  return computeCoveragePlan({ workshops, overrides });
}
