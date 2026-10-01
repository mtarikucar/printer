/**
 * 0072'nin GERÇEK DDL'i, tek kullanımlık bir QA şemasında.
 *
 * Şema 0064'ün up'ıyla kurulur — `quotes`ı yaratan tek dosya odur — sonra 0072
 * uygulanır. Kanıtlanan şey şema METNİ değil, veritabanının DAVRANIŞIdır: dört
 * takım tablosu ve `quotes.team_id` gerçekten kuruldu mu, "bir kullanıcı tek
 * takımda" ve "takım başına tek sahip" kuralları bozuk satırı reddediyor mu,
 * anonim teklife takım yazılabiliyor mu (yazılamamalı), ve geri alma MÜŞTERİ
 * VERİSİYLE karşılaşınca duruyor mu.
 *
 * `scripts/test-quote-migration-db.ts` GENİŞLETİLMEZ: o betik 0064'e çivili
 * (tohum sayımları, sahip olunan tablo listesi). Depo deseni migration başına
 * ayrı betiktir; bu dosyanın şablonu `scripts/test-fx-migration-db.ts`tir
 * (en yeni ikiz ve şekli aynı: yeni tablo + `quotes`a yeni kolon).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import {
  TEAM_ACTIONS,
  TEAM_INVITE_ROLES,
  TEAM_ROLES,
} from "../src/lib/config/quote-team";

const root = path.resolve(import.meta.dirname, "..");
const tag = "0072_customer_teams";
/** `quotes`ı yaratan tek migration; 0072 ona bir kolon ekler. */
const baseTag = "0064_instant_quotes";
/** Kayıt defterinin BAĞLADIĞI değerler (migration-flag-registry.md · T · ekip). */
const WHEN = 1790794400000;
/** Üretimde uygulanmış en yeni migration (0067). Migrator tek satır okur. */
const PRODUCTION_WATERMARK = 1790693512063;

const upPath = path.join(root, "drizzle", `${tag}.sql`);
const downPath = path.join(root, "drizzle", `${tag}.down.sql`);
assert.ok(
  fs.existsSync(upPath) && fs.existsSync(downPath),
  "0072 requires executable up/down artifacts"
);
const raw = process.env.QA_QUOTE_DB_URL;
if (!raw) throw new Error("Explicit QA_QUOTE_DB_URL is required");
const url = new URL(raw);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa" || url.search) {
  throw new Error("Only 127.0.0.1:55433/printer_qa without connection options is allowed");
}
const ns = `team_migration_${randomUUID().replaceAll("-", "")}`;
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
const fxEntry = journalEntry("0071_fx_rates");
/**
 * `public.` ÖNEKİ ŞART: yalıtım buradan geliyor. 0072'nin SQL'i tabloları
 * açıkça `public.` diye adlandırdığı için tek kullanımlık şemaya çevrilebilir;
 * önek yazılmazsa bu test QA'nın GERÇEK şemasına yazardı.
 */
const qualify = (sql: string) => sql.replaceAll('"public".', `"${ns}".`)
  .replaceAll("public.", `${ns}.`).replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);
const baseUp = qualify(fs.readFileSync(path.join(root, "drizzle", `${baseTag}.sql`), "utf8"));
const up = qualify(fs.readFileSync(upPath, "utf8"));
const down = qualify(fs.readFileSync(downPath, "utf8"));
const upText = fs.readFileSync(upPath, "utf8");
const downText = fs.readFileSync(downPath, "utf8");

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
 * (`scripts/test-fx-migration-db.ts` ile aynı ayrıştırıcı.)
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
/** Tablodaki CHECK kısıtlarının ADLARI (pg_constraint'ten, şema metninden değil). */
async function checkNames(table: string): Promise<string[]> {
  return (await rows(
    `SELECT c.conname AS name FROM pg_constraint c
      WHERE c.conrelid = to_regclass($1) AND c.contype = 'c' ORDER BY c.conname`,
    [`${ns}.${table}`],
  )).map((r) => r.name as string);
}
async function indexes(table: string): Promise<Array<{ name: string; unique: boolean }>> {
  return (await rows(
    `SELECT i.relname AS name, x.indisunique AS unique FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = to_regclass($1) AND NOT x.indisprimary ORDER BY i.relname`,
    [`${ns}.${table}`],
  )).map((r) => ({ name: r.name as string, unique: r.unique as boolean }));
}
async function foreignKeyNames(table: string): Promise<string[]> {
  return (await rows(
    `SELECT c.conname AS name FROM pg_constraint c
      WHERE c.conrelid = to_regclass($1) AND c.contype = 'f' ORDER BY c.conname`,
    [`${ns}.${table}`],
  )).map((r) => r.name as string);
}

const TEAM_TABLES = [
  "customer_teams",
  "customer_team_members",
  "customer_team_invites",
  "customer_team_actions",
] as const;

async function insertUser(): Promise<string> {
  const id = randomUUID();
  await client.query("INSERT INTO users(id) VALUES($1)", [id]);
  return id;
}
async function insertTeam(ownerUserId: string, overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    name: "Acme Mühendislik",
    owner_user_id: ownerUserId,
    kvkk_notice_version: "takim-v1",
    ...overrides,
  };
  const keys = Object.keys(data);
  return (await client.query(
    `INSERT INTO customer_teams (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function insertMember(overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = { role: "member", ...overrides };
  const keys = Object.keys(data);
  return (await client.query(
    `INSERT INTO customer_team_members (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
async function insertInvite(overrides: Record<string, unknown>) {
  const data: Record<string, unknown> = {
    email: "ali@example.com",
    role: "member",
    token_hash: randomUUID(),
    expires_at: new Date(Date.now() + 7 * 86400000),
    ...overrides,
  };
  const keys = Object.keys(data);
  return (await client.query(
    `INSERT INTO customer_team_invites (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
    Object.values(data),
  )).rows[0];
}
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
/** Bir INSERT'in BELLİ bir kısıtla ve BELLİ bir kodla düştüğünü ölçer. */
async function rejects(
  name: string,
  attempt: () => Promise<unknown>,
  code: string,
  constraint?: string
) {
  await client.query("SAVEPOINT reject_probe");
  await assert.rejects(attempt, (e: unknown) => {
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
  ok(name, failure instanceof Error && /0072 rollback refused/.test(failure.message),
    failure === undefined ? "down reddetmedi, geçti" : `beklenmeyen hata: ${String(failure)}`);
  for (const table of TEAM_TABLES) {
    ok(`${name} — ${table} YERİNDE kalır`, await tableExists(table));
  }
  ok(`${name} — quotes.team_id kolonu YERİNDE kalır`, await columnExists("quotes", "team_id"));
  check(`${name} — journal satırı yerinde kalır`,
    (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
    ["0064", "0071", "0072", "later"]);
}

// ─── Numara ve `when` kayıt defterinden gelir, tahminle yazılmaz ────────────
check("journal girdisi kayıt defterinin sayılarını taşır", [entry.idx, entry.when, entry.version], [72, WHEN, "7"]);
ok("0072'nin `when`i üretim watermark'ının ÜSTÜNDE", entry.when > PRODUCTION_WATERMARK,
  `${entry.when} <= ${PRODUCTION_WATERMARK}: migrate 0072'yi sessizce atlar ve takım tabloları üretimde eksik kalır`);
ok("0072'nin `when`i 0071'in ÜSTÜNDE", entry.when > fxEntry.when, `${entry.when} <= ${fxEntry.when}`);
// Girdi DİZİDE de 0071'den sonra, 0073'ten ÖNCE durur: `drizzle-kit migrate`
// journal'ı DİZİ SIRASINDA uyguluyor ve watermark'ı TEK okuyor (dialect.cjs:
// "order by created_at desc limit 1"), yani dizi sırası ile `when` sırası
// AYRIŞIRSA kısmi bir sevkiyat 0072'yi sonsuza dek atlanabilir hâle getirir.
const positions = journal.entries.map((e) => e.tag);
ok("journal dizisi `when` sırasıyla aynı",
  journal.entries.every((e, i) => i === 0 || journal.entries[i - 1].when < e.when),
  `dizi sırası bozuk: ${positions.join(" → ")}`);
ok("down TAM O sayıyı siler (hash ile silme yasak)",
  new RegExp(`DELETE FROM drizzle\\.__drizzle_migrations WHERE created_at = ${WHEN}\\b`).test(downText),
  "down kendi journal satırını `created_at = when` ile silmiyor");
ok("down `hash` ile silme tarifi taşımıyor", !/WHERE hash =/.test(downText));
// ─── Down YARIM uygulanamaz ─────────────────────────────────────────────────
const downTopLevel = topLevelStatements(downText);
check("down TEK üst düzey ifadedir", downTopLevel.length, 1);
ok("journal satırının silinmesi o tek `DO` bloğunun İÇİNDEdir",
  /^DO \$\$[\s\S]*DELETE FROM drizzle\.__drizzle_migrations[\s\S]*\$\$$/.test(downTopLevel[0] ?? ""),
  `üst düzey ifade beklenen DO bloğu değil: ${(downTopLevel[0] ?? "").slice(0, 120)}`);
// ─── Kapalı listeler tip sözleşmesinden gelir ───────────────────────────────
ok("up rol listesini `TEAM_ROLES` ile birebir yazar",
  upText.includes(`IN (${TEAM_ROLES.map((r) => `'${r}'`).join(", ")})`),
  "up'taki rol CHECK listesi TEAM_ROLES ile aynı değil");
ok("up davet rolü listesini `TEAM_INVITE_ROLES` ile birebir yazar ('owner' YOK)",
  upText.includes(`IN (${TEAM_INVITE_ROLES.map((r) => `'${r}'`).join(", ")})`),
  "up'taki davet rolü CHECK listesi TEAM_INVITE_ROLES ile aynı değil");
ok("up eylem listesini `TEAM_ACTIONS` ile birebir yazar",
  upText.includes(`IN (${TEAM_ACTIONS.map((a) => `'${a}'`).join(", ")})`),
  "up'taki eylem CHECK listesi TEAM_ACTIONS ile aynı değil");
const schemaText = fs.readFileSync(path.join(root, "src/lib/db/schema.ts"), "utf8");
ok("schema.ts altı CHECK'i de adıyla tanımlar",
  [
    "customer_teams_invoice_type_chk",
    "customer_teams_tax_id_type_chk",
    "customer_team_members_role_chk",
    "customer_team_invites_role_chk",
    "customer_team_actions_action_chk",
    "quotes_team_requires_user_chk",
  ].every((name) => new RegExp(`check\\(\\s*"${name}"`).test(schemaText)),
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
    await client.query("CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)");
    // 'later' satırı tuzağı kurar: "en yenisini sil" tarifi ONU silerdi.
    await client.query(
      "INSERT INTO __drizzle_migrations(hash,created_at) VALUES('0064',$1),('0071',$2),('0072',$3),('later',$4)",
      [baseEntry.when, fxEntry.when, WHEN, WHEN + 1],
    );
    await client.query(baseUp);
    for (const table of TEAM_TABLES) {
      ok(`0064'te ${table} YOK`, !(await tableExists(table)));
    }
    ok("0064'te quotes.team_id YOK", !(await columnExists("quotes", "team_id")));

    // ─── UP: tam ve idempotent ──────────────────────────────────────────────
    await client.query(up); await client.query(up);
    for (const table of TEAM_TABLES) {
      ok(`up iki kez koşabilir ve ${table}'i kurar`, await tableExists(table));
    }
    ok("up quotes.team_id kolonunu ekler", await columnExists("quotes", "team_id"));
    check("üyelik tablosunda dört indeks (üçü tekil)", await indexes("customer_team_members"), [
      { name: "customer_team_members_one_owner_idx", unique: true },
      { name: "customer_team_members_team_idx", unique: false },
      { name: "customer_team_members_team_user_uq", unique: true },
      { name: "customer_team_members_user_uq", unique: true },
    ]);
    check("davet tablosunda üç indeks (ikisi tekil)", await indexes("customer_team_invites"), [
      { name: "customer_team_invites_live_uq", unique: true },
      { name: "customer_team_invites_team_idx", unique: false },
      { name: "customer_team_invites_token_uq", unique: true },
    ]);
    check("takım ve denetim tablosu indeks taşımaz (`quote_admin_actions` emsali)",
      [...(await indexes("customer_teams")), ...(await indexes("customer_team_actions"))], []);
    ok("quotes_team_idx kurulur",
      (await indexes("quotes")).some((i) => i.name === "quotes_team_idx"));
    check("CHECK'ler pg_constraint'te ADIYLA var",
      [
        ...(await checkNames("customer_teams")),
        ...(await checkNames("customer_team_members")),
        ...(await checkNames("customer_team_invites")),
        ...(await checkNames("customer_team_actions")),
      ],
      [
        "customer_teams_invoice_type_chk",
        "customer_teams_tax_id_type_chk",
        "customer_team_members_role_chk",
        "customer_team_invites_role_chk",
        "customer_team_actions_action_chk",
      ]);
    ok("quotes_team_requires_user_chk pg_constraint'te",
      (await checkNames("quotes")).includes("quotes_team_requires_user_chk"));
    ok("quotes.team_id FK'si kuruldu (restrict)",
      (await foreignKeyNames("quotes")).includes("quotes_team_id_customer_teams_id_fk"));

    // ─── Kurallar GERÇEKTEN reddediyor ──────────────────────────────────────
    await client.query("BEGIN");
    const owner = await insertUser();
    const second = await insertUser();
    const third = await insertUser();
    const teamA = await insertTeam(owner);
    const teamB = await insertTeam(second, { name: "Beta Kalıp" });
    await insertMember({ team_id: teamA.id, user_id: owner, role: "owner" });
    await insertMember({ team_id: teamA.id, user_id: second, role: "member" });
    // SAHİBİN KARARI 6.5 — DB düzeyinde: aynı kullanıcı İKİNCİ bir takıma giremez.
    await rejects(
      "aynı kullanıcı ikinci bir takıma üye olamaz",
      () => insertMember({ team_id: teamB.id, user_id: second, role: "member" }),
      "23505",
      "customer_team_members_user_uq"
    );
    // Eşzamanlı iki "sahipliği devret" çağrısından yalnız biri yazabilir.
    await rejects(
      "aynı takımda ikinci bir sahip olamaz",
      () => insertMember({ team_id: teamA.id, user_id: third, role: "owner" }),
      "23505",
      "customer_team_members_one_owner_idx"
    );
    await rejects(
      "katalog dışı rol reddedilir",
      () => insertMember({ team_id: teamB.id, user_id: third, role: "patron" }),
      "23514",
      "customer_team_members_role_chk"
    );

    const invite = await insertInvite({ team_id: teamA.id, invited_by_user_id: owner });
    await rejects(
      "aynı adrese ikinci CANLI davet çıkmaz",
      () => insertInvite({ team_id: teamA.id, invited_by_user_id: owner }),
      "23505",
      "customer_team_invites_live_uq"
    );
    await rejects(
      "davetle 'owner' rolü verilemez",
      () => insertInvite({ team_id: teamA.id, invited_by_user_id: owner, role: "owner", email: "x@example.com" }),
      "23514",
      "customer_team_invites_role_chk"
    );
    // İPTAL, YENİLEMEYİ SERBEST BIRAKIR: kısmi indeks yalnız canlı satırları kapsar.
    await client.query("UPDATE customer_team_invites SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1",
      [invite.id, owner]);
    const renewed = await insertInvite({ team_id: teamA.id, invited_by_user_id: owner });
    check("iptalden SONRA aynı adrese yeni davet geçer", renewed.email, "ali@example.com");
    await rejects(
      "aynı token iki davette olamaz",
      () => insertInvite({ team_id: teamB.id, invited_by_user_id: second, email: "y@example.com", token_hash: renewed.token_hash }),
      "23505",
      "customer_team_invites_token_uq"
    );
    await rejects(
      "katalog dışı denetim eylemi reddedilir",
      () => client.query("INSERT INTO customer_team_actions(team_id, action) VALUES($1,'drop_table')", [teamA.id]),
      "23514",
      "customer_team_actions_action_chk"
    );
    await rejects(
      "katalog dışı fatura türü reddedilir",
      () => insertTeam(third, { invoice_type: "kurumsalish" }),
      "23514",
      "customer_teams_invoice_type_chk"
    );

    // ─── ANONİM TEKLİF ASLA TAKIM TEKLİFİ OLAMAZ ────────────────────────────
    //
    // T-2'nin dal sırası argümanı BUNA dayanıyor. MUTASYON SINAVI: CHECK'i
    // up'tan çıkar → bu iddia KIRMIZI olur.
    const anonymous = await insertQuote();
    await rejects(
      "anonim teklife takım yazılamaz",
      () => client.query("UPDATE quotes SET team_id = $2 WHERE id = $1", [anonymous.id, teamA.id]),
      "23514",
      "quotes_team_requires_user_chk"
    );
    const owned = await insertQuote({ anonymous_id: null, user_id: owner, team_id: teamA.id });
    check("sahipli teklif takıma bağlanabilir", owned.team_id, teamA.id);
    await client.query("ROLLBACK");
    check("sonda hiçbir takım satırı kalmaz (probe işlemi geri sarıldı)",
      (await rows("SELECT count(*)::int AS n FROM customer_teams"))[0].n, 0);

    // ─── Geri alma: TEK BİR MÜŞTERİ SATIRI varsa DURUR ──────────────────────
    //
    // Sarmalayıcı işlem YOK ve olmamalı: `refusesDown` down'ı psql gibi ifade
    // ifade uyguluyor, retten sonraki okumalar KALICI durumu görüyor.
    const liveOwner = await insertUser();
    const liveTeam = await insertTeam(liveOwner);
    const liveMember = await insertMember({ team_id: liveTeam.id, user_id: liveOwner, role: "owner" });
    await refusesDown("üyeli bir takım geri almayı REDDETTİRİR");

    // İkinci ret koşulu AYRI bir kapıdır: tablolar BOŞ ama takıma bağlı teklif var.
    const liveQuote = await insertQuote({ anonymous_id: null, user_id: liveOwner, team_id: liveTeam.id });
    // Bu hâl üretimde FK sayesinde ULAŞILAMAZ (takım satırı silinemez). Kapı
    // yine de gerekli: tetikleyicileri kapatılmış bir geri yükleme
    // (`pg_restore --disable-triggers`) tam bu hâli kurar. Kapıyı YALITMAK için
    // FK burada test boyunca düşürülür; başarılı down kolonu FK'siyle birlikte
    // düşürüp up onu yeniden kurduğu için tur sonunda FK geri gelir (aşağıda
    // ayrıca ölçülüyor).
    await client.query("ALTER TABLE quotes DROP CONSTRAINT quotes_team_id_customer_teams_id_fk");
    await client.query("DELETE FROM customer_team_members WHERE id = $1", [liveMember.id]);
    await client.query("DELETE FROM customer_teams WHERE id = $1", [liveTeam.id]);
    check("takım tabloları boş", (await rows("SELECT count(*)::int AS n FROM customer_teams"))[0].n, 0);
    // MUTASYON SINAVI: `quotes.team_id` ret koşulunu down'dan çıkar → KIRMIZI.
    await refusesDown("takıma bağlı TEK teklif bile geri almayı REDDETTİRİR");

    // ─── DOWN: tam ve idempotent ────────────────────────────────────────────
    await client.query("UPDATE quotes SET team_id = NULL WHERE id = $1", [liveQuote.id]);
    const firstDown = await applyLikePsql(downStatements);
    assert.equal(firstDown, undefined, `boş takım tablolarıyla down hatasız koşmalı: ${String(firstDown)}`);
    const secondDown = await applyLikePsql(downStatements);
    assert.equal(secondDown, undefined, `down ikinci kez de hatasız koşmalı: ${String(secondDown)}`);
    for (const table of TEAM_TABLES) {
      ok(`down ${table} tablosunu düşürür`, !(await tableExists(table)));
    }
    ok("down quotes.team_id kolonunu düşürür", !(await columnExists("quotes", "team_id")));
    ok("down quotes_team_idx indeksini düşürür",
      !(await indexes("quotes")).some((i) => i.name === "quotes_team_idx"));
    ok("down quotes_team_requires_user_chk kısıdını düşürür",
      !(await checkNames("quotes")).includes("quotes_team_requires_user_chk"));
    check("down yalnız KENDİ journal satırını siler",
      (await rows("SELECT hash FROM __drizzle_migrations ORDER BY created_at")).map((r) => r.hash),
      ["0064", "0071", "later"]);
    // Kalıcı tek teklif `liveQuote`tur (probe işlemi geri sarıldı): down
    // kolonu düşürür ama SATIRI silmez.
    check("down teklif satırına DOKUNMAZ",
      (await rows("SELECT id FROM quotes")).map((r) => r.id), [liveQuote.id]);

    // ─── Tur: up → down → up ────────────────────────────────────────────────
    await client.query(up);
    for (const table of TEAM_TABLES) {
      ok(`down sonrası up ${table}'i yeniden kurar`, await tableExists(table));
    }
    ok("down sonrası up kolonu yeniden ekler", await columnExists("quotes", "team_id"));
    ok("tur sonunda FK yine yerinde",
      (await foreignKeyNames("quotes")).includes("quotes_team_id_customer_teams_id_fk"));
    ok("tur sonunda anonim teklif kapısı yine kapalı",
      (await checkNames("quotes")).includes("quotes_team_requires_user_chk"));
    const turOwner = await insertUser();
    const turTeam = await insertTeam(turOwner);
    await insertMember({ team_id: turTeam.id, user_id: turOwner, role: "owner" });
    check("tur sonunda takım yine kurulabilir",
      (await rows("SELECT count(*)::int AS n FROM customer_team_members"))[0].n, 1);

    console.log(`${checks} team migration checks passed; disposable schema only`);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(() => {});
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
