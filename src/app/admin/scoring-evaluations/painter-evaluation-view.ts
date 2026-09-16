/**
 * `painter_assignment_evaluations` satırlarını ekranda gösterilebilir bir şekle
 * çeviren SAF modül (DB yok, `server-only` yok).
 *
 * Üretici ikizinden (evaluation-view.ts) NEDEN AYRI: iki karar aynı şey değil.
 * Üretici tarafında bir satır İKİ sıralamayı yan yana taşır (canlı + gölge) ve
 * ekranın asıl sorusu "gölgeyi canlıya alırsak iş el değiştirir mi"dir. Boyacı
 * tarafında gölge sıralama yoktur: tek bir sıralama karar verir, ama kararın
 * NEDEN o an alındığı değişir (QC onayı, ret sonrası, 24 saat cevapsızlık,
 * admin). Bu yüzden boyacı kaydının taşıdığı ayırt edici alan `trigger`dır.
 *
 * Aynı hoşgörü kuralı burada da geçerli: ekran, veri şekli değişikliğini
 * KIRILARAK değil, olsa olsa bir alan eksik kalarak karşılar. Eksik alan "—"
 * olur; uydurulmaz.
 *
 * Boyacı kimliği ekran tarafında YALNIZ admin panelinde ve işi devreden
 * üreticinin kendi siparişinde görünür (sözleşme v3.x): bu modülden çıkan
 * hiçbir şey müşteriye açık bir sayfaya konmaz.
 */

// TİP-ONLY import: çalışma zamanında SİLİNİR (bu dosyayı bir "use client"
// bileşeni import ediyor; yazıcı modül ise @/lib/db çeker). Tipi yine de
// oradan alıyoruz ki yeni bir tetikleyici eklendiğinde etiketi unutmak
// DERLEME hatası olsun — ekranda ham kod belirmesin.
import type { PainterAssignmentTrigger } from "@/lib/services/painter-evaluation";

/**
 * Skor bileşenleri — P4-C1 sıralayıcısının `PainterCandidate.parts` alanıyla
 * aynı sıra: rota (üretici ili→boyacı + boyacı→müşteri), yük, güvenilirlik,
 * QC kalitesi, zamanında teslim.
 */
export const PAINTER_SCORE_KEYS = [
  "route",
  "load",
  "reliability",
  "qcQuality",
  "onTime",
] as const;

export type PainterScoreKey = (typeof PAINTER_SCORE_KEYS)[number];

export const PAINTER_SCORE_LABELS_TR: Record<PainterScoreKey, string> = {
  route: "Rota",
  load: "Yük",
  reliability: "Güvenilirlik",
  qcQuality: "QC kalitesi",
  onTime: "Zamanında teslim",
};

/** Dar sütunlar / rozetler için kısa etiketler. */
export const PAINTER_SCORE_SHORT_LABELS_TR: Record<PainterScoreKey, string> = {
  route: "Rota",
  load: "Yük",
  reliability: "Güven",
  qcQuality: "QC",
  onTime: "Zamanında",
};

/**
 * TETİKLEYİCİLERİN TEK TÜRKÇE SÖZLÜĞÜ — ekran da, admin notu da buradan okur.
 *
 * Eskiden iki sözlük vardı (bu dosya + painter-evaluation.ts) ve ayrışmışlardı:
 * admin notu "Yönetici seçimi" derken karar listesi aynı kararı "Admin elle
 * atadı" diye gösteriyordu. Admin, notta okuduğu kararı listede arayamaz hâle
 * gelmişti. Sözlük BURADA durur, çünkü yazıcı (painter-evaluation.ts) `@/lib/db`
 * import eder ve bir istemci bileşeni onu asla import edemez; bu dosya ise SAF
 * olduğu için üretici panelinin boyacı seçicisi de aynı kelimeleri okuyabilir.
 * Yazıcı bu sözlüğü kendi adıyla yeniden dışa verir (tek nesne, tek ad seti).
 *
 * Kararın TETİKLEYİCİSİ — boyacı kaydının üretici kaydından ayrıldığı yer.
 *
 * Admin bu kelimeyi okuyarak "bu boyacıyı sistem mi seçti, ben mi seçtim ve
 * neden ikinci kez seçildi" sorusunu cevaplar. Ret sonrası yeniden atama ile
 * 24 saat cevapsızlık AYRI tutulur: ikisi de işi taşır ama yalnız biri bir
 * REDDETME beyanıdır; ikisini tek kelimede toplamak, cevap vermemiş bir
 * boyacıyı "reddetti" diye göstermek olurdu (sla-no-answer kararı: ceza yok).
 */
export const PAINTER_TRIGGER_LABELS_TR: Record<PainterAssignmentTrigger, string> = {
  qc_approve: "Üretici QC onayı",
  decline_retry: "Ret sonrası yeniden atama",
  sla_reassign: "24 saat cevapsız — yeniden atama",
  admin_manual: "Admin elle atadı",
  // İki İNSAN yolu (P4 · kayıtsız kalmışlardı). Ayrı etiketler, çünkü ekranda
  // "boş bir siparişe atama" ile "elindeki işin boyacısını değiştirme" aynı
  // cümleyle görünseydi, admin parçanın kimde olduğunu kayıttan okuyamazdı.
  admin_swap: "Admin boyacıyı değiştirdi",
  manufacturer_handoff: "Üretici kendi devretti",
};

/**
 * Tetikleyicinin ekran karşılığı.
 *
 * Bilinmeyen bir tetikleyici KIRMAZ: yazıcı yeni bir sebep eklediğinde ekran
 * ham değeri okunur hâlde gösterir. Damgasız (null) satırda ise "bilinmiyor"
 * denir — boş bir hücre "sebep yok" diye okunurdu.
 */
export function painterTriggerLabelTr(trigger: string | null): string {
  if (!trigger) return "bilinmiyor";
  // Sözlük tam sayımlıdır ama okunan damga HAM metindir (kolon `text`): eski ya
  // da tanınmayan bir damgada ekran kırılmaz, kodu okunur hâlde gösterir.
  return (
    (PAINTER_TRIGGER_LABELS_TR as Record<string, string>)[trigger] ??
    trigger.replace(/_/g, " ")
  );
}

export interface PainterEvaluationCandidate {
  painterId: string | null;
  companyName: string | null;
  /** 100 en iyi, 0 en kötü. Kayıtta yoksa null — sıfır DEĞİL. */
  totalScore: number | null;
  /**
   * Aday o an uygun muydu (kapasite, kabul durumu, ret listesi). Kayıt bunu
   * damgalamamışsa null kalır: "uygun değildi" ile "bilinmiyor" ayrı şeyler.
   */
  eligible: boolean | null;
  /** Uygun değilse sebebi (yazıcının Türkçe cümlesi). */
  ineligibleReason: string | null;
  /** Eksik bileşen olabilir: eski satırlar bugünkü beş skoru taşımayabilir. */
  scores: Partial<Record<PainterScoreKey, number>>;
}

/**
 * Tablodan okunan ham satır (`painter_assignment_evaluations`, P4-C3).
 *
 * Sütunlar jsonb damgasından ÖNCE gelir: sütun yazıcının kesin beyanıdır,
 * jsonb ise olsa olsa kopyası. jsonb yolu yine de okunur, çünkü bir gün
 * yazıcı yalnız zarfa damgalarsa ekran susmamalı.
 */
export interface PainterEvaluationRow {
  id: string;
  orderId: string;
  createdAt: Date;
  /** Sıralamayı üreten ağırlık sürümü; damgasız eski satırda null. */
  weightsVersion: string | null;
  /**
   * qc_approve | decline_retry | sla_reassign | admin_manual |
   * manufacturer_handoff | admin_swap (P4-C3) — ALTI damga. Son ikisi (admin'in
   * elle ataması ile birlikte ÜÇ insan yolu) sıralayıcıyı hiç çalıştırmaz:
   * sıralayıcı hiç çalışmaz, aday listesi bu yüzden boş gelir.
   */
  trigger: string | null;
  /** Sıralamanın seçtiği boyacı; uygun aday çıkmadıysa null. */
  winnerPainterId: string | null;
  /** İşi GERÇEKTEN alan boyacı; kimse yerleşmediyse null. */
  placedPainterId?: string | null;
  /** Bu denemede sıralamaya hiç sokulmayan boyacılar. */
  excludedPainterIds?: unknown;
  /** Kimse yerleşmediyse makine-okur sebep (ekran kendi etiketini basar). */
  outcomeReason?: string | null;
  /** Aday listesi + skor bileşenleri (jsonb). */
  candidates: unknown;
}

export interface PainterEvaluation {
  id: string;
  orderId: string;
  /** ISO damga (sunucu→istemci serileştirmesi için). */
  createdAt: string;
  weightsVersion: string | null;
  trigger: string | null;
  winnerPainterId: string | null;
  winnerName: string | null;
  /**
   * Kararın işi GERÇEKTEN verdiği boyacı (yazıcı damgalarsa).
   *
   * Sıralamanın birincisi olmayabilir: admin elle başka birini seçmiş ya da
   * birinci bu denemede dışlanmış olabilir. Damgasız satırda null kalır ve
   * ekran o zaman "kayıtlı değil" der — siparişin BUGÜNKÜ boyacısına düşmek,
   * karardan sonra yapılan bir değişikliği bu kararın sonucu gibi gösterirdi.
   */
  placedPainterId: string | null;
  placedPainterName: string | null;
  /** Bu denemede dışlanan boyacılar (reddedenler); damgasızda boş. */
  excludedPainterIds: string[];
  /**
   * Kimse yerleşmediyse SEBEBİ (makine kodu). Yerleşen varsa null.
   *
   * Ekran bu kodu kendi Türkçe cümlesine çevirir: kayıt boş kaldığında
   * "sıralama hiçbir şey yapmadı" ile "uygun boyacı yoktu, iş admin kuyruğuna
   * düştü" aynı şey değildir ve ikincisi admin'in DAVRANMASI gereken hâldir.
   */
  outcomeReason: string | null;
  candidates: PainterEvaluationCandidate[];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Kimlik listesini hoşgörülü okur: bozuk damga = boş liste ("bilinmiyor"). */
function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Skor bileşenleri.
 *
 * İki ad da kabul edilir: sıralayıcının kendi alanı `parts` (P4-C1), üretici
 * tarafındaki kardeş kayıtta ise aynı şey `scores` diye damgalanıyor. Okuyucu
 * bir isim tercihi yüzünden dökümü kaybederse, ekranda "skor kaydı yok" yazar —
 * yani olmamış bir şeyi iddia eder.
 */
function readScores(raw: unknown): Partial<Record<PainterScoreKey, number>> {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<PainterScoreKey, number>> = {};
  for (const key of PAINTER_SCORE_KEYS) {
    const n = asNumber(src[key]);
    if (n !== null) out[key] = n;
  }
  return out;
}

function readCandidate(raw: unknown): PainterEvaluationCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  return {
    painterId: asString(src.painterId),
    companyName: asString(src.companyName),
    // `score` sıralayıcının alanı (P4-C1), `totalScore` üretici kaydının adı.
    totalScore: asNumber(src.score) ?? asNumber(src.totalScore),
    eligible: asBoolean(src.eligible),
    ineligibleReason: asString(src.ineligibleReason),
    scores: readScores(src.parts ?? src.scores),
  };
}

/**
 * jsonb tarafını hoşgörülü okur: düz dizi de, zarf da kabul edilir.
 *
 * Zarf ({ weightsVersion, trigger, candidates, assignedPainterId }) yazıcının
 * ileride ekleyebileceği şekildir; bugün düz dizi yazılıyor olabilir. İki şekli
 * de okumak, ekranın veri şekli değiştiği gün boş liste göstermemesi içindir.
 */
export function parsePainterEvaluationCandidates(raw: unknown): {
  weightsVersion: string | null;
  trigger: string | null;
  placedPainterId: string | null;
  excludedPainterIds: string[];
  candidates: PainterEvaluationCandidate[];
} {
  if (Array.isArray(raw)) {
    return {
      weightsVersion: null,
      trigger: null,
      placedPainterId: null,
      excludedPainterIds: [],
      candidates: raw
        .map(readCandidate)
        .filter((c): c is PainterEvaluationCandidate => !!c),
    };
  }
  if (raw && typeof raw === "object") {
    const src = raw as Record<string, unknown>;
    const list = [src.candidates, src.entries, src.top].find((v) => Array.isArray(v));
    return {
      weightsVersion: asString(src.weightsVersion) ?? asString(src.version),
      trigger: asString(src.trigger) ?? asString(src.reason),
      placedPainterId:
        asString(src.assignedPainterId) ?? asString(src.placedPainterId),
      excludedPainterIds:
        readIdList(src.excludedPainterIds).length > 0
          ? readIdList(src.excludedPainterIds)
          : readIdList(src.declinedPainterIds),
      candidates: Array.isArray(list)
        ? list.map(readCandidate).filter((c): c is PainterEvaluationCandidate => !!c)
        : [],
    };
  }
  return {
    weightsVersion: null,
    trigger: null,
    placedPainterId: null,
    excludedPainterIds: [],
    candidates: [],
  };
}

/**
 * Kimliğin ekrana sığan hâli: ad çözülemediğinde admin kaydı yine de bu önekle
 * eşleştirebilir. "Adı yok" ile "hiçbir şey bilmiyoruz" arasındaki fark budur.
 */
export function shortPainterId(id: string): string {
  return id.slice(0, 8);
}

/** Kararın işi verdiği boyacının ekran karşılığı (üç hâl ayrı tutulur). */
export type PainterPlacementLabel =
  | { kind: "unrecorded" }
  | { kind: "unnamed"; painterId: string; shortId: string }
  | { kind: "named"; painterId: string; name: string };

export function painterPlacementLabel(input: {
  placedPainterId: string | null;
  placedPainterName: string | null;
}): PainterPlacementLabel {
  const { placedPainterId, placedPainterName } = input;
  if (!placedPainterId) return { kind: "unrecorded" };
  // Boş ad da çözülmemiş sayılır: ekranda boş bir <strong> kalması, adı
  // okunamayan atölyeyi "adsız boyacı" gibi gösterirdi.
  if (!placedPainterName) {
    return {
      kind: "unnamed",
      painterId: placedPainterId,
      shortId: shortPainterId(placedPainterId),
    };
  }
  return { kind: "named", painterId: placedPainterId, name: placedPainterName };
}

/**
 * Sıralamanın birincisi ile işi ALAN boyacı ayrıştığında sebebi, ancak kaydın
 * söyleyebileceği kadar söyler.
 *
 * İki gerçek sebep var ve ikisi de normaldir: birinci bu denemede dışlanmıştı
 * (daha önce reddetmiş / cevapsız kalmış) ya da admin elle başkasını seçti.
 * Damga varsa hangisi olduğu bilinir; yoksa ekran İKİSİNİ DE söyler — tek bir
 * sebebi ad koyarak yazmak, otomatik yapılan bir yerleştirmeyi insana yıkardı.
 */
export type PainterPlacementDivergence = {
  kind: "excluded" | "manual" | "unknown";
  winnerId: string;
  winnerName: string | null;
};

export function painterPlacementDivergence(input: {
  placedPainterId: string | null;
  winnerPainterId: string | null;
  winnerName: string | null;
  excludedPainterIds: string[];
  trigger: string | null;
}): PainterPlacementDivergence | null {
  const { placedPainterId, winnerPainterId, winnerName } = input;
  if (!placedPainterId || !winnerPainterId) return null;
  if (placedPainterId === winnerPainterId) return null;
  return {
    kind: input.excludedPainterIds.includes(winnerPainterId)
      ? "excluded"
      : input.trigger === "admin_manual"
        ? "manual"
        : "unknown",
    winnerId: winnerPainterId,
    winnerName,
  };
}

/**
 * "Kimse yerleşmedi" SEBEPLERİNİN Türkçe karşılığı.
 *
 * Kodlar yazıcıdan gelir (P4-C2'nin `skipped` değerleri + sıralayıcının boş
 * dönmesi). Sözlükte olmayan bir kod KIRMAZ: ekran ham kodu okunur hâlde
 * gösterir, çünkü yeni bir sebebin eklendiği gün kartın susması, sebebi hiç
 * yazmamaktan daha kötüdür.
 */
export const PAINTER_OUTCOME_REASON_LABELS_TR: Record<string, string> = {
  // Yerleştiriciden (painter-auto-assign) gelen gerçek kodlar.
  no_eligible_painter:
    "Uygun boyacı kalmadı (kapasite, kabul durumu ya da önceki retler) — iş admin kuyruğuna düştü",
  // Sıralama ile yazma ARASINDA kaybedilen yarış: boyacı o saniyede doldu ya da
  // işi başkası aldı. Ceza değildir, kimsenin kusuru yoktur.
  winner_unavailable_at_write:
    "Sıralamanın birincisi yazma anında müsait değildi (araya başka bir işlem girdi) — yerleştirme yapılmadı",
  refunded: "Sipariş iade edilmiş; boyacı atanmadı",
  unexpected_error:
    "Beklenmeyen bir hata nedeniyle yerleştirme yapılamadı — iş admin kuyruğunda",
  // P4-C2'nin atlama sözlüğü: aynı kelimeler kayda da düşebilir.
  no_candidate: "Uygun boyacı bulunamadı — iş admin kuyruğuna düştü",
  paints_in_house: "Üretici kendi boyuyor; boyacı ataması gerekmedi",
  not_needed: "Siparişte boyama yok; boyacı ataması gerekmedi",
  already_assigned: "Siparişte zaten bir boyacı vardı",
  flag_off: "Otomatik boyacı ataması kapalı",
  decline_cap_reached: "Ret hakkı doldu — iş admin kuyruğuna düştü",
};

export function painterOutcomeReasonLabelTr(reason: string | null): string | null {
  if (!reason) return null;
  return PAINTER_OUTCOME_REASON_LABELS_TR[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Satırı ekran nesnesine çevirir.
 *
 * `nameOf` boyacı adlarını çözer; ad bulunamazsa null kalır ve ekran "adı
 * çözülemedi" der — uydurma bir ad göstermez. Sütun damgası (satırın kendi
 * `weightsVersion`/`trigger` alanları) jsonb damgasından ÖNCE gelir: sütun
 * yazıcının kesin beyanıdır, jsonb ise kopyası.
 */
export function buildPainterEvaluation(
  row: PainterEvaluationRow,
  nameOf: (painterId: string) => string | null
): PainterEvaluation {
  const parsed = parsePainterEvaluationCandidates(row.candidates);
  const winnerId = row.winnerPainterId;
  const nameFromSummary = (id: string) =>
    parsed.candidates.find((c) => c.painterId === id)?.companyName ?? null;
  /**
   * YERLEŞEN, KAZANANA DÜŞMEZ.
   *
   * Kazananı yerleşen saymak, hiç kimsenin yerleşmediği bir kararda (uygun
   * aday yok → admin kuyruğu) ekranda "iş şu boyacıya verildi" cümlesi
   * üretirdi; o boyacı işi hiç görmemişken. Kayıt yerleştirmeyi yazmamışsa
   * ekran da yazmaz.
   */
  const placedPainterId = row.placedPainterId ?? parsed.placedPainterId ?? null;
  const excludedFromColumn = readIdList(row.excludedPainterIds);
  return {
    id: row.id,
    orderId: row.orderId,
    createdAt: row.createdAt.toISOString(),
    weightsVersion: row.weightsVersion ?? parsed.weightsVersion,
    trigger: row.trigger ?? parsed.trigger,
    winnerPainterId: winnerId,
    winnerName: winnerId ? nameOf(winnerId) ?? nameFromSummary(winnerId) : null,
    placedPainterId,
    placedPainterName: placedPainterId
      ? nameOf(placedPainterId) ?? nameFromSummary(placedPainterId)
      : null,
    excludedPainterIds:
      excludedFromColumn.length > 0 ? excludedFromColumn : parsed.excludedPainterIds,
    outcomeReason: row.outcomeReason ?? null,
    candidates: parsed.candidates,
  };
}
