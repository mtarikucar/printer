/**
 * Boyacı atama kayıtlarının EKRANA çevrilmesi.
 *
 * Neden var: bu modülün tek işi "kayıt ne diyorsa onu söylemek". Üretici
 * ikizinde (evaluation-view.ts) öğrenilen pahalı dersler burada ÖNCEDEN
 * çivileniyor:
 *  - Kazananı "işi alan" saymak: hiç kimsenin yerleşmediği bir kararda ekranda
 *    "iş şu boyacıya verildi" yazardı; oysa o boyacı işi hiç görmedi.
 *  - Sütun ile jsonb damgası çatıştığında hangisinin kazanacağı.
 *  - Bilinmeyen bir tetikleyici/sebep kodunun kartı susturmaması.
 *
 * Saf test — DB yok.
 *
 * Çalıştır: npx tsx scripts/test-painter-evaluation-view.ts
 */
import {
  PAINTER_SCORE_KEYS,
  buildPainterEvaluation,
  painterOutcomeReasonLabelTr,
  painterPlacementDivergence,
  painterPlacementLabel,
  painterTriggerLabelTr,
  parsePainterEvaluationCandidates,
  type PainterEvaluationRow,
} from "../src/app/admin/scoring-evaluations/painter-evaluation-view";

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

const FIRCA = "11111111-1111-1111-1111-111111111111";
const RENK = "22222222-2222-2222-2222-222222222222";
const SILINMIS = "33333333-3333-3333-3333-333333333333";
const NAMES: Record<string, string> = { [FIRCA]: "Fırça Atölye", [RENK]: "Renk Studio" };
const nameOf = (id: string) => NAMES[id] ?? null;

/** Sıralayıcının yazdığı aday (P4-C1 `PainterCandidate` alan adlarıyla). */
function snapshot(painterId: string, score: number, eligible = true) {
  return {
    painterId,
    companyName: NAMES[painterId] ?? "Bilinmeyen",
    eligible,
    ...(eligible ? {} : { ineligibleReason: "Kapasitesi dolu" }),
    score,
    parts: { route: 90, load: 70, reliability: 80, qcQuality: 60, onTime: 50 },
  };
}

function row(over: Partial<PainterEvaluationRow> = {}): PainterEvaluationRow {
  return {
    id: "row-1",
    orderId: "order-1",
    createdAt: new Date("2026-09-16T09:00:00.000Z"),
    weightsVersion: "p1.0",
    trigger: "qc_approve",
    winnerPainterId: FIRCA,
    placedPainterId: FIRCA,
    excludedPainterIds: [],
    outcomeReason: null,
    candidates: [snapshot(FIRCA, 82), snapshot(RENK, 61)],
    ...over,
  };
}

console.log("\naday listesi hoşgörülü okunuyor mu");
{
  const bare = parsePainterEvaluationCandidates([snapshot(FIRCA, 82)]);
  check("düz dizi okunur", bare.candidates.length === 1 && bare.candidates[0].totalScore === 82);
  check(
    "parts → skor bileşenleri",
    PAINTER_SCORE_KEYS.every((k) => typeof bare.candidates[0].scores[k] === "number")
  );

  // Yazıcı bir gün zarfa geçerse ekran boş liste göstermemeli.
  const enveloped = parsePainterEvaluationCandidates({
    weightsVersion: "p1.1",
    trigger: "decline_retry",
    assignedPainterId: RENK,
    excludedPainterIds: [FIRCA],
    candidates: [snapshot(RENK, 55)],
  });
  check("zarf şekli de okunur", enveloped.candidates.length === 1);
  check("zarftaki sürüm damgası okunur", enveloped.weightsVersion === "p1.1");
  check("zarftaki tetikleyici okunur", enveloped.trigger === "decline_retry");
  check("zarftaki yerleşen okunur", enveloped.placedPainterId === RENK);
  check("zarftaki dışlananlar okunur", enveloped.excludedPainterIds[0] === FIRCA);

  // Üretici kaydının alan adlarıyla yazılmış eski/karışık bir satır.
  const alt = parsePainterEvaluationCandidates([
    { painterId: FIRCA, companyName: "Fırça", totalScore: 40, scores: { route: 10 } },
  ]);
  check("totalScore/scores adları da kabul edilir", alt.candidates[0].totalScore === 40);
  check("scores içindeki bileşen okunur", alt.candidates[0].scores.route === 10);

  for (const junk of [null, undefined, 42, "bozuk", { candidates: "yok" }]) {
    const parsed = parsePainterEvaluationCandidates(junk);
    check(
      `bozuk jsonb (${JSON.stringify(junk)}) kırmaz`,
      parsed.candidates.length === 0 && parsed.placedPainterId === null
    );
  }
}

console.log("\nsatır → ekran nesnesi");
{
  const e = buildPainterEvaluation(row(), nameOf);
  check("kazananın adı çözülür", e.winnerName === "Fırça Atölye");
  check("yerleşenin adı çözülür", e.placedPainterName === "Fırça Atölye");
  check("tetikleyici satırdan okunur", e.trigger === "qc_approve");
  check("ağırlık sürümü satırdan okunur", e.weightsVersion === "p1.0");
  check("tarih ISO'ya çevrilir", e.createdAt === "2026-09-16T09:00:00.000Z");

  // KAZANAN ≠ YERLEŞEN. Uygun aday çıkmadığı için kimsenin yerleşmediği karar:
  // ekran "iş şu boyacıya verildi" DEMEMELİ.
  const empty = buildPainterEvaluation(
    row({
      winnerPainterId: null,
      placedPainterId: null,
      candidates: [],
      outcomeReason: "no_candidate",
    }),
    nameOf
  );
  check("kazanan yoksa yerleşen de yok", empty.placedPainterId === null);
  check("sebep taşınır", empty.outcomeReason === "no_candidate");

  // Sıralama birinciyi seçti ama iş hiç yerleşmedi (ret sonrası kuyruk).
  const notPlaced = buildPainterEvaluation(
    row({ placedPainterId: null, outcomeReason: "decline_cap_reached" }),
    nameOf
  );
  check(
    "kazanan varken de yerleşen uydurulmaz",
    notPlaced.winnerPainterId === FIRCA && notPlaced.placedPainterId === null
  );

  // Sütun, jsonb damgasını yener: sütun yazıcının kesin beyanıdır.
  const conflicting = buildPainterEvaluation(
    row({
      placedPainterId: RENK,
      excludedPainterIds: [SILINMIS],
      candidates: {
        assignedPainterId: FIRCA,
        excludedPainterIds: [FIRCA],
        candidates: [snapshot(FIRCA, 82)],
      },
    }),
    nameOf
  );
  check("sütundaki yerleşen kazanır", conflicting.placedPainterId === RENK);
  check(
    "sütundaki dışlananlar kazanır",
    conflicting.excludedPainterIds.length === 1 &&
      conflicting.excludedPainterIds[0] === SILINMIS
  );

  // Sütun boşsa jsonb damgası yedektir (yazıcı yalnız zarfa damgalarsa).
  const fromJson = buildPainterEvaluation(
    row({
      placedPainterId: null,
      excludedPainterIds: [],
      candidates: {
        assignedPainterId: RENK,
        excludedPainterIds: [FIRCA],
        candidates: [snapshot(RENK, 61)],
      },
    }),
    nameOf
  );
  check("sütun boşsa jsonb yerleşeni okunur", fromJson.placedPainterId === RENK);
  check("sütun boşsa jsonb dışlananları okunur", fromJson.excludedPainterIds[0] === FIRCA);

  // Kaydı silinmiş boyacı: ad çözülemez ama kimlik kaybolmaz.
  const unnamed = buildPainterEvaluation(
    row({ winnerPainterId: SILINMIS, placedPainterId: SILINMIS, candidates: [] }),
    nameOf
  );
  check("çözülemeyen ad uydurulmaz", unnamed.placedPainterName === null);
  check("kimlik korunur", unnamed.placedPainterId === SILINMIS);

  // Ad tablosu okunamasa bile kayıttaki damga adı kurtarır.
  const fromSummaryName = buildPainterEvaluation(row(), () => null);
  check(
    "ad tablosu boşken kayıttaki ad kullanılır",
    fromSummaryName.winnerName === "Fırça Atölye"
  );
}

console.log("\netiketler");
{
  check("bilinen tetikleyici çevrilir", painterTriggerLabelTr("sla_reassign").includes("24 saat"));
  check("bilinmeyen tetikleyici kırmaz", painterTriggerLabelTr("yeni_sebep") === "yeni sebep");
  check("damgasız tetikleyici 'bilinmiyor'", painterTriggerLabelTr(null) === "bilinmiyor");
  check(
    "bilinen sebep çevrilir",
    (painterOutcomeReasonLabelTr("no_candidate") ?? "").includes("admin kuyruğuna")
  );
  check("bilinmeyen sebep ham gösterilir", painterOutcomeReasonLabelTr("x_y") === "x y");
  check("sebep yoksa cümle de yok", painterOutcomeReasonLabelTr(null) === null);

  check(
    "yerleşme yazılmamışsa 'kayıtlı değil'",
    painterPlacementLabel({ placedPainterId: null, placedPainterName: null }).kind === "unrecorded"
  );
  const unnamed = painterPlacementLabel({ placedPainterId: SILINMIS, placedPainterName: null });
  check(
    "ad çözülemediyse kimlik gösterilir",
    unnamed.kind === "unnamed" && unnamed.shortId === SILINMIS.slice(0, 8)
  );
  check(
    "boş ad da çözülmemiş sayılır",
    painterPlacementLabel({ placedPainterId: FIRCA, placedPainterName: "" }).kind === "unnamed"
  );
}

console.log("\nsıralamadan sapma, kaydın söylediği kadar");
{
  const same = painterPlacementDivergence({
    placedPainterId: FIRCA,
    winnerPainterId: FIRCA,
    winnerName: "Fırça Atölye",
    excludedPainterIds: [],
    trigger: "qc_approve",
  });
  check("aynı boyacıda sapma yok", same === null);

  const unknownPlacement = painterPlacementDivergence({
    placedPainterId: null,
    winnerPainterId: FIRCA,
    winnerName: "Fırça Atölye",
    excludedPainterIds: [],
    trigger: "qc_approve",
  });
  check("yerleşme bilinmiyorsa sapma İDDİA EDİLMEZ", unknownPlacement === null);

  const excluded = painterPlacementDivergence({
    placedPainterId: RENK,
    winnerPainterId: FIRCA,
    winnerName: "Fırça Atölye",
    excludedPainterIds: [FIRCA],
    trigger: "decline_retry",
  });
  check("dışlanmışsa sebep 'excluded'", excluded?.kind === "excluded");

  const manual = painterPlacementDivergence({
    placedPainterId: RENK,
    winnerPainterId: FIRCA,
    winnerName: "Fırça Atölye",
    excludedPainterIds: [],
    trigger: "admin_manual",
  });
  check("admin elle seçtiyse sebep 'manual'", manual?.kind === "manual");

  const unknown = painterPlacementDivergence({
    placedPainterId: RENK,
    winnerPainterId: FIRCA,
    winnerName: "Fırça Atölye",
    excludedPainterIds: [],
    trigger: "qc_approve",
  });
  check("sebep kayıtta yoksa 'unknown'", unknown?.kind === "unknown");
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
}
process.exitCode = fail ? 1 : 0;
