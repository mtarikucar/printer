/**
 * Otomatik üretici ataması (Faz 1) — saf kural testleri. DB YOK, Redis YOK.
 *
 * Buradaki üç katman:
 *
 *  1. Saf kapı (src/lib/config/flags.ts): siparişin türü hangi anahtarla
 *     yönetilir, o sipariş atanabilir mi ve atanacaksa KİME bakılır. Kapının
 *     SIRASI kuralın kendisidir (atölye → anahtar → iade → durum → basılabilir
 *     içerik), çünkü admin'e ve kayda yazılan sebep o sıradan çıkar.
 *  2. Kapsam kuralları: AI_KILL_ALL neyi durdurur (para muslukları) ve neyi
 *     durdurmaz (üretici yönlendirmesi); satıcının kendi katalog ürünü kime
 *     atanabilir; bir geri almadan sonra hangi atölye dışlanır.
 *  3. Kaynak taraması — AST ile: "onaylı + atanmamış" hâline giren HER geçişin
 *     autoAssignIfEligible'ı DOĞRU DALDA çağırdığını denetler. Metin araması
 *     yetmiyordu: çağrı yanlış dala (ör. onay rotasının
 *     `awaiting_customer_approval` yoluna) taşınsa da dosyada geçtiği için
 *     testler yeşil kalırdı. Ayrıca atama zincirinin worker'da çalışmasını
 *     bozacak bir `server-only` importunu ve yazılı kalemlerin yeniden
 *     "basılabilir içerik" sayılmasını da yakalar.
 *
 * Çalıştırma: npx tsx scripts/test-auto-assign.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  AI_SPEND_FLAG_KEYS,
  AUTO_ASSIGN_FLAG_KEYS,
  FLAG_DEFAULTS,
  FLAG_KEYS,
  FLAG_LABELS_TR,
  autoAssignFlagFor,
  autoAssignPlacementPlan,
  autoAssignRowGate,
  autoAssignSkipReason,
  classifyAutoAssignOrder,
  flagForcedOffByKillSwitch,
  isFlagKey,
  type AutoAssignOrderKind,
  type AutoAssignOrderShape,
} from "../src/lib/config/flags";
import { REFUNDED_PAYMENT_STATUS } from "../src/lib/config/order-status-policy";

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("  ok  ", name);
  else {
    failed++;
    console.error("  FAIL", name, extra ?? "");
  }
}

// ─── Anahtarlar ─────────────────────────────────────────────────────────────
console.log("anahtarlar");

const AUTO_ASSIGN_KEYS = [
  "auto_assign_cart_platform",
  "auto_assign_custom",
  "auto_assign_manual",
  "auto_assign_upload",
  "auto_assign_whatsapp_ai",
];
ok(
  "sipariş türü başına bir anahtar var",
  AUTO_ASSIGN_KEYS.every((k) => (FLAG_KEYS as readonly string[]).includes(k)),
  FLAG_KEYS
);
ok(
  "otomatik atama anahtarları AÇIK doğar (yeni para harcamazlar)",
  AUTO_ASSIGN_KEYS.every((k) => FLAG_DEFAULTS[k as keyof typeof FLAG_DEFAULTS] === true)
);
ok(
  "para harcayan eski anahtarlar KAPALI kalır",
  FLAG_DEFAULTS.auto_model_enabled === false &&
    FLAG_DEFAULTS.meshy_enabled === false &&
    FLAG_DEFAULTS.wa_bot_enabled === false &&
    FLAG_DEFAULTS.wa_agent_enabled === false
);
ok(
  "her anahtarın Türkçe etiketi var",
  FLAG_KEYS.every((k) => (FLAG_LABELS_TR[k] ?? "").trim().length > 0)
);
ok("kapalı küme korunur", isFlagKey("auto_assign_manual") && !isFlagKey("auto_assign_workshop"));

// ─── AI_KILL_ALL kapsamı ────────────────────────────────────────────────────
// Kill switch bir PARA musluğudur. Her anahtarı kapattığı hâlde, acil durumda
// siparişlerin hiçbiri üreticiye gitmiyordu (hepsi `flag_off` ile atlanıyordu)
// — üstelik tek kuruş tasarruf etmeden.
console.log("kill switch kapsamı");
{
  const previous = process.env.AI_KILL_ALL;
  try {
    process.env.AI_KILL_ALL = "1";
    ok(
      "kill switch AI/harcama anahtarlarını kapatır",
      AI_SPEND_FLAG_KEYS.every((k) => flagForcedOffByKillSwitch(k)),
      AI_SPEND_FLAG_KEYS.filter((k) => !flagForcedOffByKillSwitch(k))
    );
    ok(
      "kill switch üretici yönlendirmesini DURDURMAZ",
      AUTO_ASSIGN_FLAG_KEYS.every((k) => !flagForcedOffByKillSwitch(k)),
      AUTO_ASSIGN_FLAG_KEYS.filter((k) => flagForcedOffByKillSwitch(k))
    );
    delete process.env.AI_KILL_ALL;
    ok(
      "kill switch kapalıyken hiçbir anahtar zorla kapatılmaz",
      FLAG_KEYS.every((k) => !flagForcedOffByKillSwitch(k))
    );
  } finally {
    if (previous === undefined) delete process.env.AI_KILL_ALL;
    else process.env.AI_KILL_ALL = previous;
  }
}
ok(
  "her anahtar tam olarak bir kümede (harcama / yönlendirme)",
  FLAG_KEYS.every(
    (k) =>
      (AI_SPEND_FLAG_KEYS as readonly string[]).includes(k) !==
      (AUTO_ASSIGN_FLAG_KEYS as readonly string[]).includes(k)
  ),
  FLAG_KEYS.filter(
    (k) =>
      (AI_SPEND_FLAG_KEYS as readonly string[]).includes(k) ===
      (AUTO_ASSIGN_FLAG_KEYS as readonly string[]).includes(k)
  )
);

const flagsServiceSrc = read("src/lib/services/flags.ts");
ok(
  "bayrak servisi kill switch'i TÜM anahtarlara uygulamıyor",
  !/killAllEngaged\(\)\)\s*return false/.test(flagsServiceSrc) &&
    !/killAllEngaged\(\)\)\s*for \(const key of FLAG_KEYS\) out\[key\] = false/.test(
      flagsServiceSrc
    )
);
ok(
  "bayrak servisi kapsam kuralını (flagForcedOffByKillSwitch) kullanır",
  (flagsServiceSrc.match(/flagForcedOffByKillSwitch\(/g) ?? []).length >= 2,
  flagsServiceSrc.match(/flagForcedOffByKillSwitch\(/g)?.length
);

// ─── Sipariş türü ───────────────────────────────────────────────────────────
console.log("sipariş türü");

const base: AutoAssignOrderShape = {
  status: "approved",
  paymentStatus: "succeeded",
  orderType: "custom",
  manufacturerId: null,
  manufacturerStatus: "unassigned",
  workshopSessionId: null,
  attributionChannel: null,
  productId: null,
  parentReference: null,
  hasOrderItems: false,
};
const shape = (o: Partial<AutoAssignOrderShape>): AutoAssignOrderShape => ({ ...base, ...o });

const kindCases: Array<[string, Partial<AutoAssignOrderShape>, AutoAssignOrderKind]> = [
  ["web kişiye özel figür", {}, "custom"],
  ["WhatsApp yapay zekâ siparişi", { attributionChannel: "whatsapp" }, "whatsapp_ai"],
  ["müşteri model yükleme", { orderType: "upload" }, "upload"],
  ["elle yazılan admin siparişi", { orderType: "marketplace" }, "manual"],
  [
    "tek ürünlü katalog siparişi",
    { orderType: "marketplace", productId: "11111111-1111-1111-1111-111111111111" },
    "cart_platform",
  ],
  ["sepet alt siparişi (satırlı)", { orderType: "marketplace", hasOrderItems: true }, "cart_platform"],
  ["sepet alt siparişi (kardeşli)", { orderType: "marketplace", parentReference: "CART-1" }, "cart_platform"],
  ["atölye seansı siparişi", { workshopSessionId: "s1" }, "workshop"],
  [
    "atölye bağı taşıyan pazaryeri siparişi de atölyedir",
    { orderType: "marketplace", productId: "p1", workshopSessionId: "s1" },
    "workshop",
  ],
];
for (const [name, patch, expected] of kindCases) {
  const actual = classifyAutoAssignOrder(shape(patch));
  ok(`${name} → ${expected}`, actual === expected, actual);
}

ok("atölyenin anahtarı YOKTUR (hiç otomatik atanmaz)", autoAssignFlagFor("workshop") === null);
for (const kind of ["custom", "upload", "whatsapp_ai", "manual", "cart_platform"] as const) {
  const key = autoAssignFlagFor(kind);
  ok(`${kind} bir anahtara bağlı`, !!key && (FLAG_KEYS as readonly string[]).includes(key), key);
}

// ─── Kapı: uygunluk kuralları ───────────────────────────────────────────────
console.log("uygunluk kapısı");

const full = (o: Partial<AutoAssignOrderShape>, flagEnabled = true, hasPrintableContent = true) =>
  autoAssignSkipReason(shape(o), { flagEnabled, hasPrintableContent });

ok("onaylı + atanmamış + açık anahtar + basılabilir → atanır", full({}) === null);
ok(
  "anahtar kapalıysa atanmaz",
  full({}, false) === "flag_off"
);
ok(
  "atölye siparişi anahtar AÇIK olsa da atanmaz",
  full({ workshopSessionId: "s1" }, true) === "workshop"
);
ok(
  "atölye kararı anahtar kontrolünden ÖNCE gelir",
  full({ workshopSessionId: "s1" }, false) === "workshop"
);
ok(
  "iade edilmiş sipariş atanmaz",
  full({ paymentStatus: REFUNDED_PAYMENT_STATUS }) === "refunded"
);
ok(
  "iade kontrolü durum kontrolünden ÖNCE gelir (iade siparişi onaylı+atanmamış durur)",
  full({ paymentStatus: REFUNDED_PAYMENT_STATUS, status: "approved" }) === "refunded"
);
ok("onaylanmamış sipariş atanmaz", full({ status: "awaiting_model" }) === "not_eligible");
ok(
  "müşteri onayı bekleyen meshy_auto siparişi atanmaz",
  full({ status: "awaiting_customer_approval" }) === "not_eligible"
);
ok(
  "ödenmiş pazaryeri siparişi atanabilir (platform kataloğu bu hâlde doğar)",
  full({ status: "paid", orderType: "marketplace", productId: "p1" }) === null
);
ok(
  "ödenmiş ama pazaryeri olmayan sipariş atanmaz",
  full({ status: "paid" }) === "not_eligible"
);
ok(
  "zaten atanmış sipariş yeniden atanmaz",
  full({ manufacturerId: "m1", manufacturerStatus: "assigned" }) === "not_eligible"
);
ok(
  "üretici kimliği varken durum boşsa da atanmaz",
  full({ manufacturerId: "m1", manufacturerStatus: null }) === "not_eligible"
);
ok(
  "hiç dokunulmamış (NULL) atama durumu boştadır",
  full({ manufacturerStatus: null }) === null
);
ok(
  "basılabilir içeriği olmayan sipariş atanmaz (modelsiz elle yazılan sipariş)",
  full({ orderType: "marketplace" }, true, false) === "not_eligible"
);
ok(
  "model indiğinde aynı sipariş atanır",
  full({ orderType: "marketplace" }, true, true) === null
);
ok(
  "satır kapısı basılabilir içeriği SORMAZ (boşuna sorgu atılmasın)",
  autoAssignRowGate(shape({ orderType: "marketplace" }), true) === null
);

// ─── Yerleştirme planı: satıcının ürünü ve dışlama ──────────────────────────
// Pazaryeri ürününün dosyaları satıcıya aittir: siparişi rakip bir atölyeye
// otomatik vermek, satıcının ürününü rakibine bastırmak olurdu.
console.log("yerleştirme planı");

const SELLER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const plan = (o: {
  sellerManufacturerId?: string | null;
  declined?: string[];
  exclude?: string[];
}) =>
  autoAssignPlacementPlan({
    sellerManufacturerId: o.sellerManufacturerId ?? null,
    declinedManufacturerIds: o.declined ?? [],
    excludeManufacturerIds: o.exclude ?? [],
  });

{
  const p = plan({ sellerManufacturerId: SELLER });
  ok(
    "satıcının kendi ürünü YALNIZ kendi atölyesine atanır",
    p.kind === "seller" && p.manufacturerId === SELLER,
    p
  );
}
ok(
  "satıcı siparişi sıralamaya HİÇ girmez (rakip atölye kazanamaz)",
  plan({ sellerManufacturerId: SELLER }).kind !== "rank"
);
ok(
  "satıcının atölyesinden az önce geri alındıysa otomatik atama durur",
  plan({ sellerManufacturerId: SELLER, exclude: [SELLER] }).kind === "skip"
);
ok(
  "satıcı siparişi reddettiyse de durur (rakibe kaymaz)",
  plan({ sellerManufacturerId: SELLER, declined: [SELLER] }).kind === "skip"
);
ok(
  "başka bir atölyenin dışlanması satıcı siparişini engellemez",
  plan({ sellerManufacturerId: SELLER, exclude: [OTHER] }).kind === "seller"
);
{
  const p = plan({ exclude: [OTHER] });
  ok(
    "sahipsiz sipariş sıralanır ve dışlama sıralamaya taşınır",
    p.kind === "rank" && p.excluded.includes(OTHER),
    p
  );
}
{
  const p = plan({});
  ok("dışlama yoksa sıralama serbesttir", p.kind === "rank" && p.excluded.length === 0, p);
}
{
  // Dışlama, siparişin kalıcı "reddedenler" listesinden BAĞIMSIZDIR: geri alma
  // kara liste işaretlenmeden yapıldığında bile aynı atölyeye anında dönmemeli.
  const p = plan({ exclude: [OTHER], declined: [] });
  ok(
    "dışlama declinedManufacturerIds'den bağımsız çalışır",
    p.kind === "rank" && p.excluded.length === 1,
    p
  );
}

// ─── AST yardımcıları ───────────────────────────────────────────────────────

const parse = (rel: string) =>
  ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, /* setParentNodes */ true);

function forEachNode(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((c) => forEachNode(c, fn));
}

function callsOf(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      out.push(n);
    }
  });
  return out;
}

/**
 * Çağrıyı saran koşulların metni: hangi if / üçlü operatör / `&&` dalının
 * içinde duruyor. "Çağrı dosyada geçiyor mu" değil, "doğru dalda mı" sorusunun
 * cevabı budur.
 */
function guardTrail(call: ts.Node): string[] {
  const trail: string[] = [];
  for (let n: ts.Node = call; n.parent; n = n.parent) {
    const p = n.parent;
    if (ts.isIfStatement(p)) {
      if (p.thenStatement === n) trail.push(p.expression.getText());
      else if (p.elseStatement === n) trail.push(`!(${p.expression.getText()})`);
    } else if (ts.isConditionalExpression(p)) {
      if (p.whenTrue === n) trail.push(p.condition.getText());
      else if (p.whenFalse === n) trail.push(`!(${p.condition.getText()})`);
    } else if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      p.right === n
    ) {
      trail.push(p.left.getText());
    }
  }
  return trail;
}

/** En yakın saran fonksiyonun adı (değişkene atanmış ok fonksiyonları dahil). */
function enclosingFunction(node: ts.Node): string {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (
      ts.isVariableDeclaration(p) &&
      ts.isIdentifier(p.name) &&
      p.initializer &&
      (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
    ) {
      return p.name.text;
    }
  }
  return "";
}

const argsText = (call: ts.CallExpression) => call.arguments.map((a) => a.getText()).join(", ");

// ─── Kaynak taraması: tetikleyiciler DOĞRU DALDA mı ─────────────────────────
console.log("tetikleyiciler (AST)");

interface TriggerCase {
  name: string;
  rel: string;
  calls: number;
  /** Her çağrının koşul zincirinde BULUNMASI gerekenler. */
  guards?: RegExp[];
  /** Koşul zincirinde BULUNMAMASI gerekenler (yanlış dal). */
  forbidden?: RegExp[];
  /** Hiçbir koşulun içinde olmamalı: geçiş yazıldıysa çağrı da yapılır. */
  unconditional?: boolean;
  /** Çağrı argümanlarında bulunması gerekenler. */
  args?: RegExp[];
  /** Çağrının içinde durması gereken fonksiyon. */
  fn?: string;
}

const TRIGGERS: TriggerCase[] = [
  {
    // Onay rotasının iki dalı var; `awaiting_customer_approval` dalında sipariş
    // henüz onaylı DEĞİLDİR ve üretici kuyruğu açılmaz.
    name: "admin onayı yalnız `approved` dalında tetikler",
    rel: "src/app/api/admin/orders/[id]/approve/route.ts",
    calls: 1,
    guards: [/nextStatus === "approved"/],
    forbidden: [/awaiting_customer_approval/],
  },
  {
    // Model yükleme, elle yazılan siparişin üreticiye gidebildiği andır; koşul
    // aramaz, çünkü autoAssignIfEligible her siparişte güvenlidir.
    name: "admin model yükleme koşulsuz tetikler",
    rel: "src/app/api/admin/orders/[id]/upload-model/route.ts",
    calls: 1,
    unconditional: true,
  },
  {
    name: "toplu işlem yalnız `approve` eyleminde tetikler",
    rel: "src/app/api/admin/orders/bulk-action/route.ts",
    calls: 1,
    guards: [/body\.action === "approve"/],
  },
  {
    name: "geri alma: hedefsiz + iade edilmemiş + kuyrukta bırakılmamışsa tetikler",
    rel: "src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts",
    calls: 1,
    guards: [/!target/, /!refunded/, /!keepInQueue/],
    // Dışlama kara liste tikine BAĞLI OLMAMALI.
    forbidden: [/blocklist/],
    args: [/excludeManufacturerIds/, /prevManufacturerId/],
  },
  {
    // Baskının geri alınması siparişi `printing` → `approved` + ATANMAMIŞ hâle
    // döndürür: tam olarak otomatik atamanın tetiklendiği hâl. Tetikleyicisi
    // olmayan tek geçiş buydu — rotanın kendi UPDATE'i zaten `isNull(
    // manufacturerId)` şartını taşıdığı için buraya ancak boştaki bir sipariş
    // gelir, yani koşul aranmaz.
    name: "baskının geri alınması koşulsuz tetikler",
    rel: "src/app/api/admin/orders/[id]/unstart-printing/route.ts",
    calls: 1,
    unconditional: true,
    fn: "POST",
  },
  {
    name: "üretici kabul sonrası iptali tetikler (iptal edeni dışlayarak)",
    rel: "src/app/api/manufacturer/orders/[id]/cancel/route.ts",
    calls: 1,
    unconditional: true,
    args: [/excludeManufacturerIds/, /session\.manufacturerId/],
    fn: "POST",
  },
  {
    name: "boyacıdan geri alma tetikler (admin kuyrukta bırakmadıysa)",
    rel: "src/lib/services/revoke-after-painter.ts",
    calls: 1,
    guards: [/!keepInQueue/],
    forbidden: [/blocklistManufacturer/],
    args: [/excludeManufacturerIds/, /prevManufacturerId/],
    fn: "revokeAfterPainterHandoff",
  },
  {
    // Satıcının kendi ürünü olan dal DEĞİL: orada sipariş zaten satıcıya
    // atanmıştır ve yalnız bildirim gider.
    name: "ödeme sonrası pazaryeri akışı basılabilir-içerik dalında tetikler",
    rel: "src/lib/services/order-confirm.ts",
    calls: 1,
    guards: [/orderHasPrintableContent/, /!\(order\.sellerManufacturerId\)/],
    fn: "kickOffMarketplaceOrder",
  },
];

for (const t of TRIGGERS) {
  const sf = parse(t.rel);
  const calls = callsOf(sf, "autoAssignIfEligible");
  ok(`${t.name}: çağrı sayısı ${t.calls}`, calls.length === t.calls, calls.length);
  for (const call of calls) {
    const trail = guardTrail(call);
    const joined = trail.join(" && ");
    if (t.unconditional) {
      ok(`${t.name}: koşulsuz`, trail.length === 0, trail);
    }
    for (const re of t.guards ?? []) {
      ok(`${t.name}: ${re} dalında`, re.test(joined), joined || "(koşulsuz)");
    }
    for (const re of t.forbidden ?? []) {
      ok(`${t.name}: ${re} dalında DEĞİL`, !re.test(joined), joined);
    }
    for (const re of t.args ?? []) {
      ok(`${t.name}: argümanlarda ${re}`, re.test(argsText(call)), argsText(call));
    }
    if (t.fn) {
      ok(`${t.name}: ${t.fn} içinde`, enclosingFunction(call) === t.fn, enclosingFunction(call));
    }
  }
}

// Müşteri model onayı + onay SLA: iki çağrı da yalnız `approved` dalında.
// SLA'nın otomatik onayı BEKLENİR (süpürme kaydı "atandı mı"yı yazabilsin),
// müşterinin kendi tıklaması beklenmez.
{
  const rel = "src/lib/services/model-approval.ts";
  const calls = callsOf(parse(rel), "autoAssignIfEligible");
  ok(`${rel}: iki çağrı (SLA + müşteri)`, calls.length === 2, calls.length);
  const trails = calls.map((c) => guardTrail(c).join(" && "));
  ok(
    `${rel}: her iki çağrı da yalnız \`approved\` dalında`,
    trails.every((t) => /nextStatus === "approved"/.test(t)),
    trails
  );
  ok(
    `${rel}: tam olarak biri SLA otomatik onayı dalında`,
    trails.filter((t) => /auto_approved/.test(t)).length === 1,
    trails
  );
}

// ─── Kaynak taraması: dışlama gerçekten sıralamaya uygulanıyor mu ───────────
console.log("dışlama ve satıcı kuralı (kaynak)");

const confirmSrc = read("src/lib/services/order-confirm.ts");
const confirmSf = parse("src/lib/services/order-confirm.ts");

ok(
  "otomatik atama siparişin satıcısını ve reddedenlerini okur",
  /sellerManufacturerId: true/.test(confirmSrc) &&
    /declinedManufacturerIds: true/.test(confirmSrc)
);
ok(
  "plan sıralamadan ÖNCE hesaplanır",
  confirmSrc.indexOf("autoAssignPlacementPlan(") <
    confirmSrc.indexOf("rankForOrderWithShadow(orderId,")
);
{
  const rankCalls = callsOf(confirmSf, "rankForOrderWithShadow");
  ok("sıralama tek yerde çağrılır", rankCalls.length === 1, rankCalls.length);
  const trail = rankCalls.map((c) => guardTrail(c).join(" && ")).join("");
  ok(
    "sıralama yalnız `rank` planında çalışır (satıcı siparişi sıralanmaz)",
    /plan\.kind/.test(trail),
    trail || "(koşulsuz)"
  );
}
// Dışlama SIRALAMANIN İÇİNDE uygulanır, sonrasında süzülerek değil. Sonradan
// süzmek, kaydedilen kazanan olarak SEÇİLEMEYECEK bir atölye bırakıyordu:
// sipariş sayfası da kazanan ile atanan ayrıştığı için "iş elle atanmış
// olabilir" diyor, yani hiç yapılmamış bir insan kararını suçluyordu.
ok(
  "dışlama sıralama ÇAĞRISINA geçer",
  /rankForOrderWithShadow\(orderId, \{\s*excludeManufacturerIds: plan\.excluded,?\s*\}\)/.test(
    confirmSrc
  )
);
ok(
  "dışlama sıralamadan SONRA süzülmez (kayıt ile karar ayrışmasın)",
  !/excluded\.has\(/.test(confirmSrc) && !/new Set\(plan\.excluded\)/.test(confirmSrc)
);
ok(
  "en iyi aday doğrudan sıralamadan okunur",
  /const best = candidates\.find\(\(c\) => c\.eligible\)/.test(confirmSrc)
);
ok(
  "aday çıkmama sebebi sıralayıcının SABİTİNDEN okunur (metin karşılaştırması değil)",
  confirmSrc.includes("EXCLUDED_THIS_ATTEMPT_REASON")
);
ok(
  "satıcı siparişi kendi atölyesine atanır (sıralama sonucuna değil)",
  /plan\.kind === "seller"/.test(confirmSrc) &&
    /manufacturerId: targetManufacturerId/.test(confirmSrc)
);
ok(
  "geri alma 'kuyruğumda kalsın' seçeneğini kabul eder",
  /keepInQueue/.test(read("src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts"))
);
ok(
  "boyacıdan geri alma da 'kuyruğumda kalsın' seçeneğini taşır",
  /keepInQueue/.test(read("src/app/api/admin/orders/[id]/revoke-painter/route.ts")) &&
    /keepInQueue/.test(read("src/lib/services/revoke-after-painter.ts"))
);
ok(
  "tek giriş noktası dışa açıktır",
  /export async function autoAssignIfEligible\(/.test(confirmSrc)
);

// ─── Kaynak taraması: worker güvenliği ve içerik kuralı ─────────────────────
console.log("worker güvenliği ve basılabilir içerik");

const WORKER_CHAIN = [
  "src/lib/config/flags.ts",
  "src/lib/services/order-confirm.ts",
  "src/lib/services/manufacturer-assign.ts",
  "src/lib/services/model-approval.ts",
];
for (const rel of WORKER_CHAIN) {
  // BullMQ worker'ı standalone Node'da koşar; `server-only` importu Next
  // paketleyicisi dışında çözülemez ve worker'ı crash-loop'a sokar (2026-06-13).
  ok(`${rel}: server-only importu yok`, !/^\s*import\s+["']server-only["']/m.test(read(rel)));
}

const assignSrc = read("src/lib/services/manufacturer-assign.ts");
const printable = assignSrc.slice(
  assignSrc.indexOf("export async function orderHasPrintableContent"),
  assignSrc.indexOf("export type AssignFailure")
);
ok(
  "yazılı kalemler (selectedAddons) basılabilir içerik SAYILMAZ",
  !printable.includes("selectedAddons"),
  printable.match(/.*selectedAddons.*/)?.[0]
);
ok(
  "model dosyası ve katalog ürünü hâlâ sayılır",
  ["modelGlbKey", "modelStlKey", "productId", "uploadedModelId"].every((c) =>
    printable.includes(c)
  )
);
ok(
  "atama hatası metni artık kalemleri vaat etmiyor",
  !/basılabilir içerik yok \(model, ürün veya kalem\)/.test(assignSrc)
);

// ─── Otomatik atama admin'i sessizce yalnız bırakmaz ────────────────────────
ok(
  "aday bulunamayınca [ATAMA] notu yazılır",
  confirmSrc.includes("[ATAMA] Otomatik atama yapılamadı")
);
ok(
  "aday bulunamayınca admin'e e-posta gider",
  /type: "admin_custom"/.test(confirmSrc) && confirmSrc.includes("ADMIN_EMAIL")
);
ok(
  "satıcının atölyesi kapalıysa admin haberdar edilir",
  /manufacturer_unavailable/.test(confirmSrc)
);
ok(
  "sıralama Q7 gölge sarmalayıcısından geçer (telemetri tek yerde)",
  confirmSrc.includes("rankForOrderWithShadow(orderId,")
);

// ─── Değerlendirme satırı GERÇEK yerleştirmeye bağlanır ─────────────────────
// Satırı 2,5 sn'lik doğrulama zamanlayıcısına bırakmak iki şeyi bozuyordu:
// kısa ömürlü bir süreçte (betik, tek işlik worker) unref'li zamanlayıcı hiç
// çalışmıyor ve karar kaydedilmiyordu; yarış kaybedildiğinde ise zamanlayıcı
// siparişte o an duran üreticiyi görüp BAŞKASININ atamasını bize mal ediyordu.
console.log("değerlendirme kaydı (AST)");
{
  const commits = callsOf(confirmSf, "commitAssignmentEvaluation");
  ok("kayıt tam olarak bir yerde yazılır", commits.length === 1, commits.length);
  for (const call of commits) {
    const trail = guardTrail(call).join(" && ");
    ok(
      "kayıt yalnız SIRALAMADAN geçen yerleştirmede yazılır",
      /ranked/.test(trail),
      trail || "(koşulsuz)"
    );
    ok(
      "kayıt, gerçekten atanan atölyeyi yazar",
      /targetManufacturerId/.test(argsText(call)),
      argsText(call)
    );
    ok(
      `kayıt ${"autoAssignIfEligible"} içinde`,
      enclosingFunction(call) === "autoAssignIfEligible",
      enclosingFunction(call)
    );
  }

  // Sıralamadan geçip de hiçbir iş YERLEŞTİRMEYEN ÜÇ çıkış var ve üçü de taslağı
  // düşürmek zorunda: uygun aday çıkmaması, korumalı UPDATE'in eşleşmemesi
  // (yarış) ve fonksiyonun dış yakalaması — atama çağrısı "ok değil" dönmek
  // yerine FIRLATIRSA taslak aksi hâlde bellekte kalırdı. Düşürülmezse gecikmeli
  // doğrulama, o sırada siparişi alan BAŞKA bir aktörün atamasını bizim kararımız
  // sanıp kaydeder.
  const discards = callsOf(confirmSf, "discardAssignmentEvaluation");
  ok("yerleştirmeyen her çıkış taslağı düşürür", discards.length === 3, discards.length);
  const discardTrails = discards.map((c) => guardTrail(c).join(" && "));
  ok(
    "aday bulunamayan çıkış düşürür",
    discardTrails.some((t) => /!best/.test(t)),
    discardTrails
  );
  ok(
    "yarışı kaybeden çıkış düşürür",
    discardTrails.some((t) => /!result\.ok/.test(t) && /ranked/.test(t)),
    discardTrails
  );
  // Sıra kuralın kendisi: önce korumalı UPDATE, sonra kayıt. Ters olsaydı
  // gerçekleşmeyen bir atama kaydedilirdi.
  ok(
    "kayıt korumalı UPDATE'ten SONRA gelir",
    confirmSrc.indexOf("assignManufacturerToOrder({") <
      confirmSrc.indexOf("commitAssignmentEvaluation(")
  );
}

// ─── Ret yolu: satıcı kuralı ve değerlendirme taslağının kaderi ─────────────
// Ret, otomatik atamanın İKİZİ bir yerleştirme yoludur: siparişi koparır ve
// yeniden yerleştirir. İki kural burada da aynı olmak zorunda — yoksa satıcının
// kendi katalog ürünü, reddedildiği anda rakip bir atölyeye basılmaya gider
// (sıralayıcı satıcıyı BİLMEZ) ve hiçbir işi yerleştirmemiş bir sıralama
// gecikmeli doğrulamayla başkasının atamasını kendi kararı diye kaydeder.
console.log("ret yolu: satıcı kuralı ve değerlendirme (AST)");

const DECLINE_REL = "src/lib/services/manufacturer-decline.ts";
const declineSrc = read(DECLINE_REL);
const declineSf = parse(DECLINE_REL);
{
  const plans = callsOf(declineSf, "autoAssignPlacementPlan");
  ok("ret yolu ORTAK yerleştirme kuralını çağırır", plans.length === 1, plans.length);
  ok(
    "kural sıralamadan ÖNCE hesaplanır",
    declineSrc.indexOf("autoAssignPlacementPlan(") > 0 &&
      declineSrc.indexOf("autoAssignPlacementPlan(") <
        declineSrc.indexOf("rankForOrderWithShadow(")
  );
  ok(
    "plan siparişin SATICISINI okur",
    /sellerManufacturerId: result\.sellerManufacturerId/.test(declineSrc)
  );
  ok(
    "işlem satıcı kimliğini dışarı taşır",
    /sellerManufacturerId: order\.sellerManufacturerId/.test(declineSrc)
  );
  ok(
    "reddeden atölye plana taşınır (satıcı KENDİ siparişini reddettiyse rakibe kaymaz)",
    /declinedManufacturerIds: result\.declinedList/.test(declineSrc)
  );
  // Eski kopya kuralı `orderType` üzerinden anlatıyordu: hem satıcısı olmayan
  // platform siparişlerini gereksizce admin'e yığıyor, hem de asıl kuralı
  // (ürünün sahibi) dolaylı söylüyordu.
  ok(
    "satıcı kuralının ikinci kopyası yok (orderType üzerinden anlatılmıyor)",
    !/orderType === "marketplace"/.test(declineSrc)
  );

  const rankCalls = callsOf(declineSf, "rankForOrderWithShadow");
  ok("ret yolunda sıralama tek yerde çağrılır", rankCalls.length === 1, rankCalls.length);
  const rankTrail = rankCalls.map((c) => guardTrail(c).join(" && ")).join("");
  ok(
    "sıralama yalnız `rank` planında çalışır (satıcı siparişi sıralanmaz)",
    /plan\.kind/.test(rankTrail),
    rankTrail || "(koşulsuz)"
  );
  ok(
    "satıcının kendi ürünü sahibinin atölyesine verilir",
    /plan\.kind === "seller"/.test(declineSrc) &&
      /targetManufacturerId = plan\.manufacturerId/.test(declineSrc)
  );
  ok(
    "sahibi atölye alamıyorsa sipariş admin'i bekler (rakibe verilmez)",
    /plan\.kind === "skip"/.test(declineSrc) &&
      /"marketplace_seller_declined"/.test(declineSrc)
  );
  ok(
    "sahibi atölye aktif değilse sebep ayrıca adlandırılır",
    /"seller_shop_unavailable"/.test(declineSrc) &&
      /manufacturer_unavailable/.test(declineSrc)
  );
  ok(
    "admin sessizce yalnız bırakılmaz (not + e-posta)",
    /appendAdminNote\(/.test(declineSrc) &&
      (declineSrc.match(/notifyAdminManualAssignment\(\{/g) ?? []).length >= 3
  );
  // Sonradan süzmek, kayda SEÇİLEMEYECEK bir kazanan bırakıyordu; reddedenleri
  // sıralayıcı zaten siparişin kendi satırından okuyup uygunsuz işaretliyor.
  ok(
    "aday doğrudan sıralamadan okunur, sonradan süzülmez",
    /candidates\.find\(\(c\) => c\.eligible\)/.test(declineSrc) &&
      !/c\.manufacturerId !== manufacturerId/.test(declineSrc)
  );

  const commits = callsOf(declineSf, "commitAssignmentEvaluation");
  ok("ret yolu yerleştirmeyi KAYDEDER", commits.length === 1, commits.length);
  for (const call of commits) {
    ok(
      "kayıt yalnız SIRALAMADAN geçen yerleştirmede yazılır",
      /ranked/.test(guardTrail(call).join(" && ")),
      guardTrail(call).join(" && ") || "(koşulsuz)"
    );
    ok(
      "kayıt, gerçekten atanan atölyeyi yazar",
      /targetManufacturerId/.test(argsText(call)),
      argsText(call)
    );
  }
  ok(
    "kayıt korumalı UPDATE'ten SONRA gelir",
    declineSrc.indexOf("assignManufacturerToOrder({") <
      declineSrc.indexOf("commitAssignmentEvaluation(")
  );

  const declineDiscards = callsOf(declineSf, "discardAssignmentEvaluation");
  ok(
    "ret yolunda yerleştirmeyen her sıralama çıkışı taslağı düşürür",
    declineDiscards.length === 3,
    declineDiscards.length
  );
  const declineDiscardTrails = declineDiscards.map((c) => guardTrail(c).join(" && "));
  ok(
    "aday kalmayan çıkış düşürür",
    declineDiscardTrails.some((t) => /!next/.test(t)),
    declineDiscardTrails
  );
  ok(
    "yarışı kaybeden çıkış düşürür",
    declineDiscardTrails.some((t) => /!assigned\.ok/.test(t) && /ranked/.test(t)),
    declineDiscardTrails
  );
}

// Otomatik atamanın DIŞ yakalaması da taslağı düşürmeli: atama çağrısı "ok
// değil" dönmek yerine FIRLATIRSA taslak bellekte kalıyor ve 2,5 sn'lik
// doğrulama, o sırada siparişi alan başka bir aktörün atamasını bizim
// sıralamamızın sonucu sanıp kaydediyordu.
{
  const catchDiscard = callsOf(confirmSf, "discardAssignmentEvaluation").some((c) => {
    for (let n: ts.Node | undefined = c; n; n = n.parent) {
      if (ts.isCatchClause(n)) return true;
    }
    return false;
  });
  ok("otomatik atamanın catch bloğu da taslağı düşürür", catchDiscard);
}

// ─── Atama kapısı: MÜLKİYET kuralı orada mı (E-C1) ─────────────────────────
// Kural çağıran başına kopyalandığı sürece bir sonraki yazıcı onu unutuyordu:
// atamayı geri alıp doğrudan başka bir atölyeye devreden rota kendi UPDATE'ini
// yazıyor ve hiçbir mülkiyet kontrolü yapmıyordu. Kural artık siparişe üretici
// yazan TEK NOKTADA; burada da onun orada KALDIĞI denetleniyor.
console.log("atama kapısı: mülkiyet kuralı (E-C1)");

const assignSf = parse("src/lib/services/manufacturer-assign.ts");
ok(
  "AssignFailure `seller_owned` üyesini taşır",
  /\|\s*"seller_owned"/.test(assignSrc)
);
ok(
  "`seller_owned` reddinin Türkçe karşılığı var",
  /seller_owned:\s*\n?\s*"[^"]*atölye/.test(assignSrc),
  assignSrc.match(/seller_owned:[^,]*/)?.[0]
);
ok(
  "kural YENİDEN YAZILMAZ, otomatik atamanın saf kuralından okunur",
  assignSrc.includes("autoAssignPlacementPlan("),
);
ok(
  "mülkiyet kontrolü korumalı UPDATE'ten ÖNCE gelir",
  assignSrc.indexOf("sellerOwnedPlacementBlocked(") > 0 &&
    assignSrc.indexOf("sellerOwnedPlacementBlocked(") < assignSrc.indexOf(".update(orders)")
);
// Ön okuma ile yazı arasında sahip değişirse ön kontrol bayatlar: kuralın SQL
// ikizi yazının İÇİNDE de durmalı.
ok(
  "kuralın SQL ikizi korumalı UPDATE'in koşullarında",
  /conditions\.push\(sellerPlacementGuard\(manufacturerId\)\)/.test(assignSrc)
);
ok(
  "SQL ikizi de aynı cümleyi söyler (sahibi yok ya da sahibi tam olarak bu atölye)",
  /isNull\(orders\.sellerManufacturerId\)/.test(assignSrc) &&
    /eq\(orders\.sellerManufacturerId, manufacturerId\)/.test(assignSrc)
);
// Aşma: sahibin kararı. Mümkün olmalı (satıcının atölyesi temelli kapanabilir)
// ama DENETLENEBİLİR olmalı — bayrak tek başına yetmez.
ok(
  "aşma üç şeyi birden ister: açık bayrak + admin + gerekçe",
  /args\.allowSellerOverride === true &&\s*!!args\.adminEmail &&\s*overrideReason\.length > 0/.test(
    assignSrc
  )
);
// Yukarıdaki `length > 0` TEK BAŞINA barajı pinlemez: `overrideReason` artık
// barajdan geçmiş değerdir, yani baraj 1 karaktere düşse bile o satır yeşil
// kalırdı. Barajın kendisi ayrıca denetlenir — sayı adı konmuş bir SABİTTİR,
// değeri denetlenebilir bir gerekçe için yeterlidir ve aşmayı sayan karşılaştırma
// gerçekten o sabite bakar.
const overrideBar = Number(
  assignSrc.match(/export const SELLER_OVERRIDE_REASON_MIN_LENGTH = (\d+)/)?.[1]
);
ok(
  "aşma gerekçesinin alt sınırı adı konmuş bir sabittir",
  Number.isFinite(overrideBar),
  overrideBar
);
ok(
  "baraj denetlenebilir bir gerekçe için yeterince yüksek (en az 10 karakter)",
  overrideBar >= 10,
  overrideBar
);
ok(
  "denetlenmiş sayılan gerekçe BARAJDAN geçirilir (karşılaştırma sabite bakar)",
  /rawOverrideReason\.length >= SELLER_OVERRIDE_REASON_MIN_LENGTH/.test(assignSrc)
);
// Rotalar barajı KOPYALAMAZ: 10 / 3 / serbest ayrışması tam olarak böyle doğdu.
{
  const rel = "src/app/api/admin/orders/[id]/assign-manufacturer/route.ts";
  const routeSrc = read(rel);
  ok(
    `${rel}: barajı kapıdan içe aktarır`,
    /SELLER_OVERRIDE_REASON_MIN_LENGTH/.test(routeSrc) &&
      /from "@\/lib\/services\/manufacturer-assign"/.test(routeSrc)
  );
  ok(
    `${rel}: kendi sayısını yazmaz`,
    !/\.min\(\s*\d/.test(routeSrc),
    routeSrc.match(/\.min\(\s*\d[^)]*/)?.[0]
  );
}
{
  const refusals = callsOf(assignSf, "sellerOwnedPlacementBlocked");
  ok("mülkiyet kararı tek yerde verilir", refusals.length === 1, refusals.length);
  // Reddin kendisi: `seller_owned` dönüşü YALNIZ denetlenmemiş aşmada çalışmalı.
  const sellerReturn = (() => {
    let found: string[] | null = null;
    forEachNode(assignSf, (n) => {
      if (
        ts.isReturnStatement(n) &&
        n.expression &&
        /reason: "seller_owned"/.test(n.expression.getText())
      ) {
        found = guardTrail(n);
      }
    });
    return found as string[] | null;
  })();
  ok("kural ihlali reddedilir (`seller_owned` dönüşü var)", !!sellerReturn);
  ok(
    "ret yalnız DENETLENMEMİŞ aşmada verilir (denetlenmiş aşma geçer)",
    !!sellerReturn && sellerReturn.join(" && ").includes("!overrideAudited"),
    sellerReturn
  );
}
ok(
  "aşma denetim satırı satıcıyı ve GEREKÇEyi birlikte yazar",
  /SATICI KURALI AŞILDI/.test(assignSrc) &&
    /Gerekçe: \$\{overrideReason\}/.test(assignSrc)
);
ok(
  "aşmada ürünün SAHİBİ bilgilendirilir",
  /manufacturerId: ownership\.sellerManufacturerId!/.test(assignSrc)
);
ok(
  "ret, satıcıyı çağırana taşır (rota adıyla söyleyebilsin)",
  /sellerName: ownership\.sellerName/.test(assignSrc)
);

// ─── Ret yolu: türün otomatik atama anahtarı ───────────────────────────────
// Ret sonrası yeniden yerleştirme de bir YERLEŞTİRMEDİR. Anahtarı okumayan ret
// yolu, kapatılmış bir anahtarın arkadan dolaşılması demekti: üretici reddeder,
// sistem siparişi yine kendiliğinden bir başkasına verirdi.
console.log("ret yolu: sipariş türü anahtarı");
ok("ret yolu anahtarı OKUR", declineSrc.includes("isFlagEnabled("));
ok(
  "tür siparişin kendi kolonlarından türetilir (ikinci bir kopya yok)",
  declineSrc.includes("classifyAutoAssignOrder(") &&
    declineSrc.includes("autoAssignFlagFor(")
);
ok(
  "anahtar SIRALAMADAN önce okunur",
  declineSrc.indexOf("isFlagEnabled(") <
    declineSrc.indexOf("rankForOrderWithShadow(")
);
ok(
  "anahtarı OLMAYAN tür (atölye) asla otomatik atanmaz — bayrak okunmadan çıkılır",
  /flagKey \? await isFlagEnabled\(flagKey\) : false/.test(declineSrc)
);
{
  // Kapalı anahtarın çıkışı: admin kuyruğu, sebebi adıyla.
  const flagReturn = (() => {
    let found: string[] | null = null;
    forEachNode(declineSf, (n) => {
      if (
        ts.isReturnStatement(n) &&
        n.expression &&
        /auto_assign_off/.test(n.expression.getText())
      ) {
        found = guardTrail(n);
      }
    });
    return found as string[] | null;
  })();
  ok("kapalı anahtarda sipariş admin kuyruğuna düşer", !!flagReturn);
  ok(
    "bu çıkış yalnız anahtar KAPALIYKEN çalışır",
    !!flagReturn && flagReturn.join(" && ").includes("!flagEnabled"),
    flagReturn
  );
}
ok(
  "atölye siparişi için ayrı, adı konmuş sebep",
  declineSrc.includes("workshop_never_auto_assigned")
);
ok(
  "admin sessizce bırakılmaz: kapalı anahtarda da not + e-posta",
  /otomatik atama anahtarı kapalı/.test(declineSrc)
);
// P2 kararı: sahipsiz pazaryeri siparişi reddedildiğinde YENİDEN SIRALANIR.
// Gerekçesi kodda yazılı olmalı, yoksa bir sonraki okuyan onu "eksik kalmış
// pazaryeri kontrolü" sanıp geri koyar.
ok(
  "sahipsiz pazaryeri siparişinin neden yeniden sıralandığı YAZILI",
  /SAHİPSİZ \(platform\)/.test(declineSrc)
);

// ─── Ret yolu: sıralama ile atama arasındaki hata penceresi (P3) ───────────
console.log("ret yolu: hata penceresi");
{
  const rankCall = callsOf(declineSf, "rankForOrderWithShadow")[0];
  ok("ret yolunda sıralama var", !!rankCall);
  const inTry = (() => {
    for (let n: ts.Node | undefined = rankCall; n; n = n.parent) {
      if (ts.isTryStatement(n)) return n;
    }
    return undefined;
  })();
  ok("sıralama bir try bloğunun İÇİNDE", !!inTry);
  const catchDiscards =
    inTry?.catchClause
      ? callsOf(declineSf, "discardAssignmentEvaluation").filter((c) => {
          for (let n: ts.Node | undefined = c; n; n = n.parent) {
            if (n === inTry.catchClause) return true;
          }
          return false;
        })
      : [];
  ok("catch bloğu taslağı düşürür", catchDiscards.length === 1, catchDiscards.length);
  ok(
    "catch'teki düşürme KOŞULSUZ (sıralama yapılmadıysa zaten no-op)",
    catchDiscards.length === 1 && guardTrail(catchDiscards[0]).length === 0,
    catchDiscards.length === 1 ? guardTrail(catchDiscards[0]) : "-"
  );
  ok(
    "ret zaten commit olduğu için hata da admin kuyruğuyla biter",
    /reason: "placement_error"/.test(declineSrc)
  );
}

// ─── Atölye partisi: toplu yazılar da kurala tabidir (P9) ──────────────────
// Atölye siparişinin bugün satıcısı yok, yani bu bir canlı ihlal DEĞİL. Ama
// terfi (`order-draft`) `sellerManufacturerId`i koşulsuz kopyalıyor: tek bir
// alan, bunu canlı ihlalden ayırıyor. Parti yazımı sipariş başına atama
// servisinden geçmediği için kuralı kendi WHERE'inde taşımak zorunda.
console.log("atölye partisi: mülkiyet kuralı");
{
  const workshopRel = "src/lib/services/workshop-session.ts";
  const workshopSrc = read(workshopRel);
  ok(
    "kural ORTAK kaynaktan gelir (ikinci bir kopya yazılmamış)",
    /from "@\/lib\/services\/manufacturer-assign"/.test(workshopSrc) &&
      workshopSrc.includes("sellerOwnedPlacementBlocked") &&
      workshopSrc.includes("sellerPlacementGuard")
  );
  ok(
    "üreticiye yazan üç toplu UPDATE'in üçünde de SQL koşulu var",
    (workshopSrc.match(/sellerPlacementGuard\(/g) ?? []).length === 3,
    (workshopSrc.match(/sellerPlacementGuard\(/g) ?? []).length
  );
  ok(
    "kuralın elediği sipariş SESSİZCE kaybolmaz (gürültülü log)",
    (workshopSrc.match(/satıcısına ait olduğu için/g) ?? []).length === 3,
    (workshopSrc.match(/satıcısına ait olduğu için/g) ?? []).length
  );
  ok(
    "elenen siparişte komisyon oranı YİNE donar (oran fiyattır, atama değil)",
    /batchAssignmentSet\(\{ manufacturerId: null, commissionRateBps, at: closedAt \}\)/.test(
      workshopSrc
    )
  );
  ok(
    "üreticiye söylenen adet, GERÇEKTEN ona yazılan adettir",
    /const placedCount = outcome\.manufacturerId \? outcome\.batch\.length : 0;/.test(
      workshopSrc
    ) &&
      /orderCount: placedCount,/.test(workshopSrc) &&
      // toplu devir ucu (assignBatchManufacturer) aynı cümleyi kendi
      // değişkeniyle söyler: orada `batch` zaten yalnız yazılan satırlardır.
      /orderCount: outcome\.batch\.length,/.test(workshopSrc)
  );
  // Hiçbir siparişin yazılmadığı partinin İKİ sebebi var (seansta üretici yok
  // YA DA partinin tamamı mülkiyet kuralına takıldı) ve ikisi de admin'in elle
  // atamasını gerektirir. Koşul yalnız ilkine bakarsa ikincisinde kimse haber
  // almaz: seans kapanmış, siparişler ödenmiş, kimse basmıyor.
  ok(
    "hiçbir siparişi yazılmayan parti admin'e bildirilir (iki sebep de)",
    /outcome\.orderCount > 0 && placedCount === 0/.test(workshopSrc)
  );
  // "Bu seansa ödenmiş katılımcı olmadı" cümlesi yalnız GERÇEKTEN boş seansta
  // doğrudur; tamamı elenmiş bir partide üreticiye söylenirse yalan olur.
  ok(
    "üreticiye 'parti iptal' yalnız sipariş HİÇ yokken söylenir",
    /outcome\.manufacturerId && outcome\.orderCount === 0/.test(workshopSrc)
  );
  // Süpürmenin iş geçmişi de aynı sayıyı konuşmalı: parti büyüklüğünü yazmak,
  // kısmen elenmiş bir partiyi "tamamı atandı" diye kaydediyordu.
  const closeWorkerSrc = read("src/lib/queue/workers/workshop-close.worker.ts");
  ok(
    "kapanış süpürmesinin iş geçmişi ATANAN ve ATLANAN adedi yazar",
    /result\.assignedCount/.test(closeWorkerSrc) && /result\.skippedCount/.test(closeWorkerSrc)
  );
}

// ─── Siparişe üretici YAZAN her yol: yapısal tarama ────────────────────────
//
// Eski hâli METİN aramasıydı ve iki deliği vardı:
//  1. yalnız `rankForOrderWithShadow` çağıran dosyaları buluyordu — doğrudan ham
//     sıralayıcıyla kurulan yeni bir yerleştirme yolu kapsam dışında kalırdı;
//  2. "dosyada commit ve discard geçiyor mu" diye bakıyordu — sıralamadan sonraki
//     üç çıkışından yalnız birinde taslağı düşüren bir yol da yeşil kalırdı.
//
// Yerine AST geçiyor. `orders` tablosuna ÜRETİCİ yazan her ifade bulunur ve her
// biri iki soruya cevap vermek zorundadır:
//   MÜLKİYET — bu yazı satıcının kendi ürününü rakip bir atölyeye verebilir mi?
//   TASLAK   — sıralama yapıyorsa, sıralamadan SONRAKİ her çıkışta değerlendirme
//              taslağını ya işliyor ya düşürüyor mu?
console.log("yerleştirme yolları: yapısal tarama");

const CHOKEPOINT_REL = "src/lib/services/manufacturer-assign.ts";
const SHADOW_REL = "src/lib/services/manufacturer-assignment-shadow.ts";
const WORKSHOP_REL = "src/lib/services/workshop-session.ts";
/** Sıralayıcının HER hâli: yeni bir yol hangisini çağırırsa çağırsın yakalanır. */
const RANKERS = [
  "rankForOrderWithShadow",
  "rankManufacturersForOrder",
  "rankManufacturersForProfiles",
];
/** Beklemedeki değerlendirme taslağını KAPATAN iki çağrı. */
const SETTLERS = ["commitAssignmentEvaluation", "discardAssignmentEvaluation"];

const walkSrc = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walkSrc(rel);
    return e.isFile() && /\.tsx?$/.test(e.name) ? [rel] : [];
  });
const SRC_FILES = walkSrc("src");

/** `db.update(orders)` / `db.insert(orders)` zinciri: metot adı → çağrı. */
function fluentChain(start: ts.CallExpression): Map<string, ts.CallExpression> {
  const chain = new Map<string, ts.CallExpression>();
  let cur: ts.Node = start;
  while (cur.parent) {
    const p: ts.Node = cur.parent;
    if (
      ts.isPropertyAccessExpression(p) &&
      p.expression === cur &&
      p.parent &&
      ts.isCallExpression(p.parent) &&
      p.parent.expression === p
    ) {
      chain.set(p.name.text, p.parent);
      cur = p.parent;
      continue;
    }
    break;
  }
  return chain;
}

/**
 * Bu yazı `manufacturerId`ye NE atıyor? `null` (string) = alanı NULL'a çekiyor
 * (kopartma, ihlal edemez); `undefined` = alana hiç dokunmuyor.
 *
 * Kısayol (`manufacturerId,`) ve yardımcı üzerinden yazım (atölye partisinin
 * `batchAssignmentSet(...)`'i) bilerek çözülüyor: naif bir metin araması ikisini
 * de kaçırıyordu ve atölye partisinin üç yazısından ikisi tam olarak böyle
 * yazılmış.
 */
function manufacturerValue(payload: ts.Node | undefined): string | undefined {
  if (!payload) return undefined;
  if (ts.isCallExpression(payload)) return manufacturerValue(payload.arguments[0]);
  if (!ts.isObjectLiteralExpression(payload)) return undefined;
  for (const prop of payload.properties) {
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "manufacturerId") {
      return prop.name.text;
    }
    if (ts.isPropertyAssignment(prop) && prop.name.getText() === "manufacturerId") {
      return prop.initializer.getText().replace(/\s+/g, " ");
    }
    if (ts.isSpreadAssignment(prop)) {
      const inner = manufacturerValue(prop.expression);
      if (inner) return inner;
    }
  }
  return undefined;
}

interface OrderWrite {
  rel: string;
  line: number;
  value: string;
  where: string;
  placement: boolean;
}

const orderWrites: OrderWrite[] = [];
for (const rel of SRC_FILES) {
  const sf = parse(rel);
  forEachNode(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
    const method = n.expression.name.text;
    if (method !== "update" && method !== "insert") return;
    if (n.arguments.length !== 1) return;
    const table = n.arguments[0];
    if (!ts.isIdentifier(table) || table.text !== "orders") return;
    const chain = fluentChain(n);
    const payload = (chain.get("set") ?? chain.get("values"))?.arguments[0];
    const value = manufacturerValue(payload);
    if (value === undefined) return;
    orderWrites.push({
      rel,
      line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
      value,
      where: chain.get("where")?.getText().replace(/\s+/g, " ") ?? "",
      placement: value !== "null",
    });
  });
}

const placements = orderWrites.filter((w) => w.placement);
ok("siparişe üretici yazan ifadeler bulundu", orderWrites.length > 0, orderWrites.length);
ok(
  "taramada hem yerleştirme hem kopartma yazıları var (tarayıcı körelmemiş)",
  placements.length > 0 && orderWrites.length > placements.length,
  { placements: placements.length, total: orderWrites.length }
);
ok(
  "atamanın TEK KAPISI da taramada görünüyor",
  placements.some((w) => w.rel === CHOKEPOINT_REL),
  placements.map((w) => w.rel)
);
ok(
  "atölye partisinin ÜÇ toplu yazısı da taramada",
  placements.filter((w) => w.rel === WORKSHOP_REL).length === 3,
  placements.filter((w) => w.rel === WORKSHOP_REL)
);

// MÜLKİYET: kapının DIŞINDA kalan her yerleştirme yazısı kuralı kendi üstünde
// taşımak zorunda. "Dosya bir yerinde atama servisini çağırıyor" MAZERET DEĞİL:
// geri alma rotası tam olarak öyleydi — servisi başka bir dalda çağırıyor, ama
// devri kendi UPDATE'iyle yazıyordu.
for (const w of placements) {
  if (w.rel === CHOKEPOINT_REL) continue; // kuralın EVİ, yukarıda ayrıca denetlendi
  // İki yapısal muafiyet:
  //  - yazılan değer siparişin KENDİ satıcısından türüyorsa başka bir atölye
  //    seçilemez (terfi anında satıcıya atama);
  //  - WHERE kuralın SQL ikizini taşıyorsa ihlal eden satır zaten eşleşmez.
  const ownSellerOnly = /sellerManufacturerId|sellerId/.test(w.value);
  const guarded = /sellerPlacementGuard\(/.test(w.where);
  ok(
    `${w.rel}:${w.line} mülkiyet kuralını uygular (kendi satıcısı ya da SQL koşulu)`,
    ownSellerOnly || guarded,
    w
  );
}

/** En yakın saran fonksiyon DÜĞÜMÜ (adı değil). */
function enclosingFunctionNode(node: ts.Node): ts.Node | undefined {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p)
    ) {
      return p;
    }
  }
  return undefined;
}

/** Fonksiyonun kendi çıkışları (iç içe fonksiyonlarınkiler DEĞİL). */
function exitsOf(fn: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if (
      n !== fn &&
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n))
    ) {
      return;
    }
    if (ts.isReturnStatement(n) || ts.isContinueStatement(n) || ts.isBreakStatement(n)) {
      out.push(n);
    }
    n.forEachChild(visit);
  };
  visit(fn);
  return out;
}

function containsSettler(node: ts.Node, afterPos: number): boolean {
  let found = false;
  forEachNode(node, (n) => {
    if (found) return;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      SETTLERS.includes(n.expression.text) &&
      n.getStart() > afterPos
    ) {
      found = true;
    }
  });
  return found;
}

/**
 * Bu çıkışa gelene kadar taslak KAPATILMIŞ mı?
 *
 * Çıkıştan yukarı yürünür; her blok seviyesinde ÖNCE gelen deyimlere bakılır.
 * Böylece `if (!ok) { if (ranked) discard(); ...; return X; }` gibi iç içe
 * çıkışlar da dıştaki düşürmeyi görür — ama sıralamadan ÖNCE yazılmış bir
 * düşürme sayılmaz (afterPos).
 */
function settlesBefore(exit: ts.Node, afterPos: number): boolean {
  let child: ts.Node = exit;
  for (let p: ts.Node | undefined = exit.parent; p; child = p, p = p.parent) {
    if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) {
      for (const st of p.statements) {
        if (st.getStart() >= child.getStart()) break;
        if (containsSettler(st, afterPos)) return true;
      }
    }
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p)
    ) {
      break;
    }
  }
  return false;
}

// YERLEŞTİRME YOLU = sıralama yapan VE siparişe üretici yazan (kapıdan ya da
// doğrudan) dosya. Salt-okunur sıralama yüzeyleri (admin önizlemesi, tarama
// kuru koşusu) hiçbir şey yerleştirmediği için taslak disiplinine tabi değil.
const placementPathRels = SRC_FILES.filter((rel) => {
  if (rel === SHADOW_REL) return false;
  const src = read(rel);
  const ranks = RANKERS.some((r) => src.includes(`${r}(`));
  if (!ranks) return false;
  return src.includes("assignManufacturerToOrder(") || placements.some((w) => w.rel === rel);
});
ok("sıralayıp yerleştiren yollar bulundu", placementPathRels.length >= 3, placementPathRels);
for (const known of [
  "src/lib/services/order-confirm.ts",
  "src/lib/services/manufacturer-decline.ts",
  "src/app/api/admin/assignment-sweep/route.ts",
]) {
  // Tarama bir gün hiçbir şey bulamazsa sessizce yeşil kalmasın.
  ok(`${known}: bilinen yerleştirme yolu taramada görünüyor`, placementPathRels.includes(known), placementPathRels);
}

for (const rel of placementPathRels) {
  const sf = parse(rel);
  const src = read(rel);
  ok(`${rel}: yerleşen atamayı KAYDEDER`, src.includes("commitAssignmentEvaluation("), rel);
  // Mülkiyet: bu yolun kendi ham yazısı yoksa kuralı kapı uygular; varsa yukarıdaki
  // döngü zaten satır satır denetledi.
  ok(
    `${rel}: mülkiyet kuralına tabi (kapıdan geçiyor ya da kendi koşulunu taşıyor)`,
    src.includes("assignManufacturerToOrder(") || placements.some((w) => w.rel === rel),
    rel
  );
  const rankCalls = RANKERS.flatMap((r) => callsOf(sf, r));
  ok(`${rel}: sıralama çağrısı bulundu`, rankCalls.length > 0, rankCalls.length);
  for (const call of rankCalls) {
    const fn = enclosingFunctionNode(call);
    ok(`${rel}: sıralama bir fonksiyonun içinde`, !!fn);
    if (!fn) continue;
    const exits = exitsOf(fn).filter((e) => e.getStart() > call.getEnd());
    ok(
      `${rel}: sıralamadan SONRA en az bir çıkış var (tarama körelmemiş)`,
      exits.length > 0,
      exits.length
    );
    for (const exit of exits) {
      const line = sf.getLineAndCharacterOfPosition(exit.getStart()).line + 1;
      ok(
        `${rel}:${line} sıralama sonrası çıkış taslağı işler ya da düşürür`,
        settlesBefore(exit, call.getEnd()),
        exit.getText().replace(/\s+/g, " ").slice(0, 70)
      );
    }
  }
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exitCode = failed ? 1 : 0;
