/**
 * Yönetici sipariş sayfasındaki HER kontrol, GERÇEKTEN var olan bir uca ve o
 * ucun DIŞA AÇTIĞI yönteme gider. DB YOK, sunucu YOK — yalnız kaynak ağacı.
 *
 * NEDEN AYRI BİR TEST (test-api-contracts.ts varken): oradaki tarayıcı yalnız
 * DÜZ YAZILMIŞ `fetch("/api/…")` çağrılarını görür. Bu sayfanın kontrollerinin
 * çoğu düz değil:
 *
 *   performAction("qc-approve")        → POST /api/admin/orders/[id]/qc-approve
 *   runApi(key, path, jsonInit(b,"PATCH")) → yöntem bir YARDIMCININ ikinci argümanı
 *   callApi(path, init)                → yol bir DEĞİŞKEN
 *   <a href={`/api/…/model-files/zip`}> → hiç fetch değil
 *   <OrderChat basePath={…}>           → yöntemleri BİLEŞEN belirliyor
 *
 * Faz 2'nin altı kontrolü tam da bu yüzden canlıda 404 döndü (P2B-01..04):
 * tsc, eslint ve test-api-contracts üçü de yeşildi. Bu test sayfanın gerçek
 * çağrı biçimlerini (AST) çözer, uç ağacına düşürür ve iki yönü birden kilitler:
 *
 *   1. İLERİ  — sayfanın çağırdığı her yol+yöntem bir route.ts'te vardır.
 *   2. GERİ   — F-C1'in kanonik kümesi sayfada GERÇEKTEN çağrılır (bir düğme
 *               sessizce silinir ya da başka uca yönlendirilirse kırılır).
 *
 * Çalıştırma: npx tsx scripts/test-admin-order-routes.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const API_ROOT = join(ROOT, "src/app/api");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Yönetici sipariş sayfasının kontrolleri: sayfa + üstünde duran bileşenler. */
const PAGE = "src/app/admin/orders/[id]/client.tsx";
const UPLOADER = "src/components/admin/order-model-uploader.tsx";
/** Sohbet kutusunun yöntemlerini belirleyen kanca. */
const CHAT_HOOK = "src/lib/hooks/use-order-chat.ts";
/** Yükleme kontrolünün yöntemini belirleyen XHR yardımcısı. */
const UPLOAD_XHR = "src/lib/upload-with-progress.ts";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/**
 * Yolu bir DEĞİŞKENDEN alan yardımcılar: onların KENDİ `fetch`i değil, ÇAĞRI
 * YERLERİ toplanır. Listede olmayan bir yardımcı çözümsüz sayılır ve test
 * kırılır — yeni bir dolaylı çağrı biçimi sessizce taranmamış kalmasın.
 */
const INDIRECT_HELPERS = new Set(["callApi", "runApi"]);

interface Control {
  /** Nereden: dosya:satır. */
  where: string;
  /** `/api/admin/orders/${order.id}/ship` gibi, ifadeleri yerinde duran yol. */
  pattern: string;
  method: string;
}

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
    return;
  }
  failed++;
  console.error(`  FAIL ${name}`);
  if (extra !== undefined) console.error("       ", extra);
}

// ─── AST yardımcıları ───────────────────────────────────────────────────────

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function forEachNode(root: ts.Node, fn: (n: ts.Node) => void) {
  const visit = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
}
function lineOf(sf: ts.SourceFile, n: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
}

/** `/api/x/${a.b}/y` → metin; ifadeler `${…}` olarak yerinde kalır. */
function templatePattern(n: ts.Node): string | null {
  if (ts.isStringLiteralLike(n)) return n.text;
  if (ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    let out = n.head.text;
    for (const span of n.templateSpans) {
      out += `\${${span.expression.getText()}}`;
      out += span.literal.text;
    }
    return out;
  }
  return null;
}

/**
 * Bir yol ifadesinin olası değerleri.
 *
 * Koşullu ifade (`target === "shipped" ? A : B`) İKİ yol birden döndürür —
 * "kargoyu geri al" düğmesi tam olarak böyle yazılmış ve iki ucu da var olmalı.
 * Düz bir tanımlayıcı, dosyadaki `const url = …` bildirimlerinden çözülür
 * (boyacı sohbeti yolunu böyle tutuyor).
 */
function resolvePathExpr(
  n: ts.Node,
  consts: Map<string, string>
): { patterns: string[]; unresolved: boolean } {
  const direct = templatePattern(n);
  if (direct !== null) return { patterns: [direct], unresolved: false };
  if (ts.isConditionalExpression(n)) {
    const a = resolvePathExpr(n.whenTrue, consts);
    const b = resolvePathExpr(n.whenFalse, consts);
    return {
      patterns: [...a.patterns, ...b.patterns],
      unresolved: a.unresolved || b.unresolved,
    };
  }
  if (ts.isIdentifier(n)) {
    const hit = consts.get(n.text);
    if (hit !== undefined) return { patterns: [hit], unresolved: false };
  }
  return { patterns: [], unresolved: true };
}

/** `const url = \`/api/…\`` bildirimleri. */
function apiConstants(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  forEachNode(sf, (n) => {
    if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || !n.initializer) return;
    const p = templatePattern(n.initializer);
    if (p && p.startsWith("/api/")) out.set(n.name.text, p);
  });
  return out;
}

/** Çağrının içinde bulunduğu ok fonksiyonunun değişken adı (varsa). */
function enclosingHelperName(n: ts.Node): string | null {
  let cur: ts.Node | undefined = n;
  while (cur) {
    if (
      (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) &&
      cur.parent &&
      ts.isVariableDeclaration(cur.parent) &&
      ts.isIdentifier(cur.parent.name)
    ) {
      return cur.parent.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

/**
 * Dize BİRLEŞİM tipli parametreler: `(decision: "approve" | "reject")`.
 * `/api/admin/painter-qc/${order.id}/${decision}` gibi bir yolun dinamik
 * kuyruğu böyle çözülür — iki değerin İKİSİ de var olmak zorunda.
 */
function literalUnionParams(sf: ts.SourceFile): Map<string, string[]> {
  const out = new Map<string, string[]>();
  forEachNode(sf, (n) => {
    if (!ts.isParameter(n) || !ts.isIdentifier(n.name) || !n.type) return;
    if (!ts.isUnionTypeNode(n.type)) return;
    const values: string[] = [];
    for (const t of n.type.types) {
      if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) values.push(t.literal.text);
      else return; // saf dize birleşimi değil
    }
    if (values.length > 0) out.set(n.name.text, values);
  });
  return out;
}

/** `method: "PATCH"` ya da `jsonInit(body, "PATCH")` → yöntem. GET varsayılan. */
function methodOf(init: ts.Node | undefined, jsonInitDefault: string): string {
  if (!init) return "GET";
  if (ts.isObjectLiteralExpression(init)) {
    for (const p of init.properties) {
      if (
        ts.isPropertyAssignment(p) &&
        ts.isIdentifier(p.name) &&
        p.name.text === "method" &&
        ts.isStringLiteralLike(p.initializer)
      ) {
        return p.initializer.text.toUpperCase();
      }
    }
    return "GET";
  }
  if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "jsonInit") {
    const second = init.arguments[1];
    if (second && ts.isStringLiteralLike(second)) return second.text.toUpperCase();
    return jsonInitDefault;
  }
  return "GET";
}

/** route.ts'in dışa açtığı HTTP yöntemleri. */
function exportedMethods(routeFile: string): string[] {
  const src = readFileSync(routeFile, "utf8");
  return HTTP_METHODS.filter((verb) =>
    new RegExp(`export\\s+(async\\s+function|function|const)\\s+${verb}\\b`).test(src)
  );
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
  } catch {
    return [];
  }
}

// ─── Kontrolleri topla ──────────────────────────────────────────────────────

const pageSf = parse(PAGE);
const uploaderSf = parse(UPLOADER);

/** performAction("<eylem>") çağrılarındaki eylem adları. */
function performActionValues(sf: ts.SourceFile): string[] {
  const out = new Set<string>();
  forEachNode(sf, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "performAction" &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      out.add((n.arguments[0] as ts.StringLiteral).text);
    }
  });
  return [...out];
}

const ACTIONS = performActionValues(pageSf);

/**
 * Dinamik segmentlerin değer kümesi. `action` sayfanın kendi çağrılarından,
 * dize birleşimli parametreler tipten türer — ikisi de ELLE YAZILMAZ, yoksa
 * yeni bir eylem eklenince liste sessizce eksik kalırdı.
 */
const DYNAMIC = new Map<string, string[]>([
  ["action", ACTIONS],
  ...literalUnionParams(pageSf),
]);

function collectControls(sf: ts.SourceFile, rel: string): { controls: Control[]; unresolved: string[] } {
  const consts = apiConstants(sf);
  const controls: Control[] = [];
  const unresolved: string[] = [];
  const jsonInitDefault = /const jsonInit = \([^)]*method = "(\w+)"/.exec(read(rel))?.[1] ?? "POST";

  const push = (node: ts.Node, pathNode: ts.Node | undefined, method: string) => {
    if (!pathNode) return;
    const r = resolvePathExpr(pathNode, consts);
    const where = `${rel}:${lineOf(sf, node)}`;
    if (r.unresolved) {
      // Yardımcının KENDİ fetch'i: çağrı yerleri zaten toplanıyor.
      const helper = enclosingHelperName(node);
      if (helper && INDIRECT_HELPERS.has(helper)) return;
      unresolved.push(`${where} → ${pathNode.getText().slice(0, 60)}`);
      return;
    }
    for (const p of r.patterns) {
      if (p.startsWith("/api/")) controls.push({ where, pattern: p, method });
    }
  };

  forEachNode(sf, (n) => {
    // 1. Düz fetch + dolaylı yardımcılar + XHR yükleyici.
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fn = n.expression.text;
      if (fn === "fetch") push(n, n.arguments[0], methodOf(n.arguments[1], jsonInitDefault));
      else if (fn === "runApi") push(n, n.arguments[1], methodOf(n.arguments[2], jsonInitDefault));
      else if (fn === "callApi") push(n, n.arguments[0], methodOf(n.arguments[1], jsonInitDefault));
      // uploadWithProgress XHR'ı POST açar (aşağıda ayrıca doğrulanıyor).
      else if (fn === "uploadWithProgress") push(n, n.arguments[0], "POST");
    }
    // 2. Bağlantılar ve sohbet kutusu: fetch değil ama yine de birer kontrol.
    if (ts.isJsxAttribute(n) && ts.isIdentifier(n.name) && n.initializer) {
      const name = n.name.text;
      if (name !== "href" && name !== "basePath") return;
      const expr = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (!expr) return;
      const p = templatePattern(expr);
      if (!p || !p.startsWith("/api/")) return;
      const where = `${rel}:${lineOf(sf, n)}`;
      if (name === "href") controls.push({ where, pattern: p, method: "GET" });
      else {
        // use-order-chat: liste GET, gönderim POST, okundu bilgisi POST /read.
        controls.push({ where, pattern: p, method: "GET" });
        controls.push({ where, pattern: p, method: "POST" });
        controls.push({ where, pattern: `${p}/read`, method: "POST" });
      }
    }
  });

  return { controls, unresolved };
}

const pageScan = collectControls(pageSf, PAGE);
const uploaderScan = collectControls(uploaderSf, UPLOADER);
const controls = [...pageScan.controls, ...uploaderScan.controls];
const unresolved = [...pageScan.unresolved, ...uploaderScan.unresolved];

// ─── Yol → route.ts ─────────────────────────────────────────────────────────

interface Resolution {
  /** api kökünden göreli kanonik yol: "admin/orders/[id]/ship". */
  canonical: string;
  routeFile: string | null;
  problem: string | null;
}

function resolvePattern(pattern: string): Resolution[] {
  const q = pattern.indexOf("?");
  const clean = q === -1 ? pattern : pattern.slice(0, q);
  const segments = clean.split("/").filter(Boolean).slice(1); // baştaki "api" atılır

  let branches: string[][] = [[]];
  for (const segment of segments) {
    const next: string[][] = [];
    for (const branch of branches) {
      const dir = join(API_ROOT, ...branch);
      const entries = subdirs(dir);
      const m = /^\$\{(.+)\}$/.exec(segment);
      if (!m) {
        if (!entries.includes(segment)) {
          return [{ canonical: [...branch, segment].join("/"), routeFile: null, problem: "klasör yok" }];
        }
        next.push([...branch, segment]);
        continue;
      }
      // Dinamik segment: önce BİLİNEN değer kümesi (hepsi var olmalı), yoksa
      // [param] klasörü. İkisi de yoksa test bilerek kırılır.
      const known = DYNAMIC.get(m[1].trim());
      if (known && known.length > 0) {
        for (const value of known) {
          if (!entries.includes(value)) {
            return [
              { canonical: [...branch, value].join("/"), routeFile: null, problem: `dinamik değer '${value}' için klasör yok` },
            ];
          }
          next.push([...branch, value]);
        }
        continue;
      }
      const param = entries.find((e) => e.startsWith("[") && e.endsWith("]"));
      if (!param) {
        return [
          {
            canonical: [...branch, segment].join("/"),
            routeFile: null,
            problem: `dinamik segment çözülemedi (${m[1]}): ne [param] klasörü ne bilinen değer kümesi var`,
          },
        ];
      }
      next.push([...branch, param]);
    }
    branches = next;
  }

  return branches.map((branch) => {
    const canonical = branch.join("/");
    const routeFile = join(API_ROOT, ...branch, "route.ts");
    try {
      statSync(routeFile);
      return { canonical, routeFile, problem: null };
    } catch {
      return { canonical, routeFile: null, problem: "route.ts yok" };
    }
  });
}

// ─── 1. Tarayıcının kendisi sağlam mı ───────────────────────────────────────
console.log("tarayıcı");
ok(
  "sayfada taranacak kontrol bulundu",
  controls.length >= 25,
  `${controls.length} kontrol bulundu — tarayıcı bozulmuş olabilir`
);
ok(
  "performAction eylemleri toplandı (dinamik kuyruk çözülebilir)",
  ACTIONS.length >= 8,
  ACTIONS
);
ok(
  "yolu değişkenden alan her çağrı çözüldü",
  unresolved.length === 0,
  unresolved.join("\n        ")
);
ok(
  "jsonInit varsayılanı POST (yöntem okuması buna dayanıyor)",
  /const jsonInit = \([^)]*method = "POST"/.test(read(PAGE))
);
ok(
  "uploadWithProgress gerçekten POST açıyor (yükleme kontrolünün yöntemi)",
  /xhr\.open\("POST"/.test(read(UPLOAD_XHR))
);
ok(
  "sohbet kancası basePath'i GET + POST, /read'i POST olarak kullanıyor",
  /const listUrl = `\$\{basePath\}/.test(read(CHAT_HOOK)) &&
    /const readUrl = `\$\{basePath\}\/read/.test(read(CHAT_HOOK)) &&
    /fetch\(readUrl, \{ method: "POST" \}\)/.test(read(CHAT_HOOK)) &&
    /fetch\(listUrl, \{ method: "POST"/.test(read(CHAT_HOOK))
);

// ─── 2. İLERİ yön: her kontrol var olan bir uca gider ───────────────────────
console.log("\nileri yön: kontrol → uç");
const missing: string[] = [];
const wrongMethod: string[] = [];
const hit = new Set<string>();

for (const c of controls) {
  for (const r of resolvePattern(c.pattern)) {
    if (!r.routeFile) {
      missing.push(`${c.where} → ${c.method} ${c.pattern} (${r.problem}: ${r.canonical})`);
      continue;
    }
    const methods = exportedMethods(r.routeFile);
    if (!methods.includes(c.method)) {
      wrongMethod.push(
        `${c.where} → ${c.method} ${c.pattern} (uç yalnız ${methods.join(", ") || "hiçbir yöntem"} açıyor)`
      );
      continue;
    }
    hit.add(`${r.canonical} ${c.method}`);
  }
}

ok("hiçbir kontrol olmayan bir uca gitmiyor (404)", missing.length === 0, missing.join("\n        "));
ok(
  "hiçbir kontrol ucun açmadığı bir yöntemi kullanmıyor (405)",
  wrongMethod.length === 0,
  wrongMethod.join("\n        ")
);

// ─── 3. GERİ yön: F-C1 kanonik kümesi sayfada GERÇEKTEN çağrılıyor ─────────
//
// İleri yön tek başına yetmez: bir düğme silinir ya da başka uca yönlendirilirse
// tarama yine yeşil kalırdı. Faz 2'nin sözleşmesi bu küme üzerinden yazıldı.
console.log("\ngeri yön: kanonik küme → sayfa");
const REQUIRED: Array<[string, string]> = [
  // Kargo geri almanın kuralı SUNUCUDA: sayfa GET /ship'i çağırmazsa kuralın
  // kendi (daha dar) kopyasını tutar ve ödenmiş hakedişli bir siparişte her
  // zaman 409 dönecek bir düğme gösterir — bu ucun var olma sebebi tam olarak
  // o ayrışmayı önlemek.
  ["admin/orders/[id]/ship", "GET"],
  ["admin/orders/[id]/ship", "PATCH"],
  ["admin/orders/[id]/ship", "DELETE"],
  ["admin/orders/[id]/deliver", "DELETE"],
  ["admin/orders/[id]/model-approval/resend", "POST"],
  ["admin/orders/[id]/model-approval/record", "POST"],
  ["admin/orders/[id]/model-revisions/[revision]", "PATCH"],
  ["admin/orders/[id]/partner-messages", "GET"],
  ["admin/orders/[id]/partner-messages", "POST"],
  ["admin/orders/[id]/on-behalf", "POST"],
  ["admin/orders/[id]/swap-painter", "POST"],
  ["admin/orders/[id]/upload-model", "POST"],
  ["admin/orders/[id]/upload-model", "PATCH"],
  ["admin/orders/[id]/upload-model", "DELETE"],
  ["admin/orders/[id]/qc-approve", "POST"],
  ["admin/orders/[id]/qc-reject", "POST"],
  ["admin/painter-qc/[id]/approve", "POST"],
  ["admin/painter-qc/[id]/reject", "POST"],
];
for (const [path, method] of REQUIRED) {
  ok(`sayfa ${method} /${path} çağırıyor`, hit.has(`${path} ${method}`));
}

// ─── 4. Yapısal çivi: GÖSTERİM okuması KORUMASIZ kalamaz ───────────────────
//
// Faz 2'de sipariş sayfasının kendi okumaları tek tek korundu, ama TEK bir çağrı
// dışarıda kaldı ve tabloya DOLAYLI indiği için gözden kaçtı: aday sıralaması
// (rankForOrderPreview → rankManufacturersForOrder → reliabilityScoreFor'daki
// çıplak `manufacturer_actions` okuması). Sonuç, arıza sırasında 42 siparişin
// 42'sinde HTTP 500 oldu ve tam da o arıza için yazılmış "okunamadı" uyarılarının
// HİÇBİRİ ekrana çıkamadı — çünkü sayfa onlardan önce ölüyordu. tsc, eslint ve bu
// dosyanın ilk üç bölümü üçü de yeşildi.
//
// Bu bölüm boşluğu YAPISAL olarak kapatır: sayfa düzeyindeki her okuma ya kendi
// `.catch`ini taşır, ya `displayRead` ile sarılır, ya gövdeli bir `try` içindedir
// — ya da sayfanın KENDİ verisi olarak aşağıda adıyla listelenir. Yeni bir okuma
// eklendiğinde üçünden birini yapmak ZORUNLU; sessizce korumasız kalamaz.
console.log("\nyapısal çivi: gösterim okuması korumasız kalamaz");

/** Bu sayfalar, arıza anında da AÇILMAK zorunda. */
const GUARDED_PAGES = [
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/painter/jobs/page.tsx",
  // Üreticinin sipariş ekranı: uçların dürüst 503'ünü okuyabileceği TEK yer.
  "src/app/manufacturer/orders/[id]/page.tsx",
  // Panelin KABUĞU. Buradaki bir okuma tek bir sayfayı değil /admin/* altındaki
  // HER sayfayı düşürür: `products` okunamazken taranan 24 admin sayfasının 24'ü
  // 500 verdi ve sayfaların kendi korumaları hiç çalışamadı, çünkü kabuk onlardan
  // önce ölüyordu. Bir rozet sayısı, panelin açılmasının ön şartı olamaz.
  "src/app/admin/layout.tsx",
  // Yalnız GÖSTERİM için konmuş JOIN/ilişki yüzünden komple düşen admin
  // ekranları: kuyruğun, para kuyruğunun ve değerlendirme tablosunun kendisi
  // okunabilirken bir ad tablosu yüzünden 500 vermeleri kabul edilemez.
  "src/app/admin/bulk-orders/page.tsx",
  "src/app/admin/payouts/page.tsx",
  "src/app/admin/scoring-evaluations/page.tsx",
];

/** Okumayı saran yardımcı (sayfanın kendi içinde tanımlı). */
const GUARD_WRAPPER = "displayRead";

/**
 * Çağrısında `db.` GEÇMEYEN ama altında tablo okuyan yardımcılar. Sıralayıcı tam
 * da bu yüzden kaçtı: metinde "db" yoktu. Liste ELLE tutulur; buraya yazılmayan
 * yeni bir dolaylı okuyucu, ilk arızada sayfayı yine düşürür.
 */
const TRANSITIVE_READERS = new Set([
  "rankForOrderPreview",
  "journeyEligibility",
  "ensureJourneyToken",
  "buildOrderMoneyBreakdown",
  // Üretici sayfasının dolaylı okuyucuları: ikisi de tabloya iner, çağrılarında
  // "db" geçmez.
  "latestModelFiles",
  "getProductSpec",
]);

/**
 * Sayfanın KENDİ verisi: bunlar okunamazsa gösterilecek bir sayfa da yoktur
 * (sipariş yoksa sipariş sayfası da yok). Korumasız kalmalarının SEBEBİ budur ve
 * sebep burada yazılı olduğu için yeni bir okuma buraya sessizce eklenemez.
 */
const CORE_READS: Record<string, string[]> = {
  "src/app/admin/orders/[id]/page.tsx": [
    // Siparişin kendisi: yoksa notFound(), okunamazsa gösterilecek şey yok.
    "db.query.orders.findFirst",
  ],
  "src/app/painter/jobs/page.tsx": [
    // Oturum sahibi boyacı + iş listesinin kendisi.
    "db.query.painters.findFirst",
    "db.select({ total: count() })",
    "db.query.orders.findMany",
  ],
  "src/app/manufacturer/orders/[id]/page.tsx": [
    // Oturumun sahibi atölye (aktif değilse sayfa zaten yönlendirilir).
    "db.query.manufacturers.findFirst",
    // Siparişin kendisi: yoksa notFound(), okunamazsa gösterilecek şey yok.
    "db.query.orders.findFirst",
  ],
};

/**
 * ÇEKİRDEK okumanın `with:` bloğunda DURMASINA izin verilen ilişkiler.
 *
 * NEDEN AYRI BİR KURAL: drizzle'ın ilişkisel sorgusu TEK ifadedir. `with`
 * içindeki yan tablolardan biri okunamadığında SORGUNUN TAMAMI fırlar — yani
 * korumasız bir çekirdek okumanın içine konan yalnızca-GÖSTERİM ilişkisi,
 * sayfayı üst düzey korumasız bir okuma kadar kesin düşürür. Bir önceki tur
 * yalnız ÜST DÜZEY okumaları çiviledi; arıza bu kez çekirdek okumanın İÇİNDEN
 * geldi (ölçüm: üretici panelinde 13 sayfanın 13'ü) ve çivi yeşil kaldı.
 *
 * Kural: KORUMASIZ bir ilişkisel okuma `with:` TAŞIYAMAZ. Taşıyacaksa ilişki
 * burada, sayfa adıyla ve GEREKÇESİYLE yazılı olmalı — yoksa "sayfanın kendisi"
 * sayılamaz. Korumalı (displayRead/.catch/try) bir okumanın `with`'i serbesttir:
 * orada arıza zaten O KARTA hapsedilmiştir.
 */
const CORE_RELATIONS: Record<string, string[]> = {
  // (şimdilik boş: üç sayfanın da çekirdek okuması yalnız kendi satırını okur)
};

function parseSource(name: string, src: string): ts.SourceFile {
  return ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Satır sonlarını silip tek satıra indirir (rapor için). */
function flat(n: ts.Node): string {
  return n.getText().replace(/\s+/g, " ").trim();
}

/**
 * BOŞLUKSUZ biçim: eşleştirme bunun üzerinden yapılır.
 *
 * NEDEN: eski tarayıcı okumayı `flat(n).startsWith("db.")` ile tanıyordu, ama
 * bu dosyaların baskın yazım biçimi çok satırlı — `await db` alt satır
 * `.select()…` — ve flat() onu "db .select()…" yapıyor, yani "db." ile
 * BAŞLAMIYORDU. Sonuç: sayfadaki okumaların çoğu hiç TARANMIYORDU ve çivi
 * "korumasız okuma yok" derken aslında bakmamış oluyordu.
 */
function squeeze(t: string): string {
  return t.replace(/\s+/g, "");
}

/** `X.catch(...)` — okumanın kendi yakalayıcısı. */
function isCatchCall(n: ts.Node): boolean {
  return (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "catch"
  );
}

/**
 * Çağrı zincirinin EN SOLUNDAKİ tanımlayıcı.
 *
 * `db.select()`, `db\n  .select()` ve `db.query.x.findFirst().then()` üçü de
 * "db" verir: okuma tanıma artık METNE değil AĞACA bakar.
 */
function rootIdentifier(n: ts.Node): string | null {
  let cur: ts.Node = n;
  for (;;) {
    if (
      ts.isCallExpression(cur) ||
      ts.isPropertyAccessExpression(cur) ||
      ts.isElementAccessExpression(cur) ||
      ts.isNonNullExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isAwaitExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    return ts.isIdentifier(cur) ? cur.text : null;
  }
}

/** `db` köklü bir çağrı mı (yazım biçiminden bağımsız). */
function isDbRead(n: ts.Node): boolean {
  return ts.isCallExpression(n) && rootIdentifier(n) === "db";
}

/** Okuma korunuyor mu: kendi `.catch`i, `displayRead` sargısı ya da `try`. */
function readIsGuarded(n: ts.Node): boolean {
  let cur: ts.Node | undefined = n;
  while (cur) {
    if (isCatchCall(cur)) return true;
    if (
      ts.isCallExpression(cur) &&
      ts.isIdentifier(cur.expression) &&
      cur.expression.text === GUARD_WRAPPER
    ) {
      return true;
    }
    const parent: ts.Node | undefined = cur.parent;
    if (parent && ts.isTryStatement(parent) && parent.tryBlock === cur && parent.catchClause) {
      return true;
    }
    cur = parent;
  }
  return false;
}

/** Dosyadaki KORUMASIZ okumalar (zincirin yalnız en dışı sayılır). */
function unguardedReads(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  forEachNode(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const isDb = isDbRead(n);
    const isTransitive =
      ts.isIdentifier(n.expression) && TRANSITIVE_READERS.has(n.expression.text);
    if (!isDb && !isTransitive) return;
    // `db.select().from().where()` TEK okumadır: iç halkalar sayılmaz.
    if (isDb) {
      let a: ts.Node | undefined = n.parent;
      while (a) {
        if (isDbRead(a)) return;
        a = a.parent;
      }
    }
    if (readIsGuarded(n)) return;
    out.push(`${lineOf(sf, n)}: ${flat(n).slice(0, 90)}`);
  });
  return out;
}

/**
 * KORUMASIZ ilişkisel okumaların `with:` içine koyduğu ilişkiler (ihlaller).
 *
 * Korumalı okuma atlanır: orada bir yan tablonun arızası yalnız o kartı düşürür,
 * sayfayı değil.
 */
function coreReadRelations(sf: ts.SourceFile, rel: string): string[] {
  const allowed = new Set(CORE_RELATIONS[rel] ?? []);
  const out: string[] = [];
  forEachNode(sf, (n) => {
    if (!isDbRead(n) || !ts.isCallExpression(n)) return;
    if (!/^db\.query\.[A-Za-z0-9_]+\.find(First|Many)\(/.test(squeeze(flat(n)))) return;
    if (readIsGuarded(n)) return;
    const arg = n.arguments[0];
    if (!arg || !ts.isObjectLiteralExpression(arg)) return;
    for (const prop of arg.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !ts.isIdentifier(prop.name) ||
        prop.name.text !== "with" ||
        !ts.isObjectLiteralExpression(prop.initializer)
      ) {
        continue;
      }
      for (const r of prop.initializer.properties) {
        const rn =
          ts.isPropertyAssignment(r) && ts.isIdentifier(r.name) ? r.name.text : null;
        if (rn && !allowed.has(rn)) out.push(`${lineOf(sf, n)}: with.${rn}`);
      }
    }
  });
  return out;
}

// Denetleyicinin KENDİSİ önce kanıtlanır: korumasızı yakalamayan bir çivi,
// çivi değildir.
const GUARD_SELF_TESTS: Array<[string, string, number]> = [
  ["çıplak okuma yakalanır", "async function f(){ const r = await db.select().from(t); }", 1],
  ["kendi .catch'i olan okuma geçer", "async function f(){ const r = await db.select().from(t).catch(() => null); }", 0],
  ["displayRead ile sarılan okuma geçer", "async function f(){ const r = await displayRead('x', id, db.select().from(t)); }", 0],
  ["gövdeli try içindeki okuma geçer", "async function f(){ try { const r = await db.select().from(t); } catch (e) { console.error(e); } }", 0],
  // Canlıdaki hatanın ta kendisi: metinde "db" yok, tabloya dolaylı iniyor.
  ["çıplak dolaylı okuyucu yakalanır", "async function f(){ const c = await rankForOrderPreview(id, p); }", 1],
  ["sarılmış dolaylı okuyucu geçer", "async function f(){ const c = await displayRead('x', id, rankForOrderPreview(id, p)); }", 0],
  ["zincir tek okuma sayılır", "async function f(){ const r = await db.select().from(t).where(x).orderBy(y); }", 1],
  // Dosyaların BASKIN yazım biçimi: eski metin tabanlı tarayıcı bunların
  // hiçbirini görmüyordu, yani "korumasız okuma yok" boş bir taramanın sonucuydu.
  [
    "çok satırlı çıplak okuma yakalanır",
    "async function f(){ const r = await db\n  .select()\n  .from(t)\n  .where(x); }",
    1,
  ],
  [
    "çok satırlı ilişkisel çıplak okuma yakalanır",
    "async function f(){ const r = await db\n  .query.orders.findMany({\n    where: x,\n  }); }",
    1,
  ],
  [
    "çok satırlı korumalı okuma geçer",
    "async function f(){ const r = await db\n  .select()\n  .from(t)\n  .catch(() => null); }",
    0,
  ],
];
for (const [name, src, expected] of GUARD_SELF_TESTS) {
  const found = unguardedReads(parseSource("t.tsx", src)).length;
  ok(`denetleyici: ${name}`, found === expected, `beklenen ${expected}, bulunan ${found}`);
}

// İlişki denetleyicisi de önce kanıtlanır: çekirdek okumanın İÇİNDEKİ gösterim
// ilişkisi, üst düzey korumasız bir okuma kadar kesin düşürür sayfayı.
const RELATION_SELF_TESTS: Array<[string, string, number]> = [
  [
    "çekirdek okumanın with'i yakalanır",
    "async function f(){ const o = await db.query.orders.findFirst({ where: x, with: { photos: true } }); }",
    1,
  ],
  [
    "with'siz çekirdek okuma geçer",
    "async function f(){ const o = await db.query.orders.findFirst({ where: x }); }",
    0,
  ],
  [
    "KORUMALI okumanın with'i geçer (arıza o karta hapsedilmiş)",
    "async function f(){ const o = await displayRead('x', id, db.query.orders.findFirst({ where: x, with: { photos: true } })); }",
    0,
  ],
  // Düzeltmeden ÖNCEKİ canlı biçimin ta kendisi (admin sipariş sayfası).
  [
    "çok satırlı çekirdek okumanın her ilişkisi ayrı ayrı yakalanır",
    "async function f(){\n  const order = await db.query.orders.findFirst({\n    where: eq(orders.id, id),\n    with: {\n      photos: true,\n      adminActions: { orderBy: [desc(adminActions.createdAt)] },\n      preview: true,\n    },\n  });\n}",
    3,
  ],
];
for (const [name, src, expected] of RELATION_SELF_TESTS) {
  const found = coreReadRelations(parseSource("t.tsx", src), "t.tsx").length;
  ok(`ilişki denetleyicisi: ${name}`, found === expected, `beklenen ${expected}, bulunan ${found}`);
}

for (const rel of GUARDED_PAGES) {
  const core = CORE_READS[rel] ?? [];
  const sf = parse(rel);
  const loose = unguardedReads(sf).filter(
    (hit) => !core.some((c) => squeeze(hit).includes(squeeze(c)))
  );
  ok(
    `${rel}: korumasız gösterim okuması yok`,
    loose.length === 0,
    loose.join("\n        ")
  );
  // AYNI kural, okumanın İÇİ için: çekirdek okuma yalnız kendi satırını okur.
  const relations = coreReadRelations(sf, rel);
  ok(
    `${rel}: çekirdek okuma yalnızca-gösterim ilişkisi taşımıyor`,
    relations.length === 0,
    relations.join("\n        ")
  );
}

// Sıralamanın kendisi ayrıca ADIYLA çivilenir: sayfayı 42/42 düşüren çağrı buydu.
ok(
  "aday sıralaması (rankForOrderPreview) korumalı çağrılıyor",
  new RegExp(`${GUARD_WRAPPER}\\([^)]*rankForOrderPreview|rankForOrderPreview\\([^)]*\\)[\\s\\n]*\\.catch`, "s").test(
    read(GUARDED_PAGES[0]).replace(/\s+/g, " ")
  )
);

// ─── 4b. Bayrak, kullanıcının İNDİĞİ yerde de yazmalı ──────────────────────
//
// Korumalı okuma + kartın kendi cümlesi YETMİYOR: cümle bir SEKMEDE duruyorsa
// kullanıcı o sekmeye hiç geçmeyebilir. Ölçüm: `order_model_revisions`
// okunamazken 19 admin sipariş sayfasının 18'i açıldı ve HİÇBİR uyarı
// göstermedi — bayrak vardı (revisionReadFailed), cümle vardı (Üretim sekmesi),
// ama admin sayfayı Özet sekmesinde açıyor. Kural: sayfanın bildirdiği her arıza
// bayrağı, sekmelerin DIŞINDAKİ şeritte de sayılır.
console.log("\narıza bayrağı, kullanıcının indiği yerde de yazıyor mu");

const STRIP_PAGES = [
  "src/app/admin/orders/[id]/page.tsx",
  "src/app/manufacturer/orders/[id]/page.tsx",
  "src/app/admin/bulk-orders/page.tsx",
  "src/app/admin/payouts/page.tsx",
  "src/app/admin/scoring-evaluations/page.tsx",
];
for (const rel of STRIP_PAGES) {
  const src = read(rel);
  const start = src.indexOf("const unreadableAreas = [");
  if (start < 0) {
    ok(`${rel}: sekmelerin dışında bir arıza şeridi var`, false);
    continue;
  }
  const strip = src.slice(start, src.indexOf("].filter(", start));
  const declared = [
    ...src.matchAll(/const (\w*(?:Unreadable|ReadFailed))\s*=/g),
  ].map((m) => m[1]);
  const missing = declared.filter(
    (name) => !new RegExp(`\\b${name}\\b`).test(strip)
  );
  ok(`${rel}: her arıza bayrağı şeritte de sayılıyor`, missing.length === 0, missing);
}

// Kapıyı BESLEYEN okuma, sayfa açık kalsa bile KAPALI tarafa düşmek zorunda.
// Üretici ekranında parça listesi okunamadığında istemci `multiPart`ı false
// hesaplıyor (client.tsx) ve tek dosyalık "STL indir" düğmesi geri geliyordu:
// 13 parçalık bir işin TEK parçası "modelin kendisi" diye veriliyordu.
{
  const flat = read("src/app/manufacturer/orders/[id]/page.tsx").replace(/\s+/g, " ");
  ok(
    "üretici ekranı: parça listesi okunamazken tek dosyalık indirme kapalı",
    /glbUrl: modelFilesUnreadable \? null/.test(flat) &&
      /stlUrl: modelFilesUnreadable \? null/.test(flat) &&
      /objUrl: modelFilesUnreadable \? null/.test(flat)
  );
}

// Panelin kabuğu, arızayı İÇERİĞİN üstünde söylemeli: kenar çubuğundaki "?"
// rozeti sebebi söylemez ve mobilde çekmece kapalıdır.
{
  const layout = read("src/app/admin/layout.tsx");
  ok(
    "admin kabuğu: okunamayan rozet sayısı her sayfanın üstünde yazıyor",
    /<PanelReadNotice areas={unreadableAreas} \/>/.test(layout) &&
      /badge: number \| null/.test(read("src/app/admin/sidebar.tsx"))
  );
}

// ─── 5. Bayrak EKRANA ulaşıyor mu ──────────────────────────────────────────
//
// Korumalı okuma tek başına yetmez: hatayı yutup boş liste göstermek, sayfayı
// ayakta tutar ama YALAN söyletir ("kayıt yok"). Bu yüzden her bayrağın ekranda
// bir karşılığı olmak zorunda.
console.log("\nbayraklar ekrana ulaşıyor mu");

const adminPageSf = parse(GUARDED_PAGES[0]);
const readFailureKeys: string[] = [];
forEachNode(adminPageSf, (n) => {
  if (
    !ts.isPropertyAssignment(n) ||
    !ts.isIdentifier(n.name) ||
    n.name.text !== "readFailures" ||
    !ts.isObjectLiteralExpression(n.initializer)
  ) {
    return;
  }
  for (const prop of n.initializer.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      readFailureKeys.push(prop.name.text);
    }
  }
});
ok("sunucu readFailures bayraklarını gönderiyor", readFailureKeys.length >= 10, readFailureKeys);

const clientSrc = read(PAGE);
const unusedFlags = readFailureKeys.filter((k) => !clientSrc.includes(`readFailures?.${k}`));
ok(
  "her readFailures bayrağı ekranda KULLANILIYOR (sessiz bayrak yok)",
  unusedFlags.length === 0,
  unusedFlags
);

// Sayfanın kendi içinde tutulan bayraklar da (boyacı iş listesi) kullanılmalı:
// bildirilip hiç gösterilmeyen bir bayrak, korumayı yapılmış gibi gösterirdi.
for (const rel of GUARDED_PAGES) {
  const src = read(rel);
  const declared = [...src.matchAll(/const (\w*(?:Unreadable|ReadFailed))\s*=/g)].map((m) => m[1]);
  const silent = declared.filter(
    (name) => (src.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length < 2
  );
  ok(`${rel}: her arıza bayrağının bir kullanımı var`, silent.length === 0, silent);
}

console.log(
  `\n${controls.length} kontrol tarandı, ${hit.size} ayrı uç+yöntem eşleşti` +
    (failed ? `\n${failed} FAILED` : "\ntümü geçti")
);
process.exitCode = failed ? 1 : 0;
