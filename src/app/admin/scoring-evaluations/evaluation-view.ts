/**
 * `manufacturer_assignment_evaluations` satırlarını ekranda gösterilebilir bir
 * şekle çeviren SAF modül. DB'ye de React'e de dokunmaz; hem sipariş detay
 * sayfası (sunucu) hem bu klasördeki liste sayfası hem de sipariş detayının
 * client bileşeni aynı çeviriyi kullansın diye burada duruyor — iki yerde iki
 * ayrı okuyucu olsaydı, "canlı" ve "gölge" kavramları sessizce ayrışırdı.
 *
 * Satırın şekli: bir sipariş için TEK satır, içinde iki sıralama sonucu yan
 * yana (v1_winner_id / v2_winner_id sütunları) ve hangisinin karar verdiğini
 * söyleyen `authoritative`. Yani "gölge satır" ayrı bir kayıt değil, aynı
 * satırın öbür yarısıdır.
 *
 * ÖNEMLİ: taraflar ROL ile adlandırılır (canlı / gölge), sütun adıyla değil.
 * Gölge profil değişebilir (Phase 1'de sürekli mesafeli v3 devreye giriyor ve
 * tablo yeni sütun almıyor), bu yüzden "v2 kazananı" yazan bir başlık ilk
 * profil değişiminde yalan söylemeye başlardı. Teknik kimlik, tarafın kendi
 * damgaladığı ağırlık sürümüdür; o yoksa sütunun profili yedek olarak gösterilir.
 */

import type { AutoAssignOrderKind } from "@/lib/config/flags";

/** Skor bileşenleri — sıralayıcının `CandidateScore.scores` alanıyla aynı sıra. */
export const SCORE_KEYS = [
  "distance",
  "load",
  "reliability",
  "onTimeDelivery",
  "compliance",
  "batchAffinity",
] as const;

export type ScoreKey = (typeof SCORE_KEYS)[number];

export const SCORE_LABELS_TR: Record<ScoreKey, string> = {
  distance: "Mesafe",
  load: "Yük",
  reliability: "Güvenilirlik",
  onTimeDelivery: "Zamanında teslim",
  compliance: "Uygunluk",
  batchAffinity: "Parti uyumu",
};

/** Dar sütunlar için kısa etiketler; uzun olanlar kartı taşırıyor. */
export const SCORE_SHORT_LABELS_TR: Record<ScoreKey, string> = {
  distance: "Mesafe",
  load: "Yük",
  reliability: "Güven",
  onTimeDelivery: "Zamanında",
  compliance: "Uygun",
  batchAffinity: "Parti",
};

/** Mesafe alt-skorunun nasıl hesaplandığı (gölge kayıt damgalarsa gösterilir). */
export const DISTANCE_MODEL_LABELS_TR: Record<string, string> = {
  tiered: "kademeli mesafe",
  continuous: "sürekli mesafe",
};

export interface EvaluationCandidate {
  manufacturerId: string | null;
  companyName: string | null;
  totalScore: number | null;
  /** Eksik bileşen olabilir: eski satırlar bugünkü altı skoru taşımıyor. */
  scores: Partial<Record<ScoreKey, number>>;
}

export interface EvaluationSide {
  /** Rol: kararı veren taraf mı, yoksa yalnızca kaydedilen taraf mı. */
  role: "live" | "shadow";
  /** Bu tarafın okunduğu sütun çifti: "v1" | "v2". Yalnızca yedek etikettir. */
  column: "v1" | "v2";
  /**
   * Bu tarafı üreten ağırlık sürümü. Satırın `weights_version` sütunu TEK bir
   * metin olduğu için taraf bazlı sürüm ancak jsonb'nin içinde taşınabilir;
   * yoksa null döner ve ekran sütun adına düşer.
   */
  weightsVersion: string | null;
  /** "tiered" | "continuous" — jsonb damgalarsa. */
  distanceModel: string | null;
  /**
   * Bu kararın İŞİ GERÇEKTEN VERDİĞİ atölye (yazıcı damgalar).
   *
   * Sıralamanın kazananı DEĞİLDİR ve siparişin bugünkü üreticisi de değildir:
   * elle atanan bir iş kazananla, sonradan devredilen bir iş de bugünkü
   * üreticiyle ayrışır. Damgasız (eski) satırlarda null kalır ve ekran o zaman
   * eskisi gibi siparişin bugünkü üreticisine bakar.
   */
  placedManufacturerId: string | null;
  /**
   * Bu YERLEŞTİRME KARARININ kimliği (yazıcı damgalar, D-C1 sözleşmesi).
   *
   * Neden gerekti: bir karar tabloya birden çok satır yazıyor ve İKİ AYRI karar
   * birbirine saniyeler kadar yaklaşabiliyor (arka arkaya iki geri alma,
   * otomatik atamanın hemen ardından tarama uygulaması). Satırları yalnız
   * zamana bakarak gruplamak o iki kararı tek karara katlıyor, önceki
   * yerleştirmenin kazananını da işi alan atölyesini de her iki ekrandan
   * siliyordu. Damga varsa gruplama zamanı HİÇ sormaz.
   *
   * Damgasız (damga öncesi yazılmış) satırlarda null kalır; okuyucu o zaman
   * eski zaman penceresine düşer.
   */
  decisionId: string | null;
  /**
   * Bu YERLEŞTİRME DENEMESİNE özgü dışlanan atölyeler (yazıcı damgalarsa).
   *
   * Siparişin kalıcı "reddedenler" listesinden ayrıdır: geri alma "kara listeye
   * ekle" işaretlenmeden yapıldığında bile sipariş az önce koparıldığı atölyeye
   * geri verilmez (order-confirm.ts `excludeManufacturerIds`). O dışlama
   * sıralamadan SONRA uygulandığı için sıralamanın birincisi kayıtta kazanan
   * kalır, iş ise ikinciye gider — ekran sebebi ancak bu damgayla bilebilir.
   * Damgasız satırlarda boş kalır ve ekran sebebi İDDİA ETMEZ.
   */
  excludedManufacturerIds: string[];
  winnerId: string | null;
  winnerName: string | null;
  candidates: EvaluationCandidate[];
}

export interface OrderEvaluation {
  id: string;
  orderId: string;
  createdAt: string;
  /** Satırın ağırlık sürümü (tabloda saklanan tekil damga). */
  weightsVersion: string;
  /** Kararı veren taraf. */
  live: EvaluationSide;
  /** Aynı anda çalışan, karara etki etmeyen taraf. */
  shadow: EvaluationSide;
  /** Satırın ait olduğu karar kimliği; damgasız eski satırlarda null. */
  decisionId: string | null;
  /** Kararın yerleştirdiği atölye; damgasız eski satırlarda null. */
  placedManufacturerId: string | null;
  /** Yerleşen atölyenin adı (çözülebildiyse). */
  placedManufacturerName: string | null;
  /** Bu denemede dışlanan atölyeler (iki taraftan birleşik); damgasızda boş. */
  excludedManufacturerIds: string[];
  /** İki taraf da bir atölye seçti ve bunlar FARKLI. */
  differs: boolean;
  /** İki taraf da bir atölye seçti ve AYNI. */
  agrees: boolean;
}

/** Tarafın teknik kimliği: damgalanmış sürüm, yoksa sütun adı. */
export function sideVersionLabel(side: EvaluationSide): string {
  return side.weightsVersion ?? side.column;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Kimlik listesini hoşgörülü okur.
 *
 * Damga henüz yazılmıyor olabilir ya da başka bir şekilde yazılabilir; ekran
 * bunu kırılarak değil, listeyi boş bırakarak karşılamalı (boş liste = "sebep
 * bilinmiyor", yanlış sebep değil).
 */
function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function readScores(raw: unknown): Partial<Record<ScoreKey, number>> {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<Record<ScoreKey, number>> = {};
  for (const key of SCORE_KEYS) {
    const n = asNumber(src[key]);
    if (n !== null) out[key] = n;
  }
  return out;
}

function readCandidate(raw: unknown): EvaluationCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  return {
    manufacturerId: asString(src.manufacturerId),
    companyName: asString(src.companyName),
    totalScore: asNumber(src.totalScore),
    scores: readScores(src.scores),
  };
}

/**
 * jsonb tarafını hoşgörülü okur.
 *
 * Bugün yazılan şekil düz bir dizidir (ilk üç aday). Sıralayıcı sahibi, hangi
 * ağırlık sürümünün o tarafı ürettiğini kaydetmek için diziyi bir zarfa alırsa
 * ({ weightsVersion, candidates }), ekranın o gün boş liste göstermemesi için
 * her iki şekil de kabul ediliyor: gösterim, veri şekli değişikliğini kırılarak
 * değil, olsa olsa bir alan eksik kalarak karşılamalı.
 */
export function parseEvaluationSide(raw: unknown): {
  weightsVersion: string | null;
  distanceModel: string | null;
  decisionId: string | null;
  placedManufacturerId: string | null;
  excludedManufacturerIds: string[];
  candidates: EvaluationCandidate[];
} {
  if (Array.isArray(raw)) {
    return {
      weightsVersion: null,
      distanceModel: null,
      decisionId: null,
      placedManufacturerId: null,
      excludedManufacturerIds: [],
      candidates: raw.map(readCandidate).filter((c): c is EvaluationCandidate => !!c),
    };
  }
  if (raw && typeof raw === "object") {
    const src = raw as Record<string, unknown>;
    const list = [src.candidates, src.entries, src.top].find((v) => Array.isArray(v));
    return {
      weightsVersion: asString(src.weightsVersion) ?? asString(src.version),
      distanceModel: asString(src.distanceModel),
      decisionId: asString(src.decisionId),
      placedManufacturerId: asString(src.assignedManufacturerId),
      // İki ad da kabul edilir: alan adı yazıcı tarafında `excludeManufacturerIds`
      // (autoAssignIfEligible seçeneğinin adı) ya da onun çoğul-geçmiş hâli
      // olarak damgalanabilir. Okuyucunun bir isim tercihi yüzünden sebebi
      // kaybetmesi, ekranda yanlış suçlamaya dönüşürdü.
      excludedManufacturerIds:
        readIdList(src.excludedManufacturerIds).length > 0
          ? readIdList(src.excludedManufacturerIds)
          : readIdList(src.excludeManufacturerIds),
      candidates: Array.isArray(list)
        ? list.map(readCandidate).filter((c): c is EvaluationCandidate => !!c)
        : [],
    };
  }
  return {
    weightsVersion: null,
    distanceModel: null,
    decisionId: null,
    placedManufacturerId: null,
    excludedManufacturerIds: [],
    candidates: [],
  };
}

export interface EvaluationRow {
  id: string;
  orderId: string;
  createdAt: Date;
  weightsVersion: string;
  authoritative: string;
  v1WinnerId: string | null;
  v2WinnerId: string | null;
  v1Scores: unknown;
  v2Scores: unknown;
}

export interface BuildEvaluationOptions {
  /**
   * Mesafe gölgesi satırlarının ağırlık damgası — sunucu tarafı çağıran
   * `weightsVersion("v3")` ile verir.
   *
   * Neden parametre: bu modülü sipariş sayfasının CLIENT bileşeni de okuyor
   * (etiketler + tipler), ağırlık modülü ise `node:crypto` çekiyor. Import
   * etseydik tarayıcı paketine sunucu bağımlılığı sızardı.
   */
  distanceShadowVersion?: string | null;
}

/**
 * Satırı canlı/gölge ikilisine çevirir.
 *
 * SÜTUNLARIN ANLAMI SATIRA GÖRE DEĞİŞİR, bu yüzden `weights_version` okunmadan
 * satır yorumlanamaz:
 *  - ağırlık karşılaştırması satırı (v2.2): sütun = profilin kendisi, kararı
 *    veren tarafı `authoritative` söyler.
 *  - mesafe gölgesi satırı (v3.0): v1 sütunu HER ZAMAN canlı seçimdir (kanarya
 *    açıkken bile), v2 sütunu sürekli mesafeli meydan okuyandır.
 *
 * `authoritative`'a bakarak ikinciyi çözmeye çalışmak, kanarya açıldığı gün
 * canlı ile gölgeyi sessizce yer değiştirirdi — yani ekran, işi kimin kazandığı
 * konusunda tam tersini söylerdi.
 *
 * `nameOf` üretici adlarını çözer (kazanan, jsonb özetinde yoksa). Ad
 * bulunamazsa null kalır; ekran o zaman "—" gösterir, uydurma bir ad göstermez.
 */
export function buildOrderEvaluation(
  row: EvaluationRow,
  nameOf: (manufacturerId: string) => string | null,
  opts?: BuildEvaluationOptions
): OrderEvaluation {
  const isDistanceRow =
    !!opts?.distanceShadowVersion &&
    row.weightsVersion === opts.distanceShadowVersion;

  const liveColumn: "v1" | "v2" = isDistanceRow
    ? "v1"
    : row.authoritative === "v2"
      ? "v2"
      : "v1";
  const shadowColumn: "v1" | "v2" = liveColumn === "v2" ? "v1" : "v2";

  const sideOf = (column: "v1" | "v2", role: "live" | "shadow"): EvaluationSide => {
    const isV1 = column === "v1";
    const winnerId = isV1 ? row.v1WinnerId : row.v2WinnerId;
    const parsed = parseEvaluationSide(isV1 ? row.v1Scores : row.v2Scores);
    const fromSummary = winnerId
      ? parsed.candidates.find((c) => c.manufacturerId === winnerId)?.companyName ?? null
      : null;
    // Mesafe satırında sütun adı profil DEĞİLDİR: "v2" yazmak yanlış olurdu.
    // Canlı taraf kararı veren profildir, meydan okuyan tarafın kimliği de
    // satırın damgasıdır (v3.0).
    const fallbackVersion = isDistanceRow
      ? role === "live"
        ? row.authoritative
        : row.weightsVersion
      : null;
    return {
      role,
      column,
      weightsVersion: parsed.weightsVersion ?? fallbackVersion,
      // Damga varsa o kullanılır. Yoksa yalnız mesafe satırının meydan okuyan
      // tarafı için çıkarım yapılır: o satırın VARLIK sebebi sürekli mesafedir.
      distanceModel:
        parsed.distanceModel ??
        (isDistanceRow && role === "shadow" ? "continuous" : null),
      decisionId: parsed.decisionId,
      placedManufacturerId: parsed.placedManufacturerId,
      excludedManufacturerIds: parsed.excludedManufacturerIds,
      winnerId,
      winnerName: winnerId ? nameOf(winnerId) ?? fromSummary : null,
      candidates: parsed.candidates,
    };
  };

  const live = sideOf(liveColumn, "live");
  const shadow = sideOf(shadowColumn, "shadow");
  const bothPicked = !!live.winnerId && !!shadow.winnerId;
  // Damga iki tarafa da aynı yazılır; hangisi varsa o okunur (bir taraf eksik
  // ya da eski şekilde yazılmış olabilir).
  const decisionId = live.decisionId ?? shadow.decisionId;
  // İki taraf da aynı yerleştirmeyi damgalar; hangisi varsa o okunur.
  const placedManufacturerId =
    live.placedManufacturerId ?? shadow.placedManufacturerId;
  // Dışlama denemeye aittir, tarafa değil: hangi taraf damgaladıysa oradan
  // okunur, ikisi de damgaladıysa birleştirilir.
  const excludedManufacturerIds = Array.from(
    new Set([...live.excludedManufacturerIds, ...shadow.excludedManufacturerIds])
  );

  return {
    id: row.id,
    orderId: row.orderId,
    createdAt: row.createdAt.toISOString(),
    weightsVersion: row.weightsVersion,
    live,
    shadow,
    decisionId,
    placedManufacturerId,
    placedManufacturerName: placedManufacturerId
      ? nameOf(placedManufacturerId)
      : null,
    excludedManufacturerIds,
    differs: bothPicked && live.winnerId !== shadow.winnerId,
    agrees: bothPicked && live.winnerId === shadow.winnerId,
  };
}

/**
 * Sipariş türü etiketleri.
 *
 * Anahtar kümesi otomatik atama bayraklarınınkiyle (config/flags.ts)
 * BİREBİR aynıdır ve sınıflandırmayı da o modül yapar: değerlendirme
 * ekranındaki "tür" ile "bu türde otomatik atama açık mı" sorusunun aynı
 * kelimeleri kullanması gerekir, yoksa admin iki ekranda iki ayrı tür sözlüğü
 * öğrenmek zorunda kalır. Buradaki metinler yalnızca KISA gösterim içindir
 * (bayrak ekranındaki etiketler "Otomatik atama — ..." diye başlar).
 */
export const AUTO_ASSIGN_KIND_LABELS_TR: Record<AutoAssignOrderKind, string> = {
  custom: "Fotoğraftan figür",
  upload: "Müşteri modeli",
  whatsapp_ai: "WhatsApp",
  manual: "Elle yazılan",
  cart_platform: "Platform / sepet",
  workshop: "Atölye seansı",
};

export function autoAssignKindLabelTr(kind: AutoAssignOrderKind | null): string {
  return kind ? AUTO_ASSIGN_KIND_LABELS_TR[kind] : "—";
}

/* ─── Karar = satır değil, satır KÜMESİ ──────────────────────────────────── */

/**
 * Tek bir ATAMA KARARININ tüm satırları.
 *
 * Tablo bir satırda yalnız İKİ kazanan taşıyabiliyor (v1_winner / v2_winner),
 * bu yüzden bir karar birden çok satır yazar: ağırlık karşılaştırması bir
 * satır, sürekli mesafe gölgesi başka bir satır (manufacturer-assignment-shadow
 * içindeki iki `logEvaluation` çağrısı). Ekranlar bunları tek karar gibi
 * göstermezse iki gerçek sonuç çıkar: sayaçlar aynı kararı iki kez sayar ve
 * kardeş satır sipariş sayfasında "önceki değerlendirme" diye görünür — oysa
 * öncesi değil, aynı anın öbür yarısıdır.
 */
export interface EvaluationDecision {
  /** React anahtarı ve süzgeç kimliği; gruptaki en yeni satırdan türetilir. */
  key: string;
  orderId: string;
  /**
   * Kararın kimliği (yazıcı damgası).
   *
   * null = damgadan önce yazılmış eski satırlar; grup o zaman zaman penceresine
   * göre kurulmuştur, yani 5 saniyeden yakın İKİ gerçek yerleştirme tek karar
   * görünmüş olabilir. Ekran, bu ayrımı söylemek istediğinde buna bakar.
   */
  decisionId: string | null;
  /** Kararın zamanı: gruptaki en yeni satırın damgası (ISO). */
  createdAt: string;
  /** Kararı veren sıralama — kararda TEK kez gösterilir. */
  live: EvaluationSide;
  /**
   * Gruptaki satırlar canlı kazanan konusunda hemfikir mi? Aynı karardan
   * doğdukları için normalde hep hemfikirdirler; ayrışma varsa ekran bunu
   * söylemeli, iki cevaptan birini sessizce seçmemeli.
   */
  liveConsistent: boolean;
  /** Karşılaştırmalar, ağırlık sürümüne göre sabit sırada (ör. v2.2 → v3.0). */
  comparisons: OrderEvaluation[];
  /**
   * Bu kararın işi verdiği atölye. Siparişin BUGÜNKÜ üreticisiyle karıştırılmaz:
   * ikisi ayrıştığında iş karardan sonra devredilmiş demektir ve ekran bunu
   * "sıralama yanlış seçti" diye göstermemelidir.
   */
  placedManufacturerId: string | null;
  placedManufacturerName: string | null;
  /**
   * Bu yerleştirmede dışlanan atölyeler (damgasız kararlarda boş).
   *
   * Kararın birincisi ile işi alan atölye ayrıştığında sebebi SÖYLEYEBİLEN tek
   * alan budur; boşsa ekran sebebi iddia etmez.
   */
  excludedManufacturerIds: string[];
  /**
   * Aynı karşılaştırmanın bu kararda birden fazla kez yazılıp geçersiz kılınan
   * (daha eski) satır sayısı. Normalde 0'dır; 0'dan büyükse aynı karar iki kez
   * kaydedilmiş demektir (atama anındaki yazım + gecikmeli mutabakat).
   */
  supersededRowCount: number;
}

/**
 * Aynı kararın satırları arasındaki azami zaman farkı — YALNIZ DAMGASIZ
 * SATIRLAR İÇİN YEDEK KURAL.
 *
 * Satırlar paralel yazılıyor: ölçülen fark mikrosaniyeler, ağır yükte olsa olsa
 * milisaniyelerdir. Ayrı kararlar genelde saniyelerce ayrıdır, 5 saniye de bu
 * iki ölçeğin arasında durur — ama GENELDE yetmiyor: arka arkaya iki geri alma
 * (ölçülen: 0,39 sn arayla iki gerçek yerleştirme) bu pencerenin içine
 * sığıyordu ve ikisi tek karara katlanıyordu; önceki kararın kazananı da işi
 * alan atölyesi de her iki ekrandan siliniyordu.
 *
 * Bu yüzden pencere artık yalnızca damga (`decisionId`) TAŞIMAYAN satırlar için
 * kullanılıyor; damgalı satırlar zamanı hiç sormadan kimliğe göre gruplanıyor.
 */
export const DECISION_WINDOW_MS = 5000;

/**
 * Değerlendirme satırlarını KARARLARA böler (en yeni karar başta).
 *
 * Satırlar artık ÜST ÜSTE YAZILMIYOR, BİRİKİYOR: bir sipariş ikinci kez
 * yerleştirildiğinde (ret sonrası yeniden sıralama, geri al + otomatik
 * yerleştirme) ilk kararın satırları yerinde kalır. Yani gruplama, "önceki
 * kararlar" listesinin gerçekten dolduğu tek yerdir.
 *
 * KİMLİK ÖNCE, ZAMAN SONRA:
 *  - Damgalı satır (`decisionId`): aynı damga = aynı karar, farklı damga =
 *    farklı karar. Zaman hiç sorulmaz. Zamana bakan eski kural, 5 saniyeden
 *    yakın İKİ gerçek yerleştirmeyi tek karara katlıyordu (ölçüldü: 0,39 sn
 *    arayla iki geri alma) — önceki kararın kazananı ve işi alan atölyesi her
 *    iki ekrandan da siliniyordu.
 *  - Damgasız satır (damga yazılmadan önceki kayıtlar): tek ipucu zamandır,
 *    `windowMs` penceresi orada YEDEK olarak sürüyor. Damgalı ve damgasız
 *    satırlar asla aynı gruba düşmez: biri kimliğini biliyor, öbürü bilmiyor.
 *
 * Aynı sürüm grup içinde ikinci kez: yeni bir karar değildir — aynı karar iki
 * kez yazılmıştır. Sürümün EN YENİ satırı karşılaştırma olarak alınır, daha
 * eskisi "geçersiz kılınmış" sayılır (`supersededRowCount`, ekranda gösterilir)
 * ama tutarlılık denetiminde okunmaya devam eder: iki yazım farklı kazanan
 * söylüyorsa ekran bunu söylemeli, birini sessizce seçmemeli.
 */
export function groupEvaluationDecisions(
  rows: OrderEvaluation[],
  opts?: { windowMs?: number }
): EvaluationDecision[] {
  const windowMs = opts?.windowMs ?? DECISION_WINDOW_MS;
  // Çağıranın sırasına güvenme: gruplama "en yeni önce" varsayımına dayanıyor.
  const sorted = [...rows].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  interface Group {
    orderId: string;
    decisionId: string | null;
    /** Karşılaştırma başına EN YENİ satır — ekranda gösterilen. */
    rows: OrderEvaluation[];
    /** Aynı karşılaştırmanın daha eski yazımları; gösterilmez, okunur. */
    superseded: OrderEvaluation[];
    newestMs: number;
    versions: Set<string>;
  }

  const groups: Group[] = [];
  /** Damgalı satırlar: sipariş + karar kimliği. Zaman hiç sorulmaz. */
  const byDecisionId = new Map<string, Group>();
  /** Damgasız satırlar: sipariş başına AÇIK pencere (yedek kural). */
  const openLegacy = new Map<string, Group>();

  // Satırlar en yeniden eskiye geldiği için sürümün ilk görülen satırı en
  // yenisidir; aynı sürümün sonrakileri o kararın eski yazımlarıdır.
  const absorb = (group: Group, row: OrderEvaluation) => {
    if (group.versions.has(row.weightsVersion)) {
      group.superseded.push(row);
    } else {
      group.rows.push(row);
      group.versions.add(row.weightsVersion);
    }
  };

  const startGroup = (row: OrderEvaluation, ms: number): Group => {
    const group: Group = {
      orderId: row.orderId,
      decisionId: row.decisionId,
      rows: [row],
      superseded: [],
      newestMs: Number.isFinite(ms) ? ms : 0,
      versions: new Set([row.weightsVersion]),
    };
    groups.push(group);
    return group;
  };

  for (const row of sorted) {
    const ms = Date.parse(row.createdAt);
    if (row.decisionId) {
      // Kimlik kesin: aynı damga saatler sonra yazılmış olsa bile aynı karardır,
      // farklı damga mikrosaniye arayla yazılmış olsa bile ayrı karardır.
      // Anahtar sipariş kimliğini de taşır: damga üreticisi bozulsa bile iki
      // siparişin satırları birbirine karışmasın.
      const key = `${row.orderId}::${row.decisionId}`;
      const existing = byDecisionId.get(key);
      if (existing) {
        absorb(existing, row);
        continue;
      }
      byDecisionId.set(key, startGroup(row, ms));
      continue;
    }
    // Damgasız: yalnız zamana bakılabilir. Damgalı bir grubun içine DÜŞMEZ —
    // `openLegacy` yalnızca damgasız gruplar tutar.
    const current = openLegacy.get(row.orderId);
    const inWindow =
      !!current && Number.isFinite(ms) && current.newestMs - ms <= windowMs;
    if (inWindow && current) {
      absorb(current, row);
      continue;
    }
    openLegacy.set(row.orderId, startGroup(row, ms));
  }

  return groups.map((g) => {
    // Sütun sırası veriye göre oynamamalı: admin iki kararı yan yana
    // karşılaştırırken aynı karşılaştırma hep aynı yerde dursun.
    const comparisons = [...g.rows].sort((a, b) =>
      a.weightsVersion.localeCompare(b.weightsVersion)
    );
    const newest = g.rows[0];
    // Tutarlılık ve damgalar, geçersiz kılınan yazımlar DAHİL bütün satırlardan
    // okunur: eski yazımı yok saymak, iki yazımın ayrıştığı durumu gizlerdi.
    const allRows = [...g.rows, ...g.superseded];
    const liveWinners = Array.from(
      new Set(
        allRows.map((c) => c.live.winnerId).filter((id): id is string => !!id)
      )
    );
    const live =
      comparisons.find((c) => c.live.winnerId)?.live ?? comparisons[0].live;
    // `g.rows` en yeniden eskiye sıralı; damgayı taşıyan EN YENİ satır kazanır.
    const placed = allRows.find((c) => c.placedManufacturerId);
    const excludedManufacturerIds = Array.from(
      new Set(allRows.flatMap((c) => c.excludedManufacturerIds))
    );
    return {
      key: `${g.orderId}:${newest.id}`,
      orderId: g.orderId,
      decisionId: g.decisionId,
      createdAt: newest.createdAt,
      live,
      liveConsistent: liveWinners.length <= 1,
      comparisons,
      placedManufacturerId: placed?.placedManufacturerId ?? null,
      placedManufacturerName: placed?.placedManufacturerName ?? null,
      excludedManufacturerIds,
      supersededRowCount: g.superseded.length,
    };
  });
}

/* ─── "Neden sıralamanın birincisi almadı?" ───────────────────────────────── */

/**
 * Kararın birincisi ile işi GERÇEKTEN alan atölye ayrıştığında, sebebi ancak
 * kaydın söyleyebileceği kadar söyler.
 *
 * İki gerçek sebep var ve ikisi de normaldir:
 *  - Dışlama: iş az önce o atölyeden geri alındığı için bu denemede hariç
 *    tutulmuştu (order-confirm `excludeManufacturerIds`). Dışlama sıralamadan
 *    SONRA uygulanır, bu yüzden kayıtta birinci hâlâ o atölyedir.
 *  - Elle atama: admin sıralamayı dinlemeyip başka bir atölye seçmiştir.
 *
 * Damga varsa hangisi olduğu bilinir; yoksa ekran İKİSİNİ DE söylemeli. Tek bir
 * sebebi (özellikle "elle atanmış") ad koyarak yazmak, otomatik yapılan bir
 * yerleştirmeyi insana yıkıyordu.
 */
export type PlacementDivergence = {
  kind: "excluded" | "unknown";
  winnerId: string;
  winnerName: string | null;
};

export function placementDivergence(input: {
  placedManufacturerId: string | null;
  liveWinnerId: string | null;
  liveWinnerName: string | null;
  excludedManufacturerIds: string[];
}): PlacementDivergence | null {
  const { placedManufacturerId, liveWinnerId, liveWinnerName } = input;
  if (!placedManufacturerId || !liveWinnerId) return null;
  if (placedManufacturerId === liveWinnerId) return null;
  return {
    kind: input.excludedManufacturerIds.includes(liveWinnerId)
      ? "excluded"
      : "unknown",
    winnerId: liveWinnerId,
    winnerName: liveWinnerName,
  };
}

/* ─── "Bu karar işi kime verdi?" — ekran etiketi ──────────────────────────── */

/**
 * Kararın YERLEŞTİRDİĞİ atölyenin ekranda gösterilebilir hâli.
 *
 * Üç hâl AYRI tutulur, çünkü ikisini tek dala katlayan her kısayol ekranda
 * sessiz bir yalan üretiyordu:
 *  - `unrecorded`: kayıt yerleştirmeyi hiç yazmamış (damgadan önce yazılmış
 *    satır). Ekran "bilinmiyor" demeli; siparişin BUGÜNKÜ üreticisine düşmek,
 *    karardan sonra yapılan bir devri bu kararın sonucu gibi gösteriyordu.
 *  - `unnamed`: yerleştirme YAZILMIŞ ama atölyenin adı çözülemiyor (atölye
 *    kaydı silinmiş ya da ad sorgusuna girmemiş). Sipariş kartı bu hâlde
 *    tamamen susuyordu: cümle adın varlığına bağlıydı, "kayıtlı değil" notu da
 *    kimlik YAZILI olduğu için çıkmıyordu — yani karar bir atölyeye iş
 *    verdiği hâlde ekran hiçbir şey söylemiyordu. Bilinen şey (kimlik) yazılır,
 *    eksik olan da adıyla söylenir.
 *  - `named`: ad çözüldü.
 */
export type PlacementLabel =
  | { kind: "unrecorded" }
  | { kind: "unnamed"; manufacturerId: string; shortId: string }
  | { kind: "named"; manufacturerId: string; name: string };

/**
 * Kimliğin ekrana sığan hâli.
 *
 * Çıplak uuid bir hücreyi taşırıyor, ama admin kaydı yine de bu önekle
 * eşleştirebiliyor: "ad yok" demekle "hiçbir şey bilmiyoruz" demek arasındaki
 * fark budur.
 */
export function shortManufacturerId(id: string): string {
  return id.slice(0, 8);
}

export function placementLabel(input: {
  placedManufacturerId: string | null;
  placedManufacturerName: string | null;
}): PlacementLabel {
  const { placedManufacturerId, placedManufacturerName } = input;
  if (!placedManufacturerId) return { kind: "unrecorded" };
  // Boş ad da çözülmemiş sayılır: ekranda boş bir <strong> kalması, adı
  // okunamayan atölyeyi "adsız atölye" gibi gösterirdi.
  if (!placedManufacturerName) {
    return {
      kind: "unnamed",
      manufacturerId: placedManufacturerId,
      shortId: shortManufacturerId(placedManufacturerId),
    };
  }
  return {
    kind: "named",
    manufacturerId: placedManufacturerId,
    name: placedManufacturerName,
  };
}

/**
 * Karşılaştırmanın adı = MEYDAN OKUYAN tarafın ne olduğu.
 *
 * Sürüm koduna göre değil damgaya göre adlandırılır: "v3.0" ileride başka bir
 * deneye verilirse, sürüme bakan bir etiket o gün yalan söylemeye başlardı.
 */
export function comparisonTitleTr(evaluation: OrderEvaluation): string {
  if (evaluation.shadow.distanceModel === "continuous") {
    return "Sürekli mesafe gölgesi";
  }
  if (evaluation.shadow.distanceModel === "tiered") {
    return "Ağırlık karşılaştırması";
  }
  // Damgasız eski satır: hangi deney olduğunu iddia etmeden adlandır.
  return "Gölge sıralama";
}
