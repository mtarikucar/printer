import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manufacturerAssignmentEvaluations, manufacturers, orders } from "@/lib/db/schema";
import {
  rankManufacturersDetailed,
  rankManufacturersForOrder,
  type CandidateScore,
  type RankOptions,
} from "@/lib/services/manufacturer-assignment";
import {
  getCanaryPercent,
  getDistanceModel,
  shouldRunDistanceShadow,
  shouldUseV2,
  weightsVersion,
  type ScoringProfile,
} from "@/lib/config/manufacturer-scoring";
import {
  PHASE5_DISTANCE_MODEL,
  PHASE5_WEIGHTS_VERSION,
  activeSignals,
  explainShadowDivergence,
  isPhase5ShadowEnabled,
  signalsForProfile,
  type CoverageResolver,
  type ShadowComparison,
} from "@/lib/config/scoring";
import { loadManufacturerCapacities } from "@/lib/services/manufacturer-capacity";
// Büyük format kuralının TEK sahibi. Sıralayıcı bunu import EDEMEZ (o modül
// manufacturer-capacity'yi, o da sıralayıcıyı import ediyor: döngü), bu yüzden
// fişi bu katman takıyor — kapasite ve kapsama fişleriyle aynı sebeple.
import { largeFormatPlacementBlocked } from "@/lib/services/manufacturer-assign";
import { coveragePlanResolver, loadCoveragePlan } from "@/lib/services/coverage-plan";

/**
 * Mesafe gölgesi (Phase 1). v3 = v1 ağırlıkları + sürekli mesafe.
 *
 * Sabit olarak duruyor ki "v3 nerede otoriter oluyor?" sorusu tek bir grep'le
 * yanıtlanabilsin: hiçbir yerde. Otorite seçimi aşağıda yalnız v1/v2 arasından
 * yapılır (ranker-rollout kararı: gölge önce, yüzdeyle açma sonra).
 */
const SHADOW_DISTANCE_PROFILE: ScoringProfile = "v3";

/** `rankForOrderWithShadow` seçenekleri: sıralama girdileri + admin kaçış kapısı. */
export interface RankWithShadowOptions extends RankOptions {
  /** Admin tanı görünümü (?weights=v1|v2|v3): kanaryayı ve kaydı atlar. */
  forceProfile?: ScoringProfile;
}

/* ────────────────────────────────────────────────────────────────────────────
 * FAZ 5 GÖLGE BAĞLAMI: ağırlıklı kapasite (K2) + hesaplanan etki alanı (K1)
 *
 * İkisi de BU KATMANDA bağlanır, sıralayıcının içinde değil. Sebep yapısal:
 * `manufacturer-capacity.ts` ve `coverage-plan.ts` ikisi de sıralayıcıdan
 * import ediyor (`ACTIVE_MFG_STATUSES`, `DISTANCE_NEAR_UNITS`), yani
 * sıralayıcının onları import etmesi döngü kurardı. Sıralayıcı bu yüzden
 * ikisini de YUVA olarak taşır; fişi buraya takıyoruz.
 *
 * ÖNBELLEK, çünkü plan sipariş başına değil TARAMA başına hesaplanmalı (K1'in
 * notu): her atamada 81 il × malzeme hesabı + atölye/müdahale okuması yapmak,
 * bir TELEMETRİ satırı için canlı atama yoluna ölçülebilir bir gecikme eklerdi.
 * 60 sn'lik önbellek yalnız GÖLGE içindir. Kapasite veya kapsama sinyali
 * canlıya açılırsa ortak sıralama bağlamı her çağrıda yeniden yüklenir;
 * gölgenin açık olup olmaması bu tazelik kuralını değiştirmez.
 * ────────────────────────────────────────────────────────────────────────── */

interface Phase5Context {
  capacities?: ReadonlyMap<string, { loadUnits: number }>;
  coverageOf?: CoverageResolver;
}

const PHASE5_CTX_TTL_MS = 60 * 1000;
let phase5CtxAt = 0;
let phase5Ctx: Phase5Context = {};

/** Kapasite önce yüklenir; kapsama planı aynı aktif atölye ölçüsünü kullanır. */
async function loadPhase5Context(): Promise<Phase5Context> {
  const active = await db
    .select({ id: manufacturers.id })
    .from(manufacturers)
    .where(eq(manufacturers.status, "active"));
  const capacities = await loadManufacturerCapacities(active.map((m) => m.id));
  const plan = await loadCoveragePlan(capacities);
  return { capacities, coverageOf: coveragePlanResolver(plan) };
}

/**
 * Canlı sinyaller gölge önbelleğini kullanamaz. Canlı okuma hatası da eski
 * telemetriye ya da boş bağlama düşmemeli; çağıran bu denemeyi başarısız görür.
 * Taze okuma, sıralama ile atama yazımı arasındaki yarışları engellemez.
 */
async function rankingPhase5Context(withShadow: boolean): Promise<Phase5Context> {
  const liveSignals = signalsForProfile("live");
  if (liveSignals.weightedLoad || liveSignals.computedCoverage) {
    return loadPhase5Context();
  }
  return withShadow ? phase5Context() : {};
}

/**
 * Gölge bağlamını verir. ASLA FIRLATMAZ.
 *
 * Bir telemetri girdisi, gerçek bir atamayı düşüremez: plan ya da kapasite
 * okunamazsa boş bağlam döner ve gölge o turda ağırlıklı yükü "ölçülemedi",
 * kapsamayı da "typed" olarak damgalar — yani ekran, sinyalin konuşmadığını
 * SÖYLER, sessizce "fark yok" demez.
 */
async function phase5Context(): Promise<Phase5Context> {
  const now = Date.now();
  if (now - phase5CtxAt < PHASE5_CTX_TTL_MS) return phase5Ctx;
  try {
    phase5Ctx = await loadPhase5Context();
  } catch (err) {
    console.warn("[Faz 5 gölge] bağlam yüklenemedi; gölge eksik sinyalle çalışır:", err);
    phase5Ctx = {};
  }
  phase5CtxAt = now;
  return phase5Ctx;
}

/**
 * Q7 shadow + canary wrapper.
 *
 * Returns the AUTHORITATIVE ranked candidate list for the order — what
 * the caller (N12 reassign, automatic assignment) should act on.
 * Internally also runs the non-authoritative profiles and keeps their winners
 * in a PENDING evaluation, which is written to
 * `manufacturer_assignment_evaluations` only if the order really ends up
 * placed (aşağıdaki "DEĞERLENDİRME NE ZAMAN YAZILIR" notu).
 *
 * Authoritative selection:
 *   - `forceProfile` set → admin escape hatch (?weights=v1|v2|v3 on admin
 *     order detail). Bypasses canary, no log row written (intent is
 *     diagnostic, not a real assignment decision).
 *   - shouldUseV2(orderId, MANUFACTURER_SCORING_V2_PERCENT) === true → v2 wins
 *   - otherwise v1 wins (shadow mode default)
 *
 * DEĞERLENDİRME YALNIZ GERÇEKLEŞEN ATAMA İÇİN YAZILIR. Salt-okuma yüzeyleri
 * (admin sipariş sayfasının aday listesi, tarama önizlemesi) zaten
 * `rankForOrderPreview` çağırır; ama sıralamanın kendisi de bir karar DEĞİLDİR:
 * uygun aday çıkmayan bir onay, yarışı kaybeden bir atama ya da taramanın
 * "aday değişti" iptali hiçbir işi yerleştirmez. Satır o yüzden sıralama anında
 * değil, YERLEŞTİRME doğrulandıktan sonra yazılır ve yerleşen atölyeyi kaydeder.
 *
 * MALİYET: sıralamaların hepsi tek bir ortak veri yüklemesinden beslenir
 * (`rankManufacturersForProfiles`), yani karşılaştırma sayısı sorgu sayısını
 * artırmaz; mesafe gölgesi ayrıca MANUFACTURER_DISTANCE_SHADOW_PERCENT ile
 * örneklenebilir (varsayılan %100). Ayrıntı: ranker dosyasındaki maliyet notu.
 *
 * Failure isolation: shadow logging must NEVER block the assignment
 * decision. Logging errors are swallowed and console-warned; the
 * authoritative ranking still comes back.
 */
export async function rankForOrderWithShadow(
  orderId: string,
  opts?: RankWithShadowOptions
): Promise<CandidateScore[]> {
  const excludeManufacturerIds = opts?.excludeManufacturerIds ?? [];
  // Escape hatch: admin diagnostic view. Skip the canary logic + shadow
  // log entirely; the admin just wants to see what a profile would pick
  // without affecting the rollout signal.
  if (opts?.forceProfile) {
    return rankManufacturersForOrder(orderId, opts.forceProfile, {
      excludeManufacturerIds,
    });
  }

  const percent = getCanaryPercent();
  const useV2 = shouldUseV2(orderId, percent);
  const authoritativeProfile: ScoringProfile = useV2 ? "v2" : "v1";
  const shadowProfile: ScoringProfile = useV2 ? "v1" : "v2";
  // Örnekleme kapalıyken (varsayılan %100) her atamada çalışır; kova sipariş
  // başına kararlıdır, yani reddedilip yeniden sıralanan sipariş deneyin
  // içinden çıkmaz.
  const withDistanceShadow = shouldRunDistanceShadow(orderId);

  const rankedAt = Date.now();
  const profiles: ScoringProfile[] = [authoritativeProfile, shadowProfile];
  if (withDistanceShadow) profiles.push(SHADOW_DISTANCE_PROFILE);

  // Tek yükleme, çok profil. Gölge profiller artık kendi sorgularını açmadığı
  // için ayrı ayrı `catch`leri de yok; onların yerine TEK bir emniyet var:
  // ortak çağrı patlarsa canlı sıralama yalnız başına bir kez daha çalıştırılır.
  // Böylece bozuk bir meydan okuyan (kaçak env ağırlığı, bozuk çapa, şema
  // kayması) atamayı hâlâ düşüremez.
  // FAZ 5 gölgesi de AYNI yüklemeden çıkar: ek sıralama, ek veri okuması
  // değildir (yalnız kendi sinyalleri için gereken geçmiş sorgusu eklenir).
  const withPhase5 = isPhase5ShadowEnabled();

  const ctx = await rankingPhase5Context(withPhase5);

  let ranked: Awaited<ReturnType<typeof rankManufacturersDetailed>>;
  try {
    ranked = await rankManufacturersDetailed(orderId, profiles, {
      excludeManufacturerIds,
      phase5Shadow: withPhase5,
      capacities: ctx.capacities,
      coverageOf: ctx.coverageOf,
      largeFormatBlocked: largeFormatPlacementBlocked,
    });
  } catch (err) {
    console.warn(
      `[Q7 shadow] çok profilli sıralama hata verdi (${orderId}); canlı sıralama tek başına çalıştırılıyor:`,
      err
    );
    return rankManufacturersForOrder(orderId, authoritativeProfile, {
      excludeManufacturerIds,
    });
  }

  const authoritative = ranked.byProfile.get(authoritativeProfile) ?? [];
  const weightsShadow = ranked.byProfile.get(shadowProfile) ?? [];
  const distanceShadow = withDistanceShadow
    ? ranked.byProfile.get(SHADOW_DISTANCE_PROFILE) ?? []
    : [];
  const phase5Shadow = ranked.phase5 ?? [];

  const rows: EvaluationRowDraft[] = [
    // Ağırlık karşılaştırması (v2.2 satırı): karar veren profil ile öbür profil.
    draftRow({
      rowWeightsVersion: weightsVersion("v2"),
      authoritative: authoritativeProfile,
      livePlacement: "profile",
      live: { profile: authoritativeProfile, list: authoritative },
      shadow: { profile: shadowProfile, list: weightsShadow },
    }),
  ];
  if (withDistanceShadow) {
    // Mesafe karşılaştırması (v3.0 satırı): aynı canlı seçimin karşısında
    // sürekli mesafeli v3. Ayrı SATIR olmasının sebebi tabloda yalnız iki
    // kazanan sütunu bulunması; iki karşılaştırma `weights_version` ile
    // ayrışır, aynı karara ait oldukları ise satırların `decisionId` damgasından
    // okunur (migration gerekmez).
    rows.push(
      draftRow({
        rowWeightsVersion: weightsVersion(SHADOW_DISTANCE_PROFILE),
        authoritative: authoritativeProfile,
        // Mesafe satırında canlı taraf SABİT v1 sütununda durur; okuyucu da
        // satırı böyle yorumluyor (evaluation-view.ts, buildOrderEvaluation).
        livePlacement: "v1",
        live: { profile: authoritativeProfile, list: authoritative },
        shadow: { profile: SHADOW_DISTANCE_PROFILE, list: distanceShadow },
      })
    );
  }
  if (withPhase5 && phase5Shadow.length > 0) {
    // FAZ 5 karşılaştırması (v4.0 satırı): kararı veren sıralamanın karşısında
    // YENİ SİNYALLİ sıralama. Yeni bir `ScoringProfile` AÇILMADI — bu gölge bir
    // profil değil, aynı profilin sinyalli hâli; damgası `weights_version`
    // sütununda durur.
    //
    // `livePlacement: "profile"` BİLİNÇLİ (mesafe satırındaki gibi sabit "v1"
    // değil): okuyucu (scoring-evaluations/evaluation-view.ts) bu damgayı
    // tanımıyor ve tanımadığı satırlarda canlı tarafı `authoritative`in kendi
    // sütunundan okuyor. Profil yerleşimi tam olarak o okumayla uyuşur, yani
    // kanarya açıldığı gün bile ekran işi kimin kazandığını doğru söyler.
    rows.push(
      draftRow({
        rowWeightsVersion: PHASE5_WEIGHTS_VERSION,
        authoritative: authoritativeProfile,
        livePlacement: "profile",
        live: { profile: authoritativeProfile, list: authoritative },
        shadow: {
          profile: authoritativeProfile,
          list: phase5Shadow,
          // Damga profilden TÜRETİLEMEZ: iki taraf da aynı profil adını
          // taşıyor, ayrımı yapan şey sinyaller. Açıkça yazılır.
          versionOverride: PHASE5_WEIGHTS_VERSION,
          distanceModelOverride: PHASE5_DISTANCE_MODEL,
        },
        signals: activeSignals(ranked.phase5Signals),
      })
    );
  }

  stashPending(orderId, rankedAt, rows, excludeManufacturerIds);

  return authoritative;
}

/**
 * FAZ 5 GÖLGESİNİN SALT-OKUNUR hâli: canlı sıralama + sinyalli sıralama + ikisi
 * arasındaki farkın Türkçe açıklaması. HİÇBİR kayıt yazmaz.
 *
 * /admin/assignment-sweep bunu çağırır: tarama salt okunur bir işlemdir ve
 * `manufacturer_assignment_evaluations` tablosuna satır yazmamalıdır (Faz 1'in
 * kuralı — kayıt yalnızca bir sipariş ATANDIĞINDA düşer). Bu yüzden burada
 * `stashPending` YOKTUR ve olmayacaktır.
 *
 * Karşılaştırmayı `explainShadowDivergence` üretir — gölge kaydının da,
 * ekranın da aynı saf fonksiyonu çağırması bilinçli: ikinci bir karşılaştırma
 * yazılsaydı ekranda görülen fark ile kayda düşen fark sessizce ayrışabilirdi.
 */
export async function rankForOrderShadowPreview(
  orderId: string
): Promise<{ live: CandidateScore[]; shadow: CandidateScore[] | null; comparison: ShadowComparison | null }> {
  const liveProfile: ScoringProfile = shouldUseV2(orderId, getCanaryPercent())
    ? "v2"
    : "v1";
  const withPhase5 = isPhase5ShadowEnabled();
  const ctx = await rankingPhase5Context(withPhase5);
  const ranked = await rankManufacturersDetailed(orderId, [liveProfile], {
    phase5Shadow: withPhase5,
    capacities: ctx.capacities,
    coverageOf: ctx.coverageOf,
    largeFormatBlocked: largeFormatPlacementBlocked,
  });
  const live = ranked.byProfile.get(liveProfile) ?? [];
  const shadow = ranked.phase5;
  return {
    live,
    shadow,
    comparison: shadow
      ? explainShadowDivergence(live, shadow, ranked.phase5Signals)
      : null,
  };
}

/**
 * Aday listesinin SALT-OKUNUR hâli: aynı otorite kuralı, hiçbir kayıt yok.
 *
 * Admin sipariş sayfası gibi "sadece bakıyorum" yüzeyleri bunu çağırmalı.
 * Gölge profilleri de çalıştırmaz: kaydedilmeyecek bir karşılaştırma için
 * atölye başına ek sorgu döndürmenin karşılığı yok.
 */
export async function rankForOrderPreview(
  orderId: string,
  forceProfile?: ScoringProfile
): Promise<CandidateScore[]> {
  if (forceProfile) return rankManufacturersForOrder(orderId, forceProfile);
  const useV2 = shouldUseV2(orderId, getCanaryPercent());
  return rankManufacturersForOrder(orderId, useV2 ? "v2" : "v1");
}

/**
 * "Bu sıralama gerçekten bir işi yerleştirdi" — değerlendirme satırlarını ŞİMDİ
 * yaz.
 *
 * Atama yolları (otomatik atama, red sonrası yeniden atama, tarama uygulaması)
 * korumalı UPDATE `ok` döndükten SONRA bunu çağırmalı: kararı yaratan sıralama
 * ile kararın kendisi ancak o an birbirine bağlanır. Beklemede bir sıralama
 * yoksa sessizce hiçbir şey yapmaz (elle yapılan atama gibi, sıralamadan
 * geçmeyen yerleştirmeler).
 *
 * Çağrılmazsa satır kaybolmaz: aynı beklemedeki kayıt, kısa bir gecikmenin
 * ardından siparişin kendi satırından doğrulanarak da yazılır (aşağıdaki
 * `settleFromOrderRow`). Bu fonksiyon o yolun KESİN ve gecikmesiz hâlidir.
 */
export async function commitAssignmentEvaluation(
  orderId: string,
  assignedManufacturerId: string
): Promise<void> {
  const pending = takePending(orderId);
  if (!pending) return;
  try {
    await writeEvaluationRows(pending, assignedManufacturerId);
  } catch (err) {
    // Telemetri, atamayı geri almaz.
    console.warn(`[Q7 shadow] değerlendirme yazılamadı (${orderId}):`, err);
  }
}

/**
 * "Bu sıralama hiçbir işi yerleştirmedi" — beklemedeki taslağı DÜŞÜR.
 *
 * Korumalı UPDATE eşleşmediğinde (yarış kaybedildi, araya iade girdi) çağrılır.
 * Taslak düşürülmezse gecikmeli doğrulama (`settleFromOrderRow`) siparişte o an
 * duran üreticiyi görür ve bizim sıralamamızın sonucuymuş gibi kaydeder: yani
 * BAŞKASININ yaptığı atamayı bizim kararımıza mal eder. Sessizdir ve asla
 * fırlatmaz: ortada yazılacak bir şey olmaması normal bir sonuçtur.
 */
export function discardAssignmentEvaluation(orderId: string): void {
  takePending(orderId);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Beklemedeki değerlendirmeler
 * ────────────────────────────────────────────────────────────────────────── */

/** Değerlendirme satırının bir tarafı: hangi profil, hangi sıralama. */
interface EvaluationSideInput {
  profile: ScoringProfile;
  list: CandidateScore[];
  /**
   * Ağırlık damgası profilden TÜRETİLEMİYORSA açıkça verilir.
   *
   * Faz 5 gölgesinde iki taraf da aynı `ScoringProfile`ı taşıyor (yeni bir
   * profil açılmadı); ayrımı yapan şey yürürlükteki sinyaller. Damga o yüzden
   * dışarıdan gelir, yoksa iki taraf da "v1.2" yazar ve satır kendi kendini
   * açıklayamaz hâle gelirdi.
   */
  versionOverride?: string;
  /** Aynı sebeple: mesafe modeli profilden türetilemediğinde açıkça verilir. */
  distanceModelOverride?: string;
}

interface EvaluationSideSnapshot {
  winnerId: string | null;
  weightsVersion: string;
  distanceModel: string;
  candidates: Array<{
    manufacturerId: string;
    companyName: string;
    totalScore: number;
    scores: CandidateScore["scores"];
    /** Faz 5 açıklaması (ceza kalemleri, ağırlıklı yük, kapsama kaynağı). */
    shadow?: CandidateScore["shadow"];
  }>;
}

/** Yazılmaya hazır ama HENÜZ yazılmamış bir satır (sütunlara yerleşmiş hâli). */
interface EvaluationRowDraft {
  rowWeightsVersion: string;
  authoritative: ScoringProfile;
  v1: EvaluationSideSnapshot;
  v2: EvaluationSideSnapshot;
  /**
   * Bu satırı üreten Faz 5 sinyalleri (varsa).
   *
   * Satırın anlamı sinyal kümesine bağlı: aynı "v4.0" damgası, iki hafta sonra
   * bir sinyal kapatıldığında BAŞKA bir formülü anlatır. Küme yazılmazsa
   * karşılaştırma geriye dönük olarak okunamaz hâle gelirdi.
   */
  signals?: string[];
}

interface PendingEvaluation {
  orderId: string;
  /** Bu beklemedeki kaydı üreten sıralamanın kimliği (eski zamanlayıcı ayıklar). */
  token: number;
  /** Sıralamanın çalıştığı an — yerleştirmenin BİZDEN sonra olduğunu doğrular. */
  rankedAt: number;
  /**
   * Bu denemede sıralamaya sokulmayan atölyeler. Satıra damgalanır: dışlama
   * artık sıralamanın İÇİNDE uygulandığı için kazanan = yerleşen olur, ama
   * "neden bu atölye hiç görünmüyor" sorusunun cevabı ancak bu damgada durur.
   */
  excludedManufacturerIds: string[];
  rows: EvaluationRowDraft[];
}

/**
 * Bellekte tutulan beklemedeki kayıtlar.
 *
 * Süreç başına ve kısa ömürlü: kaybolursa yalnız bir telemetri satırı eksilir,
 * hiçbir atama etkilenmez. Sınırlı ve TTL'li, çünkü hiç yerleşmeyen sıralamalar
 * (uygun aday yok) burada birikirdi.
 */
const PENDING = new Map<string, PendingEvaluation>();
const PENDING_MAX = 200;
const PENDING_TTL_MS = 5 * 60 * 1000;
/**
 * Yerleştirmenin siparişte görünmesi için beklenen süre. Çağıran, sıralamadan
 * sonra atama UPDATE'ini ve bildirimleri yapıyor; birkaç saniye fazlasıyla yeter.
 */
const SETTLE_DELAY_MS = 2500;
/**
 * Uygulama saati ile DB saatinin farkına tolerans. `assignedToManufacturerAt`
 * DB'de yazılıyor, karşılaştırma burada yapılıyor; tolerans olmasa küçük bir
 * sapma gerçek bir atamayı "bizden önceki bir atama" sanıp satırı düşürürdü.
 */
const CLOCK_SKEW_MS = 60 * 1000;

let pendingToken = 0;

function prunePending(now: number) {
  for (const [id, p] of PENDING) {
    if (now - p.rankedAt > PENDING_TTL_MS) PENDING.delete(id);
  }
  while (PENDING.size >= PENDING_MAX) {
    const oldest = PENDING.keys().next();
    if (oldest.done) break;
    PENDING.delete(oldest.value);
  }
}

function stashPending(
  orderId: string,
  rankedAt: number,
  rows: EvaluationRowDraft[],
  excludeManufacturerIds: readonly string[]
) {
  prunePending(rankedAt);
  const token = ++pendingToken;
  // Aynı sipariş yeniden sıralandıysa (red sonrası yeniden atama) EN SON
  // sıralama geçerlidir: kararı o verdi.
  PENDING.set(orderId, {
    orderId,
    token,
    rankedAt,
    excludedManufacturerIds: [...excludeManufacturerIds],
    rows,
  });
  scheduleSettle(orderId, token);
}

function takePending(orderId: string): PendingEvaluation | null {
  const pending = PENDING.get(orderId);
  if (!pending) return null;
  PENDING.delete(orderId);
  return pending;
}

function scheduleSettle(orderId: string, token: number) {
  const timer = setTimeout(() => {
    void settleFromOrderRow(orderId, token);
  }, SETTLE_DELAY_MS);
  // Bir telemetri zamanlayıcısı, betiği/işlemi ayakta tutmamalı.
  if (typeof timer === "object" && typeof timer.unref === "function") {
    timer.unref();
  }
}

/**
 * Çağıran `commitAssignmentEvaluation` demediyse: siparişin KENDİ satırından
 * yerleştirmeyi doğrula.
 *
 * Yazma koşulları (hepsi birden):
 *  - sipariş hâlâ beklemedeki kaydın sahibi (araya yeni bir sıralama girmemiş),
 *  - siparişte bir üretici var ve `manufacturerStatus` 'unassigned' değil,
 *  - atama zamanı bizim sıralamamızdan ESKİ değil — yoksa çok önce atanmış bir
 *    siparişi, hiç yerleşmemiş bir sıralamanın sonucuymuş gibi kaydederdik.
 * Aksi hâlde beklemedeki kayıt sessizce düşer: uygun aday çıkmadıysa, yarış
 * kaybedildiyse ya da tarama "aday değişti" deyip vazgeçtiyse ortada
 * açıklanacak bir atama yoktur.
 */
async function settleFromOrderRow(orderId: string, token: number) {
  const pending = PENDING.get(orderId);
  if (!pending || pending.token !== token) return;
  try {
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: {
        manufacturerId: true,
        manufacturerStatus: true,
        assignedToManufacturerAt: true,
      },
    });
    // Okuma sırasında ARAYA YENİ BİR SIRALAMA girmiş olabilir (red sonrası
    // yeniden atama). O zaman bu zamanlayıcı bayattır: yeni kaydı silip eski
    // taslağı yazmak, güncel kararı sessizce çöpe atardı.
    const current = PENDING.get(orderId);
    if (!current || current.token !== token) return;
    // Artık kimse bu kaydı yazmayacak; her hâlükârda bellekten düşür.
    PENDING.delete(orderId);
    if (!order?.manufacturerId) return;
    if (order.manufacturerStatus === "unassigned") return;
    const assignedAt = order.assignedToManufacturerAt?.getTime() ?? 0;
    if (assignedAt < pending.rankedAt - CLOCK_SKEW_MS) return;
    await writeEvaluationRows(pending, order.manufacturerId);
  } catch (err) {
    console.warn(`[Q7 shadow] değerlendirme doğrulanamadı (${orderId}):`, err);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Satır üretimi ve yazımı
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Bir karşılaştırmayı satır TASLAĞINA çevirir (henüz DB'ye gitmez).
 *
 * SÜTUN YERLEŞİMİ satırın türüne göre değişir ve OKUYUCUYLA birebir aynı olmak
 * zorundadır (admin/scoring-evaluations/evaluation-view.ts):
 *  - ağırlık karşılaştırması (v2.2): sütun = profilin kendisi, kararı veren
 *    tarafı `authoritative` söyler. Tablonun tarihsel anlamı budur.
 *  - mesafe gölgesi (v3.0): v1 sütunu HER ZAMAN canlı seçimdir, v2 sütunu
 *    sürekli mesafeli meydan okuyan. Burada canlıyı `authoritative`'in sütununa
 *    koymak, kanarya açıldığı gün canlı ile gölgeyi yer değiştirirdi — ekran da
 *    işi kimin kazandığı konusunda tam tersini söylerdi.
 *
 * Her taraf AYRICA kendi ağırlık sürümünü ve mesafe modelini jsonb içinde
 * damgalar (P1-C4): satırın tek `weights_version` sütunu iki tarafı birden
 * adlandıramaz, ve gölge profil değiştiğinde eski bir satırın hangi algoritmayla
 * üretildiği yalnızca bu damgadan okunabilir.
 */
function draftRow(args: {
  /** Satırın `weights_version` sütunu — karşılaştırmanın kimliği. */
  rowWeightsVersion: string;
  authoritative: ScoringProfile;
  /** Kararı veren sıralama. */
  live: EvaluationSideInput;
  /** Aynı anda çalışan, karara etki etmeyen sıralama. */
  shadow: EvaluationSideInput;
  /**
   * Canlı taraf hangi sütuna yazılsın:
   *  "profile" → profilin kendi sütunu (v1 profili v1_*, v2 profili v2_*)
   *  "v1"      → her zaman v1_* (mesafe gölgesi satırı)
   */
  livePlacement: "profile" | "v1";
  /** Faz 5 satırını üreten sinyaller; öbür karşılaştırmalarda yoktur. */
  signals?: string[];
}): EvaluationRowDraft {
  // Persist top-3 score snapshots only — anything below rank 3 is
  // useless noise once we're looking at decision quality.
  const summarize = (list: CandidateScore[]) =>
    list
      .filter((c) => c.eligible)
      .slice(0, 3)
      .map((c) => ({
        manufacturerId: c.manufacturerId,
        companyName: c.companyName,
        totalScore: c.totalScore,
        scores: c.scores,
        // Faz 5 açıklaması (ceza kalemleri, ağırlıklı yük, kapsama kaynağı).
        // Sinyaller kapalıyken alan hiç YOKTUR, yani eski satırların şekli
        // değişmez.
        ...(c.shadow ? { shadow: c.shadow } : {}),
      }));

  const sideOf = (input: EvaluationSideInput): EvaluationSideSnapshot => ({
    winnerId: input.list.find((c) => c.eligible)?.manufacturerId ?? null,
    // Damga profilden TÜRETİLEMİYORSA açık değer kazanır: Faz 5 gölgesinde iki
    // taraf da aynı profili taşır, ayrımı sinyaller yapar.
    weightsVersion: input.versionOverride ?? weightsVersion(input.profile),
    distanceModel: input.distanceModelOverride ?? getDistanceModel(input.profile),
    candidates: summarize(input.list),
  });

  const live = sideOf(args.live);
  const shadow = sideOf(args.shadow);
  // Canlı taraf ağırlık satırında profilin kendi sütununa, mesafe satırında
  // sabit v1 sütununa yazılır.
  const liveInV2Column =
    args.livePlacement === "profile" && args.authoritative === "v2";
  const [v1Side, v2Side] = liveInV2Column ? [shadow, live] : [live, shadow];
  return {
    rowWeightsVersion: args.rowWeightsVersion,
    authoritative: args.authoritative,
    v1: v1Side,
    v2: v2Side,
    signals: args.signals,
  };
}

/**
 * jsonb tarafı: karar kimliği + sürüm damgası + gerçekleşen atama + dışlananlar +
 * ilk üç aday.
 */
function sideJson(
  side: EvaluationSideSnapshot,
  decisionId: string,
  assignedManufacturerId: string,
  excludedManufacturerIds: readonly string[],
  signals?: readonly string[]
) {
  return {
    /**
     * Bu satırı üreten Faz 5 sinyalleri (varsa).
     *
     * Damga olmadan satır geriye dönük okunamaz: aynı "v4.0" etiketi, iki hafta
     * sonra bir sinyal kapatıldığında BAŞKA bir formülü anlatır.
     */
    ...(signals && signals.length > 0 ? { signals: [...signals] } : {}),
    /**
     * Bu satırı doğuran YERLEŞTİRME KARARININ kimliği (D-C1).
     *
     * Bir karar tabloya birden çok satır yazıyor (ağırlık karşılaştırması +
     * mesafe gölgesi) ve İKİ AYRI karar birbirine saniyeler kadar yaklaşabiliyor
     * (arka arkaya iki geri alma, otomatik atamanın hemen ardından tarama
     * uygulaması). Satırları yalnız zamana bakarak gruplandırmak o iki kararı
     * tek karara katlıyor, önceki yerleştirmenin kazananını da işi alan
     * atölyesini de ekranlardan siliyordu. Damga varsa okuyucu zamanı hiç
     * sormaz; 5 sn'lik pencere yalnızca damgadan ÖNCE yazılmış satırlar için
     * yedek olarak durur.
     */
    decisionId,
    weightsVersion: side.weightsVersion,
    distanceModel: side.distanceModel,
    /**
     * Bu DENEMEDE sıralamaya hiç sokulmayan atölyeler.
     *
     * Dışlama artık sıralamanın içinde uygulandığı için kazanan = yerleşen olur
     * ve ekran kimseyi haksız yere suçlamaz; ama "en yakın atölye neden hiç
     * görünmüyor" sorusunun cevabı yalnız burada durur. Siparişin kalıcı
     * `declinedManufacturerIds` listesinden ayrıdır: o listeye yazılmayan bir
     * geri alma da buraya düşer.
     */
    excludedManufacturerIds: [...excludedManufacturerIds],
    /**
     * İşİ GERÇEKTEN ALAN atölye. Tabloda bunun için sütun yok (migration da
     * yok), oysa satırın bütün anlamı "şu karar şu atölyeye gitti"dir: kazanan
     * sütunları sıralamanın seçtiğini söyler, bu alan yerleşenin ta kendisini.
     * Sipariş sonradan devredilse bile satır o günkü atamayı anlatmaya devam
     * eder — siparişin bugünkü üreticisine bakmak bu soruyu cevaplamaz.
     */
    assignedManufacturerId,
    candidates: side.candidates,
  };
}

/**
 * Satırları yazar — EKLEYEREK, üzerine yazmadan; hepsini TEK bir karar kimliğiyle
 * damgalayarak.
 *
 * Eskiden burada `onConflictDoUpdate` vardı, çünkü tablo UNIQUE (order_id,
 * weights_version) taşıyordu: sipariş+sürüm başına tek satır. O tekillik "son
 * karar kazanır" demekti, yani bir siparişin İKİNCİ yerleştirmesi (geri al +
 * yeniden atama, ret sonrası yeniden atama) BİRİNCİNİN kaydını siliyordu.
 * Kartın "Önceki atama kararları" bölümü bu yüzden hiçbir koşulda dolmuyor,
 * ilk kararın kimi seçtiği de geri alınamaz biçimde kayboluyordu. Migration
 * 0054 tekil indeksi kaldırdı; her karar artık kendi satırını EKLER ve okuyucu
 * satırları zamana göre kararlara böler (groupEvaluationDecisions).
 *
 * Aynı taslak iki kez yazılamaz: satırları yazan iki yol da (`commit...` ve
 * gecikmeli doğrulama) taslağı `takePending` ile ALIR, yani ikisinden yalnız
 * biri kazanır. Tekil indeks gittiği için bu artık bir kopya satır doğururdu.
 *
 * `created_at` YAZILMAZ: tek saat veritabanınınkidir (kolonun `now()`
 * varsayılanı). Eskiden çakışma tazelemesi uygulama saatini, taze insert ise DB
 * saatini yazıyordu; iki saat arasındaki sapma, "en yeni karar" manşetini ve
 * kararları gruplayan 5 sn'lik pencereyi yanıltabilirdi.
 *
 * Satırlar SIRAYLA yazılır (önce ağırlık, sonra mesafe karşılaştırması): aynı
 * anda atılan iki insert'in `created_at`'i mikrosaniye farkıyla rastgele
 * sıralanıyordu ve "en yeni değerlendirme" diye gösterilen satır her çalıştırmada
 * değişiyordu.
 */
async function writeEvaluationRows(
  pending: PendingEvaluation,
  assignedManufacturerId: string
) {
  // D-C1: BİR yerleştirme kararı = BİR kimlik, kararın bütün satırlarına aynı
  // damga. Kimlik BURADA üretilir, çünkü satırların yazıldığı an kararın
  // gerçekleştiği andır: aynı taslak iki kez yazılamaz (`takePending` onu alır),
  // yeniden sıralanan sipariş ise yeni bir taslak ve yeni bir kimlik alır.
  const decisionId = randomUUID();
  for (const row of pending.rows) {
    await db.insert(manufacturerAssignmentEvaluations).values({
      orderId: pending.orderId,
      weightsVersion: row.rowWeightsVersion,
      v1WinnerId: row.v1.winnerId,
      v2WinnerId: row.v2.winnerId,
      v1Scores: sideJson(
        row.v1,
        decisionId,
        assignedManufacturerId,
        pending.excludedManufacturerIds,
        row.signals
      ),
      v2Scores: sideJson(
        row.v2,
        decisionId,
        assignedManufacturerId,
        pending.excludedManufacturerIds,
        row.signals
      ),
      authoritative: row.authoritative,
    });
  }
}
