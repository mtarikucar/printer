/**
 * 0070'in GERÇEK DDL'i, tek kullanımlık bir QA şemasında.
 *
 * Şema 0064'ün up'ıyla kurulur — `quote_parts`ı yaratan tek dosya odur — sonra
 * 0070 uygulanır. Kanıtlanan şey şema METNİ değil, veritabanının DAVRANIŞIdır:
 * `step` yazılabiliyor mu, birim kilidi gerçekten kuruldu mu, liste hâlâ kapalı
 * mı ve geri alma müşteri verisiyle karşılaşınca duruyor mu.
 *
 * `scripts/test-quote-migration-db.ts` GENİŞLETİLMEZ: o betik 0064'e çivili
 * (tohum sayımları, sahip olunan tablo listesi). Depo deseni migration başına
 * ayrı betiktir (`test-dispute-migration-db.ts`, `test-order-refund-migration-db.ts`).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { defaultPartConfig } from "../src/lib/config/quote-compute";
import { SEED_SNAPSHOT } from "../src/lib/config/quote-seed";
import { QUOTE_SOURCE_FORMATS } from "../src/lib/config/quote-types";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0070_step_format";
/** `quote_parts`ı yaratan tek migration; 0070 yalnız onun kısıtlarını değiştirir. */
const baseTag = "0064_instant_quotes";
/** Kayıt defterinin BAĞLADIĞI değerler (migration-flag-registry.md · S · STEP). */
const WHEN = 1790787200000;
/** Üretimde uygulanmış en yeni migration (0067). Migrator tek satır okur. */
const PRODUCTION_WATERMARK = 1790693512063;

const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(fs.existsSync(upPath) && fs.existsSync(downPath), "0070 requires executable up/down artifacts");
const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `quote_step_migration_${randomUUID().replaceAll("-", "")}`;
const client = new pg.Client({ connectionString: raw });
const journal = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")) as {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};
function journalEntry(wanted: string) {
  const found = journal.entries.find((e) => e.tag === wanted);
  assert.ok(found, `${wanted} journal girdisi gerekli`);
  return found;
}
const entry = journalEntry(tag);
const baseEntry = journalEntry(baseTag);
/**
 * `public.` ÖNEKİ ŞART: yalıtım buradan geliyor. 0070'in SQL'i tabloyu açıkça
 * `public.quote_parts` diye adlandırdığı için tek kullanımlık şemaya çevrilebilir.
 */
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const baseUp = qualify(fs.readFileSync(path.join(root, "drizzle", `${baseTag}.sql`), "utf8"));
const up = qualify(fs.readFileSync(upPath, "utf8"));
const down = qualify(fs.readFileSync(downPath, "utf8"));
const relation = `${ns}.quote_parts`;

let checks = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name); checks++; console.log(`PASS ${name}`);
}
function ok(name: string, condition: unknown, detail?: string) {
  assert.ok(condition, detail ? `${name}: ${detail}` : name); checks++; console.log(`PASS ${name}`);
}
async function rows(sql: string, params: unknown[] = []) {
  return (await client.query(sql, params)).rows;
}
/** Kısıdın veritabanındaki İFADESİ; kısıt yoksa null. */
async function constraintDef(name: string): Promise<string | null> {
  const found = await rows(
    "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = to_regclass($1) AND c.conname = $2",
    [relation, name],
  );
  return found.length === 0 ? null : (found[0].def as string);
}
/** Postgres `IN (...)`ı `= ANY (ARRAY[...])`a çevirir; listeyi ifadeden geri okur. */
async function formatsInDb(): Promise<string[]> {
  const def = await constraintDef("quote_parts_source_format_chk");
  assert.ok(def, "quote_parts_source_format_chk kısıdı yok");
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
}
async function insertQuote() {
  return (await client.query(
    "INSERT INTO quotes (anonymous_id, pricing_snapshot, expires_at) VALUES ('anon-fixture', '{\"version\":1}'::jsonb, now() + interval '30 days') RETURNING *",
  )).rows[0];
}
/** `source_format` ve `units` her çağrıda `overrides` ile verilir; gerisi kurgu. */
function partColumns(quoteId: string, overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    quote_id: quoteId, name: "Parça", file_name: "parca.step", source_key: `quote-parts/${randomUUID()}/source.step`,
    source_bytes: 4096, source_sha256: "b".repeat(64),
    technology_key: "fdm", material_key: "pla", color_key: "beyaz", finish_key: "ham", ...overrides,
  };
  const keys = Object.keys(data);
  return {
    sql: `INSERT INTO quote_parts (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, source_format, units`,
    params: Object.values(data),
  };
}
async function insertPart(quoteId: string, overrides: Record<string, unknown>) {
  const { sql, params } = partColumns(quoteId, overrides);
  return (await client.query(sql, params)).rows[0] as { id: string; source_format: string; units: string };
}
async function accepts(name: string, quoteId: string, overrides: Record<string, unknown>, expected: { source_format: string; units: string }) {
  const { source_format, units } = await insertPart(quoteId, overrides);
  check(name, { source_format, units }, expected);
}
async function rejectsPart(name: string, quoteId: string, overrides: Record<string, unknown>, constraint: string) {
  const { sql, params } = partColumns(quoteId, overrides);
  await client.query("SAVEPOINT reject_probe");
  await assert.rejects(
    client.query(sql, params),
    (e: unknown) => {
      const err = e as { code?: string; constraint?: string };
      return err.code === "23514" && err.constraint === constraint;
    },
    name,
  );
  await client.query("ROLLBACK TO SAVEPOINT reject_probe");
  checks++; console.log(`PASS ${name}`);
}
/**
 * Geri alma DURUR. Ret bir `RAISE EXCEPTION` olduğu için tüm blok atomik olarak
 * geri sarılır — "hiçbir şeye dokunmadan durdu" güvencesi budur; aşağıdaki
 * kontroller de şemanın ve journal satırının yerinde kaldığını doğrular.
 */
async function refusesDown(name: string) {
  await client.query("SAVEPOINT before_down");
  await assert.rejects(client.query(down), /0070 geri alma reddedildi/, name);
  await client.query("ROLLBACK TO SAVEPOINT before_down");
  checks++; console.log(`PASS ${name}`);
  check(`${name} — liste dört değerde kalır`, await formatsInDb(), [...QUOTE_SOURCE_FORMATS]);
  ok(`${name} — birim kilidi yerinde kalır`, await constraintDef("quote_parts_step_units_chk"));
  check(`${name} — journal satırı yerinde kalır`,
    (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
    ["0064", "0070", "later"]);
}

// ─── Şema tarafı ile veritabanı AYNI listeyi taşıyor mu ─────────────────────
//
// Bu sevkiyatın tek işi ikisini BİRLİKTE dört değere çıkarmak. Tip sözleşmesi
// genişletilip migration yazılmazsa (ya da tersi) uygulama `step` yazmaya
// kalkar ve veritabanı 23514 ile reddeder: boş gövdeli 500. Aşağısı o ayrışmayı
// kaynak üzerinden yakalar; davranış kanıtı veritabanı bölümünde.
check("tip sözleşmesi dört biçim taşır", [...QUOTE_SOURCE_FORMATS], ["stl", "obj", "3mf", "step"]);
ok("0070'in up'ı listeyi tip sözleşmesiyle birebir yazar",
  fs.readFileSync(upPath, "utf8").includes(`source_format IN (${QUOTE_SOURCE_FORMATS.map((f) => `'${f}'`).join(", ")})`),
  "up'taki CHECK listesi QUOTE_SOURCE_FORMATS ile aynı değil");
ok("schema.ts birim kilidini adıyla tanımlar",
  fs.readFileSync(path.join(root, "src/lib/db/schema.ts"), "utf8").includes('check("quote_parts_step_units_chk"'),
  "schema.ts'te quote_parts_step_units_chk yok — drizzle-kit bir sonraki turda kısıdı düşürür");
check("journal girdisi kayıt defterinin sayılarını taşır", [entry.idx, entry.when, entry.version], [70, WHEN, "7"]);
ok("0070'in `when`i üretim watermark'ının ÜSTÜNDE", entry.when > PRODUCTION_WATERMARK,
  `${entry.when} <= ${PRODUCTION_WATERMARK}: migrate 0070'i sessizce atlar`);

async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    // 0064 yalnız kimliklerine bakıyor; en küçük öncüller yeter.
    for (const table of ["users", "orders", "order_drafts"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY)`);
    }
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    // 'later' satırı tuzağı kurar: "en yenisini sil" tarifi ONU silerdi.
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('0064',$1),('0070',$2),('later',$3)",
      [baseEntry.when, WHEN, WHEN + 1]);
    await client.query(baseUp);
    check("0064 listeyi üç değerle kurar", await formatsInDb(), ["stl", "obj", "3mf"]);
    check("0064'te birim kilidi YOK", await constraintDef("quote_parts_step_units_chk"), null);

    await client.query(up); await client.query(up);
    check("up iki kez koşabilir ve listeyi dörde çıkarır", await formatsInDb(), [...QUOTE_SOURCE_FORMATS]);
    const unitsLock = await constraintDef("quote_parts_step_units_chk");
    ok("up birim kilidini kurar", unitsLock && /source_format <> 'step'/.test(unitsLock) && /units = 'mm'/.test(unitsLock),
      `beklenmeyen ifade: ${unitsLock}`);

    const quote = await insertQuote();
    // Geri almanın DOKUNMAMASI gereken satır: kalıcı, STEP olmayan, birimi mm
    // DIŞINDA bir müşteri parçası. Sondalar geri sarıldığı için kalıcı olmalı.
    await accepts("STEP olmayan bir müşteri parçası kalıcı olarak yazılır", quote.id,
      { source_format: "stl", units: "cm" }, { source_format: "stl", units: "cm" });

    // Kısıt sondaları yazıyor; tek işlem saklanan kurguyu bozmadan tutar.
    await client.query("BEGIN");
    await accepts("STEP parçası mm ile YAZILABİLİR", quote.id, { source_format: "step", units: "mm" },
      { source_format: "step", units: "mm" });
    await rejectsPart("STEP parçası cm ile REDDEDİLİR", quote.id, { source_format: "step", units: "cm" },
      "quote_parts_step_units_chk");
    await rejectsPart("STEP parçası inç ile REDDEDİLİR", quote.id, { source_format: "step", units: "in" },
      "quote_parts_step_units_chk");
    // En kolay kaçırılan regresyon: kilit YALNIZ STEP'i bağlar.
    await accepts("STL parçası cm ile YAZILABİLİR (kilit yalnız STEP'i bağlar)", quote.id,
      { source_format: "stl", units: "cm" }, { source_format: "stl", units: "cm" });
    await accepts("3MF parçası inç ile YAZILABİLİR", quote.id,
      { source_format: "3mf", units: "in" }, { source_format: "3mf", units: "in" });
    await rejectsPart("liste HÂLÂ KAPALI: iges reddedilir", quote.id, { source_format: "iges", units: "mm" },
      "quote_parts_source_format_chk");
    // Bugünkü yükleme yolu: `addPartFromUpload` parçayı geometri OLMADAN yazar,
    // yani `defaultPartConfig` her zaman 'mm' der. Yeni kilit onu kırmaz.
    const uploadUnits = defaultPartConfig(SEED_SNAPSHOT, null).units;
    check("yükleme yolunun varsayılan birimi 'mm'", uploadUnits, "mm");
    await accepts("STEP parçası yükleme yolunun varsayılan birimiyle YAZILABİLİR", quote.id,
      { source_format: "step", units: uploadUnits }, { source_format: "step", units: "mm" });
    await client.query("ROLLBACK");

    // ─── Geri alma: müşteri verisi varsa REDDEDER ──────────────────────────
    const stepPart = await insertPart(quote.id, { source_format: "step", units: "mm" });
    await client.query("BEGIN");
    await refusesDown("yazılmış bir STEP satırı geri almayı REDDETTİRİR");
    await client.query("ROLLBACK");

    await client.query("UPDATE quote_parts SET deleted_at = now() WHERE id = $1", [stepPart.id]);
    await client.query("BEGIN");
    await refusesDown("YUMUŞAK SİLİNMİŞ bir STEP satırı da geri almayı REDDETTİRİR");
    await client.query("ROLLBACK");

    // ─── Temizse geri alma TAM ─────────────────────────────────────────────
    await client.query("DELETE FROM quote_parts WHERE source_format = 'step'");
    await client.query(down); await client.query(down);
    check("down listeyi üç değerine döndürür", await formatsInDb(), ["stl", "obj", "3mf"]);
    check("down birim kilidini YOK EDER", await constraintDef("quote_parts_step_units_chk"), null);
    check("down yalnız KENDİ journal satırını siler",
      (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
      ["0064", "later"]);
    await client.query("BEGIN");
    await rejectsPart("geri alma sonrası STEP parçası REDDEDİLİR", quote.id, { source_format: "step", units: "mm" },
      "quote_parts_source_format_chk");
    await client.query("ROLLBACK");
    check("down müşteri satırlarına DOKUNMAZ",
      await rows("SELECT source_format, units FROM quote_parts ORDER BY source_format"),
      [{ source_format: "stl", units: "cm" }]);

    // ─── Tur: up → down → up ───────────────────────────────────────────────
    await client.query(up);
    check("down sonrası up listeyi yeniden dörde çıkarır", await formatsInDb(), [...QUOTE_SOURCE_FORMATS]);
    ok("down sonrası up birim kilidini yeniden kurar", await constraintDef("quote_parts_step_units_chk"));
    await client.query("BEGIN");
    await accepts("tur sonunda STEP parçası yine YAZILABİLİR", quote.id, { source_format: "step", units: "mm" },
      { source_format: "step", units: "mm" });
    await client.query("ROLLBACK");

    console.log(`${checks} quote step migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(() => {});
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
