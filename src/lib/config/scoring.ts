/**
 * Faz 5 — üretici sıralamasının YENİ sinyalleri. SAF yapılandırma modülü.
 *
 * DB yok, `server-only` yok: bu modülü hem API rotaları, hem BullMQ worker'ı
 * (atama zinciri worker'dan da yürüyor), hem admin İSTEMCİ bileşeni, hem de
 * DB'siz birim testi import eder. Boyacı ikizi `painter-scoring.ts`, üreticinin
 * bugünkü canlı ağırlıkları ise `manufacturer-scoring.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BU DOSYANIN TEK SÖZÜ: BURADAKİ HİÇBİR SİNYAL, KİMİN İŞ ALDIĞINI BUGÜN
 * DEĞİŞTİRMEZ.
 *
 * Sahibin kararı (ranker-rollout = B): her yeni sıralama sinyali önce YALNIZ
 * GÖLGEDE çalışır, bir-iki hafta bugünün skorunun yanına kaydedilir,
 * karşılaştırılır; ancak ondan sonra açılır. Partner gelirini sessizce oynatan
 * bir değişiklik bu fazda SÖZLEŞME İHLALİDİR.
 *
 * Bu yüzden her sinyalin İKİ ayrı anahtarı var:
 *   <SİNYAL>_LIVE   — canlı skora girer mi?   VARSAYILAN: HAYIR
 *   <SİNYAL>_SHADOW — gölge kaydına girer mi? VARSAYILAN: EVET
 *
 * İki anahtarın ayrı olması şart: tek anahtar olsaydı "gölgede ölçmek" ile
 * "canlıya almak" aynı hareket olurdu ve ölçüm yapmanın bedeli, ölçülen şeyin
 * canlıya çıkması olurdu.
 *
 * YAPISAL GÜVENCE: sıralayıcı sinyalleri KENDİ okumaz; `signalsForProfile()`
 * ile bir KÜME alır ve yalnız o kümedeki sinyali uygular. Canlı profiller için
 * bu küme varsayılanda BOŞTUR (`NO_SIGNALS`), yani canlı skor bugünküyle
 * bit-bit aynıdır. `scripts/test-scoring-v2.ts` bunu sayısal olarak doğrular:
 * bütün gölge anahtarları AÇIKken canlı sıralamanın çıktısı değişirse test
 * düşer.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { painterLoadUnits } from "@/lib/config/painter-scoring";
import type { ScoringWeights } from "@/lib/config/manufacturer-scoring";

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Sinyaller: kapalı küme
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Faz 5'te eklenen sıralama sinyalleri. KAPALI KÜME — yeni bir sinyal
 * eklendiğinde etiketini, iki env anahtarını ve testini yazmak DERLEME
 * zorunluluğu olsun diye (aşağıdaki `Record<Phase5SignalKey, …>` sözlükleri).
 *
 * Sahibin cümlesiyle:
 *  - paintInHouse     "kendi boyayan atölyeye, boyamalı siparişte küçük bir artı"
 *  - qcRejections     "güvenilirlik QC redleriyle düşsün"
 *  - strikes          "güvenilirlik ceza puanıyla düşsün"
 *  - onTime           "zamanında teslim gerçekten ağırlıklansın"
 *  - weightedLoad     "adet sayılsın" (capacity-unit = C, Faz 4'ün kuralı)
 *  - largeFormat      "büyük parçayı basamayan atölyeye gitmesin"
 *  - computedCoverage "etki alanı tıklanmasın, hesaplansın" (coverage-model = B)
 */
export type Phase5SignalKey =
  | "paintInHouse"
  | "qcRejections"
  | "strikes"
  | "onTime"
  | "weightedLoad"
  | "largeFormat"
  | "computedCoverage";

export const PHASE5_SIGNAL_KEYS = [
  "paintInHouse",
  "qcRejections",
  "strikes",
  "onTime",
  "weightedLoad",
  "largeFormat",
  "computedCoverage",
] as const satisfies readonly Phase5SignalKey[];

/** Ekranlarda yazılan Türkçe ad. Admin iki ekranda iki ayrı sözlük öğrenmesin. */
export const PHASE5_SIGNAL_LABELS_TR: Record<Phase5SignalKey, string> = {
  paintInHouse: "Kendi boyayan atölye",
  qcRejections: "QC reddi cezası",
  strikes: "Ceza puanı (strike)",
  onTime: "Zamanında teslim ağırlığı",
  weightedLoad: "Ağırlıklı kapasite (adet)",
  largeFormat: "Büyük format yeteneği",
  computedCoverage: "Hesaplanan etki alanı",
};

/** Sinyalin ne yaptığını bir cümlede söyleyen açıklama (ekrandaki ipucu). */
export const PHASE5_SIGNAL_HINTS_TR: Record<Phase5SignalKey, string> = {
  paintInHouse:
    "Sipariş boyama içeriyorsa ve atölye boyamayı kendi yapıyorsa toplam skora küçük bir artı: bir kargo bacağı ve bir el değiştirme eksilir.",
  qcRejections:
    "Son işlerinin kaçı kalite kontrolünden geri döndü — güvenilirlik o oranda düşer.",
  strikes: "Biriken ceza puanı güvenilirliği düşürür (her ceza sabit bir puan).",
  onTime:
    "Atama→baskı ve baskı→kargo süreleri gerçekten ağırlık taşır. Canlı v1'de bu sinyalin ağırlığı sıfır olduğu için bugüne kadar hiç konuşmuyordu.",
  weightedLoad:
    "Yük, iş sayısı değil ADET ağırlıklı sayılır: sipariş başına 1, her 20 adet için 1 daha (Faz 4'te boyacı tarafında yürürlüğe giren kuralın aynısı).",
  largeFormat:
    "Sipariş büyük format istiyorsa, bunu beyan etmemiş atölye aday listesinden düşer.",
  computedCoverage:
    "Etki alanı elle yazılan listeden değil, hesaplanan kapsama planından okunur (sabitlenen ve dışlanan iller dâhil).",
};

/** Bir sıralama geçişinde YÜRÜRLÜKTE olan sinyaller. */
export type Phase5SignalSet = Readonly<Record<Phase5SignalKey, boolean>>;

/**
 * HİÇBİR yeni sinyal yok — yani BUGÜNKÜ canlı davranış.
 *
 * Donduruldu (`Object.freeze`): sıralayıcının içinde yanlışlıkla bir alanı
 * `true`ya çeken bir satır, sessizce canlı skoru oynatırdı. Donmuş nesnede o
 * satır katı modda fırlar, sessiz kalmaz.
 */
export const NO_SIGNALS: Phase5SignalSet = Object.freeze({
  paintInHouse: false,
  qcRejections: false,
  strikes: false,
  onTime: false,
  weightedLoad: false,
  largeFormat: false,
  computedCoverage: false,
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Anahtarlar: canlı KAPALI doğar, gölge AÇIK doğar
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Sinyal başına iki env anahtarı. Tek yerde durur: ayarı okuyan da, sürüm
 * damgasını üreten de, testi yazan da aynı listeyi görsün.
 *
 * NEDEN env, NEDEN `platform_flags` DEĞİL: `platform_flags` tablosu operatörün
 * tek tıkla çevirdiği CANLI musluklardır (config/flags.ts). Bir ölçüm
 * anahtarını oraya koymak, "kimin iş aldığını değiştir" düğmesini "raporu aç"
 * düğmesinin yanına koymak olurdu. Sıralama kalibrasyonu bu depoda zaten env
 * ile ayarlanıyor (MANUFACTURER_SCORING_V2_PERCENT, MFG_W2_*), aynı rafta durur.
 */
export const PHASE5_SIGNAL_ENV: Record<
  Phase5SignalKey,
  { live: string; shadow: string }
> = {
  paintInHouse: {
    live: "MFG_SIGNAL_PAINT_IN_HOUSE_LIVE",
    shadow: "MFG_SIGNAL_PAINT_IN_HOUSE_SHADOW",
  },
  qcRejections: {
    live: "MFG_SIGNAL_QC_LIVE",
    shadow: "MFG_SIGNAL_QC_SHADOW",
  },
  strikes: {
    live: "MFG_SIGNAL_STRIKES_LIVE",
    shadow: "MFG_SIGNAL_STRIKES_SHADOW",
  },
  onTime: {
    live: "MFG_SIGNAL_OTD_LIVE",
    shadow: "MFG_SIGNAL_OTD_SHADOW",
  },
  weightedLoad: {
    live: "MFG_SIGNAL_WEIGHTED_LOAD_LIVE",
    shadow: "MFG_SIGNAL_WEIGHTED_LOAD_SHADOW",
  },
  largeFormat: {
    live: "MFG_SIGNAL_LARGE_FORMAT_LIVE",
    shadow: "MFG_SIGNAL_LARGE_FORMAT_SHADOW",
  },
  computedCoverage: {
    live: "MFG_SIGNAL_COMPUTED_COVERAGE_LIVE",
    shadow: "MFG_SIGNAL_COMPUTED_COVERAGE_SHADOW",
  },
};

/**
 * Anahtar okuması. YALNIZ "1" / "true" AÇAR.
 *
 * Hoşgörülü bir okuma ("0" dışındaki her şey açık) tehlikeli olurdu: canlı
 * tarafta yanlış yazılmış bir değer ("off", "hayır", "") partner gelirini
 * oynatırdı. Tanımadığı değer, varsayılana düşer.
 */
function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return fallback;
}

/**
 * CANLI skora giren sinyaller. Varsayılan: HİÇBİRİ.
 *
 * Bu fonksiyonun `true` döndürdüğü her sinyal GERÇEK PARAYI oynatır (kim iş
 * alırsa hakedişi o kazanır). Varsayılanın "kapalı" olması bu yüzden bir
 * tercih değil, fazın bağlayıcı kararıdır.
 */
export function liveSignalSet(): Phase5SignalSet {
  const out = {} as Record<Phase5SignalKey, boolean>;
  for (const key of PHASE5_SIGNAL_KEYS) {
    out[key] = envBool(PHASE5_SIGNAL_ENV[key].live, false);
  }
  return out;
}

/**
 * GÖLGE kaydına giren sinyaller. Varsayılan: HEPSİ.
 *
 * Gölge hiçbir işi yerleştirmez; amacı bir-iki haftalık karşılaştırma verisi
 * toplamaktır ve yarım veriyle o karşılaştırma yapılamaz.
 */
export function shadowSignalSet(): Phase5SignalSet {
  const out = {} as Record<Phase5SignalKey, boolean>;
  for (const key of PHASE5_SIGNAL_KEYS) {
    out[key] = envBool(PHASE5_SIGNAL_ENV[key].shadow, true);
  }
  return out;
}

/**
 * Sıralayıcının çağırdığı TEK kapı: "bu geçişte hangi sinyaller yürürlükte?"
 *
 * `lane` ayrımı yapısaldır ve kasıtlıdır: sıralayıcı hiçbir yerde env okumaz,
 * yalnız bu fonksiyonun verdiği kümeye bakar. Yani "canlı skora yeni bir sinyal
 * sızdı mı?" sorusunun cevabı TEK bir yerde aranır — burada.
 *
 *   "live"   → kararı veren sıralama (v1/v2). Varsayılanda BOŞ küme.
 *   "shadow" → yalnız kaydedilen, hiçbir işi yerleştirmeyen sıralama.
 */
export function signalsForProfile(lane: "live" | "shadow"): Phase5SignalSet {
  return lane === "shadow" ? shadowSignalSet() : liveSignalSet();
}

/** Kümede açık olan sinyaller (kayda ve ekrana yazılan liste). */
export function activeSignals(set: Phase5SignalSet): Phase5SignalKey[] {
  return PHASE5_SIGNAL_KEYS.filter((k) => set[k]);
}

/** Kümede hiç sinyal var mı? (Pahalı yüklemeleri atlamak için.) */
export function anySignalOn(set: Phase5SignalSet): boolean {
  return PHASE5_SIGNAL_KEYS.some((k) => set[k]);
}

/**
 * Gölge kaydı çalışsın mı? Tek kaldıraç, tek `0`.
 *
 * NEDEN YÜZDE DEĞİL BOOLEAN: mesafe gölgesi (Faz 1) yüzdeyle örnekleniyor
 * çünkü o, ÜÇÜNCÜ bir tam sıralama açıyordu. Faz 5 gölgesi aynı veri
 * yüklemesinden besleniyor (bkz. manufacturer-assignment.ts, maliyet notu),
 * yani atölye başına ek sorgusu yalnız QC geçmişi. Örnekleme kazancı, ikinci
 * bir hash kovası ve onun "iki deney birbirinin yanlılığını taşımasın" bakım
 * yükü kadar etmiyor. Kapatmak gerekirse tek anahtar yeter.
 */
export function isPhase5ShadowEnabled(): boolean {
  return envBool("MFG_PHASE5_SHADOW", true);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Gölge ağırlıkları
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Faz 5 gölge ağırlıkları. Toplam = 1.0; tüketiciler NORMALİZE ETMEZ (canlı
 * taraftaki sözleşmenin aynısı).
 *
 * Canlı v1 (.35 / .30 / .18 / 0 / .05 / .12) ile farkı TEK bir niyet: zamanında
 * teslim gerçekten konuşsun. 0.15'lik pay mesafeden (.35→.30), yükten (.30→.28)
 * ve parti uyumundan (.12→.07) kesildi:
 *
 *  - mesafe .30 — hâlâ en ağır kalem, çünkü kargoyu platform ödüyor. Sürekli
 *    mesafe eğrisi kalibre edilirken (DISTANCE_NEAR_SCORE notu) "yarı dolu
 *    YEREL atölye, boştaki UZAK atölyeyi yener" eşitliği .35 ile kurulmuştu;
 *    .30'da da korunur çünkü yük ağırlığı da birlikte indi.
 *  - yük .28 — ağırlıklı yük sinyaliyle birlikte bu ağırlık ARTIK DAHA ÇOK
 *    ŞEY SÖYLÜYOR (adet sayılıyor), o yüzden puanını düşürmek kapasiteyi
 *    zayıflatmaz; ölçüsü keskinleşti.
 *  - güvenilirlik .15 — QC ve ceza puanı cezaları da bu kalemin İÇİNDEN
 *    çalışıyor (ayrı ağırlık açılmadı, sahibin cümlesi "güvenilirlik düşsün").
 *  - zamanında teslim .15 — sahibin istediği asıl değişiklik. Güvenilirlikle
 *    aynı ağırlıkta: ikisi de "bu atölye sözünü tutuyor mu" sorusunun iki yüzü.
 *  - uygunluk .05 — dokunulmadı.
 *  - parti uyumu .07 — sıralamayı çevirmesi zaten istenmeyen bir düzeltici;
 *    .12'de zamanında teslimle yarışacak hâle gelirdi.
 *
 * Kendi boyayan atölye BİR AĞIRLIK DEĞİL, toplama eklenen küçük bir BONUSTUR
 * (bkz. PAINT_IN_HOUSE_BONUS) — sahibin kelimesi de "küçük bir bonus".
 */
export const PHASE5_WEIGHTS: ScoringWeights = {
  distance: 0.3,
  load: 0.28,
  reliability: 0.15,
  onTimeDelivery: 0.15,
  compliance: 0.05,
  batchAffinity: 0.07,
};

/**
 * Gölge geçişinin ağırlıkları.
 *
 * `onTime` sinyali KAPALIYSA canlı ağırlıklar aynen kullanılır. Sebep: gölgenin
 * tek amacı "şu sinyal açılırsa ne değişir" sorusunu yanıtlamak ve İKİ
 * DEĞİŞKENLİ bir deneyin sonucu hiçbir sinyale atfedilemez. Zamanında teslim
 * kapalıyken yine de yeni ağırlıklarla puanlasaydık, gölgede çıkan her fark
 * "ağırlıklar mı, öbür sinyaller mi?" diye cevapsız kalırdı. (Aynı ilke
 * V3_WEIGHTS'te de yazılı: v3, v1'in ağırlıklarını BİLEREK aynen kullanır.)
 */
export function phase5Weights(
  signals: Phase5SignalSet,
  liveWeights: ScoringWeights
): ScoringWeights {
  return signals.onTime ? PHASE5_WEIGHTS : liveWeights;
}

/**
 * Gölge satırının `weights_version` damgası.
 *
 * Canlı sürümlerden (v1.2 / v2.2) ve mesafe gölgesinden (v3.0) ayrı bir metin:
 * değerlendirme tablosunda satırlar bu damgayla ayrışıyor ve okuyucu
 * (scoring-evaluations/evaluation-view.ts) hangi karşılaştırmaya baktığını
 * yalnız buradan bilebiliyor.
 *
 * Ağırlıklar ya da ceza sabitleri değişirse BUMP EDİLMELİ: eski satırlar başka
 * bir formülün ürünüdür ve yenileriyle aynı kovada karşılaştırılamaz.
 */
export const PHASE5_WEIGHTS_VERSION = "v4.0";

/**
 * Gölge tarafının mesafe modeli: KADEMELİ — yani canlının kullandığının aynısı.
 *
 * Sürekli mesafe ayrı bir deneydir (v3 gölgesi, Faz 1) ve hâlâ ölçülüyor. Faz 5
 * gölgesine onu da katmak, tek karşılaştırmada iki bağımsız değişken oynatmak
 * olurdu: kazanan değiştiğinde sebebin sürekli mesafe mi yoksa yeni sinyaller
 * mi olduğu söylenemezdi.
 */
export const PHASE5_DISTANCE_MODEL = "tiered" as const;

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Sinyallerin saf matematiği
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Bir sinyalin konuşabilmesi için gereken en az örnek. Altında NÖTR yazılır:
 * yeni atölye ne ödüllendirilir ne cezalandırılır. Üretici tarafındaki
 * güvenilirlik/OTD eşiğiyle (3) ve boyacı tarafıyla aynı sayı.
 */
export const PHASE5_MIN_HISTORY_SAMPLES = 3;

/**
 * Kendi boyayan atölyenin bonusu — TOPLAM skora eklenen puan.
 *
 * NEDEN 4 PUAN: ağırlıklı toplam 0–100 aralığında. 4 puan, neredeyse eşit iki
 * atölye arasındaki sırayı çevirmeye yeter; mesafe ya da kapasite farkını
 * yenmeye yetmez (300 km'lik mesafe farkı tek başına ~13 puan). Sahibin
 * kelimesi "küçük bir bonus" ve ölçüsü tam olarak budur.
 *
 * NEDEN AĞIRLIK DEĞİL BONUS: ağırlık olsaydı ScoringWeights'e altıncı bir alan
 * girerdi ve o alanı canlı profillerin de (v1/v2) taşıması gerekirdi — yani
 * canlı formülün ŞEKLİ, hiç açılmamış bir sinyal yüzünden değişirdi. Bonus,
 * kapalıyken tam olarak 0'dır ve formüle hiç dokunmaz.
 *
 * DİKKAT — BU BONUS PARA DAĞITIMINI OYNATIR: üretici boyamayı kendi yaparsa
 * boyama payı da onun hakedişinde kalır (earning-base.ts · manufacturerBaseKurus)
 * ve o siparişte hiçbir boyacı kazanmaz. Yani sinyal yalnız "kim iş alır"ı
 * değil, "pasta nasıl bölünür"ü de değiştirir. Gölgede kalmasının ve canlıya
 * ancak bilinçli bir kararla alınmasının sebebi budur.
 */
export const PAINT_IN_HOUSE_BONUS = 4;

/** Bonusun girdisi — DB tiplerine bağlı değil. */
export interface PaintInHouseInput {
  /** Siparişte boyama kalemi var mı (`orders.needsPainting`). */
  orderNeedsPainting: boolean;
  /** Atölye boyamayı kendi yapıyor mu (`manufacturers.paintsInHouse`). */
  paintsInHouse: boolean;
}

/**
 * Toplam skora eklenecek bonus. Sinyal kapalıysa ya da sipariş boyama
 * istemiyorsa 0 — boyamasız siparişte "kendi boyuyor" bir üstünlük değildir.
 */
export function paintInHouseBonus(
  signals: Phase5SignalSet,
  input: PaintInHouseInput
): number {
  if (!signals.paintInHouse) return 0;
  if (!input.orderNeedsPainting) return 0;
  return input.paintsInHouse ? PAINT_IN_HOUSE_BONUS : 0;
}

/**
 * QC reddi cezasının ÜST SINIRI (puan). Son işlerinin TAMAMI geri dönmüş bir
 * atölye güvenilirlikten bu kadar kaybeder.
 *
 * NEDEN 40: güvenilirliğin nötr tabanı 70. 40 puanlık tam ceza, kronik QC
 * reddi olan bir atölyeyi 30'a indirir — listenin altına düşer ama UYGUNSUZ
 * olmaz. Uygunsuzluk ayrı ve açık bir yaptırımdır (askıya alma); sıralama
 * cezası onun yerine geçemez.
 */
export const QC_REJECTION_PENALTY_MAX = 40;

/** Ceza puanı (strike) başına düşülen puan ve toplam tavan. */
export const STRIKE_PENALTY_PER = 12;
export const STRIKE_PENALTY_CAP = 36;

/** Güvenilirlik cezalarının girdisi. */
export interface ReliabilityPenaltyInput {
  /** Son işlerden kaçı sayıldı (pencere: sıralayıcının OTD penceresiyle aynı). */
  jobs: number;
  /** Bunlardan kaçı en az bir kez QC'den geri döndü (`qcRejectionCount > 0`). */
  rejectedJobs: number;
  /** `manufacturers.strikeCount`. */
  strikeCount: number;
}

export interface ReliabilityPenaltyResult {
  /** Cezalar uygulandıktan sonraki güvenilirlik (0–100). */
  score: number;
  /** Uygulanan QC cezası (puan) — açıklanabilirlik için ayrı taşınır. */
  qcPenalty: number;
  /** Uygulanan ceza-puanı cezası (puan). */
  strikePenalty: number;
}

/**
 * Güvenilirliği QC redleri ve ceza puanlarıyla düşürür.
 *
 * NEDEN AYRI BİR ALT SKOR DEĞİL: sahibin cümlesi "güvenilirlik QC redleriyle ve
 * ceza puanlarıyla DÜŞSÜN". Boyacı tarafında QC ayrı bir ağırlık taşıyor
 * (qcQuality), ama orada sorulan soru başka: "iş ikinci bir tura kalıyor mu".
 * Burada sorulan soru güvenilirliğin ta kendisi ve iki ayrı kalem açmak,
 * ağırlıkların toplamını yeniden bölüştürmeyi gerektirirdi — yani ölçülmek
 * istenen şeyin yanına ikinci bir değişken daha koyardı.
 *
 * Cezalar TOPLANIR, çarpılmaz: çarpım, iki kötü sinyali olan bir atölyeyi
 * orantısız biçimde dibe vururdu ve iki sinyal birbirinden bağımsız.
 *
 * Eşiğin altında (3 örnek) QC cezası YAZILMAZ: tek işi geri dönmüş yeni bir
 * atölyeyi "kronik" saymak, onu hiç iş alamaz hâle getirirdi. Ceza puanı ise
 * örnek saymaz — o zaten tek tek verilmiş açık bir yaptırımdır.
 */
export function applyReliabilityPenalties(
  base: number,
  input: ReliabilityPenaltyInput,
  signals: Phase5SignalSet
): ReliabilityPenaltyResult {
  let qcPenalty = 0;
  if (signals.qcRejections && input.jobs >= PHASE5_MIN_HISTORY_SAMPLES) {
    const rejected = Math.max(0, Math.min(input.rejectedJobs, input.jobs));
    qcPenalty = Math.round((rejected / input.jobs) * QC_REJECTION_PENALTY_MAX);
  }
  let strikePenalty = 0;
  if (signals.strikes && input.strikeCount > 0) {
    strikePenalty = Math.min(
      STRIKE_PENALTY_CAP,
      input.strikeCount * STRIKE_PENALTY_PER
    );
  }
  const score = Math.max(0, Math.min(100, Math.round(base - qcPenalty - strikePenalty)));
  return { score, qcPenalty, strikePenalty };
}

/**
 * ADET AĞIRLIKLI YÜK BİRİMİ — sahibin kapasite kararı (capacity-unit = C):
 * "sipariş başına bir, toplu işte her yirmi adet için bir tane daha".
 *
 * KURAL BURADA YENİDEN YAZILMAZ. Faz 4 bu kuralı boyacı tarafında yürürlüğe
 * koydu (`painterLoadUnits`) ve fazın bağlayıcı kuralı şu: bir kuralın ikinci
 * kopyası, kusurun ta kendisidir. Faz 5'in işi kuralı ÜRETİCİ tarafına
 * getirmek, ikinci bir tanımını yazmak değil — o yüzden burada yalnızca aynı
 * fonksiyon yeniden adlandırılarak dışa veriliyor.
 *
 * Ad neden değişiyor: çağıran taraf üretici sıralayıcısı ve orada
 * `painterLoadUnits(...)` yazmak, okuyan kişiye yanlış bir şey söylerdi
 * ("boyacının yükü neden burada?"). Kural tek, ad iki bağlama uyuyor.
 *
 * NOT (K2 sahibine): üretici tarafının KAPI'sı (`manufacturerHasRoom` /
 * manufacturer-capacity.ts) da bu aynı fonksiyonu çağırmalı. İkinci bir
 * `1 + floor(adet/20)` yazımı, Faz 4'te ölçülen kusurun üretici tarafındaki
 * tıpatıp aynısını doğurur: ekran bir ölçüyle kapatırken uç başka bir ölçüyle
 * kabul eder.
 */
export const manufacturerLoadUnits = painterLoadUnits;

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Hesaplanan etki alanı — K1'in planı için TAKILIR yuva
 * ────────────────────────────────────────────────────────────────────────── */

/** Etki alanının nereden okunduğu; gölge kaydına ve ekrana damgalanır. */
export type CoverageSource = "typed" | "computed";

/** Kapsama çözücüsünün gördüğü atölye satırı (DB tiplerine bağlı değil). */
export interface CoverageSubject {
  manufacturerId: string;
  /** Atölyenin kendi ili (`address.il`). */
  il: string | null;
  /** Elle yazılmış kapsama listesi (`manufacturers.coverageProvinces`). */
  coverageProvinces: string[] | null;
}

/**
 * "Bu atölye hangi illere bakıyor?" sorusunun HESAPLANMIŞ cevabı.
 *
 * TAKILIR YUVA, kopya DEĞİL: coverage-model = B kararının hesabı (mesafeden
 * türetilen kapsama + sahibin SABİTLEDİĞİ iller + DIŞLADIĞI iller) K1'in
 * dosyasında yazılıyor ve ORASI tek sahibidir — hem anasayfadaki harita hem
 * atama skoru TEK bir hesabı okumak zorunda. Buraya ikinci bir hesap yazmak,
 * fazın açıkça yasakladığı şeydir.
 *
 * Çözücü verilmediğinde gölge, bugünkü ELLE YAZILMIŞ listeyi kullanır ve
 * kaydına `coverageSource: "typed"` damgalar — yani ekran, hesaplanan kapsama
 * lanesinin henüz bağlanmadığını SÖYLER, sessizce "hesaplandı" demez.
 */
export type CoverageResolver = (subject: CoverageSubject) => readonly string[];

/* ────────────────────────────────────────────────────────────────────────────
 * 6. "Gölge kazananı neden farklı?" — saf açıklayıcı
 * ────────────────────────────────────────────────────────────────────────── */

/** Skor kırılımı — sıralayıcının `CandidateScore.scores` alanıyla aynı alanlar. */
export interface ComparableScores {
  distance: number;
  load: number;
  reliability: number;
  onTimeDelivery: number;
  compliance: number;
  batchAffinity: number;
}

/**
 * Gölge geçişinin adayın yanında taşıdığı AÇIKLAMA alanları.
 *
 * Skorun kendisinden geri çıkarılamaz: admin "güvenilirlik neden 58?" diye
 * sorduğunda cevabı ancak ayrıştırılmış ceza kalemleri verebilir.
 */
export interface ShadowSignalDetail {
  /** Bu geçişte yürürlükte olan sinyaller. */
  signals: Phase5SignalKey[];
  /** Ağırlıklı yük birimi (tek ölçü: manufacturer-capacity.ts · loadUnits). */
  loadUnits: number;
  /**
   * Ağırlıklı yük GERÇEKTEN ölçülebildi mi.
   *
   * Çağıran kapasite haritasını geçmediyse (savunma yolu) sıralayıcı ham iş
   * sayısına düşer. O hâlde gölge ile canlı bu kalemde aynı çıkar — ve bu
   * "fark yok" demek DEĞİLDİR, "ölçemedik" demektir. İkisini tek görünüşe
   * katlamak, okuyan kişiye sinyalin denendiğini ve bir şey değiştirmediğini
   * söylerdi; oysa sinyal hiç konuşmamıştır.
   */
  loadUnitsMeasured: boolean;
  /** Toplama eklenen bonus (kendi boyayan atölye). */
  bonus: number;
  /** Güvenilirlikten düşülen QC cezası. */
  qcPenalty: number;
  /** Güvenilirlikten düşülen ceza-puanı cezası. */
  strikePenalty: number;
  /** Etki alanı nereden okundu. */
  coverageSource: CoverageSource;
  /** Sipariş büyük format istiyor mu. */
  largeFormatRequired: boolean;
  /** Atölye bunu beyan etmiş mi (istenmiyorsa her zaman true). */
  largeFormatOk: boolean;
}

/** Açıklayıcının beklediği en küçük aday şekli. */
export interface ComparableCandidate {
  manufacturerId: string;
  companyName: string;
  totalScore: number;
  eligible: boolean;
  ineligibleReason?: string;
  scores: ComparableScores;
  shadow?: ShadowSignalDetail;
}

/** Tek adayın canlı ↔ gölge farkı, gerekçeleriyle. */
export interface ShadowCandidateDelta {
  manufacturerId: string;
  companyName: string;
  liveScore: number | null;
  shadowScore: number | null;
  /** gölge − canlı; taraflardan biri yoksa null. */
  delta: number | null;
  liveEligible: boolean;
  shadowEligible: boolean;
  /** Türkçe, insan okuyacak gerekçeler. Boşsa fark yok demektir. */
  reasons: string[];
}

/** Canlı ve gölge sıralamanın yan yana okunabilir hâli. */
export interface ShadowComparison {
  liveWinnerId: string | null;
  liveWinnerName: string | null;
  liveWinnerScore: number | null;
  shadowWinnerId: string | null;
  shadowWinnerName: string | null;
  shadowWinnerScore: number | null;
  /** İki taraf da bir atölye seçti ve bunlar FARKLI. */
  differs: boolean;
  /** Bu geçişte yürürlükte olan sinyaller (gölge tarafından okunur). */
  signals: Phase5SignalKey[];
  /** Aday başına fark; en çok oynayan üstte. */
  deltas: ShadowCandidateDelta[];
  /** Tek cümlelik Türkçe özet — ekranda manşet. */
  summaryTr: string;
}

/**
 * Gerekçe satırının eşiği: YARIM PUAN. Altında kalan kalem tek başına
 * yazılmaz — ama SESSİZCE DÜŞMEZ: yazılmayanların toplamı aşağıdaki kalan
 * satırına eklenir, yani yazılan satırların toplamı yine gösterilen farkı verir.
 */
const REASON_NOISE_TENTHS = 5;

/**
 * Puanı onda bir hassasiyetle, Türkçe ondalık ayırıcıyla yazar: "+1,4 puan".
 *
 * ONDALIK NEDEN VAR: bir alt skorun toplama katkısı ağırlığı kadardır (ör.
 * 0,28) ve tam sayıya yuvarlanmış kalemler artık toplanmaz. Dökümün toplanması
 * bu satırların TEK işi olduğu için hassasiyet burada pazarlık konusu değil.
 */
function pointsTr(tenths: number): string {
  const sign = tenths < 0 ? "−" : "+";
  const abs = Math.abs(tenths);
  const frac = abs % 10;
  return `${sign}${Math.floor(abs / 10)}${frac === 0 ? "" : `,${frac}`} puan`;
}

/** Ağırlıklı toplama giren kalemler; sıra, ekranda okunacak sıradır. */
const COMPONENT_LABELS_TR: readonly (readonly [keyof ComparableScores, string])[] = [
  ["distance", "Mesafe"],
  ["load", "Ağırlıklı yük"],
  ["reliability", "Güvenilirlik"],
  ["onTimeDelivery", "Zamanında teslim"],
  ["compliance", "Uygunluk"],
  ["batchAffinity", "Parti uyumu"],
];

/**
 * Bir adayın gölge skorunun NEDEN oynadığını Türkçe söyler.
 *
 * SÖZLEŞME — TEK BİRİM, TAM TOPLAM: her satır TOPLAM SKOR PUANI cinsindendir ve
 * satırların puanları toplandığında ekranda gösterilen fark (gölge − canlı)
 * çıkar. Önceden döküm İKİ BİRİMİ yan yana yazıyordu: bonus toplam puandaydı
 * ("Kendi boyuyor +4"), yük/zamanında teslim/mesafe ise ALT SKOR farkındaydı
 * ("Ağırlıklı yük +5", toplamdaki karşılığı ~1,4 puan). Rakamlar toplanmıyordu;
 * dahası ağırlık kümesi değişiminin payı hiç yazılmadığı için puanı ARTAN bir
 * adayın tek gerekçesi EKSİ görünebiliyordu.
 *
 * Kalem payı: bir alt skorun toplama katkısı `ağırlık × alt skor` olduğuna göre
 * kalemin payı `ağırlık × (gölge − canlı)`. Gölgenin ağırlık kümesi BİLİNİYOR
 * (`phase5Weights`: onTime sinyali açıkken PHASE5_WEIGHTS), canlınınki buraya
 * geçmiyor (v1/v2 profile bağlı). Bu yüzden ağırlık kümesi değişiminin payı
 * KALAN olarak yazılır: farkın açıklanmamış kısmı. Kalan aynı zamanda eşik altı
 * kalemleri ve yuvarlamayı taşır — döküm böylece HER ZAMAN tam toplanır.
 *
 * Sıra kasıtlı: önce UYGUNLUK (aday listeden düşüyorsa sebebi odur), sonra
 * ölçülemeyen kalem uyarısı, en sonda puan kalemleri.
 */
function deltaReasons(
  live: ComparableCandidate | undefined,
  shadow: ComparableCandidate | undefined,
  signals: Phase5SignalSet
): string[] {
  const reasons: string[] = [];
  if (!live || !shadow) return reasons;

  if (live.eligible && !shadow.eligible) {
    reasons.push(`Gölgede ELENİYOR: ${shadow.ineligibleReason ?? "gerekçe yok"}`);
  } else if (!live.eligible && shadow.eligible) {
    reasons.push(
      `Gölgede UYGUN hâle geliyor (canlıda: ${live.ineligibleReason ?? "gerekçe yok"})`
    );
  }

  const d = shadow.shadow;
  if (d && d.signals.includes("weightedLoad") && !d.loadUnitsMeasured) {
    // Sessiz kalmak, sinyali "denendi, fark etmedi" diye gösterirdi.
    reasons.push("Ağırlıklı yük ölçülemedi (kapasite verisi gelmedi)");
  }

  const deltaTenths = Math.round((shadow.totalScore - live.totalScore) * 10);
  // Bonusun ağırlığı YOK; doğrudan toplama ekleniyor, payı da kendisi kadar.
  const bonusTenths = Math.round(((d?.bonus ?? 0) - (live.shadow?.bonus ?? 0)) * 10);

  // Kalemin yanına yazılan açıklayıcı ek — İKİNCİ BİR RAKAM DEĞİL: yükün kaç
  // birim olduğu ölçünün kendisidir, güvenilirlik cezaları ise adıyla anılır.
  // Buraya "−12 alt puan" yazmak, kapatılan birim karışıklığını geri getirirdi.
  const suffixOf = (key: keyof ComparableScores): string => {
    if (key === "load") return d ? ` (${d.loadUnits} birim)` : "";
    if (key !== "reliability" || !d) return "";
    const causes = [
      d.qcPenalty > 0 ? "QC reddi" : null,
      d.strikePenalty > 0 ? "ceza puanı" : null,
    ].filter((c): c is string => c !== null);
    return causes.length > 0 ? ` (${causes.join(", ")})` : "";
  };

  // AĞIRLIK KÜMESİ AYNIYSA (onTime sinyali kapalı) kalem payları
  // ayrıştırılamaz: gölge, canlının ağırlıklarını kullanıyor ve o ağırlıklar
  // buraya geçmiyor. Uydurulmuş bir pay yazmaktansa pay hiç yazılmaz; kalemler
  // yalnız YÖNÜYLE sıralanır ve tek puan satırı toplamdır. Birim yine tektir.
  if (!signals.onTime) {
    if (bonusTenths !== 0) reasons.push("Kendi boyuyor");
    for (const [key, label] of COMPONENT_LABELS_TR) {
      const diff = shadow.scores[key] - live.scores[key];
      if (diff !== 0) {
        reasons.push(`${label} ${diff > 0 ? "yükseldi" : "düştü"}${suffixOf(key)}`);
      }
    }
    if (deltaTenths !== 0) {
      reasons.push(
        `Toplam ${pointsTr(deltaTenths)} (kalem payları ayrıştırılamıyor: ` +
          `gölge, canlının ağırlık kümesini kullanıyor)`
      );
    }
    return reasons;
  }

  const items: { label: string; suffix: string; tenths: number }[] = [];
  if (bonusTenths !== 0) {
    items.push({ label: "Kendi boyuyor", suffix: "", tenths: bonusTenths });
  }
  for (const [key, label] of COMPONENT_LABELS_TR) {
    const diff = shadow.scores[key] - live.scores[key];
    if (diff === 0) continue;
    items.push({
      label,
      suffix: suffixOf(key),
      tenths: Math.round(diff * PHASE5_WEIGHTS[key] * 10),
    });
  }

  let written = 0;
  for (const item of items) {
    if (Math.abs(item.tenths) < REASON_NOISE_TENTHS) continue;
    written += item.tenths;
    reasons.push(`${item.label} ${pointsTr(item.tenths)}${item.suffix}`);
  }
  // KALAN: ağırlık kümesi değişiminin payı (canlının ağırlıkları buraya
  // geçmediği için doğrudan hesaplanamaz) + eşik altı kalemler + yuvarlama.
  // Açıklanmamış kısmı yazmak, dökümün toplanmasını GARANTİ eder.
  const remainder = deltaTenths - written;
  if (remainder !== 0) {
    reasons.push(`Ağırlık kümesi ve yuvarlama ${pointsTr(remainder)}`);
  }
  return reasons;
}

/**
 * Canlı ve gölge sıralamayı yan yana koyar ve FARKIN SEBEBİNİ söyler.
 *
 * SAF: aynı girdi → aynı çıktı, IO yok. Hem gölge kaydı hem /admin/assignment
 * -sweep ekranı bunu çağırır; ikinci bir karşılaştırma yazılsaydı ekranda
 * gördüğünüz fark ile kayda düşen fark sessizce ayrışabilirdi.
 *
 * Kazanan = HER İKİ tarafın da kendi listesindeki ilk UYGUN aday. "Uygun
 * olmayanların en yükseği" kazanan sayılamaz: sıralama onu zaten veremez.
 */
export function explainShadowDivergence(
  live: readonly ComparableCandidate[],
  shadow: readonly ComparableCandidate[],
  signals: Phase5SignalSet
): ShadowComparison {
  const liveWinner = live.find((c) => c.eligible) ?? null;
  const shadowWinner = shadow.find((c) => c.eligible) ?? null;
  const liveById = new Map(live.map((c) => [c.manufacturerId, c]));
  const shadowById = new Map(shadow.map((c) => [c.manufacturerId, c]));

  const ids = new Set<string>([...liveById.keys(), ...shadowById.keys()]);
  const deltas: ShadowCandidateDelta[] = [...ids].map((id) => {
    const l = liveById.get(id);
    const s = shadowById.get(id);
    const liveScore = l?.totalScore ?? null;
    const shadowScore = s?.totalScore ?? null;
    return {
      manufacturerId: id,
      companyName: l?.companyName ?? s?.companyName ?? id.slice(0, 8),
      liveScore,
      shadowScore,
      delta:
        liveScore !== null && shadowScore !== null ? shadowScore - liveScore : null,
      liveEligible: l?.eligible ?? false,
      shadowEligible: s?.eligible ?? false,
      reasons: deltaReasons(l, s, signals),
    };
  });

  // En çok oynayan üstte: admin'in bakması gereken satır odur. Eşitlikte unvan
  // (Türkçe sıralama), sonra kimlik — SIRA VERİNİN GELİŞ SIRASINA BAĞLI OLAMAZ,
  // yoksa aynı karşılaştırma iki kez açıldığında farklı görünürdü.
  deltas.sort((a, b) => {
    const da = Math.abs(a.delta ?? 0);
    const db = Math.abs(b.delta ?? 0);
    if (db !== da) return db - da;
    const byName = a.companyName.localeCompare(b.companyName, "tr");
    if (byName !== 0) return byName;
    return a.manufacturerId.localeCompare(b.manufacturerId);
  });

  const differs =
    !!liveWinner &&
    !!shadowWinner &&
    liveWinner.manufacturerId !== shadowWinner.manufacturerId;

  return {
    liveWinnerId: liveWinner?.manufacturerId ?? null,
    liveWinnerName: liveWinner?.companyName ?? null,
    liveWinnerScore: liveWinner?.totalScore ?? null,
    shadowWinnerId: shadowWinner?.manufacturerId ?? null,
    shadowWinnerName: shadowWinner?.companyName ?? null,
    shadowWinnerScore: shadowWinner?.totalScore ?? null,
    differs,
    signals: activeSignals(signals),
    deltas,
    summaryTr: summarize(liveWinner, shadowWinner, differs, deltas),
  };
}

/**
 * Manşet cümlesi.
 *
 * Üç hâl AYRI tutulur, çünkü ikisini tek cümleye katlamak ekranda sessiz bir
 * yalan üretir: "aynı atölye" ile "gölgede hiç aday yok" aynı şey değildir ve
 * ikincisi bir arıza işaretidir.
 */
function summarize(
  liveWinner: ComparableCandidate | null,
  shadowWinner: ComparableCandidate | null,
  differs: boolean,
  deltas: readonly ShadowCandidateDelta[]
): string {
  if (!liveWinner && !shadowWinner) return "İki sıralamada da uygun aday yok.";
  if (!shadowWinner) {
    return `Gölgede hiç uygun aday kalmıyor (canlıda: ${liveWinner?.companyName}). Yeni sinyallerden biri aday havuzunu kapatıyor.`;
  }
  if (!liveWinner) {
    return `Canlıda uygun aday yok, gölgede ${shadowWinner.companyName} çıkıyor.`;
  }
  if (!differs) {
    return `Aynı atölye: ${liveWinner.companyName}. Yeni sinyaller kazananı değiştirmiyor.`;
  }
  const why =
    deltas.find((d) => d.manufacturerId === shadowWinner.manufacturerId)
      ?.reasons ?? [];
  const because = why.length > 0 ? ` — ${why.join(", ")}` : "";
  return `Kazanan DEĞİŞİYOR: canlı ${liveWinner.companyName} (${liveWinner.totalScore}) → gölge ${shadowWinner.companyName} (${shadowWinner.totalScore})${because}.`;
}
