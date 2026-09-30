/**
 * 0071'in GERÇEK DDL'i, tek kullanımlık bir QA şemasında.
 *
 * Şema 0064'ün up'ıyla kurulur — `quotes`ı yaratan tek dosya odur — sonra 0071
 * uygulanır. Kanıtlanan şey şema METNİ değil, veritabanının DAVRANIŞIdır:
 * `fx_rates` ve `quotes.fx_snapshot` gerçekten kuruldu mu, dört CHECK ve tekil
 * indeks bozuk satırı reddediyor mu, ve geri alma ÖDENMİŞ teklifin kur kanıtıyla
 * karşılaşınca duruyor mu.
 *
 * `scripts/test-quote-migration-db.ts` GENİŞLETİLMEZ: o betik 0064'e çivili
 * (tohum sayımları, sahip olunan tablo listesi). Depo deseni migration başına
 * ayrı betiktir (`test-quote-step-migration-db.ts`, `test-dispute-migration-db.ts`).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { FX_CURRENCIES, type QuoteFxSnapshot } from "../src/lib/config/quote-types";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0071_fx_rates";
/** `quotes`ı yaratan tek migration; 0071 ona bir kolon ekler. */
const baseTag = "0064_instant_quotes";
/** Kayıt defterinin BAĞLADIĞI değerler (migration-flag-registry.md · D · döviz). */
const WHEN = 1790790800000;
/** Üretimde uygulanmış en yeni migration (0067). Migrator tek satır okur. */
const PRODUCTION_WATERMARK = 1790693512063;

const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(fs.existsSync(upPath) && fs.existsSync(downPath), "0071 requires executable up/down artifacts");
const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `fx_migration_${randomUUID().replaceAll("-", "")}`;
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
 * `public.` ÖNEKİ ŞART: yalıtım buradan geliyor. 0071'in SQL'i tabloları
 * açıkça `public.` diye adlandırdığı için tek kullanımlık şemaya çevrilebilir;
 * önek yazılmazsa bu test QA'nın GERÇEK şemasına yazardı.
 */
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const baseUp = qualify(fs.readFileSync(path.join(root, "drizzle", `${baseTag}.sql`), "utf8"));
const up = qualify(fs.readFileSync(upPath, "utf8"));
const down = qualify(fs.readFileSync(downPath, "utf8"));

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
/**
 * Dosyayı `psql`in gördüğü ÜST DÜZEY ifadelere ayırır. Sınır yalnız üst düzey
 * `;`dir: dolar alıntısı (`$$…$$`), tek alıntı (`''` kaçışı dâhil), çift
 * alıntılı tanımlayıcı ve yorumların İÇİ sayılmaz. Yorumlar atılır, böylece
 * yalnız yorumdan oluşan bir kuyruk ifade sayılmaz.
 * (`scripts/test-quote-step-migration-db.ts` ile aynı ayrıştırıcı.)
 */
function topLevelStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      const close = sql.indexOf(dollar[0], i + dollar[0].length);
      assert.ok(close !== -1, `kapanmamış dolar alıntısı: ${dollar[0]}`);
      buf += sql.slice(i, close + dollar[0].length);
      i = close + dollar[0].length;
      continue;
    }
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] !== ch) { j++; continue; }
        if (sql[j + 1] === ch) { j += 2; continue; }
        break;
      }
      assert.ok(j < sql.length, `kapanmamış alıntı: ${ch}`);
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
const downStatements = topLevelStatements(down);
/**
 * `psql -f` gibi uygular: her ÜST DÜZEY ifade KENDİ işleminde koşar — psql `-1`
 * olmadan tam olarak böyle davranır ve down'ın TEK uygulama yolu odur. İlk
 * hatada durup o hatayı döner, hata yoksa `undefined`. Sarmalayıcı bir işlem ya
 * da savepoint YOK: çağrıdan sonra okunan şey geri sarılmış değil KALICI olandır.
 */
async function applyLikePsql(statements: string[]): Promise<unknown> {
  for (const statement of statements) {
    try {
      await client.query(statement);
    } catch (error) {
      return error;
    }
  }
  return undefined;
}
async function tableExists(name: string): Promise<boolean> {
  return (await rows("SELECT to_regclass($1) IS NOT NULL AS found", [`${ns}.${name}`]))[0].found as boolean;
}
async function columnExists(table: string, column: string): Promise<boolean> {
  return (await rows(
    "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
    [ns, table, column],
  ))[0].n === 1;
}
/** Tablodaki CHECK kısıtlarının adı → ifadesi. */
async function checkConstraints(table: string): Promise<Record<string, string>> {
  const found = await rows(
    `SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      WHERE c.conrelid = to_regclass($1) AND c.contype = 'c' ORDER BY c.conname`,
    [`${ns}.${table}`],
  );
  return Object.fromEntries(found.map((r) => [r.name as string, r.def as string]));
}
async function indexes(table: string): Promise<Array<{ name: string; unique: boolean }>> {
  return (await rows(
    `SELECT i.relname AS name, x.indisunique AS unique FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = to_regclass($1) AND NOT x.indisprimary ORDER BY i.relname`,
    [`${ns}.${table}`],
  )).map((r) => ({ name: r.name as string, unique: r.unique as boolean }));
}
const snapshot: QuoteFxSnapshot = {
  version: 1,
  source: "tcmb",
  bulletinDate: "2026-09-30",
  takenAt: "2026-09-30T08:00:00.000Z",
  rates: [{ currency: "EUR", microTryPerUnit: 47_320_000 }],
};
async function insertQuote(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    anonymous_id: "anon-fixture",
    pricing_snapshot: JSON.stringify({ version: 1 }),
    expires_at: new Date(Date.now() + 30 * 86400000),
    ...overrides,
  };
  const keys = Object.keys(data);
  return (await client.query(
    `INSERT INTO quotes (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function insertRate(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    currency: "EUR", bulletin_date: "2026-09-30", micro_try_per_unit: 47_320_000, ...overrides,
  };
  const keys = Object.keys(data);
  // `bulletin_date` METİN olarak da okunur: `pg`, `date` kolonunu sunucunun
  // yerel saatinde bir `Date`e çeviriyor (UTC+3'te YEREL GECE YARISI, yani
  // `toISOString()` bir GÜN GERİ kayar). Bülten tarihi müşteriye AYNEN
  // gösterilen bir etikettir — okuma yolu (D2/D3) onu metin olarak almalı.
  return (await client.query(
    `INSERT INTO fx_rates (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})
     RETURNING *, bulletin_date::text AS bulletin_date_text`,
    Object.values(data),
  )).rows[0];
}
async function rejectsRate(name: string, overrides: Record<string, unknown>, code: string, constraint?: string) {
  await client.query("SAVEPOINT reject_probe");
  await assert.rejects(insertRate(overrides), (e: unknown) => {
    const err = e as { code?: string; constraint?: string };
    return err.code === code && (!constraint || err.constraint === constraint);
  }, name);
  await client.query("ROLLBACK TO SAVEPOINT reject_probe");
  checks++; console.log(`PASS ${name}`);
}
/**
 * Geri alma DURUR — ve durduğunda GERÇEKTEN hiçbir şey kalıcı olmaz.
 *
 * Dosya `applyLikePsql` ile ifade ifade koşturulur; ne bir işleme sarılır ne de
 * savepoint'e geri sarılır. Aşağıdaki okumalar bu yüzden ÇÜRÜTÜLEBİLİR: journal
 * `DELETE`i ya da `DROP TABLE` ileride `DO` bloğunun DIŞINA çıkarsa yarım
 * uygulama olur (kolon yerinde kalır ama tablo düşer / kayıt silinir) ve bu
 * kontroller KIRMIZI olur.
 */
async function refusesDown(name: string) {
  const failure = await applyLikePsql(downStatements);
  ok(name, failure instanceof Error && /0071 rollback refused/.test(failure.message),
    failure === undefined ? "down reddetmedi, geçti" : `beklenmeyen hata: ${String(failure)}`);
  ok(`${name} — fx_rates tablosu YERİNDE kalır`, await tableExists("fx_rates"));
  ok(`${name} — quotes.fx_snapshot kolonu YERİNDE kalır`, await columnExists("quotes", "fx_snapshot"));
  check(`${name} — journal satırı yerinde kalır`,
    (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
    ["0064", "0071", "later"]);
}

// ─── Numara ve `when` kayıt defterinden gelir, tahminle yazılmaz ────────────
check("journal girdisi kayıt defterinin sayılarını taşır", [entry.idx, entry.when, entry.version], [71, WHEN, "7"]);
ok("0071'in `when`i üretim watermark'ının ÜSTÜNDE", entry.when > PRODUCTION_WATERMARK,
  `${entry.when} <= ${PRODUCTION_WATERMARK}: migrate 0071'i sessizce atlar ve fx_snapshot kolonu üretimde eksik kalır`);
ok("down TAM O sayıyı siler (hash ile silme yasak)",
  new RegExp(`DELETE FROM drizzle\\.__drizzle_migrations WHERE created_at = ${WHEN}\\b`)
    .test(fs.readFileSync(downPath, "utf8")),
  "down kendi journal satırını `created_at = when` ile silmiyor");
ok("down `hash` ile silme tarifi taşımıyor",
  !/WHERE hash =/.test(fs.readFileSync(downPath, "utf8")));
// ─── Down YARIM uygulanamaz ─────────────────────────────────────────────────
const downTopLevel = topLevelStatements(fs.readFileSync(downPath, "utf8"));
check("down TEK üst düzey ifadedir", downTopLevel.length, 1);
ok("journal satırının silinmesi o tek `DO` bloğunun İÇİNDEdir",
  /^DO \$\$[\s\S]*DELETE FROM drizzle\.__drizzle_migrations[\s\S]*\$\$$/.test(downTopLevel[0] ?? ""),
  `üst düzey ifade beklenen DO bloğu değil: ${(downTopLevel[0] ?? "").slice(0, 120)}`);
// ─── CHECK listesi tip sözleşmesinden gelir ─────────────────────────────────
ok("0071'in up'ı para birimi listesini tip sözleşmesiyle birebir yazar",
  fs.readFileSync(upPath, "utf8").includes(`IN (${FX_CURRENCIES.map((c) => `'${c}'`).join(", ")})`),
  "up'taki CHECK listesi FX_CURRENCIES ile aynı değil");
ok("schema.ts dört CHECK'i de adıyla tanımlar",
  ["fx_rates_currency_chk", "fx_rates_source_chk", "fx_rates_rate_chk", "fx_rates_unit_chk"].every((name) =>
    fs.readFileSync(path.join(root, "src/lib/db/schema.ts"), "utf8").includes(`check("${name}"`)),
  "schema.ts'te eksik CHECK var — drizzle-kit bir sonraki turda onu düşürür");

async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    // 0064 yalnız kimliklerine bakıyor; en küçük öncüller yeter.
    for (const table of ["users", "orders", "order_drafts"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY)`);
    }
    const orderId = randomUUID();
    await client.query("INSERT INTO orders(id) VALUES($1)", [orderId]);
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    // 'later' satırı tuzağı kurar: "en yenisini sil" tarifi ONU silerdi.
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('0064',$1),('0071',$2),('later',$3)",
      [baseEntry.when, WHEN, WHEN + 1]);
    await client.query(baseUp);
    ok("0064'te fx_rates YOK", !(await tableExists("fx_rates")));
    ok("0064'te quotes.fx_snapshot YOK", !(await columnExists("quotes", "fx_snapshot")));

    // ─── UP: tam ve idempotent ──────────────────────────────────────────────
    await client.query(up); await client.query(up);
    ok("up iki kez koşabilir ve fx_rates'i kurar", await tableExists("fx_rates"));
    ok("up quotes.fx_snapshot kolonunu ekler", await columnExists("quotes", "fx_snapshot"));
    check("iki indeks kurulur (biri tekil)", await indexes("fx_rates"), [
      { name: "fx_rates_currency_date_uq", unique: true },
      { name: "fx_rates_recent_idx", unique: false },
    ]);
    check("dört CHECK yerinde", Object.keys(await checkConstraints("fx_rates")),
      ["fx_rates_currency_chk", "fx_rates_rate_chk", "fx_rates_source_chk", "fx_rates_unit_chk"]);

    // ─── CHECK'ler ve tekillik gerçekten reddediyor ─────────────────────────
    const stored = await insertRate();
    check("kur satırı varsayılanlarıyla yazılır",
      [stored.currency, stored.bulletin_date_text, Number(stored.micro_try_per_unit), stored.bulletin_unit, stored.source],
      ["EUR", "2026-09-30", 47_320_000, 1, "tcmb"]);
    ok("`date` kolonu MİKRO-TRY gibi tamsayı değil, gün etiketidir",
      typeof stored.bulletin_date_text === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored.bulletin_date_text));
    await client.query("BEGIN");
    await rejectsRate("katalog dışı para birimi (CHF) reddedilir", { currency: "CHF" }, "23514", "fx_rates_currency_chk");
    await rejectsRate("sıfır kur reddedilir", { micro_try_per_unit: 0 }, "23514", "fx_rates_rate_chk");
    await rejectsRate("negatif kur reddedilir", { micro_try_per_unit: -1 }, "23514", "fx_rates_rate_chk");
    await rejectsRate("sıfır bülten birimi reddedilir", { bulletin_unit: 0 }, "23514", "fx_rates_unit_chk");
    await rejectsRate("TCMB dışı kaynak reddedilir", { source: "ecb" }, "23514", "fx_rates_source_chk");
    await rejectsRate("aynı (para birimi, bülten tarihi) ikinci kez yazılamaz", {}, "23505");
    // Başka bir GÜN aynı para birimi için yazılabilir: tekillik gün başınadır.
    await insertRate({ bulletin_date: "2026-10-01" });
    await insertRate({ currency: "USD" });
    check("tekillik gün + para birimi başına", (await rows("SELECT count(*)::int AS n FROM fx_rates"))[0].n, 3);
    await client.query("ROLLBACK");

    // ─── Geri alma: ÖDENMİŞ teklifte kur kanıtı varsa REDDEDER ──────────────
    //
    // Sarmalayıcı işlem YOK ve olmamalı: `refusesDown` down'ı psql gibi ifade
    // ifade uyguluyor, retten sonraki okumalar KALICI durumu görüyor.
    const paid = await insertQuote({ fx_snapshot: JSON.stringify(snapshot) });
    await client.query("UPDATE quotes SET order_id = $2 WHERE id = $1", [paid.id, orderId]);
    await refusesDown("siparişe dönmüş teklifin kur kanıtı geri almayı REDDETTİRİR");

    // Ret FAZLA GENİŞ değil: siparişe dönmemiş teklifin snapshot'ı kayıplı düşer.
    await client.query("UPDATE quotes SET order_id = NULL WHERE id = $1", [paid.id]);
    ok("ödenmemiş teklifin snapshot'ı yerinde", (await rows("SELECT fx_snapshot FROM quotes WHERE id = $1", [paid.id]))[0].fx_snapshot !== null);

    // ─── DOWN: tam ve idempotent ────────────────────────────────────────────
    const firstDown = await applyLikePsql(downStatements);
    assert.equal(firstDown, undefined, `ödenmemiş snapshot ile down hatasız koşmalı: ${String(firstDown)}`);
    const secondDown = await applyLikePsql(downStatements);
    assert.equal(secondDown, undefined, `down ikinci kez de hatasız koşmalı: ${String(secondDown)}`);
    ok("down fx_rates tablosunu düşürür", !(await tableExists("fx_rates")));
    ok("down quotes.fx_snapshot kolonunu düşürür", !(await columnExists("quotes", "fx_snapshot")));
    check("down yalnız KENDİ journal satırını siler",
      (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
      ["0064", "later"]);
    check("down teklif satırına DOKUNMAZ",
      (await rows("SELECT count(*)::int AS n FROM quotes"))[0].n, 1);

    // ─── Tur: up → down → up ────────────────────────────────────────────────
    await client.query(up);
    ok("down sonrası up fx_rates'i yeniden kurar", await tableExists("fx_rates"));
    ok("down sonrası up kolonu yeniden ekler", await columnExists("quotes", "fx_snapshot"));
    check("tur sonunda dört CHECK yine yerinde", Object.keys(await checkConstraints("fx_rates")),
      ["fx_rates_currency_chk", "fx_rates_rate_chk", "fx_rates_source_chk", "fx_rates_unit_chk"]);
    await insertRate();
    check("tur sonunda kur satırı yine yazılabilir", (await rows("SELECT count(*)::int AS n FROM fx_rates"))[0].n, 1);
    // Kolon geri geldiğinde snapshot'ın kendisi NULL'dur: down kayıplıydı ve
    // dosya bunu `\copy` yedek tarifiyle söylüyor.
    check("geri gelen kolon boştur (down KAYIPLIYDI)",
      (await rows("SELECT fx_snapshot FROM quotes"))[0].fx_snapshot, null);
    ok("down dosyası kayıp için `\\copy` yedek tarifi taşıyor",
      /\\copy \(SELECT[^\n]*fx_snapshot/.test(fs.readFileSync(downPath, "utf8")));

    console.log(`${checks} fx migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(() => {});
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
