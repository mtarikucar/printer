/**
 * Boyacı atama KARAR KAYDI — saf testler + kaynak/migration denetimi (P4-C3).
 *
 * Neden bu testler var: bu tablo bir ortağın "neden bu iş bana gelmedi / neden
 * benden alındı" sorusunun TEK kanıtı. Kanıtın iki şekilde bozulabileceğini
 * üretici ikizinde yaşadık:
 *   - satır, kararı değil BUGÜNKÜ durumu anlatırsa (yerleşen boyacı kayıtta
 *     hiç geçmezse) kanıt olmaktan çıkar;
 *   - tekil bir indeks yüzünden ikinci karar birincinin üstüne yazılırsa
 *     geçmiş hiç oluşmaz (migration 0054).
 * Buradaki testler ikisini de kilitler.
 *
 * DB YOK: yazıcının saf yarısı (satır üretimi) ile dosya/şema denetimleri.
 *
 * Çalıştır: npx tsx scripts/test-painter-evaluation.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PAINTER_ASSIGNMENT_TRIGGERS,
  PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR,
  PAINTER_DECLINE_CAP_REASON,
  PAINTER_EVALUATION_RETENTION_DAYS,
  PAINTER_EVALUATION_WEIGHTS_VERSION,
  PAINTER_HUMAN_TRIGGERS,
  buildPainterEvaluationRow,
  isPainterAssignmentTrigger,
  painterEvaluationCutoff,
  painterEvaluationWriteWarningTr,
  painterTriggerIsHuman,
  type PainterAssignmentTrigger,
} from "../src/lib/services/painter-evaluation";
import { PAINTER_TRIGGER_LABELS_TR } from "../src/app/admin/scoring-evaluations/painter-evaluation-view";
import type { PainterEvaluationCandidateSnapshot } from "../src/lib/db/schema";

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

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const MIGRATION_TAG = "0057_painter_assignment_evaluations";
const ORDER = "11111111-1111-1111-1111-111111111111";

function cand(
  id: string,
  score: number,
  opts: { eligible?: boolean; ineligibleReason?: string } = {}
): PainterEvaluationCandidateSnapshot {
  return {
    painterId: id,
    companyName: `Boyacı ${id}`,
    eligible: opts.eligible ?? true,
    ...(opts.ineligibleReason ? { ineligibleReason: opts.ineligibleReason } : {}),
    score,
    parts: { route: 90, load: 80, reliability: 70, qcQuality: 60, onTime: 50 },
  };
}

/* ── 1. Kazanan: sıralayıcının verdiği SIRA geçerlidir ──────────────────── */
{
  // Skoru daha yüksek olan aday LİSTEDE SONRA duruyor. Yazıcı yeniden
  // sıralarsa sıralayıcıdaki bir hatayı kayıtta gizler: kayıt "kim kazandı"
  // sorusunu sıralayıcıya sormalı, kendi cevabını uydurmamalı.
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "qc_approve",
    candidates: [cand("a", 40), cand("b", 99)],
    outcome: { kind: "placed", painterId: "a" },
  });
  check(
    "kazanan = listedeki ilk uygun aday (yazıcı yeniden sıralamaz)",
    row.winnerPainterId === "a",
    String(row.winnerPainterId)
  );
  check("yerleşen boyacı sütuna yazılır", row.placedPainterId === "a");
  check("yerleşen kararda sebep null kalır", row.outcomeReason === null);
}

/* ── 2. Eleme: elenmişler kazananın önüne geçmez ────────────────────────── */
{
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "qc_approve",
    candidates: [
      cand("x", 95, { eligible: false, ineligibleReason: "kapasite dolu" }),
      cand("y", 60),
    ],
    outcome: { kind: "placed", painterId: "y" },
  });
  check("elenmiş aday kazanan sayılmaz", row.winnerPainterId === "y");
  check(
    "yerleşen kararda elenmişler kayda girmez (gürültü)",
    row.candidates.every((c) => c.eligible),
    JSON.stringify(row.candidates.map((c) => c.painterId))
  );
}

/* ── 3. İlk üç uygun aday saklanır ──────────────────────────────────────── */
{
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "qc_approve",
    candidates: [cand("1", 90), cand("2", 80), cand("3", 70), cand("4", 60)],
    outcome: { kind: "placed", painterId: "1" },
  });
  check(
    "ilk üç aday saklanır, dördüncü düşer",
    row.candidates.map((c) => c.painterId).join(",") === "1,2,3",
    row.candidates.map((c) => c.painterId).join(",")
  );
}

/* ── 4. Uygun aday yoksa: kararın TEK açıklaması elenmişlerdir ──────────── */
{
  const many = Array.from({ length: 14 }, (_, i) =>
    cand(`e${i}`, 10, { eligible: false, ineligibleReason: "sipariş almıyor" })
  );
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "decline_retry",
    candidates: many,
    outcome: { kind: "no_eligible_candidate", reason: "no_candidate" },
    excludedPainterIds: ["red1", "red2"],
  });
  check("uygun aday yoksa kazanan null", row.winnerPainterId === null);
  check("kimse yerleşmediyse yerleşen null", row.placedPainterId === null);
  check(
    "admin kuyruğuna düşme sebebi kaydedilir",
    row.outcomeReason === "no_candidate"
  );
  check(
    "elenmişler sebepleriyle saklanır (en çok 10)",
    row.candidates.length === 10 &&
      row.candidates.every((c) => c.ineligibleReason === "sipariş almıyor"),
    String(row.candidates.length)
  );
  check(
    "dışlananlar (önceki retler / SLA) satıra damgalanır",
    row.excludedPainterIds.join(",") === "red1,red2"
  );
}

/* ── 5. Yerleşen aday HER ZAMAN kayıtta kalır ───────────────────────────── */
{
  // Yönetici sıralamanın birincisi yerine dördüncüyü seçti. Satır onu
  // anmazsa "şu karar şu boyacıya gitti" cümlesi doğrulanamaz olurdu.
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "admin_manual",
    candidates: [cand("1", 90), cand("2", 80), cand("3", 70), cand("4", 60)],
    outcome: { kind: "placed", painterId: "4" },
  });
  check(
    "ilk üçün dışındaki yerleşen aday yine kayıtta",
    row.candidates.some((c) => c.painterId === "4"),
    row.candidates.map((c) => c.painterId).join(",")
  );
  check(
    "elle atamada kazanan (sıralamanın birincisi) ile yerleşen ayrışır",
    row.winnerPainterId === "1" && row.placedPainterId === "4"
  );

  // Yönetici ELENMİŞ bir boyacıyı da seçebilir (kapasitesini bilerek aşmak).
  const forced = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "admin_manual",
    candidates: [
      cand("1", 90),
      cand("z", 10, { eligible: false, ineligibleReason: "kapasite dolu" }),
    ],
    outcome: { kind: "placed", painterId: "z" },
  });
  check(
    "elenmiş olsa bile yerleşen aday kayıtta (sebebiyle birlikte)",
    forced.candidates.some(
      (c) => c.painterId === "z" && c.ineligibleReason === "kapasite dolu"
    )
  );
}

/* ── 6. Kopya aday teklenir ─────────────────────────────────────────────── */
{
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "qc_approve",
    candidates: [cand("a", 90), cand("a", 90), cand("b", 80)],
    outcome: { kind: "placed", painterId: "a" },
  });
  check(
    "aynı boyacı iki kez sayılmaz",
    row.candidates.map((c) => c.painterId).join(",") === "a,b",
    row.candidates.map((c) => c.painterId).join(",")
  );
}

/* ── 7. Girdi savunmacı kopyalanır + deterministik ──────────────────────── */
{
  const excluded = ["p1"];
  const input = {
    orderId: ORDER,
    trigger: "sla_reassign" as PainterAssignmentTrigger,
    candidates: [cand("a", 90)],
    outcome: { kind: "placed" as const, painterId: "a" },
    excludedPainterIds: excluded,
  };
  const row = buildPainterEvaluationRow(input);
  excluded.push("sonradan-eklendi");
  check(
    "dışlanan listesi kopyalanır (çağıranın dizisi satırı değiştiremez)",
    row.excludedPainterIds.join(",") === "p1"
  );
  const again = buildPainterEvaluationRow(input);
  check(
    "saf ve deterministik: aynı girdi aynı satırı verir",
    JSON.stringify(again) === JSON.stringify(buildPainterEvaluationRow(input))
  );
  check(
    "ağırlık sürümü damgalanır",
    row.weightsVersion === PAINTER_EVALUATION_WEIGHTS_VERSION
  );
  const custom = buildPainterEvaluationRow({ ...input, weightsVersion: "p2.0" });
  check("çağıran kendi ağırlık sürümünü geçirebilir", custom.weightsVersion === "p2.0");
}

/* ── 8. Tetikleyiciler ──────────────────────────────────────────────────── */
{
  check(
    "altı tetikleyici sözleşmedeki gibi (üç otomatik/karma + üç insan yolu)",
    PAINTER_ASSIGNMENT_TRIGGERS.join(",") ===
      "qc_approve,decline_retry,sla_reassign,admin_manual,manufacturer_handoff,admin_swap",
    PAINTER_ASSIGNMENT_TRIGGERS.join(",")
  );
  check(
    "her tetikleyicinin Türkçe etiketi var",
    PAINTER_ASSIGNMENT_TRIGGERS.every(
      (t) => (PAINTER_ASSIGNMENT_TRIGGER_LABELS_TR[t] ?? "").length > 0
    )
  );
  // Ekranın sözlüğü yazıcının listesinden GERİ KALAMAZ: eksik etiket, admin'e
  // ham kod ("manufacturer_handoff") göstermek demektir — hem Türkçe kuralını
  // çiğner hem de `tetik` süzgecini o karar için sessizce kapatır.
  check(
    "her tetikleyicinin EKRAN etiketi de var (süzgeç bu sözlükten doğruluyor)",
    PAINTER_ASSIGNMENT_TRIGGERS.every(
      (t) => (PAINTER_TRIGGER_LABELS_TR[t] ?? "").length > 0
    ),
    PAINTER_ASSIGNMENT_TRIGGERS.filter((t) => !PAINTER_TRIGGER_LABELS_TR[t]).join(",")
  );
  check(
    "insan yolları: sıralayıcının hiç çalışmadığı üç tetikleyici",
    PAINTER_HUMAN_TRIGGERS.join(",") ===
      "admin_manual,manufacturer_handoff,admin_swap",
    PAINTER_HUMAN_TRIGGERS.join(",")
  );
  check(
    "otomatik karar insan sayılmaz (ekran 'sıralama çalışmadı' demez)",
    !painterTriggerIsHuman("qc_approve") &&
      !painterTriggerIsHuman("decline_retry") &&
      !painterTriggerIsHuman("sla_reassign") &&
      painterTriggerIsHuman("admin_swap") &&
      !painterTriggerIsHuman(null)
  );
  check("bilinmeyen tetikleyici reddedilir", !isPainterAssignmentTrigger("boyandi"));
  check("geçerli tetikleyici kabul edilir", isPainterAssignmentTrigger("sla_reassign"));
}

/* ── 9. Saklama penceresi ───────────────────────────────────────────────── */
{
  check("saklama penceresi 30 gün (üretici ikiziyle aynı)", PAINTER_EVALUATION_RETENTION_DAYS === 30);
  const now = new Date("2026-09-16T12:00:00.000Z");
  const cutoff = painterEvaluationCutoff(now);
  const days = Math.round((now.getTime() - cutoff.getTime()) / 86_400_000);
  check("kesim tarihi tam 30 gün geride", days === 30, String(days));
  const svc = read("src/lib/services/painter-evaluation.ts");
  check(
    "temizlik yalnız BU tabloya dokunur (üretici kaydını kısaltmaz)",
    /delete\(painterAssignmentEvaluations\)/.test(svc) &&
      !/manufacturerAssignmentEvaluations/.test(svc)
  );
}

/* ── 10. Yazıcının kaynak kuralları ─────────────────────────────────────── */
{
  const svc = read("src/lib/services/painter-evaluation.ts");
  check(
    "yazıcı `server-only` import ETMEZ (SLA worker'ı bu zincire giriyor)",
    !/["']server-only["']/.test(svc)
  );
  const writer = svc.slice(svc.indexOf("export async function recordPainterEvaluation"));
  check(
    "yazma hatası yutulur: telemetri yerleşmiş bir atamayı geri aldıramaz",
    /catch\s*\(/.test(writer.slice(0, writer.indexOf("export interface PainterEvaluationRecord")))
  );
  check(
    "girdide 'sadece sıraladım' hâli yoktur (sayfa görüntülemesi satır yazamaz)",
    /kind: "placed"/.test(svc) &&
      /kind: "no_eligible_candidate"/.test(svc) &&
      !/kind: "ranked/.test(svc)
  );
}

/* ── 11. Şema: karar geçmişi BİRİKİR ────────────────────────────────────── */
{
  const schema = read("src/lib/db/schema.ts");
  const start = schema.indexOf('pgTable(\n  "painter_assignment_evaluations"');
  const table = start >= 0 ? schema.slice(start, start + 4000) : "";
  check("tablo schema.ts'te tanımlı (drizzle-kit yalnız orayı tarar)", start >= 0);
  const body = table.slice(0, table.indexOf("\n);"));
  check(
    "tabloda UNIQUE indeks YOK — ikinci karar birincinin üstüne yazılamaz",
    body.length > 0 && !/uniqueIndex/.test(body)
  );
  for (const col of [
    "winner_painter_id",
    "placed_painter_id",
    "excluded_painter_ids",
    "weights_version",
    "trigger",
    "outcome_reason",
  ]) {
    check(`kolon var: ${col}`, body.includes(`"${col}"`));
  }
}

/* ── 12. Migration çifti geri alınabilir ve KENDİ satırını siler ─────────── */
{
  const up = read(`drizzle/${MIGRATION_TAG}.sql`);
  const down = read(`drizzle/${MIGRATION_TAG}.down.sql`);
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.tag === MIGRATION_TAG);

  check("journal'da 0057 kaydı var", !!entry);
  check("up lock_timeout kuruyor", /SET lock_timeout/.test(up));
  check(
    "up idempotent (tablo + iki indeks IF NOT EXISTS)",
    /CREATE TABLE IF NOT EXISTS "painter_assignment_evaluations"/.test(up) &&
      (up.match(/CREATE INDEX IF NOT EXISTS/g) ?? []).length === 2
  );
  check(
    "FK'ler CREATE TABLE'ın içinde (ayrı ALTER idempotent olmazdı)",
    !/ALTER TABLE .*ADD CONSTRAINT/.test(up) &&
      (up.match(/CONSTRAINT "painter_assignment_evaluations_/g) ?? []).length === 3
  );
  check("down tabloyu düşürür (IF EXISTS)", /DROP TABLE IF EXISTS "painter_assignment_evaluations"/.test(down));
  check(
    "down KENDİ drizzle kaydını etiketiyle siler",
    !!entry &&
      new RegExp(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when};`).test(
        down
      ),
    entry ? String(entry.when) : "kayıt yok"
  );
  check(
    "down 'en yeni satırı sil' tarifini UYGULAMAZ (0058 eklenince başkasının kaydını silerdi)",
    !/DELETE FROM drizzle\.__drizzle_migrations[\s\S]{0,200}ORDER BY created_at DESC/i.test(down)
  );
  check(
    "drizzle şeması yoksa geri alma patlamaz (psql ile kurulan scratch DB)",
    /to_regclass\('drizzle\.__drizzle_migrations'\) IS NOT NULL/.test(down)
  );
}

/* ── 13. Ret hakkı doldu: terminal hâlin KENDİ satırı ──────────────────────── */
{
  // Bu yol sıralayıcıyı hiç çağırmaz, yani aday listesi BOŞ gelir. Satırın
  // yine de anlamlı olması gerekir: kazanan yok, yerleşen yok, sebep okunur.
  const row = buildPainterEvaluationRow({
    orderId: ORDER,
    trigger: "decline_retry",
    candidates: [],
    outcome: {
      kind: "no_eligible_candidate",
      reason: PAINTER_DECLINE_CAP_REASON,
    },
  });
  check("üst sınır kaydında kazanan yok", row.winnerPainterId === null);
  check("üst sınır kaydında yerleşen yok", row.placedPainterId === null);
  check(
    "sebep makine kodu olarak yazılır",
    row.outcomeReason === "decline_cap_reached",
    String(row.outcomeReason)
  );
  check("aday aranmadığı için liste boş", row.candidates.length === 0);

  // Ekranın sözlüğü ile yazıcının kodu AYNI dizeye bakmalı; ayrışırlarsa
  // admin ham kodu okur ve kararın en keskin hâli anlaşılmaz görünür.
  const view = read("src/app/admin/scoring-evaluations/painter-evaluation-view.ts");
  check(
    "ekran sözlüğünde bu sebebin Türkçe karşılığı var",
    view.includes(`${PAINTER_DECLINE_CAP_REASON}:`)
  );

  const svc = read("src/lib/services/painter-evaluation.ts");
  check(
    "üst sınır yazıcısı ortak yazıcıya delege eder (ikinci bir INSERT yolu yok)",
    /recordPainterDeclineCapReached[\s\S]{0,700}return recordPainterEvaluation\(/.test(svc)
  );
}

/* ── 14. KARAR YAZAN DÖRT YOL — kaynak denetimi ─────────────────────────── */
{
  // Yazıcı bir süre ÖLÜ KODDU: tablo, ekran ve testler vardı ama hiçbir canlı
  // yol satır yazmıyordu. Dört yolun dördü de burada pinlenir; biri sökülürse
  // kırmızı yanar.
  const auto = read("src/lib/services/painter-auto-assign.ts");
  const sla = read("src/lib/queue/workers/painter-accept-sla.worker.ts");
  const adminRoute = read("src/app/api/admin/orders/[id]/assign-painter/route.ts");
  const qc = read("src/app/api/admin/orders/[id]/qc-approve/route.ts");

  check(
    "1) QC onayı yerleştiriciyi çağırır (kaydı yerleştirici yazar)",
    /assignPainterAutomatically\(/.test(qc)
  );
  check(
    "2) yerleştirici hem yerleşen hem yerleşemeyen kararı yazar",
    (auto.match(/recordPainterEvaluation\(\{/g) ?? []).length >= 3
  );
  check(
    "3) ret sonrası üst sınır dalı kendi satırını yazar",
    /recordPainterDeclineCapReached\(\{[\s\S]{0,160}orderId: args\.orderId/.test(auto)
  );
  check(
    "4) cevapsızlık süpürmesinin üst sınır dalı da yazar (sla_reassign damgalı)",
    /recordPainterDeclineCapReached\(\{[\s\S]{0,200}trigger: "sla_reassign"/.test(sla)
  );
  check(
    "5) süpürmenin olağan dalı yerleştiriciyi sla_reassign ile çağırır",
    /assignPainterAutomatically\([\s\S]{0,200}trigger: "sla_reassign"/.test(sla)
  );
  check(
    "6) admin'in elle ataması admin_manual damgasıyla yazar",
    /recordPainterPlacementDecision\(\{[\s\S]{0,240}trigger: "admin_manual"/.test(adminRoute)
  );
  check(
    "elle atamada yazma hatası YUTULMAZ, admin'e uyarı olarak döner",
    /const evaluation = await recordPainterPlacementDecision\(/.test(adminRoute) &&
      /evaluation\.warningTr \? \{ warning: evaluation\.warningTr \}/.test(adminRoute)
  );
}

/* ── 15. Saklama süpürücüsünün ÇAĞIRANI var ─────────────────────────────── */
{
  // `purgeOldPainterEvaluations` yazıldı ama kimse çağırmıyordu: tablo
  // sonsuza kadar büyüyecekti.
  const worker = read("src/lib/queue/workers/scoring-evaluations-cleanup.worker.ts");
  check(
    "boyacı karar kayıtları günlük temizlikte süpürülür",
    /purgeOldPainterEvaluations\(\)/.test(worker)
  );
  check(
    "üretici kayıtlarının temizliği aynı yerde duruyor (kimse kısaltılmadı)",
    /delete\(manufacturerAssignmentEvaluations\)/.test(worker)
  );
}

/* ── 16. Boyacı cezası: ateşleyen yol var, yasak yollarda YOK ───────────── */
{
  const strikes = read("src/lib/services/strikes.ts");
  const revoke = read("src/app/api/admin/orders/[id]/revoke-painter/route.ts");
  const sla = read("src/lib/queue/workers/painter-accept-sla.worker.ts");
  const decline = read("src/app/api/painter/orders/[id]/decline/route.ts");

  check("ceza yardımcısı boyacı türünü biliyor", /kind === "painter"/.test(strikes));
  check(
    "boyacıdan geri alma cezayı boyacı türüyle yazar",
    /applyStrike\([\s\S]{0,160}kind: "painter"/.test(revoke)
  );
  check(
    "ceza iade edilmiş siparişte yazılmaz (kapı çağıranda)",
    /if \(strike && !refunded\)/.test(revoke)
  );
  check(
    "ceza siparişi de geçirir (kapı yazıcının içinde de kapansın)",
    /applyStrike\([\s\S]{0,200}orderId: id,/.test(revoke)
  );
  // Sahibin kararı: cevapsızlık ceza DEĞİLDİR. Süpürmeye bir gün ceza
  // eklenirse burası kırmızı yanar.
  check(
    "24 saat cevapsızlık ceza yazmaz (süpürmede applyStrike çağrısı yok)",
    !/applyStrike\(/.test(sla)
  );
  check(
    "ret de ceza yazmaz (ret rotasında applyStrike çağrısı yok)",
    !/applyStrike\(/.test(decline)
  );
}

/* ── 17. Çakışan dışa aktarım adı kalmadı ───────────────────────────────── */
{
  // İki sıralayıcı aynı adla (loadScore) farklı ölçü bekleyen iki fonksiyon
  // veriyordu: biri ağırlıklı birim, öbürü iş sayısı. İmzaları aynı olduğu için
  // yanlış modülden import sessizce derlenirdi.
  const painter = read("src/lib/services/painter-assignment.ts");
  const mfg = read("src/lib/services/manufacturer-assignment.ts");
  check(
    "boyacı yük skoru kendi adıyla dışa açılır",
    /export function painterLoadScore\(/.test(painter)
  );
  check(
    "boyacı tarafında `loadScore` adı KALMADI",
    !/export function loadScore\(/.test(painter)
  );
  check(
    "`loadScore` adının tek sahibi üretici sıralayıcısı",
    /export function loadScore\(/.test(mfg)
  );
}

/* ── 18. KAYITSIZ YENİ BİR YERLEŞTİRME YOLU EKLENEMEZ ───────────────────── */
{
  // İki yol tam da böyle kayıtsız kaldı: üreticinin kendi devri ve yöneticinin
  // boyacı değişimi siparişe boyacı yazıyor, ama hiçbir gerekçe satırı
  // bırakmıyordu — yani "bu iş neden bu boyacıya gitti" sorusu, yerleştirmeyi
  // KİMİN yaptığına göre cevaplanabilir ya da cevaplanamaz oluyordu. Kaynak
  // taraması bunu bir daha sessizce olamaz kılar: siparişe boyacı yazan yeni
  // bir dosya listeye girdiği anda (ya da bilinen bir dosya kaydını bıraktığı
  // anda) bu bölüm kırmızı yanar.
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) files.push(next);
    }
  };
  walk("src");

  const PLACEMENT_WRITE = 'painterStatus: "assigned"';
  const placementFiles = files.filter((f) => read(f).includes(PLACEMENT_WRITE)).sort();
  const KNOWN_PLACEMENT_FILES = [
    "src/app/api/admin/orders/[id]/assign-painter/route.ts",
    "src/app/api/admin/orders/[id]/swap-painter/route.ts",
    "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts",
    // Otomatik yolların ORTAK yerleştiricisi: kaydı çağıranı yazar (bkz. 14).
    "src/lib/services/painter-auto-assign.ts",
  ].sort();
  check(
    "siparişe boyacı yazan dosyalar tam olarak bilinen dört yol",
    placementFiles.join(" | ") === KNOWN_PLACEMENT_FILES.join(" | "),
    `bulunan: ${placementFiles.join(", ")}`
  );

  // İnsan yollarının ÜÇÜ de ortak kapıdan, kendi damgasıyla yazar. Damga
  // ayrı ayrı sınanır: hepsi "admin_manual" yazsaydı kayıt, parçanın kimde
  // olduğunu (değişimde eski boyacıda) anlatamazdı.
  const humanPaths: [string, string][] = [
    ["src/app/api/admin/orders/[id]/assign-painter/route.ts", "admin_manual"],
    ["src/app/api/admin/orders/[id]/swap-painter/route.ts", "admin_swap"],
    [
      "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts",
      "manufacturer_handoff",
    ],
  ];
  for (const [file, trigger] of humanPaths) {
    const src = read(file);
    check(
      `yerleştirme kaydı ortak kapıdan yazılıyor: ${file.split("/").slice(-2)[0]}`,
      new RegExp(
        `recordPainterPlacementDecision\\(\\{[\\s\\S]{0,240}trigger: "${trigger}"`
      ).test(src),
      trigger
    );
    // Kayıt yazılamadığında SUSULMAZ: uyarı hem cevaba hem (yazıcının içinde)
    // siparişin admin notuna gider. Cevabı düşüren bir ekran uyarıyı yok
    // edemesin diye ikisi birden şart.
    check(
      `kayıt yazılamadığında uyarı cevaba konuyor: ${file.split("/").slice(-2)[0]}`,
      /warning: evaluation\.warningTr/.test(src)
    );
  }

  // Yazıcının kendi raporlaması: uyarı cümlesi TEK yerde üretilir ve
  // yazılamayan kayıt siparişin admin notuna da düşer.
  const svc = read("src/lib/services/painter-evaluation.ts");
  check(
    "uyarı cümlesi tek kaynaktan gelir",
    /export function painterEvaluationWriteWarningTr\(/.test(svc) &&
      painterEvaluationWriteWarningTr("Boyacı atandı").startsWith("Boyacı atandı, ancak")
  );
  check(
    "yazılamayan kayıt siparişin admin notuna da yazılır (ekrana bağlı kalmaz)",
    /\[BOYACI KAYDI\]/.test(svc) && /notePainterEvaluationWriteFailure/.test(svc)
  );
  check(
    "ortak kapı İKİNCİ bir INSERT yolu açmaz (tek yazıcı korunur)",
    (svc.match(/db\.insert\(painterAssignmentEvaluations\)/g) ?? []).length === 1
  );

  // Değerlendirme ekranı: okunamayan tabloda TEK ŞEY söyler. Şerit + "henüz
  // kayıt yok" + dört sıfır sayaç birlikte görünüyordu; ekran kendi kendisiyle
  // çelişiyordu.
  const page = read("src/app/admin/scoring-evaluations/page.tsx");
  const unreadableBranch = page.indexOf("painterSide && painterEvaluationRowsUnreadable");
  const readableBranch = page.indexOf("painterSide && !painterEvaluationRowsUnreadable");
  const emptyClaim = page.indexOf("Henüz boyacı atama kaydı yok");
  check(
    "okunamayan tabloda ekran 'kayıt yok' İDDİA ETMEZ",
    unreadableBranch >= 0 && readableBranch > unreadableBranch && emptyClaim > readableBranch,
    `arıza dalı ${unreadableBranch}, okunur dal ${readableBranch}, boş iddia ${emptyClaim}`
  );
  check(
    "insan kararında 'sıralama kimseyi seçemedi' yazılmaz",
    /painterTriggerIsHuman\(d\.trigger\)/.test(page)
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
