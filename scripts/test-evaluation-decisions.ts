/**
 * Değerlendirme satırlarının KARARLARA eşlenmesi.
 *
 * Neden var: bir atama kararı tabloya birden çok satır yazıyor (ağırlık
 * karşılaştırması + sürekli mesafe gölgesi) ve bunlar mikrosaniyelerle
 * ayrılıyor. Eşleme bozulursa iki görünür hata doğar: /admin/scoring-evaluations
 * aynı kararı iki kez sayar, sipariş sayfası da kardeş satırı "önceki
 * değerlendirme" diye gösterir ve manşeti iki INSERT'ün yarışına bırakır.
 *
 * Eşleme artık yazıcının damgaladığı KARAR KİMLİĞİNE dayanıyor (D-C1); zaman
 * penceresi yalnız damgasız eski satırlar için yedek. Bu dosyanın asıl işi iki
 * kuralı birden korumak: aynı damga hep tek karar, farklı damga hep ayrı karar
 * (mikrosaniye arayla yazılmış olsalar bile).
 *
 * Saf test — DB yok.
 *
 * Çalıştır: npx tsx scripts/test-evaluation-decisions.ts
 */
import {
  buildOrderEvaluation,
  comparisonTitleTr,
  groupEvaluationDecisions,
  parseEvaluationSide,
  placementDivergence,
  placementLabel,
  type EvaluationRow,
} from "../src/app/admin/scoring-evaluations/evaluation-view";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const EGE = "11111111-1111-1111-1111-111111111111";
const NOKTA = "22222222-2222-2222-2222-222222222222";
const NAMES: Record<string, string> = { [EGE]: "Ege Reçine", [NOKTA]: "Nokta Figür" };
const nameOf = (id: string) => NAMES[id] ?? null;
const DISTANCE_VERSION = "v3.0";

function side(
  profileVersion: string,
  distanceModel: string,
  winnerId: string | null,
  placed?: string
) {
  return {
    weightsVersion: profileVersion,
    distanceModel,
    // Yazıcının damgası: kararın işi GERÇEKTEN verdiği atölye. Eski satırlarda
    // yok — o yüzden isteğe bağlı.
    ...(placed ? { assignedManufacturerId: placed } : {}),
    candidates: winnerId
      ? [
          {
            manufacturerId: winnerId,
            companyName: NAMES[winnerId],
            totalScore: 70,
            scores: { distance: 100, load: 60 },
          },
        ]
      : [],
  };
}

/** Ağırlık karşılaştırması satırı: canlı profil kendi sütununda. */
function weightsRow(
  id: string,
  orderId: string,
  createdAt: string,
  liveWinner: string | null,
  shadowWinner: string | null,
  placed?: string
): EvaluationRow {
  return {
    id,
    orderId,
    createdAt: new Date(createdAt),
    weightsVersion: "v2.2",
    authoritative: "v1",
    v1WinnerId: liveWinner,
    v2WinnerId: shadowWinner,
    v1Scores: side("v1.2", "tiered", liveWinner, placed),
    v2Scores: side("v2.2", "tiered", shadowWinner, placed),
  };
}

/** Mesafe gölgesi satırı: canlı seçim HER ZAMAN v1 sütununda. */
function distanceRow(
  id: string,
  orderId: string,
  createdAt: string,
  liveWinner: string | null,
  shadowWinner: string | null,
  placed?: string
): EvaluationRow {
  return {
    id,
    orderId,
    createdAt: new Date(createdAt),
    weightsVersion: DISTANCE_VERSION,
    authoritative: "v1",
    v1WinnerId: liveWinner,
    v2WinnerId: shadowWinner,
    v1Scores: side("v1.2", "tiered", liveWinner, placed),
    v2Scores: side("v3.0", "continuous", shadowWinner, placed),
  };
}

/** Yazıcının karar damgaları (D-C1): gerçekte uuid. */
const DECISION_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const DECISION_B = "bbbbbbbb-0000-4000-8000-00000000000b";

/** Satırın İKİ jsonb tarafını da damgalar — yazıcı da böyle yazıyor. */
function withDecision(row: EvaluationRow, decisionId: string): EvaluationRow {
  return {
    ...row,
    v1Scores: { ...(row.v1Scores as object), decisionId },
    v2Scores: { ...(row.v2Scores as object), decisionId },
  };
}

const build = (rows: EvaluationRow[]) =>
  rows.map((r) =>
    buildOrderEvaluation(r, nameOf, { distanceShadowVersion: DISTANCE_VERSION })
  );

// ─── 1. Tek kararın iki satırı tek karar olur ───────────────────────────────
{
  const rows = build([
    distanceRow("r-dist", "order-a", "2026-09-15T12:52:02.824847Z", EGE, NOKTA),
    weightsRow("r-weights", "order-a", "2026-09-15T12:52:02.824781Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("66 µs arayla yazılan iki satır TEK karar", decisions.length === 1, `${decisions.length}`);
  check("kararda iki karşılaştırma var", decisions[0]?.comparisons.length === 2);
  check(
    "karşılaştırmalar sabit sırada (v2.2 → v3.0)",
    decisions[0]?.comparisons.map((c) => c.weightsVersion).join(",") === "v2.2,v3.0",
    decisions[0]?.comparisons.map((c) => c.weightsVersion).join(",")
  );
  check("canlı seçim tek ve doğru", decisions[0]?.live.winnerId === EGE);
  check("canlı seçim tutarlı", decisions[0]?.liveConsistent === true);
  check(
    "mesafe karşılaştırmasının adı sürüm koduna değil damgaya bakar",
    comparisonTitleTr(decisions[0].comparisons[1]) === "Sürekli mesafe gölgesi",
    comparisonTitleTr(decisions[0].comparisons[1])
  );
  check(
    "ağırlık karşılaştırmasının adı ayrı",
    comparisonTitleTr(decisions[0].comparisons[0]) === "Ağırlık karşılaştırması",
    comparisonTitleTr(decisions[0].comparisons[0])
  );
  check(
    "sürekli mesafe gölgesi başka atölye seçtiyse 'farklı'",
    decisions[0].comparisons[1].differs === true &&
      decisions[0].comparisons[0].agrees === true
  );
}

// ─── 2. Aynı siparişin İKİ kararı ayrı kalır ────────────────────────────────
{
  // Gerçek senaryo: otomatik atama, sonra geri al + yeniden yerleştirme.
  const rows = build([
    distanceRow("r4", "order-a", "2026-09-15T13:10:00.000Z", NOKTA, EGE),
    weightsRow("r3", "order-a", "2026-09-15T13:10:00.000Z", NOKTA, NOKTA),
    distanceRow("r2", "order-a", "2026-09-15T12:52:02.824847Z", EGE, NOKTA),
    weightsRow("r1", "order-a", "2026-09-15T12:52:02.824781Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("18 dakika arayla iki ayrı karar", decisions.length === 2, `${decisions.length}`);
  check("en yeni karar başta", decisions[0]?.live.winnerId === NOKTA);
  check("her kararda ikişer karşılaştırma", decisions.every((d) => d.comparisons.length === 2));
}

// ─── 3. Aynı sürüm PENCERE İÇİNDE iki kez = tek karar, yeni yazım kazanır ───
{
  // Satırlar artık üst üste yazılmıyor, birikiyor. Aynı kararı iki kez yazan
  // yol (atama anındaki yazım + gecikmeli mutabakat yazımı) aynı sürümden iki
  // satır bırakır; bunu iki karar saymak her atamayı iki kez gösterirdi:
  // sipariş sayfasında uydurma bir "önceki karar", listede iki katı sayaç.
  const rows = build([
    distanceRow("r2", "order-b", "2026-09-15T12:52:02.900Z", NOKTA, NOKTA),
    distanceRow("r1", "order-b", "2026-09-15T12:52:02.800Z", NOKTA, NOKTA),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "aynı sürümün ikinci yazımı yeni karar değildir",
    decisions.length === 1,
    `${decisions.length}`
  );
  check("karşılaştırma bir kez görünür", decisions[0]?.comparisons.length === 1);
  check(
    "gösterilen satır en yenisidir",
    decisions[0]?.comparisons[0]?.id === "r2",
    decisions[0]?.comparisons[0]?.id
  );
  check("geçersiz kılınan yazım sayılır", decisions[0]?.supersededRowCount === 1);
}

// ─── 3b. İki yazım ayrışıyorsa ekran bunu söyleyebilmeli ────────────────────
{
  const rows = build([
    distanceRow("r2", "order-b2", "2026-09-15T12:52:02.900Z", NOKTA, NOKTA),
    distanceRow("r1", "order-b2", "2026-09-15T12:52:02.800Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("ayrışan iki yazım tek karardır", decisions.length === 1, `${decisions.length}`);
  check(
    "geçersiz kılınan yazımdaki ayrışma gizlenmez",
    decisions[0]?.liveConsistent === false
  );
}

// ─── 3c. Pencere DIŞINDAKİ aynı sürüm gerçek bir önceki karardır ────────────
{
  const rows = build([
    distanceRow("r2", "order-b3", "2026-09-15T13:10:00.000Z", NOKTA, NOKTA, NOKTA),
    distanceRow("r1", "order-b3", "2026-09-15T12:52:02.800Z", EGE, EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "18 dakika arayla aynı sürüm iki ayrı karardır",
    decisions.length === 2,
    `${decisions.length}`
  );
  check(
    "önceki kararın yerleştirdiği atölye korunur",
    decisions[1]?.placedManufacturerId === EGE,
    String(decisions[1]?.placedManufacturerId)
  );
  check("hiçbir yazım geçersiz kılınmadı", decisions.every((d) => d.supersededRowCount === 0));
}

// ─── 4. Zaman penceresi: uzak satırlar birleşmez ───────────────────────────
{
  const rows = build([
    distanceRow("r2", "order-c", "2026-09-15T12:53:00.000Z", EGE, NOKTA),
    weightsRow("r1", "order-c", "2026-09-15T12:52:00.000Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("60 saniye arayla yazılan satırlar ayrı karar", decisions.length === 2, `${decisions.length}`);
}

// ─── 5. Farklı siparişler karışmaz (araya giren satırlar) ──────────────────
{
  const rows = build([
    distanceRow("a2", "order-a", "2026-09-15T12:52:02.900Z", EGE, NOKTA),
    distanceRow("b2", "order-b", "2026-09-15T12:52:02.880Z", NOKTA, NOKTA),
    weightsRow("a1", "order-a", "2026-09-15T12:52:02.860Z", EGE, EGE),
    weightsRow("b1", "order-b", "2026-09-15T12:52:02.840Z", NOKTA, NOKTA),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("iki sipariş, iki karar", decisions.length === 2, `${decisions.length}`);
  check(
    "her karar yalnız kendi siparişinin satırlarını taşır",
    decisions.every((d) => d.comparisons.every((c) => c.orderId === d.orderId))
  );
}

// ─── 6. Canlı seçim ayrışırsa ekran uyarabilmeli ───────────────────────────
{
  const rows = build([
    distanceRow("r2", "order-d", "2026-09-15T12:52:02.824847Z", NOKTA, NOKTA),
    weightsRow("r1", "order-d", "2026-09-15T12:52:02.824781Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("tutarsız canlı seçim işaretlenir", decisions[0]?.liveConsistent === false);
}

// ─── 7. Kazananı olmayan (aday bulunamadı) karar da tek karardır ───────────
{
  const rows = build([
    distanceRow("r2", "order-e", "2026-09-15T12:52:02.824847Z", null, null),
    weightsRow("r1", "order-e", "2026-09-15T12:52:02.824781Z", null, null),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("kazanansız satırlar da tek kararda toplanır", decisions.length === 1);
  check("kazanansız kararda ne 'aynı' ne 'farklı' vardır", decisions[0].comparisons.every((c) => !c.agrees && !c.differs));
}

// ─── 8. Giriş sırası bozuk gelse de sonuç aynı ─────────────────────────────
{
  const rows = build([
    weightsRow("r1", "order-f", "2026-09-15T12:52:02.824781Z", EGE, EGE),
    distanceRow("r2", "order-f", "2026-09-15T12:52:02.824847Z", EGE, NOKTA),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("eski-önce gelen giriş de tek karar üretir", decisions.length === 1, `${decisions.length}`);
  check(
    "karar zamanı en yeni satırın damgasıdır",
    decisions[0]?.createdAt === new Date("2026-09-15T12:52:02.824847Z").toISOString()
  );
}

// ─── 9. Yerleşen atölye damgası okunur; eski satırlarda null kalır ─────────
{
  const stamped = groupEvaluationDecisions(
    build([
      distanceRow("r2", "order-g", "2026-09-15T12:52:02.824847Z", EGE, NOKTA, NOKTA),
      weightsRow("r1", "order-g", "2026-09-15T12:52:02.824781Z", EGE, EGE, NOKTA),
    ])
  );
  check(
    "kararın yerleştirdiği atölye damgadan okunur",
    stamped[0]?.placedManufacturerId === NOKTA,
    String(stamped[0]?.placedManufacturerId)
  );
  check(
    "yerleşen atölyenin adı çözülür",
    stamped[0]?.placedManufacturerName === "Nokta Figür",
    String(stamped[0]?.placedManufacturerName)
  );
  check(
    "yerleşen atölye, sıralamanın kazananından ayrı tutulur",
    stamped[0]?.live.winnerId === EGE
  );

  const legacy = groupEvaluationDecisions(
    build([weightsRow("r1", "order-h", "2026-09-15T12:52:02.000Z", EGE, EGE)])
  );
  check("damgasız eski satırda yerleşen atölye null", legacy[0]?.placedManufacturerId === null);
}

// ─── 10. Damga dizi biçimindeki en eski jsonb şeklinde de patlamaz ─────────
{
  const decisions = groupEvaluationDecisions(
    build([
      {
        id: "legacy",
        orderId: "order-i",
        createdAt: new Date("2026-06-12T15:08:47.239Z"),
        weightsVersion: "v2.0",
        authoritative: "v1",
        v1WinnerId: EGE,
        v2WinnerId: NOKTA,
        v1Scores: [{ manufacturerId: EGE, companyName: "Ege Reçine", totalScore: 71, scores: {} }],
        v2Scores: [{ manufacturerId: NOKTA, companyName: "Nokta Figür", totalScore: 70, scores: {} }],
      },
    ])
  );
  check("dizi biçimli eski kayıt tek karar olur", decisions.length === 1);
  check("eski kaydın karşılaştırma adı iddiasız", comparisonTitleTr(decisions[0].comparisons[0]) === "Gölge sıralama");
  check("eski kayıtta yerleşen atölye null", decisions[0].placedManufacturerId === null);
}

// ─── 10b. Dışlama damgası: sıralamadan sapmanın SEBEBİ ─────────────────────
{
  // Geri alma "kara listeye ekle" işaretlenmeden yapıldığında sıralamanın
  // birincisi kayıtta kazanan kalır, iş ise sıradakine gider. Kart bunu "elle
  // atanmış olabilir" diye anlatıyordu — hiçbir insanın karışmadığı bir
  // yerleştirmede.
  const excludedRow: EvaluationRow = {
    id: "r-excl",
    orderId: "order-j",
    createdAt: new Date("2026-09-15T12:52:02.900Z"),
    weightsVersion: DISTANCE_VERSION,
    authoritative: "v1",
    v1WinnerId: EGE,
    v2WinnerId: EGE,
    v1Scores: {
      weightsVersion: "v1.2",
      distanceModel: "tiered",
      assignedManufacturerId: NOKTA,
      excludedManufacturerIds: [EGE],
      candidates: [],
    },
    v2Scores: {
      weightsVersion: "v3.0",
      distanceModel: "continuous",
      assignedManufacturerId: NOKTA,
      candidates: [],
    },
  };
  const [decision] = groupEvaluationDecisions(build([excludedRow]));
  check("dışlama damgası okunur", decision.excludedManufacturerIds.includes(EGE));
  check("yerleşen atölye damgadan okunur", decision.placedManufacturerId === NOKTA);
  const excluded = placementDivergence({
    placedManufacturerId: decision.placedManufacturerId,
    liveWinnerId: decision.live.winnerId,
    liveWinnerName: decision.live.winnerName,
    excludedManufacturerIds: decision.excludedManufacturerIds,
  });
  check("birinci dışlanmışsa sebep 'dışlama'", excluded?.kind === "excluded", String(excluded?.kind));
  check("sebep gösterilirken birincinin adı taşınır", excluded?.winnerName === "Ege Reçine");

  const unknown = placementDivergence({
    placedManufacturerId: NOKTA,
    liveWinnerId: EGE,
    liveWinnerName: "Ege Reçine",
    excludedManufacturerIds: [],
  });
  check("damga yoksa tek sebep iddia edilmez", unknown?.kind === "unknown", String(unknown?.kind));

  check(
    "sapma yoksa uyarı da yok",
    placementDivergence({
      placedManufacturerId: EGE,
      liveWinnerId: EGE,
      liveWinnerName: "Ege Reçine",
      excludedManufacturerIds: [],
    }) === null
  );
  check(
    "kazanan bilinmiyorsa sebep uydurulmaz",
    placementDivergence({
      placedManufacturerId: NOKTA,
      liveWinnerId: null,
      liveWinnerName: null,
      excludedManufacturerIds: [],
    }) === null
  );

  // Yazıcı damgayı seçenek adıyla (`excludeManufacturerIds`) bırakırsa da sebep
  // kaybolmamalı: bir isim tercihi ekranda yanlış suçlamaya dönüşürdü.
  check(
    "alternatif alan adı da okunur",
    parseEvaluationSide({
      assignedManufacturerId: NOKTA,
      excludeManufacturerIds: [EGE],
      candidates: [],
    }).excludedManufacturerIds[0] === EGE
  );
  check(
    "bozuk damga sessizce boş kalır",
    parseEvaluationSide({
      assignedManufacturerId: NOKTA,
      excludedManufacturerIds: "hepsi",
      candidates: [],
    }).excludedManufacturerIds.length === 0
  );
}

// ─── 11. Karar GEÇMİŞİ: aynı sipariş, aynı sürüm, iki ayrı karar ───────────
// Migration 0054 öncesinde tekil (order_id, weights_version) indeksi yüzünden
// ikinci karar birincinin ÜZERİNE yazılıyordu: bir siparişte her zaman tam
// olarak bir karar bulunuyor, "Önceki atama kararları" hiç dolmuyordu. Satırlar
// artık eklendiği için okuyucunun ikisini de ayrı karar olarak görmesi gerekir.
{
  const rows = build([
    distanceRow("r4", "order-j", "2026-09-15T13:10:00.000Z", NOKTA, EGE, NOKTA),
    weightsRow("r3", "order-j", "2026-09-15T13:10:00.000Z", NOKTA, NOKTA, NOKTA),
    distanceRow("r2", "order-j", "2026-09-15T12:52:02.824847Z", EGE, NOKTA, EGE),
    weightsRow("r1", "order-j", "2026-09-15T12:52:02.824781Z", EGE, EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("iki yerleştirme = iki karar (üzerine yazılmaz)", decisions.length === 2, `${decisions.length}`);
  check(
    "en yeni karar manşet, eskisi GEÇMİŞ olarak durur",
    decisions[0]?.placedManufacturerId === NOKTA &&
      decisions[1]?.placedManufacturerId === EGE,
    `${decisions[0]?.placedManufacturerId} / ${decisions[1]?.placedManufacturerId}`
  );
  check(
    "ilk kararın kimi seçtiği kaybolmaz",
    decisions[1]?.live.winnerId === EGE,
    String(decisions[1]?.live.winnerId)
  );
}

// ─── 12. Dışlama damgası okunur ────────────────────────────────────────────
// Dışlama artık sıralamanın İÇİNDE uygulanıyor (kazanan = yerleşen), ama "en
// yakın atölye neden hiç görünmüyor" sorusunun cevabı yalnız bu damgada durur.
{
  const withExcluded = (row: EvaluationRow, excluded: string[]): EvaluationRow => ({
    ...row,
    v1Scores: { ...(row.v1Scores as object), excludedManufacturerIds: excluded },
    v2Scores: { ...(row.v2Scores as object), excludedManufacturerIds: excluded },
  });
  const rows = build([
    withExcluded(
      distanceRow("r2", "order-k", "2026-09-15T12:52:02.824847Z", EGE, EGE, EGE),
      [NOKTA]
    ),
    withExcluded(
      weightsRow("r1", "order-k", "2026-09-15T12:52:02.824781Z", EGE, EGE, EGE),
      [NOKTA]
    ),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "dışlanan atölye karşılaştırmadan okunur",
    decisions[0].comparisons.every((c) =>
      c.excludedManufacturerIds.includes(NOKTA)
    ),
    JSON.stringify(decisions[0].comparisons.map((c) => c.excludedManufacturerIds))
  );
  check(
    "dışlama varken kazanan ile yerleşen AYRIŞMAZ (dışlama sıralamanın içinde)",
    decisions[0].live.winnerId === decisions[0].placedManufacturerId,
    `${decisions[0].live.winnerId} / ${decisions[0].placedManufacturerId}`
  );
  // Damgasız satır sebebi İDDİA ETMEZ: boş liste "bilinmiyor" demektir.
  const legacy = groupEvaluationDecisions(
    build([weightsRow("r1", "order-l", "2026-09-15T12:52:02.000Z", EGE, EGE)])
  );
  check(
    "damgasız satırda dışlama listesi boştur",
    legacy[0].comparisons.every((c) => c.excludedManufacturerIds.length === 0)
  );
}

// ─── 13. KARAR KİMLİĞİ: 5 saniyeden yakın İKİ gerçek yerleştirme ──────────
// Ölçülen gerçek senaryo (p1e-02): arka arkaya iki geri alma, 0,39 sn arayla
// iki GERÇEK yerleştirme. Zaman penceresi bunları tek karara katlıyordu; önceki
// kararın kazananı da işi alan atölyesi de her iki ekrandan siliniyordu.
{
  const rows = build([
    withDecision(
      distanceRow("r4", "order-m", "2026-09-15T14:48:06.312Z", NOKTA, NOKTA, NOKTA),
      DECISION_B
    ),
    withDecision(
      weightsRow("r3", "order-m", "2026-09-15T14:48:06.300Z", NOKTA, NOKTA, NOKTA),
      DECISION_B
    ),
    withDecision(
      distanceRow("r2", "order-m", "2026-09-15T14:48:05.921Z", EGE, EGE, EGE),
      DECISION_A
    ),
    withDecision(
      weightsRow("r1", "order-m", "2026-09-15T14:48:05.900Z", EGE, EGE, EGE),
      DECISION_A
    ),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "0,39 sn arayla iki damgalı yerleştirme İKİ karardır",
    decisions.length === 2,
    `${decisions.length}`
  );
  check(
    "en yeni karar manşet olur",
    decisions[0]?.placedManufacturerId === NOKTA,
    String(decisions[0]?.placedManufacturerId)
  );
  check(
    "ÖNCEKİ kararın işi alan atölyesi kaybolmaz",
    decisions[1]?.placedManufacturerId === EGE,
    String(decisions[1]?.placedManufacturerId)
  );
  check(
    "önceki kararın sıralama birincisi kaybolmaz",
    decisions[1]?.live.winnerId === EGE,
    String(decisions[1]?.live.winnerId)
  );
  check(
    "karar kimliği karara taşınır",
    decisions[0]?.decisionId === DECISION_B &&
      decisions[1]?.decisionId === DECISION_A,
    `${decisions[0]?.decisionId} / ${decisions[1]?.decisionId}`
  );
  check(
    "iki ayrı karar, geçersiz kılınmış yazım DEĞİLDİR",
    decisions.every((d) => d.supersededRowCount === 0)
  );
  check(
    "her karar ikişer karşılaştırma taşır",
    decisions.every((d) => d.comparisons.length === 2)
  );
}

// ─── 14. Aynı damga: zaman ne derse desin TEK karar ────────────────────────
// Kimliğin zamanı yendiğini gösterir: aynı damgalı satırlar pencerenin çok
// dışına düşse bile tek karardır.
{
  const rows = build([
    withDecision(
      distanceRow("r2", "order-n", "2026-09-15T13:10:00.000Z", EGE, NOKTA, EGE),
      DECISION_A
    ),
    withDecision(
      weightsRow("r1", "order-n", "2026-09-15T12:52:00.000Z", EGE, EGE, EGE),
      DECISION_A
    ),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "aynı damga, 18 dakika arayla: TEK karar",
    decisions.length === 1,
    `${decisions.length}`
  );
  check("kararda iki karşılaştırma var", decisions[0]?.comparisons.length === 2);
}

// ─── 15. Damgalı ile damgasız satır aynı karara düşmez ─────────────────────
{
  const rows = build([
    withDecision(
      distanceRow("r2", "order-o", "2026-09-15T12:52:02.900Z", NOKTA, NOKTA, NOKTA),
      DECISION_A
    ),
    distanceRow("r1", "order-o", "2026-09-15T12:52:02.890Z", EGE, EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check(
    "damgalı satır, damgasız satırla aynı karara katlanmaz",
    decisions.length === 2,
    `${decisions.length}`
  );
  check("damgalı kararın kimliği okunur", decisions[0]?.decisionId === DECISION_A);
  check("damgasız kararın kimliği null kalır", decisions[1]?.decisionId === null);
}

// ─── 16. Damgasız satırlarda zaman penceresi YEDEK olarak sürüyor ──────────
{
  const rows = build([
    distanceRow("r2", "order-p", "2026-09-15T12:52:02.824847Z", EGE, NOKTA),
    weightsRow("r1", "order-p", "2026-09-15T12:52:02.824781Z", EGE, EGE),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("damgasız kardeş satırlar hâlâ tek karar", decisions.length === 1);
  check("damgasız kararın kimliği null", decisions[0]?.decisionId === null);
}

// ─── 17. Aynı damganın aynı sürümü iki kez: fazladan YAZIM ────────────────
// Ayrı karar değil; ekran bunu "N kayıt daha yazılmış" diye gösteriyor.
{
  const rows = build([
    withDecision(
      distanceRow("r2", "order-q", "2026-09-15T12:52:02.900Z", NOKTA, NOKTA, NOKTA),
      DECISION_A
    ),
    withDecision(
      distanceRow("r1", "order-q", "2026-09-15T12:52:02.800Z", NOKTA, NOKTA, NOKTA),
      DECISION_A
    ),
  ]);
  const decisions = groupEvaluationDecisions(rows);
  check("aynı damga + aynı sürüm: tek karar", decisions.length === 1);
  check("gösterilen satır en yenisidir", decisions[0]?.comparisons[0]?.id === "r2");
  check(
    "fazladan yazım sayılır (ekranda gösterilir)",
    decisions[0]?.supersededRowCount === 1,
    String(decisions[0]?.supersededRowCount)
  );
}

// ─── 18. Kayıt işi kime verdiğini BİLMİYORSA sapma iddia edilmez ──────────
// Ekranlar eskiden siparişin BUGÜNKÜ üreticisine düşüyordu: karardan çok sonra
// elle yapılan bir devir, o eski kararı "sıralamadan farklı" diye damgalıyordu.
{
  check(
    "yerleşen atölye kayıtlı değilse sapma İDDİA EDİLMEZ",
    placementDivergence({
      placedManufacturerId: null,
      liveWinnerId: EGE,
      liveWinnerName: "Ege Reçine",
      excludedManufacturerIds: [],
    }) === null
  );
  const legacy = groupEvaluationDecisions(
    build([weightsRow("r1", "order-r", "2026-09-15T12:52:02.000Z", EGE, EGE)])
  );
  check(
    "damgasız kararda yerleşen atölye null kalır (ekran 'bilinmiyor' der)",
    legacy[0]?.placedManufacturerId === null
  );
  check(
    "damgasız kararın kendi kaydından sapma çıkarılamaz",
    placementDivergence({
      placedManufacturerId: legacy[0]?.placedManufacturerId ?? null,
      liveWinnerId: legacy[0]?.live.winnerId ?? null,
      liveWinnerName: legacy[0]?.live.winnerName ?? null,
      excludedManufacturerIds: legacy[0]?.excludedManufacturerIds ?? [],
    }) === null
  );
}

// ─── 19. "İşi alan" etiketi: bilinen yazılır, EKSİK OLAN da söylenir ───────
// Kart, cümleyi ADIN varlığına bağlamıştı: kayıt bir atölye yazmış ama o
// atölyenin adı çözülemediğinde (atölye kaydı silinmiş) ekran hiçbir şey
// yazmıyordu — "kayıtlı değil" notu da kimlik YAZILI olduğu için çıkmıyordu.
{
  const named = placementLabel({
    placedManufacturerId: NOKTA,
    placedManufacturerName: "Nokta Figür",
  });
  check("ad çözüldüyse etiket adı taşır", named.kind === "named" && named.name === "Nokta Figür");

  const unnamed = placementLabel({
    placedManufacturerId: NOKTA,
    placedManufacturerName: null,
  });
  check(
    "yerleştirme yazılı ama ad yoksa: sessizlik değil, 'ad çözülemedi'",
    unnamed.kind === "unnamed",
    unnamed.kind
  );
  check(
    "ad çözülemediğinde BİLİNEN şey (kimlik) ekrana taşınır",
    unnamed.kind === "unnamed" && unnamed.shortId === NOKTA.slice(0, 8),
    unnamed.kind === "unnamed" ? unnamed.shortId : unnamed.kind
  );

  const empty = placementLabel({
    placedManufacturerId: NOKTA,
    placedManufacturerName: "",
  });
  check("boş ad da çözülmemiş sayılır (boş <strong> kalmaz)", empty.kind === "unnamed");

  const unrecorded = placementLabel({
    placedManufacturerId: null,
    placedManufacturerName: null,
  });
  check(
    "kayıt yerleştirmeyi hiç yazmamışsa 'kayıtlı değil' hâli ayrı kalır",
    unrecorded.kind === "unrecorded",
    unrecorded.kind
  );

  // Kararın kendisinden okunduğunda da aynı: rozet ve cümle, siparişin bugünkü
  // üreticisine değil kararın damgasına bakar.
  const [decision] = groupEvaluationDecisions(
    build([distanceRow("r1", "order-s", "2026-09-15T12:52:02.000Z", EGE, EGE, NOKTA)])
  );
  const fromDecision = placementLabel(decision);
  check(
    "etiket kararın KENDİ damgasından okunur (sıralamanın birincisinden değil)",
    fromDecision.kind === "named" && fromDecision.manufacturerId === NOKTA,
    fromDecision.kind
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
