/**
 * Baskı kataloğunun VERİTABANI davranışı: 0066 aralık kısıtları, yöneticinin
 * yazımıyla AYNI işlemde düşen denetim satırı ve bayat damganın 409'u.
 *
 * Neden kalıcı bir DB testi: bu üç davranışın hiçbiri saf bir testle
 * kanıtlanamaz ve üçü de PARA ile ilgilidir.
 *
 *  1. **Aralık kısıtları (0066).** Kataloğun tek yazanı zod'lu admin rotasıdır;
 *     kısıtlar savunma derinliğidir. Bir gün ikinci bir yazan çıktığında (bir
 *     betik, elle bir `UPDATE`, yeni bir uç) müşteriye çıkan fiyatı koruyan şey
 *     bu kısıtlar olacak. Kısıt SATIRLARLA sınanmazsa yazıldığı gibi
 *     çalıştığını kimse bilmez.
 *  2. **Denetim satırı.** `0064_instant_quotes.down.sql` "her katalog
 *     düzenlemesi `print_catalog_changes`e bir satır bırakır" varsayımına
 *     DAYANARAK geri almayı reddediyor. O varsayım sessizce bozulursa geri alma
 *     kapısı da sessizce açılır — yani kanıtı burada durmalı.
 *  3. **409 bayat damga.** İki sekmede açık bir katalogda ikinci kaydın
 *     birincisini EZMEDİĞİ yalnız gerçek satır kilidiyle görülür.
 *
 * Ayrıca (s) maddesinin ölçüsü burada: dört katalog GET'i artık tüm kataloğu
 * değil YALNIZ kendi dilimini sorguluyor — sorgu sayısı sayılarak iddia edilir.
 *
 * Kullanıcının dev veritabanına (5432) ASLA bağlanmaz; iki tek kullanımlık
 * şema açar ve sonunda ikisini de düşürür.
 *
 * Çalıştırma:
 *   npx tsx --env-file=<qa.env> scripts/test-quote-admin-catalog-db.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.QA_QUOTE_DB_URL;
if (!connectionString) throw new Error("QA_QUOTE_DB_URL required");
const url = new URL(connectionString);
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || url.pathname !== "/printer_qa") {
  throw new Error("Only 127.0.0.1:55433/printer_qa is allowed");
}

const root = path.resolve(import.meta.dirname, "..");
const TAG = "0066_print_catalog_checks";
/** Journal'daki `when`; 0066'nın down'ı kendi kayıt satırını bununla siler. */
const WHEN = 1790689912063;
const upPath = path.join(root, "drizzle", `${TAG}.sql`);
const downPath = path.join(root, "drizzle", `${TAG}.down.sql`);
assert.ok(fs.existsSync(upPath), `${TAG}.sql gerekli`);
assert.ok(fs.existsSync(downPath), `${TAG}.down.sql gerekli`);

const journal = JSON.parse(
  fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8")
) as { entries: Array<{ idx: number; tag: string; when: number }> };
const entry = journal.entries.find((e) => e.tag === TAG);
assert.ok(entry, `${TAG} journal girdisi gerekli`);
assert.equal(entry.when, WHEN, "0066 journal `when` değeri sözleşmedeki sayı olmalı");
// ESKİ HÂLİ "0066 en büyük `when` olmalı" diyordu ve 0070 inince KIRILDI —
// `:db` testi olduğu için `test:unit` zincirinde olmadan haftalarca kırmızı
// kalabilirdi. Asıl kural 0066'ya özel değil: migrator journal'ı DİZİ SIRASINDA
// uygular ama tek bir `max(created_at)` işaretine bakar, yani `when` değerleri
// `idx` ile birlikte ARTMAK zorundadır. Bir migration küçük bir `when` ile
// inerse `migrate` onu sessizce atlar ve "başarılı" der. Bu hâliyle iddia her
// yeni migration'da kendiliğinden geçerli kalır.
const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
for (let i = 1; i < ordered.length; i++) {
  const prev = ordered[i - 1];
  const curr = ordered[i];
  assert.ok(
    curr.when > prev.when,
    `journal \`when\` sırası bozuk: ${curr.tag} (${curr.when}) ${prev.tag} (${prev.when}) ` +
      "değerinden büyük olmalı, yoksa migrate onu sessizce atlar"
  );
}

/** Tohumun sabit kimlikleri: kısıt sondası hangi satıra dokunacağını bilsin. */
const FDM = "00000000-0000-4000-8000-000000000f01";
const PLA = "00000000-0000-4000-8000-000000000f11";
const PETG = "00000000-0000-4000-8000-000000000f12";

/** 0066'nın eklediği kısıtlar — tablo başına, adıyla. */
const EXPECTED_CONSTRAINTS: Record<string, string[]> = {
  print_technologies: [
    "print_technologies_build_mm_chk",
    "print_technologies_lead_days_chk",
    "print_technologies_money_chk",
    "print_technologies_rate_chk",
  ],
  print_materials: [
    "print_materials_density_chk",
    "print_materials_lead_days_chk",
    "print_materials_money_chk",
    "print_materials_support_factor_max_chk",
  ],
  print_finishes: ["print_finishes_lead_days_chk", "print_finishes_money_chk"],
  print_addons: ["print_addons_lead_days_chk", "print_addons_money_chk"],
  quote_pricing_settings: [
    "quote_pricing_settings_bps_chk",
    "quote_pricing_settings_days_chk",
    "quote_pricing_settings_money_chk",
  ],
};
const ALL_CONSTRAINTS = Object.values(EXPECTED_CONSTRAINTS).flat().sort();

/** Kısıdın REDDETMESİ gereken yazımlar: [ad, kısıt, SQL]. */
const REJECTED: Array<[string, string, string]> = [
  ["kurulum ücreti üst sınırın üstünde", "print_technologies_money_chk",
    `UPDATE print_technologies SET setup_fee_kurus = 10000001 WHERE id = '${FDM}'`],
  ["taban fiyat eksi", "print_technologies_money_chk",
    `UPDATE print_technologies SET min_unit_price_kurus = -1 WHERE id = '${FDM}'`],
  ["makine saati üst sınırın üstünde", "print_technologies_money_chk",
    `UPDATE print_technologies SET machine_rate_kurus_per_hour = 10000001 WHERE id = '${FDM}'`],
  ["baskı hacmi 10 mm'nin altında", "print_technologies_build_mm_chk",
    `UPDATE print_technologies SET build_x_mm = 9 WHERE id = '${FDM}'`],
  ["baskı hacmi 2000 mm'nin üstünde", "print_technologies_build_mm_chk",
    `UPDATE print_technologies SET build_z_mm = 2001 WHERE id = '${FDM}'`],
  ["debi sıfır (fiyat bölmesi sonsuza giderdi)", "print_technologies_rate_chk",
    `UPDATE print_technologies SET throughput_cm3_per_hour = 0 WHERE id = '${FDM}'`],
  ["duvar kalınlığı sıfır", "print_technologies_rate_chk",
    `UPDATE print_technologies SET min_wall_mm = 0 WHERE id = '${FDM}'`],
  ["yükseklik saati 10'un üstünde", "print_technologies_rate_chk",
    `UPDATE print_technologies SET height_hours_per_mm = 10.1 WHERE id = '${FDM}'`],
  ["temel teslim günü sıfır", "print_technologies_lead_days_chk",
    `UPDATE print_technologies SET base_lead_days = 0 WHERE id = '${FDM}'`],
  ["temel teslim günü 60'ın üstünde", "print_technologies_lead_days_chk",
    `UPDATE print_technologies SET base_lead_days = 61 WHERE id = '${FDM}'`],
  ["yoğunluk 0,5'in altında", "print_materials_density_chk",
    `UPDATE print_materials SET density_g_cm3 = 0.4 WHERE id = '${PLA}'`],
  ["yoğunluk 3'ün üstünde", "print_materials_density_chk",
    `UPDATE print_materials SET density_g_cm3 = 3.1 WHERE id = '${PLA}'`],
  ["destek çarpanı 3'ün üstünde", "print_materials_support_factor_max_chk",
    `UPDATE print_materials SET support_factor = 3.5 WHERE id = '${PLA}'`],
  ["gram fiyatı eksi", "print_materials_money_chk",
    `UPDATE print_materials SET price_kurus_per_gram = -5 WHERE id = '${PLA}'`],
  ["malzeme ek günü 60'ın üstünde", "print_materials_lead_days_chk",
    `UPDATE print_materials SET lead_days_extra = 61 WHERE id = '${PLA}'`],
  ["yüzey cm² ücreti üst sınırın üstünde", "print_finishes_money_chk",
    "UPDATE print_finishes SET per_cm2_kurus = 10000001 WHERE key = 'ham'"],
  ["yüzey ek günü eksi", "print_finishes_lead_days_chk",
    "UPDATE print_finishes SET lead_days_extra = -1 WHERE key = 'ham'"],
  ["ek hizmet fiyatı üst sınırın üstünde", "print_addons_money_chk",
    "UPDATE print_addons SET price_kurus = 10000001 WHERE key = 'rohs_beyani'"],
  ["ek hizmet günü 60'ın üstünde", "print_addons_lead_days_chk",
    "UPDATE print_addons SET lead_days_extra = 61 WHERE key = 'rohs_beyani'"],
  ["asgari sipariş tutarı eksi", "quote_pricing_settings_money_chk",
    "UPDATE quote_pricing_settings SET min_order_kurus = -1 WHERE id = 1"],
  ["otomatik üst tutar üst sınırın üstünde", "quote_pricing_settings_money_chk",
    "UPDATE quote_pricing_settings SET max_auto_total_kurus = 10000001 WHERE id = 1"],
  ["teklif geçerlilik günü sıfır", "quote_pricing_settings_days_chk",
    "UPDATE quote_pricing_settings SET quote_valid_days = 0 WHERE id = 1"],
  ["saklama günü 3650'nin üstünde", "quote_pricing_settings_days_chk",
    "UPDATE quote_pricing_settings SET retention_days_after_expiry = 3651 WHERE id = 1"],
  ["adet indirimi baz puanı 30000'in üstünde", "quote_pricing_settings_bps_chk",
    `UPDATE quote_pricing_settings SET qty_breaks = '[{"minQty":1,"discountBps":40000}]'::jsonb WHERE id = 1`],
  ["adet indirimi baz puanı eksi", "quote_pricing_settings_bps_chk",
    `UPDATE quote_pricing_settings SET qty_breaks = '[{"minQty":1,"discountBps":-1}]'::jsonb WHERE id = 1`],
  ["teslim kademesi çarpanı 30000'in üstünde", "quote_pricing_settings_bps_chk",
    `UPDATE quote_pricing_settings SET lead_tiers = '[{"key":"standard","name":"Standart","multiplierBps":40000,"daysDelta":0,"minDays":3}]'::jsonb WHERE id = 1`],
];

/**
 * Kısıdın KABUL etmesi gereken UÇ değerler.
 *
 * Kapsayıcı sınır bir ayrıntı değil: tohumun `max_auto_total_kurus` değeri
 * 10.000.000'ın TAM KENDİSİ. Sınır dışlayıcı yazılsaydı kısıt canlıdaki satırı
 * reddeder ve migration doğrulamada düşerdi.
 */
const ACCEPTED: Array<[string, string]> = [
  ["para üst sınırı kapsayıcı", `UPDATE print_technologies SET setup_fee_kurus = 10000000 WHERE id = '${FDM}'`],
  ["para sıfır olabilir", `UPDATE print_technologies SET setup_fee_kurus = 0 WHERE id = '${FDM}'`],
  ["baskı hacmi sınırları kapsayıcı", `UPDATE print_technologies SET build_x_mm = 10, build_z_mm = 2000 WHERE id = '${FDM}'`],
  ["teslim günü sınırları kapsayıcı", `UPDATE print_technologies SET base_lead_days = 60 WHERE id = '${FDM}'`],
  ["yoğunluk sınırları kapsayıcı", `UPDATE print_materials SET density_g_cm3 = 0.5 WHERE id = '${PLA}'`],
  ["destek çarpanı 3 olabilir", `UPDATE print_materials SET support_factor = 3 WHERE id = '${PLA}'`],
  ["ek gün 60 olabilir", `UPDATE print_materials SET lead_days_extra = 60 WHERE id = '${PLA}'`],
  ["baz puan 30000 olabilir", `UPDATE quote_pricing_settings SET lead_tiers = '[{"key":"express","name":"Ekspres","multiplierBps":30000,"daysDelta":-2,"minDays":2}]'::jsonb WHERE id = 1`],
  ["saklama günü 3650 olabilir", "UPDATE quote_pricing_settings SET retention_days_after_expiry = 3650 WHERE id = 1"],
];

const admin = new pg.Client({ connectionString });
const migrationNs = `catalog_checks_${randomUUID().replaceAll("-", "")}`;
const serviceNs = `catalog_service_${randomUUID().replaceAll("-", "")}`;
const ddlOut = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-checks-ddl-"));
let pool: pg.Pool | undefined;
let checks = 0;

/** Sunucunun WARNING'leri: 0066'nın "doğrulanamadı" haberi buradan okunur. */
const notices: string[] = [];
admin.on("notice", (n) => {
  if (n.message) notices.push(n.message);
});

function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log(`PASS ${name}`);
}
const test = async (name: string, run: () => Promise<void>) => {
  await run();
  checks++;
  console.log(`PASS ${name}`);
};

/** `public.` adreslerini tek kullanımlık şemaya çevirir (canlı şemaya dokunmaz). */
const qualify = (sql: string, ns: string) =>
  sql
    .replaceAll('"public".', `"${ns}".`)
    .replaceAll("public.", `${ns}.`)
    .replaceAll("drizzle.__drizzle_migrations", `${ns}.__drizzle_migrations`);

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await admin.query(sql, params)).rows as T[];
}

async function constraintNames(): Promise<string[]> {
  return (
    await rows<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND c.contype = 'c' AND c.conname = ANY($2::text[])
       ORDER BY c.conname`,
      [migrationNs, ALL_CONSTRAINTS]
    )
  ).map((r) => r.conname);
}

async function unvalidatedNames(ns: string): Promise<string[]> {
  return (
    await rows<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = $1 AND c.contype = 'c' AND NOT c.convalidated
       ORDER BY c.conname`,
      [ns]
    )
  ).map((r) => r.conname);
}

/** Kısıt tanımlarını şemadan şemaya karşılaştırmak için (0066 ⇄ schema.ts). */
async function constraintDefs(ns: string): Promise<Record<string, string>> {
  const found = await rows<{ conname: string; def: string }>(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND c.contype = 'c' AND c.conname = ANY($2::text[])`,
    [ns, ALL_CONSTRAINTS]
  );
  return Object.fromEntries(found.map((r) => [r.conname, r.def]));
}

async function seedCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of Object.keys(EXPECTED_CONSTRAINTS)) {
    out[table] = (await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n;
  }
  return out;
}

async function main() {
  await admin.connect();
  const up = qualify(fs.readFileSync(upPath, "utf8"), migrationNs);
  const down = qualify(fs.readFileSync(downPath, "utf8"), migrationNs);
  try {
    // ─── 1) Migration 0066: gerçek DDL, tek kullanımlık şema ─────────────────
    console.log("\n1) Migration 0066 — aralık kısıtları");

    await admin.query(`CREATE SCHEMA ${migrationNs}`);
    await admin.query(`SET search_path TO ${migrationNs}, pg_catalog`);
    // 0064'ün başvurduğu öncüller: yalnız kimlikleri gerekiyor.
    for (const table of ["users", "orders", "order_drafts"]) {
      await admin.query(`CREATE TABLE ${table}(id uuid PRIMARY KEY)`);
    }
    await admin.query(
      "CREATE TABLE __drizzle_migrations(id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL)"
    );
    await admin.query(
      "INSERT INTO __drizzle_migrations(hash,created_at) VALUES('prior',$1),('own',$2),('later',$3)",
      [WHEN - 1, WHEN, WHEN + 1]
    );
    await admin.query(
      qualify(fs.readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8"), migrationNs)
    );

    check("0064 tohumu yerinde", await seedCounts(), {
      print_technologies: 2,
      print_materials: 7,
      print_finishes: 5,
      print_addons: 4,
      quote_pricing_settings: 1,
    });

    await admin.query(up);
    await admin.query(up);
    check("0066 tekrar çalıştırılabilir ve her kısıdı ekler", await constraintNames(), ALL_CONSTRAINTS);
    check("uyumlu satırlarda her kısıt DOĞRULANMIŞ", await unvalidatedNames(migrationNs), []);
    check("0066 hiçbir katalog satırına dokunmaz", await seedCounts(), {
      print_technologies: 2,
      print_materials: 7,
      print_finishes: 5,
      print_addons: 4,
      quote_pricing_settings: 1,
    });

    for (const [name, constraint, sql] of REJECTED) {
      await admin.query("BEGIN");
      await assert.rejects(
        admin.query(sql),
        (e: unknown) => {
          const err = e as { code?: string; constraint?: string };
          assert.equal(err.code, "23514", `${name}: CHECK ihlali beklenir`);
          assert.equal(err.constraint, constraint, `${name}: kısıt adı`);
          return true;
        },
        name
      );
      await admin.query("ROLLBACK");
      checks++;
      console.log(`PASS reddedilir — ${name}`);
    }

    for (const [name, sql] of ACCEPTED) {
      await admin.query("BEGIN");
      await admin.query(sql);
      await admin.query("ROLLBACK");
      checks++;
      console.log(`PASS kabul edilir — ${name}`);
    }

    // ─── 2) Canlıda uyumsuz bir satır varsa 0066 DÜŞMEZ ────────────────────
    //
    // Üretimde katalog yöneticinin elindedir; kısıtları eklemeden önce satırları
    // doğrulamak gerekir. `NOT VALID` + `VALIDATE CONSTRAINT` seçildi: uyumsuz
    // satır migration'ı (ve dağıtımı) DÜŞÜRMEZ, kısıt yine de her YENİ yazımı
    // reddeder ve operatöre adıyla haber verilir.
    console.log("\n2) Uyumsuz eski satır — dağıtım düşmez, kapı yine kapalı");

    await admin.query(down);
    await admin.query(`UPDATE print_materials SET density_g_cm3 = 9 WHERE id = '${PLA}'`);
    notices.length = 0;
    await admin.query(up);
    check("uyumsuz satır kısıtları engellemez", await constraintNames(), ALL_CONSTRAINTS);
    check("yalnız ilgili kısıt doğrulanmamış kalır", await unvalidatedNames(migrationNs), [
      "print_materials_density_chk",
    ]);
    await test("operatör WARNING ile adıyla uyarılır", async () => {
      assert.ok(
        notices.some((n) => n.includes("print_materials_density_chk")),
        `WARNING beklenir, gelenler: ${JSON.stringify(notices)}`
      );
    });
    await test("doğrulanmamış kısıt YENİ yazımı yine reddeder", async () => {
      await admin.query("BEGIN");
      await assert.rejects(
        admin.query(`UPDATE print_materials SET density_g_cm3 = 9 WHERE id = '${PETG}'`),
        (e: unknown) => (e as { constraint?: string }).constraint === "print_materials_density_chk"
      );
      await admin.query("ROLLBACK");
    });
    await test("satır düzeltilince kısıt elle doğrulanabilir", async () => {
      await admin.query(`UPDATE print_materials SET density_g_cm3 = 1.24 WHERE id = '${PLA}'`);
      await admin.query(
        "ALTER TABLE print_materials VALIDATE CONSTRAINT print_materials_density_chk"
      );
      assert.deepEqual(await unvalidatedNames(migrationNs), []);
    });

    // ─── 3) Geri alma ve tur ────────────────────────────────────────────────
    console.log("\n3) Geri alma (up → down → up)");

    await admin.query(down);
    await admin.query(down);
    check("down her kısıdı düşürür ve tekrar çalıştırılabilir", await constraintNames(), []);
    check("down yalnız KENDİ kayıt satırını siler", (
      await rows<{ hash: string }>("SELECT hash FROM __drizzle_migrations ORDER BY created_at")
    ).map((r) => r.hash), ["prior", "later"]);
    check("down katalog verisine dokunmaz", await seedCounts(), {
      print_technologies: 2,
      print_materials: 7,
      print_finishes: 5,
      print_addons: 4,
      quote_pricing_settings: 1,
    });
    await admin.query(up);
    check("down sonrası up kısıtları geri getirir", await constraintNames(), ALL_CONSTRAINTS);
    check("geri gelen kısıtlar doğrulanmış", await unvalidatedNames(migrationNs), []);

    // ─── 4) schema.ts ⇄ 0066: kısıt tanımları aynı mı ───────────────────────
    //
    // İki ayrı kaynak: uygulamanın gördüğü şema `schema.ts`ten, canlı veritabanı
    // 0066'dan kurulur. Biri ötekinden kayarsa yeni bir kurulum canlıdan FARKLI
    // kısıtlarla açılır ve kimse fark etmez.
    console.log("\n4) schema.ts ile 0066 aynı kısıtları tanımlıyor mu");

    execFileSync("npx", ["drizzle-kit", "generate", "--config=scripts/db/drizzle-scratch.config.ts"], {
      cwd: root,
      env: { ...process.env, SCRATCH_OUT: ddlOut },
      stdio: "ignore",
    });
    const ddl = fs
      .readFileSync(path.join(ddlOut, fs.readdirSync(ddlOut).find((f) => f.endsWith(".sql"))!), "utf8")
      .replace(/"public"\./g, "");
    await admin.query(`CREATE SCHEMA ${serviceNs}`);
    await admin.query(`SET search_path TO ${serviceNs}`);
    for (const statement of ddl.split("--> statement-breakpoint").filter((s) => s.trim())) {
      await admin.query(statement);
    }
    const fromMigration = await constraintDefs(migrationNs);
    const fromSchema = await constraintDefs(serviceNs);
    check("schema.ts her kısıdı taşıyor", Object.keys(fromSchema).sort(), ALL_CONSTRAINTS);
    check("kısıt tanımları birebir aynı", fromSchema, fromMigration);
    check("schema.ts kurulumunda doğrulanmamış kısıt yok", await unvalidatedNames(serviceNs), []);

    // ─── 5) Yönetici yazımı: denetim satırı + 409 bayat damga ───────────────
    console.log("\n5) Yönetici yazımı — denetim satırı ve bayat damga");

    // Katalog tohumu GERÇEK migration'dan; servisin okuduğu değerler canlıdaki.
    for (const statement of fs
      .readFileSync(path.join(root, "drizzle/0064_instant_quotes.sql"), "utf8")
      .split("--> statement-breakpoint")
      .filter((s) => /\bINSERT INTO\b/.test(s))) {
      await admin.query(statement.replace(/"public"\./g, ""));
    }

    url.searchParams.set("options", `-c search_path=${serviceNs}`);
    process.env.DATABASE_URL = url.toString();

    const { db } = await import("../src/lib/db");
    pool = (db as typeof db & { $client: pg.Pool }).$client;
    const { desc, eq } = await import("drizzle-orm");
    const { printCatalogChanges, printMaterials, printTechnologies } = await import(
      "../src/lib/db/schema"
    );
    const {
      createAddon,
      createFinish,
      createMaterial,
      createTechnology,
      listAddonsForAdmin,
      listCatalogForAdmin,
      listFinishesForAdmin,
      listMaterialsForAdmin,
      listTechnologiesForAdmin,
      PrintCatalogError,
      updateAddon,
      updateFinish,
      updateMaterial,
      updatePricingSettings,
      updateTechnology,
      readPricingSettings,
    } = await import("../src/lib/services/quote-catalog-admin");

    const EMAIL = "sahip@test.invalid";
    const auditRows = async () =>
      db.select().from(printCatalogChanges).orderBy(desc(printCatalogChanges.createdAt));
    const auditCount = async () => (await auditRows()).length;

    check("düzenleme öncesi denetim izi boş", await auditCount(), 0);

    const technologyBody = {
      name: "SLS (Toz)",
      description: "Toz yatağı",
      orderMaterial: "filament" as const,
      capabilityTag: "material_filament",
      buildXMm: 300,
      buildYMm: 300,
      buildZMm: 300,
      minWallMm: 0.8,
      minFeatureMm: 0.5,
      toleranceText: "±0,3 mm",
      layerOptionsUm: [100, 120],
      defaultLayerUm: 100,
      infillOptionsPct: null,
      defaultInfillPct: null,
      shellMm: 0,
      setupFeeKurus: 3000,
      machineRateKurusPerHour: 7000,
      throughputCm3PerHour: 20,
      heightHoursPerMm: 0.01,
      minUnitPriceKurus: 5000,
      baseLeadDays: 5,
      sortOrder: 5,
      active: true,
    };

    const created = await createTechnology({ key: "sls", ...technologyBody }, EMAIL);
    await test("oluşturma, AYNI işlemde bir denetim satırı bırakır", async () => {
      const [row] = await auditRows();
      assert.ok(row, "denetim satırı yok");
      assert.equal(row.entity, "technology");
      assert.equal(row.action, "create");
      assert.equal(row.entityId, created.id);
      assert.equal(row.adminEmail, EMAIL);
      assert.equal(row.before, null);
      assert.equal((row.after as { key?: string }).key, "sls");
    });

    const updated = await updateTechnology(
      created.id,
      { expectedUpdatedAt: created.updatedAt.toISOString(), minUnitPriceKurus: 6100 },
      EMAIL
    );
    await test("güncelleme, ÖNCE/SONRA çiftiyle denetim satırı bırakır", async () => {
      const [row] = await auditRows();
      assert.ok(row);
      assert.equal(row.action, "update");
      assert.equal((row.before as { minUnitPriceKurus?: number }).minUnitPriceKurus, 5000);
      assert.equal((row.after as { minUnitPriceKurus?: number }).minUnitPriceKurus, 6100);
      assert.equal(updated.minUnitPriceKurus, 6100);
    });

    await test("BAYAT damga 409 döner ve HİÇBİR ŞEY yazmaz", async () => {
      const before = await auditCount();
      await assert.rejects(
        updateTechnology(
          created.id,
          { expectedUpdatedAt: created.updatedAt.toISOString(), minUnitPriceKurus: 9999 },
          EMAIL
        ),
        (e: unknown) => {
          assert.ok(e instanceof PrintCatalogError, "PrintCatalogError beklenir");
          assert.equal(e.code, "stale");
          assert.equal(e.status, 409);
          assert.match(e.message, /Sayfayı yenileyip/);
          return true;
        }
      );
      const [row] = await db
        .select()
        .from(printTechnologies)
        .where(eq(printTechnologies.id, created.id));
      assert.equal(row?.minUnitPriceKurus, 6100, "reddedilen yazım fiyatı değiştirmiş");
      assert.equal(await auditCount(), before, "reddedilen yazım denetim satırı bırakmış");
    });

    await test("olmayan kayıt 404 döner", async () => {
      await assert.rejects(
        updateTechnology(
          randomUUID(),
          { expectedUpdatedAt: new Date().toISOString(), sortOrder: 1 },
          EMAIL
        ),
        (e: unknown) => e instanceof PrintCatalogError && e.status === 404
      );
    });

    await test("denetim satırı yazılamazsa yazımın TAMAMI geri alınır", async () => {
      // Denetim izi yazımla AYNI işlemde olmalı: izi reddettiğimizde fiyat da
      // değişmemeli. 33 sipariş durumu değişiminde iz işlemin DIŞINDA yazılıyor
      // ve yarım kalan bir yazımda kimin değiştirdiği kayboluyordu.
      await admin.query(
        "ALTER TABLE print_catalog_changes ADD CONSTRAINT tmp_audit_block CHECK (admin_email <> 'bozuk@test.invalid')"
      );
      try {
        const fresh = await db
          .select()
          .from(printTechnologies)
          .where(eq(printTechnologies.id, created.id));
        const stamp = fresh[0]!.updatedAt.toISOString();
        await assert.rejects(
          updateTechnology(created.id, { expectedUpdatedAt: stamp, minUnitPriceKurus: 12345 }, "bozuk@test.invalid")
        );
        const [row] = await db
          .select()
          .from(printTechnologies)
          .where(eq(printTechnologies.id, created.id));
        assert.equal(row?.minUnitPriceKurus, 6100, "iz yazılamazken fiyat değişmiş");
      } finally {
        await admin.query(
          "ALTER TABLE print_catalog_changes DROP CONSTRAINT tmp_audit_block"
        );
      }
    });

    await test("her katalog düzenlemesi tam bir denetim satırı bırakır", async () => {
      const before = await auditCount();
      const material = await createMaterial(
        {
          technologyId: created.id,
          key: "pa12",
          name: "PA12",
          description: "",
          properties: {},
          densityGCm3: 1.01,
          priceKurusPerGram: 400,
          supportFactor: 1,
          capabilityTag: null,
          colors: [{ key: "gri", name: "Gri", hex: "#9E9E9E", surchargeKurus: 0 }],
          leadDaysExtra: 1,
          sortOrder: 9,
          active: true,
        },
        EMAIL
      );
      await updateMaterial(
        material.id,
        { expectedUpdatedAt: material.updatedAt.toISOString(), priceKurusPerGram: 420 },
        EMAIL
      );
      const finish = await createFinish(
        {
          technologyId: null,
          key: "kumlama",
          name: "Kumlama",
          description: "",
          fixedKurus: 1200,
          perCm2Kurus: 15,
          leadDaysExtra: 1,
          requiresManual: false,
          costLineKind: "production",
          sortOrder: 9,
          active: true,
        },
        EMAIL
      );
      await updateFinish(
        finish.id,
        { expectedUpdatedAt: finish.updatedAt.toISOString(), fixedKurus: 1300 },
        EMAIL
      );
      const addon = await createAddon(
        {
          key: "hizli_kargo",
          name: "Hızlı kargo",
          description: "",
          priceType: "fixed",
          priceKurus: 5000,
          leadDaysExtra: 0,
          sortOrder: 9,
          active: true,
        },
        EMAIL
      );
      await updateAddon(
        addon.id,
        { expectedUpdatedAt: addon.updatedAt.toISOString(), priceKurus: 5500 },
        EMAIL
      );
      const settings = await readPricingSettings();
      await updatePricingSettings(
        {
          qtyBreaks: settings.qtyBreaks,
          leadTiers: settings.leadTiers,
          minOrderKurus: 25000,
          maxAutoTotalKurus: settings.maxAutoTotalKurus,
          maxAutoQtyPerPart: settings.maxAutoQtyPerPart,
          maxPartsPerQuote: settings.maxPartsPerQuote,
          maxFileBytes: settings.maxFileBytes,
          quoteValidDays: settings.quoteValidDays,
          retentionDaysAfterExpiry: settings.retentionDaysAfterExpiry,
          priceBreakQuantities: settings.priceBreakQuantities,
          holidays: settings.holidays,
          cutoffHour: settings.cutoffHour,
          havaleDiscountApplies: settings.havaleDiscountApplies,
        },
        settings.updatedAt.toISOString(),
        EMAIL
      );
      assert.equal(await auditCount(), before + 7, "yedi düzenleme, yedi denetim satırı");
      const entities = (await auditRows()).slice(0, 7).map((r) => `${r.entity}:${r.action}`);
      assert.deepEqual(new Set(entities), new Set([
        "material:create",
        "material:update",
        "finish:create",
        "finish:update",
        "addon:create",
        "addon:update",
        "settings:update",
      ]));
      const [settingsRow] = (await auditRows()).filter((r) => r.entity === "settings");
      assert.equal(settingsRow?.entityId, null, "tek satırlık ayarın entity_id'si null olmalı");
    });

    await test("bayat damga fiyat ayarlarında da 409", async () => {
      const settings = await readPricingSettings();
      await assert.rejects(
        updatePricingSettings(
          {
            qtyBreaks: settings.qtyBreaks,
            leadTiers: settings.leadTiers,
            minOrderKurus: 31000,
            maxAutoTotalKurus: settings.maxAutoTotalKurus,
            maxAutoQtyPerPart: settings.maxAutoQtyPerPart,
            maxPartsPerQuote: settings.maxPartsPerQuote,
            maxFileBytes: settings.maxFileBytes,
            quoteValidDays: settings.quoteValidDays,
            retentionDaysAfterExpiry: settings.retentionDaysAfterExpiry,
            priceBreakQuantities: settings.priceBreakQuantities,
            holidays: settings.holidays,
            cutoffHour: settings.cutoffHour,
            havaleDiscountApplies: settings.havaleDiscountApplies,
          },
          new Date(settings.updatedAt.getTime() - 1000).toISOString(),
          EMAIL
        ),
        (e: unknown) => e instanceof PrintCatalogError && e.status === 409
      );
      assert.equal((await readPricingSettings()).minOrderKurus, 25000, "reddedilen ayar yazılmış");
    });

    await test("kısıt, servisin yolunda da SON kapıdır", async () => {
      // Zod'u atlayan bir yazım (ikinci bir yazan, elle bir betik) kataloğa
      // olmayacak bir yoğunluk koyamaz.
      await assert.rejects(
        db.update(printMaterials).set({ densityGCm3: 9 }).where(eq(printMaterials.key, "pla")),
        (e: unknown) => {
          const cause = (e as { cause?: { code?: string; constraint?: string } }).cause;
          const err = (e as { code?: string; constraint?: string });
          assert.equal(cause?.code ?? err.code, "23514");
          assert.equal(cause?.constraint ?? err.constraint, "print_materials_density_chk");
          return true;
        }
      );
    });

    // ─── 6) Dilim okumaları: her uç yalnız kendi sorgusunu açar ─────────────
    console.log("\n6) Katalog GET'leri — dilim başına tek sorgu");

    const realQuery = pool.query.bind(pool) as (...args: unknown[]) => unknown;
    let queries = 0;
    (pool as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      queries += 1;
      return realQuery(...args);
    };
    const counted = async <T>(run: () => Promise<T>): Promise<[T, number]> => {
      queries = 0;
      const value = await run();
      return [value, queries];
    };

    const [technologies, techQueries] = await counted(listTechnologiesForAdmin);
    check("teknoloji dilimi tek sorgu", techQueries, 1);
    await test("teknoloji dilimi pasif satırları da verir", async () => {
      assert.ok(technologies.some((t) => t.key === "sls"));
      assert.ok(technologies.length >= 3);
    });
    const [materials, materialQueries] = await counted(listMaterialsForAdmin);
    check("malzeme dilimi tek sorgu", materialQueries, 1);
    await test("malzeme dilimi teknoloji anahtarını taşır", async () => {
      assert.ok(materials.every((m) => typeof m.technologyKey === "string" && m.technologyKey));
    });
    const [finishes, finishQueries] = await counted(listFinishesForAdmin);
    check("yüzey dilimi tek sorgu", finishQueries, 1);
    await test("teknolojisiz yüzey null anahtarla gelir", async () => {
      assert.ok(finishes.some((f) => f.key === "ham" && f.technologyKey === null));
    });
    const [addons, addonQueries] = await counted(listAddonsForAdmin);
    check("ek hizmet dilimi tek sorgu", addonQueries, 1);
    await test("ek hizmet dilimi dolu", async () => {
      assert.ok(addons.some((a) => a.key === "rohs_beyani"));
    });
    const [catalog, catalogQueries] = await counted(listCatalogForAdmin);
    check("tam katalog altı sorgu (dört dilim + ayar + denetim)", catalogQueries, 6);
    await test("tam katalog dilimlerden kurulur", async () => {
      assert.deepEqual(
        catalog.technologies.map((t) => t.key),
        technologies.map((t) => t.key)
      );
      assert.deepEqual(catalog.addons.map((a) => a.key), addons.map((a) => a.key));
      assert.ok(catalog.changes.length > 0, "denetim izi tam kataloğa girmeli");
    });

    // Rotanın kendisi: oturum kapısı taklit, gerisi gerçek.
    const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown };
    const originalLoad = loader._load;
    loader._load = function (name, ...args) {
      if (name === "@/lib/auth/require-admin") {
        return { requireAdmin: async () => ({ session: { user: { email: EMAIL, role: "admin" } } }) };
      }
      return originalLoad.call(this, name, ...args);
    };
    try {
      const routes = {
        technologies: await import("../src/app/api/admin/print-catalog/technologies/route"),
        materials: await import("../src/app/api/admin/print-catalog/materials/route"),
        finishes: await import("../src/app/api/admin/print-catalog/finishes/route"),
        addons: await import("../src/app/api/admin/print-catalog/addons/route"),
      };
      for (const [key, mod] of Object.entries(routes)) {
        const [response, count] = await counted(() => mod.GET());
        assert.equal(response.status, 200, `GET /${key} 200 dönmedi`);
        const body = (await response.json()) as Record<string, unknown[]>;
        check(`GET /${key} yalnız kendi dilimini sorguluyor`, count, 1);
        await test(`GET /${key} yalnız kendi anahtarını döndürüyor`, async () => {
          assert.deepEqual(Object.keys(body), [key]);
          assert.ok(Array.isArray(body[key]) && body[key].length > 0);
        });
      }
    } finally {
      loader._load = originalLoad;
    }

    console.log(`\n${checks} katalog DB kontrolü geçti; yalnız tek kullanımlık şemalar`);
  } finally {
    await admin.query("ROLLBACK").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${migrationNs} CASCADE`).catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${serviceNs} CASCADE`).catch(() => {});
    await admin.end();
    await pool?.end();
    fs.rmSync(ddlOut, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
