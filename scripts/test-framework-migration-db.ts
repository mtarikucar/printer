/**
 * 0073'ün GERÇEK DDL'i, tek kullanımlık bir QA şemasında.
 *
 * Şema 0064'ün up'ıyla kurulur — `quotes` / `quote_parts` / `quote_admin_actions`ı
 * yaratan tek dosya odur — sonra 0073 uygulanır. Kanıtlanan şey şema METNİ
 * değil, veritabanının DAVRANIŞIdır:
 *
 *   * para değişmezi (`line_kurus = unit_kurus * quantity`) SQL düzeyinde
 *     gerçekten reddediyor mu,
 *   * "serbest bırakıldı ama klonu yok" hâli DB'de doğuyor mu,
 *   * F2'nin yarış kapısı (`quote_id` tekilliği) duruyor mu,
 *   * denetim listesi tip sözleşmesiyle aynı ve HÂLÂ kapalı mı,
 *   * `on delete restrict` kaynak teklifi gerçekten koruyor mu,
 *   * geri alma imzalanmış bir anlaşmayla karşılaşınca DURUYOR mu — ve
 *     durduğunda yarım iş bırakmıyor mu.
 *
 * `scripts/test-quote-migration-db.ts` GENİŞLETİLMEZ: o betik 0064'e çivili
 * (tohum sayımları, sahip olunan tablo listesi). Depo deseni migration başına
 * ayrı betiktir (`test-quote-step-migration-db.ts`, `test-fx-migration-db.ts`).
 *
 * Kullanıcının dev veritabanına (5432) ASLA bağlanmaz.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-framework-migration-db.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { BATCH_STATUSES, FRAMEWORK_STATUSES } from "../src/lib/config/quote-framework";
import { QUOTE_ADMIN_ACTIONS } from "../src/lib/config/quote-types";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0073_framework_orders";
/** `quotes` + `quote_admin_actions`ı yaratan tek migration. */
const baseTag = "0064_instant_quotes";
/** Kayıt defterinin BAĞLADIĞI değerler (migration-flag-registry.md · F · çerçeve). */
const WHEN = 1790798000000;
const IDX = 73;
/** Üretimde uygulanmış en yeni migration. Migrator tek satır okur. */
const PRODUCTION_WATERMARK = 1790693512063;
/** 0073 ÖNCESİ denetim listesi: down bu yediye döner. */
const ACTIONS_BEFORE_0073 = [
  "manual_price",
  "target_accept",
  "target_counter",
  "target_reject",
  "review_reject",
  "extend_expiry",
  "reopen",
];

const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(
  fs.existsSync(upPath) && fs.existsSync(downPath),
  "0073 requires executable up/down artifacts"
);
const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `framework_migration_${randomUUID().replaceAll("-", "")}`;
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
 * `public.` ÖNEKİ ŞART: yalıtım buradan geliyor. 0073'ün SQL'i her tabloyu
 * açıkça `public.<tablo>` diye adlandırdığı için tek kullanımlık şemaya
 * çevrilebilir; önek olmasaydı test QA'nın GERÇEK şemasına yazardı.
 */
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const upRaw = fs.readFileSync(upPath, "utf8");
const downRaw = fs.readFileSync(downPath, "utf8");
const baseUp = qualify(fs.readFileSync(path.join(root, "drizzle", `${baseTag}.sql`), "utf8"));
const up = qualify(upRaw);
const down = qualify(downRaw);

const FRAMEWORKS = `${ns}.quote_frameworks`;
const BATCHES = `${ns}.quote_framework_batches`;
const LINES = `${ns}.quote_framework_batch_lines`;
const ADMIN_ACTIONS = `${ns}.quote_admin_actions`;

/** up'ın kurduğu indeksler — tablo başına, adıyla. */
const EXPECTED_INDEXES: Record<string, string[]> = {
  quote_frameworks: [
    "quote_frameworks_mfg_idx",
    "quote_frameworks_quote_id_uq",
    "quote_frameworks_status_idx",
    "quote_frameworks_user_idx",
  ],
  quote_framework_batches: [
    "quote_framework_batches_draft_id_uq",
    "quote_framework_batches_fw_pos_uq",
    "quote_framework_batches_order_id_uq",
    "quote_framework_batches_plan_idx",
    "quote_framework_batches_quote_id_uq",
  ],
  quote_framework_batch_lines: [
    "quote_framework_batch_lines_batch_part_uq",
    "quote_framework_batch_lines_fw_part_idx",
  ],
};
/** up'ın kurduğu adlandırılmış CHECK'ler. */
const EXPECTED_CHECKS: Record<string, string[]> = {
  quote_frameworks: [
    "quote_frameworks_lead_tier_chk",
    "quote_frameworks_status_chk",
    "quote_frameworks_total_chk",
    "quote_frameworks_units_chk",
  ],
  quote_framework_batches: [
    "quote_framework_batches_amount_chk",
    "quote_framework_batches_position_chk",
    "quote_framework_batches_released_chk",
    "quote_framework_batches_status_chk",
    "quote_framework_batches_units_chk",
  ],
  quote_framework_batch_lines: [
    "quote_framework_batch_lines_line_chk",
    "quote_framework_batch_lines_qty_chk",
    "quote_framework_batch_lines_unit_chk",
  ],
};
/** up'ın kurduğu adlandırılmış UNIQUE kısıtları (indeks DEĞİL, kısıt). */
const EXPECTED_UNIQUES: Record<string, string[]> = {
  quote_frameworks: ["quote_frameworks_number_unique", "quote_frameworks_seq_unique"],
  // Bileşik FK'nin HEDEFİ. `id` birincil anahtar olduğu için mantıksal olarak
  // bedava; yazılması ZORUNLU, çünkü Postgres bileşik bir FK'yi ancak hedef
  // kolonları tekil bir kısıt/indeks kapsıyorsa kabul eder.
  quote_framework_batches: ["quote_framework_batches_id_framework_id_unique"],
  quote_framework_batch_lines: [],
};
/**
 * up'ın kurduğu FK'ler: adı → veritabanındaki TANIMI (`pg_get_constraintdef`).
 * Ad YETMEZ, hedef de pinlenir — kolon ya da hedef kayması adı değiştirmez ve
 * bu dosyanın konusu tam olarak bir FK'nin HEDEFİ. Hepsi `restrict` olmak
 * ZORUNDA: anlaşma bir sözleşmedir, öksüz kalmaz. Anahtarlar ALFABETİK, çünkü
 * ad listesi veritabanının sıralı çıktısıyla karşılaştırılıyor.
 */
const EXPECTED_FKS: Record<string, Record<string, string>> = {
  quote_frameworks: {
    quote_frameworks_preferred_manufacturer_id_manufacturers_id_fk:
      "FOREIGN KEY (preferred_manufacturer_id) REFERENCES manufacturers(id) ON DELETE RESTRICT",
    quote_frameworks_quote_id_quotes_id_fk:
      "FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE RESTRICT",
    quote_frameworks_user_id_users_id_fk:
      "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT",
  },
  quote_framework_batches: {
    quote_framework_batches_draft_id_order_drafts_id_fk:
      "FOREIGN KEY (draft_id) REFERENCES order_drafts(id) ON DELETE RESTRICT",
    quote_framework_batches_framework_id_quote_frameworks_id_fk:
      "FOREIGN KEY (framework_id) REFERENCES quote_frameworks(id) ON DELETE RESTRICT",
    quote_framework_batches_order_id_orders_id_fk:
      "FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT",
    quote_framework_batches_quote_id_quotes_id_fk:
      "FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE RESTRICT",
  },
  quote_framework_batch_lines: {
    // PARA OKUMASININ KAPISI: satırın çerçevesi, satırın PARTİSİNİN
    // çerçevesidir. Tek kolonluk bir `framework_id` → `quote_frameworks(id)`
    // FK'si bunu söylemiyordu — satır, partisinin ait OLMADIĞI bir çerçeveyi
    // iddia edebiliyor ve parça başına döküm
    // (`quote_framework_batch_lines_fw_part_idx` üzerinden okunan) sessizce
    // kayıyordu.
    quote_framework_batch_lines_batch_framework_fk:
      "FOREIGN KEY (batch_id, framework_id) REFERENCES quote_framework_batches(id, framework_id) ON DELETE RESTRICT",
    quote_framework_batch_lines_batch_id_fk:
      "FOREIGN KEY (batch_id) REFERENCES quote_framework_batches(id) ON DELETE RESTRICT",
  },
};

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
 * alıntılı tanımlayıcı ve yorumların İÇİ sayılmaz.
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
 * `psql -f` gibi uygular: her ÜST DÜZEY ifade KENDİ işleminde koşar — psql
 * (`-1` olmadan) tam olarak böyle davranır ve down'ın TEK uygulama yolu odur.
 * Sarmalayıcı bir işlem ya da savepoint YOK: çağrıdan sonra okunan şey geri
 * sarılmış değil KALICI olandır.
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
async function tableExists(relation: string): Promise<boolean> {
  const found = await rows("SELECT to_regclass($1) IS NOT NULL AS present", [relation]);
  return found[0]!.present === true;
}
async function constraintNames(relation: string, type: string): Promise<string[]> {
  return (await rows(
    "SELECT conname FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype = $2 ORDER BY conname",
    [relation, type],
  )).map((r) => r.conname as string);
}
async function indexNames(table: string): Promise<string[]> {
  return (await rows(
    "SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname NOT LIKE '%_pkey' AND indexname NOT LIKE '%_unique' ORDER BY indexname",
    [ns, table],
  )).map((r) => r.indexname as string);
}
/** Kısıdın veritabanındaki İFADESİ; kısıt yoksa null. */
async function constraintDef(relation: string, name: string): Promise<string | null> {
  const found = await rows(
    "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = to_regclass($1) AND c.conname = $2",
    [relation, name],
  );
  return found.length === 0 ? null : (found[0].def as string);
}
/** Denetim CHECK'inin listesini ifadeden geri okur. */
async function adminActionsInDb(): Promise<string[]> {
  const def = await constraintDef(ADMIN_ACTIONS, "quote_admin_actions_action_chk");
  assert.ok(def, "quote_admin_actions_action_chk kısıdı yok");
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
}
async function insertQuote(): Promise<{ id: string }> {
  return (await client.query(
    "INSERT INTO quotes (anonymous_id, pricing_snapshot, expires_at) VALUES ('anon-fixture', '{\"version\":1}'::jsonb, now() + interval '30 days') RETURNING id",
  )).rows[0];
}
async function insertUser(): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO ${ns}.users (id) VALUES ($1)`, [id]);
  return id;
}
function frameworkColumns(overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    lead_tier: "standard",
    parts_snapshot: JSON.stringify([{ partId: randomUUID(), quantity: 100 }]),
    pricing_snapshot: JSON.stringify({ version: 1 }),
    committed_units: 100,
    committed_total_kurus: 1_250_000,
    price_locked_until: new Date("2027-01-31T00:00:00Z").toISOString(),
    shipping_address: JSON.stringify({ il: "İstanbul" }),
    ...overrides,
  };
  const keys = Object.keys(data);
  return {
    sql: `INSERT INTO quote_frameworks (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, number, status`,
    params: Object.values(data),
  };
}
async function insertFramework(overrides: Record<string, unknown>) {
  const { sql, params } = frameworkColumns(overrides);
  return (await client.query(sql, params)).rows[0] as { id: string; number: string; status: string };
}
function batchColumns(overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    position: 1,
    planned_ship_date: "2026-11-16",
    units: 100,
    amount_kurus: 1_250_000,
    ...overrides,
  };
  const keys = Object.keys(data);
  return {
    sql: `INSERT INTO quote_framework_batches (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id, status`,
    params: Object.values(data),
  };
}
async function insertBatch(overrides: Record<string, unknown>) {
  const { sql, params } = batchColumns(overrides);
  return (await client.query(sql, params)).rows[0] as { id: string; status: string };
}
function lineColumns(overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    part_id: randomUUID(),
    position: 1,
    quantity: 100,
    unit_kurus: 12_500,
    line_kurus: 1_250_000,
    ...overrides,
  };
  const keys = Object.keys(data);
  return {
    sql: `INSERT INTO quote_framework_batch_lines (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`,
    params: Object.values(data),
  };
}
/** Yazımın beklenen kodla (ve varsa kısıt adıyla) reddedildiğini gösterir. */
async function rejects(
  name: string,
  statement: { sql: string; params: unknown[] },
  expected: { code: string; constraint?: string },
) {
  // Sonda KENDİ işleminde koşar ve geri sarılır: reddedilen bir yazım hiçbir
  // satır bırakmaz, kurgunun kalanı (autocommit ile yazılmış) yerinde kalır.
  await client.query("BEGIN");
  try {
    await assert.rejects(
      client.query(statement.sql, statement.params),
      (e: unknown) => {
        const err = e as { code?: string; constraint?: string };
        if (err.code !== expected.code) return false;
        return expected.constraint === undefined || err.constraint === expected.constraint;
      },
      name,
    );
  } finally {
    await client.query("ROLLBACK");
  }
  checks++; console.log(`PASS ${name}`);
}
/** Üç tablo + denetim CHECK'i AYNEN yerinde mi (ret yarım iş bırakmadı mı)? */
async function schemaIntact(label: string) {
  for (const relation of [FRAMEWORKS, BATCHES, LINES]) {
    ok(`${label} — ${relation.split(".")[1]} YERİNDE kalır`, await tableExists(relation));
  }
  check(`${label} — denetim listesi GENİŞ kalır`, await adminActionsInDb(), [...QUOTE_ADMIN_ACTIONS]);
  check(
    `${label} — journal satırı yerinde kalır`,
    (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
    ["0064", "0073", "later"],
  );
}
/** Geri alma DURUR — ve durduğunda GERÇEKTEN hiçbir şey kalıcı olmaz. */
async function refusesDown(label: string, expected: RegExp) {
  const failure = await applyLikePsql(downStatements);
  ok(
    label,
    failure instanceof Error && expected.test(failure.message),
    failure === undefined ? "down reddetmedi, geçti" : `beklenmeyen hata: ${String(failure)}`,
  );
  await schemaIntact(label);
}

// ─── Kaynak tarafı: şema, tip sözleşmesi ve kayıt defteri AYNI şeyi söylüyor mu ─
//
// Tip sözleşmesi genişletilip migration yazılmazsa (ya da tersi) uygulama
// katalog dışı bir değer yazmaya kalkar ve veritabanı 23514 ile reddeder: boş
// gövdeli 500. Aşağısı o ayrışmayı kaynak üzerinden yakalar; davranış kanıtı
// veritabanı bölümünde.
check("denetim listesi 15 değer taşır", QUOTE_ADMIN_ACTIONS.length, 15);
ok(
  "up'ın denetim CHECK'i tip sözleşmesiyle BİREBİR aynı",
  upRaw.includes(`action IN (${QUOTE_ADMIN_ACTIONS.map((a) => `'${a}'`).join(", ")})`),
  "up'taki liste QUOTE_ADMIN_ACTIONS ile aynı değil",
);
ok(
  "down'ın geri kurduğu CHECK 0073 ÖNCESİ yedi değer",
  downRaw.includes(`action IN (${ACTIONS_BEFORE_0073.map((a) => `'${a}'`).join(", ")})`),
  "down eski listeyi aynen geri kurmuyor",
);
for (const [label, values] of [
  ["çerçeve durumları", FRAMEWORK_STATUSES],
  ["parti durumları", BATCH_STATUSES],
] as const) {
  ok(
    `up'ın ${label} listesi tip sözleşmesiyle BİREBİR aynı`,
    upRaw.includes(values.map((v) => `'${v}'`).join(", ")),
    `up'taki liste ${label} ile aynı değil`,
  );
}
check(
  "0073'ün HER FK'si `on delete restrict` (anlaşma bir SÖZLEŞMEDİR, öksüz kalmaz)",
  Object.values(EXPECTED_FKS)
    .flatMap((table) => Object.entries(table))
    .filter(([, def]) => !def.endsWith("ON DELETE RESTRICT"))
    .map(([name]) => name),
  [],
);
const schemaSrc = fs.readFileSync(path.join(root, "src/lib/db/schema.ts"), "utf8");
for (const constraint of Object.values(EXPECTED_CHECKS).flat()) {
  ok(
    `schema.ts ${constraint} kısıdını adıyla tanımlar`,
    new RegExp(`check\\(\\s*"${constraint}"`).test(schemaSrc),
    `schema.ts'te ${constraint} yok — drizzle-kit bir sonraki turda kısıdı düşürür`,
  );
}
// `quote_frameworks`ın iki tekili kolon düzeyindeki `.unique()`ten doğuyor ve
// adlarını drizzle türetiyor; bileşik olan ADIYLA yazılmak ZORUNDA (hedef
// kolonları tekil bir kısıt kapsamazsa bileşik FK hiç kurulamaz).
ok(
  "schema.ts quote_framework_batches_id_framework_id_unique kısıdını adıyla tanımlar",
  /unique\(\s*"quote_framework_batches_id_framework_id_unique"\s*\)\.on\(t\.id, t\.frameworkId\)/.test(schemaSrc),
  "schema.ts'te bileşik tekil kısıt yok — drizzle-kit bir sonraki turda onu düşürür ve bileşik FK'yi de alır",
);
ok(
  "schema.ts bileşik FK'yi (batch_id, framework_id) adıyla tanımlar",
  /name: "quote_framework_batch_lines_batch_framework_fk",\s*columns: \[t\.batchId, t\.frameworkId\]/.test(schemaSrc),
  "schema.ts'te bileşik FK yok — drizzle-kit bir sonraki turda kısıdı düşürür",
);
ok(
  "schema.ts'te `framework_id` ARTIK tek kolonluk bir FK taşımaz",
  !/frameworkId: uuid\("framework_id"\)\.notNull\(\)\.references\(\(\) => quoteFrameworks\.id/.test(
    schemaSrc.slice(schemaSrc.indexOf('pgTable("quote_framework_batch_lines"')),
  ),
  "batch_lines.framework_id hâlâ `quote_frameworks`a BAĞIMSIZ bir FK ile bağlı",
);
/**
 * 0073'ün ADLANDIRDIĞI her kısıt/indeks. Postgres kimlikleri 63 BAYTA SESSİZCE
 * kırpar; kırpılmış ad up'taki `conname = '<tam ad>'` kontrolüyle hiç eşleşmez
 * ve up İKİNCİ koşuda kısıdı yeniden eklemeye kalkıp "already exists" ile
 * düşer. 0061'de duran latent hata tam budur:
 * `gift_credit_returns_refund_allocation_id_order_refund_allocations_id_fk`
 * 71 karakter. Yeni kısıtlar da aynı özeni görmek ZORUNDA.
 */
const namedIdentifiers = [upRaw, downRaw].flatMap((sql) => [
  ...sql.matchAll(/(?:ADD\s+)?CONSTRAINT\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?"?([a-z0-9_]+)"?/g),
  ...sql.matchAll(/conname\s*=\s*'([a-z0-9_]+)'/g),
  ...sql.matchAll(/INDEX\s+IF\s+NOT\s+EXISTS\s+"([a-z0-9_]+)"/g),
]).map((m) => m[1]!);
ok("0073 kısıt/indeks adlarını açıkça yazar", namedIdentifiers.length >= 25, `${namedIdentifiers.length} ad bulundu`);
check(
  "0073'ün adlandırdığı hiçbir kısıt/indeks 63 BAYTI aşmaz",
  namedIdentifiers.filter((name) => Buffer.byteLength(name, "utf8") > 63).sort(),
  [],
);
check("journal girdisi kayıt defterinin sayılarını taşır", [entry.idx, entry.when, entry.version], [IDX, WHEN, "7"]);
ok("0073'ün `when`i üretim watermark'ının ÜSTÜNDE", entry.when > PRODUCTION_WATERMARK,
  `${entry.when} <= ${PRODUCTION_WATERMARK}: migrate 0073'ü sessizce atlar`);
// Migrator journal'ı DİZİ SIRASINDA uygular ama tek bir `max(created_at)`
// işaretine bakar: `when` değerleri `idx` ile birlikte ARTMAK zorunda.
const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
for (let i = 1; i < ordered.length; i++) {
  assert.ok(
    ordered[i]!.when > ordered[i - 1]!.when,
    `journal \`when\` sırası bozuk: ${ordered[i]!.tag} (${ordered[i]!.when}) > ${ordered[i - 1]!.tag} (${ordered[i - 1]!.when}) olmalı`,
  );
}
ok("journal'da `when` değerleri `idx` ile artmaya devam eder", true);
ok(
  "down TAM O sayıyı siler (hash ile silme YASAK)",
  new RegExp(`DELETE FROM drizzle\\.__drizzle_migrations WHERE created_at = ${WHEN}\\b`).test(downRaw),
  "down kendi journal satırını `when` ile silmiyor",
);
ok("down `hash` ile silmiyor", !/WHERE hash =/.test(downRaw));
// Down'ın tek uygulama yolu `psql -f` ve psql her ÜST DÜZEY ifadeyi KENDİ
// işleminde koşar: dosya tek bir `DO` bloğu olduğu sürece ret (RAISE EXCEPTION)
// her şeyi geri sarar. Journal `DELETE`i bloğun DIŞINA çıkarsa yarım uygulama
// mümkün olur — tablolar düşer ama kayıt durur ya da tersi.
const downTopLevel = topLevelStatements(downRaw);
check("down TEK üst düzey ifadedir", downTopLevel.length, 1);
ok(
  "journal satırının silinmesi o tek `DO` bloğunun İÇİNDEdir",
  /^DO \$\$[\s\S]*DELETE FROM drizzle\.__drizzle_migrations[\s\S]*\$\$$/.test(downTopLevel[0] ?? ""),
  `üst düzey ifade beklenen DO bloğu değil: ${(downTopLevel[0] ?? "").slice(0, 120)}`,
);
// Veri ifadesi YOK: 0073 hiçbir satır yazmaz. `test-quote-service-db.ts`in
// tohum eşitlik testi 64'ten yeni her migration'ın veri ifadelerini de
// uyguluyor; 0073 hiç satır yazmadığı için kendiliğinden geçer. Ölçü
// `INSERT INTO` / satır başındaki `UPDATE`: FK'lerin `ON UPDATE no action`
// ibaresi bir veri ifadesi DEĞİLDİR.
const upStatements = topLevelStatements(upRaw);
check(
  "up hiçbir satır YAZMAZ (INSERT/UPDATE yok)",
  upStatements.filter((s) => /\bINSERT\s+INTO\b/i.test(s) || /(^|\n)\s*UPDATE\s+/i.test(s)),
  [],
);

async function main() {
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`SET search_path TO ${ns}, pg_catalog`);
    // 0064 ve 0073 yalnız kimliklerine bakıyor; en küçük öncüller yeter.
    for (const table of ["users", "orders", "order_drafts", "manufacturers"]) {
      await client.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY)`);
    }
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    // 'later' satırı tuzağı kurar: "en yenisini sil" tarifi ONU silerdi.
    await client.query("INSERT INTO __drizzle_migrations(hash,created_at) VALUES('0064',$1),('0073',$2),('later',$3)",
      [baseEntry.when, WHEN, WHEN + 1]);
    await client.query(baseUp);
    check("0064 denetim listesini YEDİ değerle kurar", await adminActionsInDb(), ACTIONS_BEFORE_0073);
    ok("0064'te çerçeve tabloları YOK", !(await tableExists(FRAMEWORKS)));

    // ─── UP ────────────────────────────────────────────────────────────────
    await client.query(up);
    await client.query(up); // idempotent: ikinci koşu hata vermemeli
    for (const relation of [FRAMEWORKS, BATCHES, LINES]) {
      ok(`up ${relation.split(".")[1]} tablosunu kurar (iki kez koşabilir)`, await tableExists(relation));
    }
    for (const [table, expected] of Object.entries(EXPECTED_INDEXES)) {
      check(`up ${table} indekslerini kurar`, await indexNames(table), expected);
    }
    for (const [table, expected] of Object.entries(EXPECTED_CHECKS)) {
      check(`up ${table} CHECK'lerini kurar`, await constraintNames(`${ns}.${table}`, "c"), expected);
    }
    for (const [table, expected] of Object.entries(EXPECTED_UNIQUES)) {
      check(`up ${table} UNIQUE kısıtlarını kurar`, await constraintNames(`${ns}.${table}`, "u"), expected);
    }
    for (const [table, expected] of Object.entries(EXPECTED_FKS)) {
      check(`up ${table} FK'lerini kurar`, await constraintNames(`${ns}.${table}`, "f"), Object.keys(expected));
      // Ad DEĞİL, TANIM: kolonlar, hedef tablo/kolonlar ve `on delete` birlikte.
      for (const [name, def] of Object.entries(expected)) {
        check(`${name}: kolonları ve HEDEFİ`, await constraintDef(`${ns}.${table}`, name), def);
      }
    }
    check("up denetim listesini ONBEŞ değere çıkarır", await adminActionsInDb(), [...QUOTE_ADMIN_ACTIONS]);

    // ─── Numara üretimi ────────────────────────────────────────────────────
    const quote = await insertQuote();
    const userId = await insertUser();
    const first = await insertFramework({ quote_id: quote.id, user_id: userId });
    check("number C-000001 üretir", [first.number, first.status], ["C-000001", "draft"]);
    const secondQuote = await insertQuote();
    const second = await insertFramework({ quote_id: secondQuote.id, user_id: userId });
    check("number sırayla artar", second.number, "C-000002");

    // ─── Tekillikler ───────────────────────────────────────────────────────
    await rejects(
      "aynı teklif İKİNCİ kez çerçeveye dönüşemez",
      frameworkColumns({ quote_id: quote.id, user_id: userId }),
      { code: "23505" },
    );

    // ─── PARA DEĞİŞMEZİ ────────────────────────────────────────────────────
    const batch = await insertBatch({ framework_id: first.id });
    await client.query(lineColumns({ batch_id: batch.id, framework_id: first.id }).sql,
      lineColumns({ batch_id: batch.id, framework_id: first.id }).params);
    await rejects(
      "line_kurus <> unit_kurus * quantity INSERT'i 23514 ile reddedilir",
      lineColumns({ batch_id: batch.id, framework_id: first.id, line_kurus: 1_250_001 }),
      { code: "23514", constraint: "quote_framework_batch_lines_line_chk" },
    );
    await rejects(
      "adet tavanı (100000) aşılamaz",
      lineColumns({ batch_id: batch.id, framework_id: first.id, quantity: 100_001, unit_kurus: 1, line_kurus: 100_001 }),
      { code: "23514", constraint: "quote_framework_batch_lines_qty_chk" },
    );
    await rejects(
      "parti tutarı tek ödeme tavanını (₺2M) AŞAMAZ",
      batchColumns({ framework_id: first.id, position: 9, amount_kurus: 200_000_001 }),
      { code: "23514", constraint: "quote_framework_batches_amount_chk" },
    );

    // ─── SATIRIN ÇERÇEVESİ, PARTİSİNİN ÇERÇEVESİDİR ────────────────────────
    //
    // Bileşik FK `(batch_id, framework_id)` → `batches(id, framework_id)`.
    // Tek kolonluk bir `framework_id` FK'si yalnız "var olan BİR çerçeve"
    // diyordu; bileşik FK "partinin ait OLDUĞU çerçeve" diyor. Parça başına
    // döküm `(framework_id, part_id)` üzerinden okunuyor: yanlış çerçeveyi
    // iddia eden bir satır, taahhüdün ne kadarının tüketildiğini sessizce
    // kaydırırdı.
    await rejects(
      "satır, partisinin ait OLMADIĞI çerçeveyi iddia edemez (23503)",
      lineColumns({ batch_id: batch.id, framework_id: second.id }),
      { code: "23503", constraint: "quote_framework_batch_lines_batch_framework_fk" },
    );
    await rejects(
      "satırı olan parti BAŞKA çerçeveye taşınamaz (23503)",
      { sql: "UPDATE quote_framework_batches SET framework_id = $1 WHERE id = $2", params: [second.id, batch.id] },
      { code: "23503", constraint: "quote_framework_batch_lines_batch_framework_fk" },
    );
    const linesBefore = (await rows(`SELECT count(*)::int AS n FROM ${LINES}`))[0]!.n;
    const sameFramework = lineColumns({ batch_id: batch.id, framework_id: first.id, position: 2 });
    await client.query(sameFramework.sql, sameFramework.params);
    check(
      "doğru çerçeveyi taşıyan satır KABUL edilir (regresyon)",
      (await rows(`SELECT count(*)::int AS n FROM ${LINES}`))[0]!.n,
      linesBefore + 1,
    );

    // ─── "Klonsuz serbest bırakma" hâli DB'de doğmaz ───────────────────────
    await rejects(
      "status='released' + quote_id IS NULL INSERT'i reddedilir",
      batchColumns({ framework_id: first.id, position: 2, status: "released", released_at: new Date().toISOString() }),
      { code: "23514", constraint: "quote_framework_batches_released_chk" },
    );
    await rejects(
      "serbest bırakılmış parti DAMGASIZ olamaz",
      batchColumns({ framework_id: first.id, position: 2, status: "released", quote_id: secondQuote.id }),
      { code: "23514", constraint: "quote_framework_batches_released_chk" },
    );
    const released = await insertBatch({
      framework_id: first.id,
      position: 2,
      status: "released",
      quote_id: secondQuote.id,
      released_at: new Date().toISOString(),
    });
    check("klonu VE damgası olan parti serbest bırakılabilir", released.status, "released");
    await rejects(
      "aynı (framework_id, position) İKİNCİ kez yazılamaz",
      batchColumns({ framework_id: first.id, position: 2 }),
      { code: "23505" },
    );
    // F2'NİN YARIŞ KAPISI: iki admin aynı partiyi bırakırsa ikinci klon burada
    // reddedilir.
    await rejects(
      "aynı klon teklif İKİNCİ bir partiye bağlanamaz",
      batchColumns({
        framework_id: first.id,
        position: 3,
        status: "released",
        quote_id: secondQuote.id,
        released_at: new Date().toISOString(),
      }),
      { code: "23505" },
    );
    await rejects(
      "parti durumu KAPALI küme: 'shipped' reddedilir",
      batchColumns({ framework_id: first.id, position: 4, status: "shipped" }),
      { code: "23514", constraint: "quote_framework_batches_status_chk" },
    );
    await rejects(
      "çerçeve durumu KAPALI küme: 'signed' reddedilir",
      frameworkColumns({ quote_id: (await insertQuote()).id, user_id: userId, status: "signed" }),
      { code: "23514", constraint: "quote_frameworks_status_chk" },
    );

    // ─── Denetim izi: mevcut tabloda, hâlâ KAPALI ──────────────────────────
    await client.query(
      "INSERT INTO quote_admin_actions (quote_id, action, admin_email, reason) VALUES ($1, 'framework_batch_release', 'admin@figurunica.com', 'parti 2 serbest bırakıldı')",
      [quote.id],
    );
    // PATCH ucunun satırı (not + çapalı atölye). Kümenin sekizinci çerçeve
    // değeri BURADA ölçülüyor: CHECK genişlemediyse servis bu INSERT'te 23514
    // yer ve gerekçe hiçbir yere yazılmaz.
    await client.query(
      "INSERT INTO quote_admin_actions (quote_id, action, admin_email, reason) VALUES ($1, 'framework_update', 'admin@figurunica.com', 'çapalı atölye değişti')",
      [quote.id],
    );
    check(
      "quote_admin_actions'a framework_batch_release ve framework_update YAZILABİLİR",
      (await rows("SELECT action FROM quote_admin_actions ORDER BY created_at")).map((r) => r.action),
      ["framework_batch_release", "framework_update"],
    );
    await rejects(
      "framework_bogus REDDEDİLİR (liste hâlâ kapalı)",
      {
        sql: "INSERT INTO quote_admin_actions (quote_id, action, admin_email, reason) VALUES ($1, 'framework_bogus', 'a@b.c', 'x')",
        params: [quote.id],
      },
      { code: "23514", constraint: "quote_admin_actions_action_chk" },
    );

    // ─── `on delete restrict` gerçekten koruyor ────────────────────────────
    await rejects(
      "anlaşma varken kaynak teklif SİLİNEMEZ (23503)",
      { sql: "DELETE FROM quotes WHERE id = $1", params: [quote.id] },
      { code: "23503" },
    );
    await rejects(
      "partisi olan anlaşma SİLİNEMEZ (23503)",
      { sql: "DELETE FROM quote_frameworks WHERE id = $1", params: [first.id] },
      { code: "23503" },
    );

    // ─── Geri alma: sözleşme verisi varsa REDDEDER ─────────────────────────
    //
    // Sarmalayıcı işlem YOK ve olmamalı: `refusesDown` down'ı psql gibi ifade
    // ifade uyguluyor, retten sonraki okumalar KALICI durumu görüyor.
    await refusesDown(
      "imzalanmış bir anlaşma geri almayı REDDETTİRİR",
      /0073 rollback refused: çerçeve anlaşma kaydı var/,
    );

    // Tablolar boşaltılsa bile denetim izi tek başına REDDETTİRİR.
    await client.query("DELETE FROM quote_framework_batch_lines");
    await client.query("DELETE FROM quote_framework_batches");
    await client.query("DELETE FROM quote_frameworks");
    check("tablolar boşaltıldı", (await rows(`SELECT count(*)::int AS n FROM ${FRAMEWORKS}`))[0]!.n, 0);
    await refusesDown(
      "YALNIZ denetim izi varken de geri alma REDDEDİLİR",
      /0073 rollback refused: çerçeve denetim izi var/,
    );

    // ─── Temizse geri alma TAM ─────────────────────────────────────────────
    await client.query("DELETE FROM quote_admin_actions WHERE action LIKE 'framework\\_%'");
    const firstDown = await applyLikePsql(downStatements);
    assert.equal(firstDown, undefined, `temiz şemada down hatasız koşmalı: ${String(firstDown)}`);
    const secondDown = await applyLikePsql(downStatements);
    assert.equal(secondDown, undefined, `down ikinci kez de hatasız koşmalı: ${String(secondDown)}`);
    for (const relation of [FRAMEWORKS, BATCHES, LINES]) {
      ok(`down ${relation.split(".")[1]} tablosunu düşürür`, !(await tableExists(relation)));
    }
    check("down denetim listesini eski YEDİ değerine döndürür", await adminActionsInDb(), ACTIONS_BEFORE_0073);
    check(
      "down yalnız KENDİ journal satırını siler",
      (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
      ["0064", "later"],
    );
    await rejects(
      "geri alma sonrası framework_batch_release REDDEDİLİR",
      {
        sql: "INSERT INTO quote_admin_actions (quote_id, action, admin_email, reason) VALUES ($1, 'framework_batch_release', 'a@b.c', 'x')",
        params: [quote.id],
      },
      { code: "23514", constraint: "quote_admin_actions_action_chk" },
    );
    check(
      "down teklifleri ve denetim satırlarını SİLMEZ",
      (await rows("SELECT count(*)::int AS n FROM quotes"))[0]!.n >= 2,
      true,
    );

    // ─── Tur: up → down → up ───────────────────────────────────────────────
    await client.query(up);
    for (const relation of [FRAMEWORKS, BATCHES, LINES]) {
      ok(`tur: up ${relation.split(".")[1]} tablosunu yeniden kurar`, await tableExists(relation));
    }
    check("tur: denetim listesi yeniden ONBEŞ değer", await adminActionsInDb(), [...QUOTE_ADMIN_ACTIONS]);
    const again = await insertFramework({ quote_id: quote.id, user_id: userId });
    ok("tur sonunda yeni anlaşma yine kurulabilir", /^C-\d{6}$/.test(again.number), again.number);

    console.log(`${checks} framework migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(() => {});
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
