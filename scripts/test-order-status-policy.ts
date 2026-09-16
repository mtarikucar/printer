import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  REJECTABLE_STATUSES,
  REFUNDED_ORDER_ERROR,
  REFUNDED_PAYMENT_STATUS,
  appendAdminNote,
  formatAdminNoteLine,
  isRefunded,
} from "../src/lib/config/order-status-policy";
import { orderStatusEnum, paymentStatusEnum } from "../src/lib/db/schema";
import { WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES } from "../src/lib/config/workshop";

// Sipariş durumu politikası (src/lib/config/order-status-policy.ts): admin not
// satırının biçimi ve ekleme kuralı, ret listesi ve iade kuralı. Modül saf; test
// DB'ye bağlanmaz. Sondaki kaynak taraması iade korumasının her ileri işlem
// rotasında atomik UPDATE'in WHERE'inde durduğunu, 'succeeded' şartına geri
// dönülmediğini ve iade çevirmesinin yarışa kapalı olduğunu denetler. Bunlara
// partner (üretici/boyacı) ve QC ileri adımları, müşteri model onayı ile onay
// SLA'sı ve tek tahakkuk noktası (hakediş yalnız kilitli, korumalı okumayla
// aynı işlemde yazılır) dahildir:
// korumayı kaldıran, ön okumaya taşıyan ya da daraltan bir değişiklik burada
// kırılır. Ters yönü de denetler: temizlik yolları (üretici reddi, ret, düz
// geri alma) iade edilmiş siparişte de partneri koparır ve siparişi ileri
// taşıyan hiçbir adıma (sıralayıcı, otomatik atama, iade yan etkileri) geçmez.

let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (!cond) {
    failed++;
    console.error("  FAIL", name, extra ?? "");
  } else console.log("  ok  ", name);
}

// ─── Not satırı ve ekleme kuralı ────────────────────────────────────────────
const at = new Date("2026-09-11T14:05:00Z");
ok("stamp is Istanbul (UTC+3)", formatAdminNoteLine("x", at) === "[2026-09-11 17:05] x", formatAdminNoteLine("x", at));
const mid = new Date("2026-09-11T21:00:00Z");
ok("midnight is 00:00 next day", formatAdminNoteLine("x", mid) === "[2026-09-12 00:00] x", formatAdminNoteLine("x", mid));
ok("note trimmed", formatAdminNoteLine("  a b  ", at) === "[2026-09-11 17:05] a b");
ok("append to null", appendAdminNote(null, "a", at) === "[2026-09-11 17:05] a");
ok("append to empty", appendAdminNote("", "a", at) === "[2026-09-11 17:05] a");
ok("append to undefined", appendAdminNote(undefined, "a", at) === "[2026-09-11 17:05] a");
ok("append keeps existing", appendAdminNote("[SLA] flag", "a", at) === "[SLA] flag\n[2026-09-11 17:05] a");
ok("empty note is no-op", appendAdminNote("old", "   ", at) === "old");
ok("empty note on null", appendAdminNote(null, "") === "");
ok("default at is now-ish", /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] z$/.test(formatAdminNoteLine("z")));

// ─── Ret listesi ────────────────────────────────────────────────────────────
const statuses = orderStatusEnum.enumValues as readonly string[];
const bad = REJECTABLE_STATUSES.filter((s) => !statuses.includes(s));
ok("every REJECTABLE status is a real enum value", bad.length === 0, bad);
ok("awaiting_model rejectable", REJECTABLE_STATUSES.includes("awaiting_model"));
ok("awaiting_customer_approval rejectable", REJECTABLE_STATUSES.includes("awaiting_customer_approval"));
for (const s of ["printing", "quality_check", "painting", "shipped", "delivered", "rejected"]) {
  ok(`${s} NOT rejectable`, !REJECTABLE_STATUSES.includes(s));
}
ok(
  "previous server list kept",
  ["review", "approved", "failed_generation", "failed_mesh", "generating", "processing_mesh", "paid"].every((s) =>
    REJECTABLE_STATUSES.includes(s)
  )
);

// ─── İade kuralı ────────────────────────────────────────────────────────────
// Enum'un tamamı sabitlenmez: kural "iade edilmemiş"tir, "ödendi" değil. Yeni
// bir ödeme durumu (ör. havale bekleyen) eklemek korumaları değiştirmemeli.
const paymentStatuses = paymentStatusEnum.enumValues as readonly string[];
ok("REFUNDED_PAYMENT_STATUS is a real payment_status value", paymentStatuses.includes(REFUNDED_PAYMENT_STATUS));
ok("succeeded is a real payment_status value", paymentStatuses.includes("succeeded"));
ok("isRefunded refunded", isRefunded({ paymentStatus: REFUNDED_PAYMENT_STATUS }) === true);
for (const s of paymentStatuses.filter((v) => v !== REFUNDED_PAYMENT_STATUS)) {
  ok(`isRefunded ${s} is false`, isRefunded({ paymentStatus: s }) === false);
}
ok("a future payment status is NOT refunded", isRefunded({ paymentStatus: "pending" }) === false);
ok("isRefunded null", isRefunded({ paymentStatus: null }) === false);
ok("isRefunded undefined", isRefunded({ paymentStatus: undefined }) === false);
ok("refund error is Turkish + non-empty", REFUNDED_ORDER_ERROR.startsWith("Bu sipariş iade edildi"));
ok(
  "refund error names approval and model upload",
  REFUNDED_ORDER_ERROR.includes("Onay") && REFUNDED_ORDER_ERROR.includes("model yükleme")
);

// ─── Kaynak taraması: iade korumasının yeri ─────────────────────────────────
// Metin değil sözdizimi ağacı taranır (TypeScript derleyici API'si): yorumlar
// hiç sayılmaz ve koruma yalnız `update(orders)` zincirinin `.where(...)`
// argümanında (ya da o argümana `...dizi` ile yayılan dizinin ilk değerinde)
// sayılır. Ön okumada (`findFirst({ where })`) duran bir koruma yarışı
// kapatmaz: okuma ile yazma arasına giren iade yine kazanır. O yüzden burada
// başarısız sayılır.
const REPO_ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

function parse(src: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function forEachNode(root: ts.Node, fn: (n: ts.Node) => void) {
  const visit = (n: ts.Node) => {
    fn(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
}

function anyNode(root: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let hit = false;
  forEachNode(root, (n) => {
    if (!hit && pred(n)) hit = true;
  });
  return hit;
}

const isGuardCall = (n: ts.Node) =>
  ts.isCallExpression(n) &&
  ts.isIdentifier(n.expression) &&
  n.expression.text === "notRefundedGuard" &&
  n.arguments.length === 0;

/** `orders.paymentStatus` as code (not a comment or a string). */
const isPaymentStatusRef = (n: ts.Node) =>
  ts.isPropertyAccessExpression(n) &&
  ts.isIdentifier(n.expression) &&
  n.expression.text === "orders" &&
  n.name.text === "paymentStatus";

const isFunctionLike = (n: ts.Node) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n);

interface UpdateChain {
  /** The `.where(...)` call of the chain, if it has one. */
  where: ts.CallExpression | null;
  /** The `.set({...})` object, if it is a literal. */
  set: ts.ObjectLiteralExpression | null;
  /**
   * `.set(...)`'in HAM argümanı. `set` yalnız nesne DEĞİŞMEZİ olduğunda dolar;
   * yük bir değişkense (`.set(updates)`) orası boş kalır ve yazmanın durumu
   * yazıp yazmadığı ancak buradan çözülebilir.
   */
  setArg: ts.Expression | null;
  returning: boolean;
}

/** Every `<x>.update(orders)` call and the calls chained onto it. */
function updateChains(sf: ts.SourceFile): UpdateChain[] {
  const out: UpdateChain[] = [];
  forEachNode(sf, (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "update" ||
      n.arguments.length !== 1 ||
      !ts.isIdentifier(n.arguments[0]) ||
      n.arguments[0].text !== "orders"
    ) {
      return;
    }
    const chain: UpdateChain = { where: null, set: null, setArg: null, returning: false };
    let cur: ts.Node = n;
    while (
      ts.isPropertyAccessExpression(cur.parent) &&
      cur.parent.expression === cur &&
      ts.isCallExpression(cur.parent.parent) &&
      cur.parent.parent.expression === cur.parent
    ) {
      const name = cur.parent.name.text;
      const call = cur.parent.parent;
      if (name === "where" && !chain.where) chain.where = call;
      if (name === "set" && call.arguments[0]) {
        chain.setArg = call.arguments[0];
        if (ts.isObjectLiteralExpression(call.arguments[0])) chain.set = call.arguments[0];
      }
      if (name === "returning") chain.returning = true;
      cur = call;
    }
    out.push(chain);
  });
  return out;
}

/**
 * Does the WHERE carry `pred`: in its argument, or in the initializer array of
 * a variable spread into it (`and(...conditions)`), declared in the same
 * function. A later `conditions.push(...)` does not count.
 */
function whereCarries(where: ts.CallExpression, pred: (n: ts.Node) => boolean): boolean {
  let fn: ts.Node | undefined = where.parent;
  while (fn && !isFunctionLike(fn)) fn = fn.parent;
  const scope = fn ?? where.getSourceFile();
  const spreadCarries = (name: string) =>
    anyNode(
      scope,
      (d) =>
        ts.isVariableDeclaration(d) &&
        ts.isIdentifier(d.name) &&
        d.name.text === name &&
        !!d.initializer &&
        ts.isArrayLiteralExpression(d.initializer) &&
        d.initializer.elements.some((e) => pred(e) || anyNode(e, pred))
    );
  return where.arguments.some((arg) =>
    anyNode(
      arg,
      (n) =>
        pred(n) ||
        (ts.isSpreadElement(n) && ts.isIdentifier(n.expression) && spreadCarries(n.expression.text))
    )
  );
}

/** At least one `update(orders)` whose WHERE carries notRefundedGuard(). */
function guardInUpdateWhere(src: string): boolean {
  return updateChains(parse(src)).some((c) => !!c.where && whereCarries(c.where, isGuardCall));
}

/** Identifiers used as code; comments and strings never match. */
function codeIdentifiers(src: string): Set<string> {
  const ids = new Set<string>();
  forEachNode(parse(src), (n) => {
    if (ts.isIdentifier(n)) ids.add(n.text);
  });
  return ids;
}

/** `eq(orders.paymentStatus, "succeeded")` as code. */
function hasSucceededRequirement(src: string): boolean {
  return anyNode(
    parse(src),
    (n) =>
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "eq" &&
      n.arguments.length === 2 &&
      isPaymentStatusRef(n.arguments[0]) &&
      ts.isStringLiteralLike(n.arguments[1]) &&
      n.arguments[1].text === "succeeded"
  );
}

/**
 * The write that flips payment_status to 'refunded' is guarded on the payment
 * status (notRefundedGuard() or a condition on orders.paymentStatus) and
 * RETURNs, so exactly one of a racing refund and reject runs the side effects.
 */
function refundFlipGuarded(src: string): boolean {
  return updateChains(parse(src)).some(
    (c) =>
      !!c.set &&
      c.set.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          p.name.text === "paymentStatus" &&
          ts.isStringLiteralLike(p.initializer) &&
          p.initializer.text === REFUNDED_PAYMENT_STATUS
      ) &&
      !!c.where &&
      c.returning &&
      whereCarries(c.where, (n) => isGuardCall(n) || isPaymentStatusRef(n))
  );
}

// Denetleyicinin kendisi: yanlış yerdeki korumayı reddetmeli.
const SELF_TESTS: Array<[string, string, boolean]> = [
  [
    "guard inline in the UPDATE's where",
    "async function f(){ await db.update(orders).set({ status: 'x' }).where(and(eq(orders.id, id), notRefundedGuard())).returning(); }",
    true,
  ],
  [
    "guard in a conditions array spread into the where",
    "async function f(){ const conditions = [eq(orders.id, id), notRefundedGuard()]; await tx.update(orders).set({ a: 1 }).where(and(...conditions)); }",
    true,
  ],
  [
    "guard only in a pre-read",
    "async function f(){ const o = await db.query.orders.findFirst({ where: and(eq(orders.id, id), notRefundedGuard()) }); if (!o) return; await db.update(orders).set({ status: 'x' }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "guard only in a comment inside the where",
    "async function f(){ await db.update(orders).set({ status: 'x' }).where(and(eq(orders.id, id) /* notRefundedGuard() */)); }",
    false,
  ],
  [
    "guard in an array that is not spread into the where",
    "async function f(){ const conditions = [eq(orders.id, id), notRefundedGuard()]; await db.update(orders).set({ a: 1 }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "guard pushed later, not in the initializer",
    "async function f(){ const conditions = [eq(orders.id, id)]; if (x) conditions.push(notRefundedGuard()); await db.update(orders).set({ a: 1 }).where(and(...conditions)); }",
    false,
  ],
  [
    "guard on another table's UPDATE",
    "async function f(){ await db.update(manufacturers).set({ a: 1 }).where(and(eq(manufacturers.id, id), notRefundedGuard())); await db.update(orders).set({ a: 1 }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "guard inside .set(), not the where",
    "async function f(){ await db.update(orders).set({ a: notRefundedGuard() }).where(eq(orders.id, id)); }",
    false,
  ],
];
for (const [name, src, want] of SELF_TESTS) {
  ok(`checker: ${name} → ${want ? "accepted" : "rejected"}`, guardInUpdateWhere(src) === want);
}
ok(
  "checker: unguarded refund flip is rejected",
  !refundFlipGuarded("async function f(){ await db.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, id)); }")
);
ok(
  "checker: refund flip without RETURNING is rejected",
  !refundFlipGuarded("async function f(){ await db.update(orders).set({ paymentStatus: 'refunded' }).where(and(eq(orders.id, id), notRefundedGuard())); }")
);
ok(
  "checker: guarded refund flip with RETURNING is accepted",
  refundFlipGuarded("async function f(){ const [r] = await db.update(orders).set({ paymentStatus: 'refunded' }).where(and(eq(orders.id, id), notRefundedGuard())).returning({ id: orders.id }); }")
);
ok(
  "checker: a comment naming the guard is not code",
  !codeIdentifiers("// notRefundedGuard REFUNDED_ORDER_ERROR\nconst a = 1;").has("notRefundedGuard")
);

/* ── İleri yazma: ya KENDİ korumalı UPDATE'i, ya TEK KAPIYA devir ───────────
 *
 * Eski kural "dosyada korumayı taşıyan en az bir `update(orders)` var mı"ydı ve
 * atama tek kapıya toplandığı gün YAPISI GEREĞİ bayatladı: geri alma rotası
 * kendi devir UPDATE'ini sildi, işi `assignManufacturerToOrder`a bıraktı. Orada
 * koruma KALKMADI, tek yere TAŞINDI; buna rağmen bu liste kırmızı yanıyordu.
 *
 * Yeni kural devri KABUL EDER ama bedavaya değil:
 *   1. Dosya siparişe partner YAZIYORSA (yerleştirme), koruma o yazmanın kendi
 *      WHERE'inde durmak zorundadır. "Dosya bir yerinde atama servisini
 *      çağırıyor" MAZERET DEĞİLDİR — geri alma rotasının eski hâli tam olarak
 *      öyleydi: servisi bir dalda çağırıyor, devri kendi UPDATE'iyle yazıyordu.
 *   2. Kendi ileri yazması yoksa devir sayılır, ama YALNIZCA kapının kendisi
 *      korumayı taşıyorsa. Devir, korumanın orada VAR OLDUĞUNU kanıtlamak
 *      zorunda; yoksa "kapıya bıraktım" cümlesi korumayı kaldırmanın yolu olur.
 *
 * Yerleştirme = `manufacturerId`/`painterId` alanına NULL OLMAYAN bir değer
 * yazan UPDATE. Koparma (`manufacturerId: null`) ve kargo geri alması
 * (`status: 'printing'`, `shippedAt: null`) ileri işlem DEĞİLDİR: onları ileri
 * saymak iade korumasını temizlik yollarına da dayatırdı — bu dosyanın alt
 * bölümü tam tersini şart koşuyor (iade edilmiş sipariş de koparılabilmeli).
 */
const CHOKE_POINT = "src/lib/services/manufacturer-assign.ts";
const CHOKE_POINT_CALL = "assignManufacturerToOrder";

/** `.set({...})` içinde `prop`a NULL OLMAYAN bir değer yazılıyor mu? */
function setPlaces(set: ts.ObjectLiteralExpression, prop: string): boolean {
  return set.properties.some((p) => {
    // Kısayol (`manufacturerId,`) her zaman bir değişkendir, yani NULL değil.
    if (ts.isShorthandPropertyAssignment(p)) return p.name.text === prop;
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || p.name.text !== prop) {
      return false;
    }
    return p.initializer.kind !== ts.SyntaxKind.NullKeyword;
  });
}

/** Siparişe partner YAZAN (koparmayan) `update(orders)` zincirleri. */
function placementWrites(src: string): UpdateChain[] {
  return updateChains(parse(src)).filter(
    // `.set` okunamıyorsa (ör. yardımcı çağrısıyla kurulan yük) yerleştirme
    // SAYILIR: okunamayan bir yük, korumanın saklanacağı yer olmamalı.
    (c) => !c.set || setPlaces(c.set, "manufacturerId") || setPlaces(c.set, "painterId")
  );
}

/**
 * Siparişi müşteriye doğru İLERLETEN durum değerleri.
 *
 * `approved` burada YOK: baskının geri alınması siparişi atama aşamasına
 * döndürür, yani ileri değil geri bir adımdır. `rejected`/`cancelled` de yok;
 * onlar siparişi kapatır. Liste bilerek dar: bir durumu yanlışlıkla "ileri"
 * saymak, temizlik yollarına iade koruması dayatmak demektir ve bu dosyanın alt
 * bölümü tam tersini şart koşuyor.
 */
const FORWARD_STATUSES = new Set([
  "printing",
  "quality_check",
  "painting",
  "shipped",
  "delivered",
]);

/**
 * İLERİ bir kilometre taşını temizleyen alanlar. Bunlardan birine null yazmak,
 * yazının ileri değil GERİ bir adım olduğunun yapısal işaretidir: kargo geri
 * alması `status: 'printing'` yazar ama aynı `.set` içinde `shippedAt`i siler.
 *
 * Liste bilerek KAPALI. Eski kural "herhangi bir alana null yazılmışsa bu bir
 * geri almadır" diyordu ve bu, muafiyeti toptan açıyordu: `status: 'printing'`
 * yanına ilgisiz bir `failureReason: null` koymak, korumasız bir ileri yazmayı
 * denetimden geçiriyordu.
 */
const ROLLBACK_MARKERS = new Set([
  "shippedAt",
  "deliveredAt",
  "trackingNumber",
  "carrier",
  "manufacturerId",
  "painterId",
  "assignedToManufacturerAt",
  "manufacturerAcceptedAt",
  "manufacturerPrintedAt",
  "assignedToPainterAt",
  "sentToPainterAt",
  "receivedByPainterAt",
  "paintedAt",
]);

/** `.set({...})` ileri bir kilometre taşını NULL'a mı çekiyor (geri alma)? */
function setNullsRollbackMarker(set: ts.ObjectLiteralExpression): boolean {
  return set.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      ROLLBACK_MARKERS.has(p.name.text) &&
      p.initializer.kind === ts.SyntaxKind.NullKeyword
  );
}

/** `as`/parantez sarmalarını soyar — değerin kendisine iner. */
function unwrapStatusValue(n: ts.Node): ts.Node {
  return ts.isAsExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isNonNullExpression(n)
    ? unwrapStatusValue(n.expression)
    : n;
}

type StatusDirection = "forward" | "backward" | "unknown";

/**
 * Bu `status` değeri siparişi İLERİ mi taşıyor?
 *
 * Düz metin doğrudan okunur; üçlü operatörün İKİ dalı da okunur (bir dalı bile
 * ileriyse yazma ileridir); değişken ise aynı dosyadaki TEK `const` bildirimi
 * üzerinden çözülür (`const newStatus = x ? "approved" : "printing"` gibi).
 * Çözülemeyen değer "unknown"dır ve unknown korumayı GEREKTİRİR: okunamayan bir
 * değerin arkasına saklanmak, kuralı kaldırmanın en kolay yolu olurdu.
 */
function statusDirection(expr: ts.Node, depth = 0): StatusDirection {
  const node = unwrapStatusValue(expr);
  if (ts.isStringLiteralLike(node)) {
    return FORWARD_STATUSES.has(node.text) ? "forward" : "backward";
  }
  if (ts.isConditionalExpression(node)) {
    const a = statusDirection(node.whenTrue, depth);
    const b = statusDirection(node.whenFalse, depth);
    if (a === "forward" || b === "forward") return "forward";
    return a === "backward" && b === "backward" ? "backward" : "unknown";
  }
  if (ts.isIdentifier(node) && depth < 3) {
    const inits: ts.Expression[] = [];
    forEachNode(node.getSourceFile(), (n) => {
      if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === node.text &&
        n.initializer
      ) {
        inits.push(n.initializer);
      }
    });
    // Sıfır bildirim (dışarıdan gelen değer) ya da birden çok bildirim
    // (hangisinin geçerli olduğu sözdiziminden okunamaz) → okunamadı.
    if (inits.length !== 1) return "unknown";
    return statusDirection(inits[0], depth + 1);
  }
  return "unknown";
}

/**
 * Partner YAZMAYAN ama siparişi ileri taşıyan UPDATE'ler: `status` alanına
 * ileri bir değer (ya da OKUNAMAYAN bir değer) yazanlar.
 *
 * Kargo geri alması (`status: 'printing'`, `shippedAt: null`) bunun DIŞINDA
 * kalır, ama artık yalnız İLERİ BİR KİLOMETRE TAŞINI temizlediği için
 * (ROLLBACK_MARKERS) — "herhangi bir alana null yazılmış" olması yetmez.
 *
 * Değişkenle yazılan durum da sayılır. Eski kural onu görmezden geliyor ve
 * gerekçesinde "o dosyalar zaten `statusWritesGuarded` ile denetleniyor"
 * diyordu; DOĞRU DEĞİLDİ — o denetleyici tek bir dosyaya (model-approval.ts)
 * uygulanıyor, onay ve toplu işlem rotaları listeye yalnız "dosyada korumalı
 * bir UPDATE var" kuralıyla giriyordu. Yani kapıya devreden bir dosya,
 * korumasız yeni bir `status: nextStatus` yazması ekleyip yeşil kalabiliyordu:
 * iade edilmiş bir sipariş üretime sokulur, hakediş oradan işlemeye devam
 * ederdi. Değeri okuyabiliyorsak yönüne bakarız; okuyamıyorsak koruma isteriz.
 */
function forwardStatusWrites(src: string): UpdateChain[] {
  return updateChains(parse(src)).filter((c) => {
    // Okunamayan yük zaten `placementWrites` tarafından yerleştirme sayılıyor.
    if (!c.set) return false;
    if (setNullsRollbackMarker(c.set)) return false;
    const assignment = c.set.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "status"
    );
    if (assignment) return statusDirection(assignment.initializer) !== "backward";
    // Kısayol (`status,`) bir değişkendir: değeri okunamaz, koruma şart.
    return c.set.properties.some(
      (p) => ts.isShorthandPropertyAssignment(p) && p.name.text === "status"
    );
  });
}

/** Dosya işi tek atama kapısına devrediyor mu — yorum değil, GERÇEK çağrı? */
function delegatesToChokePoint(src: string): boolean {
  return anyNode(
    parse(src),
    (n) =>
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === CHOKE_POINT_CALL
  );
}

/**
 * İleri yazmanın iade koruması altında olduğu KANITLANIYOR mu: ya dosyanın
 * kendi UPDATE'inde, ya da korumayı taşıdığı doğrulanmış tek kapıya devirle.
 */
function forwardWriteProtected(src: string, chokePointGuarded: boolean): boolean {
  const placements = placementWrites(src);
  // 1. Kendi yerleştirmesi varsa: her biri korumayı KENDİ WHERE'inde taşımalı.
  if (placements.some((c) => !c.where || !whereCarries(c.where, isGuardCall))) return false;
  // 2. Kendi ileri DURUM yazması da korumalı olmalı — devirden BAĞIMSIZ olarak.
  //    Devir yalnızca ATAMANIN korunduğunu kanıtlar; dosyanın kendi yazdığı bir
  //    `printing`/`shipped` geçişi hakkında hiçbir şey söylemez. Kural yalnız
  //    yerleştirmelere bakarken, kapıya devreden bir dosya korumasız bir ileri
  //    durum yazması ekleyip yeşil kalabiliyordu: iade edilmiş bir sipariş
  //    üretime sokulur, üstelik hakediş oradan işlemeye devam ederdi.
  if (
    forwardStatusWrites(src).some((c) => !c.where || !whereCarries(c.where, isGuardCall))
  ) {
    return false;
  }
  // 3. Korumalı bir ileri yazması varsa eski kural zaten sağlanmış.
  if (guardInUpdateWhere(src)) return true;
  // 4. Kendi ileri yazması yok: işi kapıya devretmiş OLMALI ve kapı korumalı.
  return delegatesToChokePoint(src) && chokePointGuarded;
}

// Denetleyicinin kendisi: devri kabul etmeli, kaçamağı reddetmeli.
const FORWARD_SELF_TESTS: Array<[string, string, boolean, boolean]> = [
  [
    "delegation to the choke point is accepted",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); }",
    true,
    true,
  ],
  [
    "delegation plus a detach of its own is accepted",
    "async function f(){ await db.update(orders).set({ manufacturerId: null, manufacturerStatus: 'unassigned' }).where(eq(orders.paymentStatus, 'refunded')); await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); }",
    true,
    true,
  ],
  [
    "delegation is refused when the choke point itself is unguarded",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); }",
    false,
    false,
  ],
  [
    "its own unguarded hand-off is rejected even though it calls the choke point",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ manufacturerId: target.id, manufacturerStatus: 'assigned' }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    "its own guarded hand-off is accepted",
    "async function f(){ await db.update(orders).set({ manufacturerId: target.id }).where(and(eq(orders.id, id), notRefundedGuard())); }",
    true,
    true,
  ],
  [
    "a painter placement is a forward write too",
    "async function f(){ await db.update(orders).set({ painterId: painter.id, status: 'painting' }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    "neither a forward write nor a delegation is rejected",
    "async function f(){ await db.update(orders).set({ manufacturerId: null }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    // Devir, dosyanın KENDİ ileri durum yazmasını aklamaz.
    "a delegating file's unguarded forward status write is rejected",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ status: 'printing', updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    "a delegating file's guarded forward status write is accepted",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ status: 'printing', updatedAt: new Date() }).where(and(eq(orders.id, id), notRefundedGuard())); }",
    true,
    true,
  ],
  [
    // Kargo geri alması ileri DEĞİLDİR: aynı `.set` içinde İLERİ BİR KİLOMETRE
    // TAŞININ (shippedAt) silinmesi, adımın geri yönde olduğunun işaretidir.
    "a cargo rollback next to a delegation is accepted",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ status: 'printing', shippedAt: null, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    true,
  ],
  [
    // Muafiyet artık İLGİSİZ bir null ile satın alınamaz: eski kural "herhangi
    // bir alana null yazılmışsa geri almadır" diyordu ve korumasız bir ileri
    // yazma, yanına konan bir `failureReason: null` ile denetimden geçiyordu.
    "an unrelated null no longer exempts a forward status write",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ status: 'printing', failureReason: null, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    // Değişkenle yazılan, DEĞERİ OKUNAMAYAN durum: koruma şart.
    "a delegating file's unguarded forward status write through a variable is rejected",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); const next = pickStatus(); await db.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    // Aynı yazma, korumasıyla birlikte: kabul.
    "the same variable status write is accepted when guarded",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); const next = pickStatus(); await db.update(orders).set({ status: next, updatedAt: new Date() }).where(and(eq(orders.id, id), notRefundedGuard())); }",
    true,
    true,
  ],
  [
    // Değişken ÇÖZÜLEBİLİYORSA yönüne bakılır: iki dalı da geri olan bir geçiş
    // (onay rotasının hâli) korumasız kalabilir, çünkü ileri bir adım değildir.
    "a resolvable backward variable status needs no guard",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); const next = needsApproval ? 'awaiting_customer_approval' : 'approved'; await db.update(orders).set({ status: next, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    true,
  ],
  [
    // Tek dalı bile ileri olan üçlü operatör ileridir (toplu işlem rotasının
    // hâli: `approve` ise 'approved', değilse 'printing').
    "a ternary that can land on a forward status is rejected without the guard",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); const next = action === 'approve' ? 'approved' : 'printing'; await db.update(orders).set({ status: next as OrderStatus, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
  [
    "the same ternary is accepted when the guard rides in the conditions array",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); const next = action === 'approve' ? 'approved' : 'printing'; const conditions = [eq(orders.id, id), notRefundedGuard()]; await db.update(orders).set({ status: next as OrderStatus, updatedAt: new Date() }).where(and(...conditions)); }",
    true,
    true,
  ],
  [
    // Kısayol yazımı (`status,`) da bir değişkendir.
    "a shorthand status write is treated as unreadable and needs the guard",
    "async function f(){ await assignManufacturerToOrder({ orderId: id, manufacturerId: t }); await db.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id)); }",
    true,
    false,
  ],
];
for (const [name, src, chokeGuarded, want] of FORWARD_SELF_TESTS) {
  ok(
    `checker: ${name} → ${want ? "accepted" : "rejected"}`,
    forwardWriteProtected(src, chokeGuarded) === want
  );
}

// Devri kabul etmenin ÖN ŞARTI: kapı korumayı gerçekten taşıyor. `false`
// geçiliyor, yani kapı kendi kendine devredemez — korumayı kendi UPDATE'inde
// göstermek zorunda. Bu bayrak düşerse devreden her rota da kırmızı yanar.
const chokePointGuarded = forwardWriteProtected(read(CHOKE_POINT), false);
ok(`${CHOKE_POINT}: the choke point carries the guard in its own placement UPDATE`, chokePointGuarded);

// Siparişi ileri taşıyan her yazma: iade korumasını atomik UPDATE'in WHERE'inde
// taşımalı ve 'succeeded' şartı koymamalı (elle açılan, havale, sıfır tutarlı
// ve atölye siparişleri başka bir ödeme durumunda da ilerleyebilmeli).
const FORWARD_WRITES = [
  "src/lib/services/manufacturer-assign.ts",
  "src/app/api/admin/orders/[id]/approve/route.ts",
  "src/app/api/admin/orders/[id]/upload-model/route.ts",
  "src/app/api/admin/orders/[id]/start-printing/route.ts",
  "src/app/api/admin/orders/[id]/ship/route.ts",
  "src/app/api/admin/orders/[id]/ship-kargo/route.ts",
  "src/app/api/admin/orders/[id]/assign-painter/route.ts",
  "src/app/api/admin/orders/[id]/add-painting/route.ts",
  "src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts",
  "src/app/api/admin/orders/bulk-action/route.ts",
];
for (const rel of FORWARD_WRITES) {
  const src = read(rel);
  ok(
    `${rel}: refund guard in its own UPDATE's where, or delegated to the guarded choke point`,
    forwardWriteProtected(src, chokePointGuarded)
  );
  ok(`${rel}: no 'succeeded' requirement`, !hasSucceededRequirement(src));
}

// İade edilmiş siparişte YALNIZ RET serbest kalır: ret siparişi kapatır, hiçbir
// yöne taşımaz. Tarama boş geçmesin diye önce rotanın gerçekten bir
// `update(orders)...where(...)` yazdığı doğrulanır; sonra ne o yazmalar iade
// korumasını taşır ne de kod (yorum değil) iade reddine başvurur.
//
// TESLİM ARTIK BUNUN DIŞINDA — HER İKİ YÖNÜYLE. Damga (POST) bir zamanlar
// serbestti; gerekçe "paket zaten yola çıkmıştı, damga vardığının kaydıdır"dı.
// Ama damga kayıt değildir: durumu `delivered` yapar, `delivered_at` yazar ve
// müşteriye "teslim edildi" e-postası + bildirimi gönderir — parası geri
// verilmiş bir sipariş için. Üstelik tek yönlüydü, çünkü DELETE aynı siparişi
// iade yüzünden reddediyordu: yanlış damga bir daha geri alınamıyordu. Kural
// artık yönden bağımsız (iade edilmiş sipariş hiçbir yöne kımıldamaz) ve bu
// blok iki YÖNTEMİ de aynı şekilde pinler.
const REFUSAL_IDS = [
  "notRefundedGuard",
  "isOrderRefunded",
  "isPartnerOrderRefunded",
  "isRefunded",
  "REFUNDED_ORDER_ERROR",
];

/** Dosyadaki tek bir dışa açık HTTP yöntemi (POST/DELETE ayrı pinlensin diye). */
function exportedMethod(sf: ts.SourceFile, name: string): ts.FunctionDeclaration {
  const hits: ts.FunctionDeclaration[] = [];
  forEachNode(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) hits.push(n);
  });
  if (hits.length !== 1) throw new Error(`${name}: tek bir dışa açık yöntem beklenir`);
  return hits[0];
}

/** `inner` düğümü `outer`ın gövdesinin içinde mi (aynı SourceFile). */
const within = (outer: ts.Node, inner: ts.Node) =>
  inner.pos >= outer.pos && inner.end <= outer.end;

/** Yalnız verilen düğümün altındaki kimlikler; dosya başındaki import'lar sayılmaz. */
function nodeIdentifiers(root: ts.Node): Set<string> {
  const ids = new Set<string>();
  forEachNode(root, (n) => {
    if (ts.isIdentifier(n)) ids.add(n.text);
  });
  return ids;
}

{
  const rel = "src/app/api/admin/orders/[id]/deliver/route.ts";
  const sf = parse(read(rel));
  const post = exportedMethod(sf, "POST");
  const del = exportedMethod(sf, "DELETE");
  const chains = updateChains(sf).filter((c) => !!c.where);
  const postChains = chains.filter((c) => within(post, c.where!));
  const delChains = chains.filter((c) => within(del, c.where!));

  // Teslim damgası: reddeder. Yazmanın KENDİSİ korumayı taşır — ön okuma tek
  // başına yetmez, çünkü iade `orders.status`e dokunmaz ve okuma ile yazma
  // arasına girebilir.
  ok(`${rel}: POST has a status write to scan`, postChains.length > 0, postChains.length);
  ok(
    `${rel}: every POST UPDATE carries the refund guard`,
    postChains.every((c) => whereCarries(c.where!, isGuardCall))
  );
  const postIds = nodeIdentifiers(post);
  ok(
    `${rel}: POST answers 409 REFUNDED_ORDER_ERROR`,
    postIds.has("REFUNDED_ORDER_ERROR") &&
      (postIds.has("isRefunded") || postIds.has("isOrderRefunded"))
  );
  // Ve müşteriye "teslim edildi" demeden önce reddeder: e-posta kuyruğu ile
  // uygulama içi bildirim, korumalı UPDATE ıskaladığında kurulan daldan SONRA
  // gelmeli. İkisi de rotanın en sonunda durur; ıska dalı erken `return` eder.
  const postText = post.getText();
  ok(
    `${rel}: POST refuses before the customer delivery message`,
    postText.indexOf("REFUNDED_ORDER_ERROR") < postText.indexOf("order_delivered"),
    [postText.indexOf("REFUNDED_ORDER_ERROR"), postText.indexOf("order_delivered")]
  );

  // Teslimi geri alma: aynı kural. Yazmanın KENDİSİ korumayı taşır (ön okuma
  // yarışı kapatmaz) ve red, her rotanın kullandığı tek Türkçe metinden gelir.
  ok(`${rel}: DELETE has an UPDATE to scan`, delChains.length > 0, delChains.length);
  ok(
    `${rel}: every DELETE UPDATE carries the refund guard`,
    delChains.every((c) => whereCarries(c.where!, isGuardCall))
  );
  const delIds = nodeIdentifiers(del);
  ok(
    `${rel}: DELETE answers 409 REFUNDED_ORDER_ERROR`,
    delIds.has("REFUNDED_ORDER_ERROR") &&
      (delIds.has("isRefunded") || delIds.has("isOrderRefunded"))
  );
}

{
  const rel = "src/app/api/admin/orders/[id]/reject/route.ts";
  const src = read(rel);
  const chains = updateChains(parse(src)).filter((c) => !!c.where);
  ok(`${rel}: has a guarded status write to scan`, chains.length > 0, chains.length);
  ok(
    `${rel}: no UPDATE where carries the refund guard`,
    !chains.some((c) => whereCarries(c.where!, isGuardCall))
  );
  const ids = codeIdentifiers(src);
  const used = REFUSAL_IDS.filter((id) => ids.has(id));
  ok(`${rel}: never refuses a refunded order`, used.length === 0, used);
}

// İade çevirmesi yarışa kapalı: hem iade servisi hem ret rotası `refunded`
// yazarken ödeme durumuna koşullu ve RETURNING'li günceller. Biri koşulsuz
// yazarsa hakedişler iki kez geri alınır, gelir iki kez düşer.
for (const rel of [
  "src/lib/services/order-refund.ts",
  "src/app/api/admin/orders/[id]/reject/route.ts",
]) {
  ok(`${rel}: refund flip guarded on payment status, with RETURNING`, refundFlipGuarded(read(rel)));
}

// ─── Ortak denetleyiciler: her yazma, her okuma, her tahakkuk ───────────────
// Yukarıdaki FORWARD_WRITES "dosyada en az bir korumalı UPDATE" arar. Aşağıdaki
// dosyaların ileri yazmaları tek tip olduğu için daha sıkı kural uygulanır:
// dosyadaki HER `update(orders)` korumayı taşımalı. Böylece iki yazmadan birini
// korumasız bırakan değişiklik de burada kırılır.

const unwrapAs = (n: ts.Node): ts.Node =>
  ts.isAsExpression(n) || ts.isParenthesizedExpression(n) ? unwrapAs(n.expression) : n;

function parseFile(rel: string, src: string): ts.SourceFile {
  const kind = rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
}

function hasStringLiteral(src: string, text: string): boolean {
  return anyNode(parse(src), (n) => ts.isStringLiteralLike(n) && n.text === text);
}

/** A `.set({...})` literal that writes `prop`. */
function setWrites(set: ts.ObjectLiteralExpression, prop: string): boolean {
  return set.properties.some(
    (p) =>
      (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
      ts.isIdentifier(p.name) &&
      p.name.text === prop
  );
}

/** Every `update(orders)` carries the guard in its WHERE, and there is one. */
function everyUpdateGuarded(src: string): boolean {
  const chains = updateChains(parse(src));
  return chains.length > 0 && chains.every((c) => !!c.where && whereCarries(c.where, isGuardCall));
}

/** Every `update(orders)` whose `.set` writes `status` carries the guard, and there is one. */
function statusWritesGuarded(src: string): boolean {
  const writes = updateChains(parse(src)).filter((c) => !!c.set && setWrites(c.set, "status"));
  return writes.length > 0 && writes.every((c) => !!c.where && whereCarries(c.where, isGuardCall));
}

/** Calls chained onto `start` (`start.a(...).b(...)`), in order. */
function chainedCalls(start: ts.Node): Array<{ name: string; call: ts.CallExpression }> {
  const out: Array<{ name: string; call: ts.CallExpression }> = [];
  let cur: ts.Node = start;
  while (
    ts.isPropertyAccessExpression(cur.parent) &&
    cur.parent.expression === cur &&
    ts.isCallExpression(cur.parent.parent) &&
    cur.parent.parent.expression === cur.parent
  ) {
    out.push({ name: cur.parent.name.text, call: cur.parent.parent });
    cur = cur.parent.parent;
  }
  return out;
}

/** The identifier a chain starts from: `tx` in `tx.select(...).from`. */
function chainRoot(n: ts.Expression): string | null {
  let cur: ts.Expression = n;
  while (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) cur = cur.expression;
  return ts.isIdentifier(cur) ? cur.text : null;
}

/** Every `<x>.from(orders)` call under `root`. */
function fromOrdersCalls(root: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(root, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "from" &&
      n.arguments.length === 1 &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === "orders"
    ) {
      out.push(n);
    }
  });
  return out;
}

/** Every read of `orders` carries the guard in its `.where(...)`, and there is one. */
function everyOrdersSelectGuarded(src: string): boolean {
  const reads = fromOrdersCalls(parse(src));
  return (
    reads.length > 0 &&
    reads.every((r) => {
      const where = chainedCalls(r).find((c) => c.name === "where");
      return !!where && whereCarries(where.call, isGuardCall);
    })
  );
}

const EARNING_TABLES = new Set(["manufacturerEarnings", "painterEarnings"]);
const ROW_LOCKS = new Set(["share", "update", "no key update"]);

/** Every `<x>.insert(<partner earning table>)`, bare or as `schema.x`. */
function earningInserts(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(sf, (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "insert" ||
      n.arguments.length !== 1
    ) {
      return;
    }
    const a = n.arguments[0];
    const table = ts.isIdentifier(a) ? a.text : ts.isPropertyAccessExpression(a) ? a.name.text : null;
    if (table && EARNING_TABLES.has(table)) out.push(n);
  });
  return out;
}

function isTransactionCallback(fn: ts.Node): boolean {
  const call = fn.parent;
  return (
    !!call &&
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "transaction" &&
    call.arguments.some((a) => a === fn)
  );
}

/**
 * Tahakkuk kuralı: her hakediş INSERT'i işlem (transaction) tutamacında koşar ve
 * AYNI işlem geri çağrısında, ondan ÖNCE, sipariş satırı yine o tutamaçla
 * okunur: okumanın WHERE'inde notRefundedGuard(), zincirinde satır kilidi
 * (`.for("share")` ya da daha güçlüsü). Kilit, okuma ile yazma arasına iadenin
 * girmesini engeller. İade UPDATE'i bu işlem bitene kadar bekler ve ardından
 * koşan reverseEarning() yeni satırı görür. INSERT `db` ile yazılırsa başka bir
 * bağlantıda, kilidin dışında koşar; o yüzden reddedilir.
 */
function accrualsGuarded(src: string): boolean {
  const inserts = earningInserts(parse(src));
  return (
    inserts.length > 0 &&
    inserts.every((ins) => {
      const recv = (ins.expression as ts.PropertyAccessExpression).expression;
      if (!ts.isIdentifier(recv)) return false;
      let fn: ts.Node | undefined = ins.parent;
      while (fn && !isFunctionLike(fn)) fn = fn.parent;
      if (!fn || !isTransactionCallback(fn)) return false;
      const param = (fn as ts.FunctionLikeDeclaration).parameters[0];
      if (!param || !ts.isIdentifier(param.name) || param.name.text !== recv.text) return false;
      return fromOrdersCalls(fn).some((r) => {
        if (r.getStart() > ins.getStart()) return false;
        if (chainRoot(r.expression) !== recv.text) return false;
        const calls = chainedCalls(r);
        const where = calls.find((c) => c.name === "where");
        const lock = calls.find((c) => c.name === "for");
        const strength = lock?.call.arguments[0];
        return (
          !!where &&
          whereCarries(where.call, isGuardCall) &&
          !!strength &&
          ts.isStringLiteralLike(strength) &&
          ROW_LOCKS.has(strength.text)
        );
      });
    })
  );
}

// Yeni denetleyicilerin kendisi.
const STRICT_SELF_TESTS: Array<[string, (s: string) => boolean, string, boolean]> = [
  [
    "every update guarded: one of two unguarded",
    everyUpdateGuarded,
    "async function f(){ await db.update(orders).set({ a: 1 }).where(and(eq(orders.id, id), notRefundedGuard())); await db.update(orders).set({ b: 1 }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "every update guarded: both guarded",
    everyUpdateGuarded,
    "async function f(){ await db.update(orders).set({ a: 1 }).where(and(eq(orders.id, id), notRefundedGuard())); await tx.update(orders).set({ b: 1 }).where(and(eq(orders.id, id), notRefundedGuard())); }",
    true,
  ],
  [
    "status writes guarded: conditional guard counts, token write ignored",
    statusWritesGuarded,
    "async function f(){ await db.update(orders).set({ modelApprovalToken: t }).where(eq(orders.id, id)); await db.update(orders).set({ status: next }).where(and(eq(orders.id, id), fwd ? notRefundedGuard() : undefined)); }",
    true,
  ],
  [
    "status writes guarded: unguarded status write",
    statusWritesGuarded,
    "async function f(){ await db.update(orders).set({ status: next }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "orders reads guarded: one of two unguarded",
    everyOrdersSelectGuarded,
    "async function f(){ await db.select({ a: orders.id }).from(orders).innerJoin(x, y).where(and(eq(orders.status, 's'), notRefundedGuard())); await db.select({ n: c }).from(orders).where(eq(orders.status, 's')); }",
    false,
  ],
  [
    "accrual: locked guarded read, then insert, in one transaction",
    accrualsGuarded,
    "async function f(){ return db.transaction(async (tx) => { const [r] = await tx.select({ a: orders.id }).from(orders).where(and(eq(orders.id, id), notRefundedGuard())).for('share'); if (!r) return 'skipped_refunded'; await tx.insert(manufacturerEarnings).values(v); }); }",
    true,
  ],
  [
    "accrual: insert on db, outside the transaction's lock",
    accrualsGuarded,
    "async function f(){ return db.transaction(async (tx) => { const [r] = await tx.select({ a: orders.id }).from(orders).where(and(eq(orders.id, id), notRefundedGuard())).for('share'); if (!r) return; await db.insert(manufacturerEarnings).values(v); }); }",
    false,
  ],
  [
    "accrual: read without a row lock",
    accrualsGuarded,
    "async function f(){ return db.transaction(async (tx) => { const [r] = await tx.select({ a: orders.id }).from(orders).where(and(eq(orders.id, id), notRefundedGuard())); if (!r) return; await tx.insert(painterEarnings).values(v); }); }",
    false,
  ],
  [
    "accrual: guarded read before the transaction",
    accrualsGuarded,
    "async function f(){ const [r] = await db.select({ a: orders.id }).from(orders).where(and(eq(orders.id, id), notRefundedGuard())).for('share'); if (!r) return; await db.transaction(async (tx) => { await tx.insert(painterEarnings).values(v); }); }",
    false,
  ],
  [
    "accrual: locked read without the guard",
    accrualsGuarded,
    "async function f(){ return db.transaction(async (tx) => { await tx.select({ a: orders.id }).from(orders).where(eq(orders.id, id)).for('share'); await tx.insert(manufacturerEarnings).values(v); }); }",
    false,
  ],
  [
    "accrual: guarded read only after the insert",
    accrualsGuarded,
    "async function f(){ return db.transaction(async (tx) => { await tx.insert(manufacturerEarnings).values(v); await tx.select({ a: orders.id }).from(orders).where(and(eq(orders.id, id), notRefundedGuard())).for('share'); }); }",
    false,
  ],
  [
    "accrual: plain insert via schema.x, no transaction",
    accrualsGuarded,
    "async function f(){ await db.insert(schema.manufacturerEarnings).values(v); }",
    false,
  ],
];
for (const [name, check, src, want] of STRICT_SELF_TESTS) {
  ok(`checker: ${name} → ${want ? "accepted" : "rejected"}`, check(src) === want);
}

function sourceFiles(dirRel: string): string[] {
  return readdirSync(join(REPO_ROOT, dirRel), { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(dirRel, f));
}

// ─── Temizlik denetleyicileri ───────────────────────────────────────────────
// İade durumunu OKUYAN çağrılar, ret için var olan adlardan (notRefundedGuard,
// REFUNDED_ORDER_ERROR) ayrı tutulur. Temizlik rotası metnini iade durumuna göre
// seçebilir: boyacı reddinde üreticiye "başka bir boyacıya gönderin" demek iade
// edilmiş siparişte 409'a yollamaktır. Ama asla reddetmez.
const REFUND_READS = new Set(["isRefunded", "isOrderRefunded", "isPartnerOrderRefunded"]);
const REFUSAL_ONLY_IDS = ["notRefundedGuard", "REFUNDED_ORDER_ERROR"];

const isCallTo = (n: ts.Node, name: string) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;

const isRefundReadCall = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && REFUND_READS.has(n.expression.text);

/** Every call to `name` (a plain identifier callee), in source order. */
function callsTo(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(sf, (n) => {
    if (isCallTo(n, name)) out.push(n as ts.CallExpression);
  });
  return out;
}

/**
 * Bu başlatıcı bir iade OKUMASI mı: `isRefunded(o)`, `await isOrderRefunded(id)`,
 * `await isOrderRefunded(id).catch(() => false)` gibi.
 *
 * Neden "içinde iade okuması geçiyor mu" DEĞİL: temizlik yolları artık koparmayı
 * kilitli bir işlemin içinde yapıyor ve o işlemin gövdesinde iade okunuyor.
 * `const outcome = await db.transaction(async (tx) => { … isRefunded(order) … })`
 * satırında `outcome` iade durumunu TUTMAZ; onu iade adı saymak, rotanın
 * "bulunamadı"/"uygun durumda değil" retlerinin hepsini iadeye bağlı sanmak ve
 * dürüst bir rotayı kırmızı yakmak demekti.
 */
function initializerIsRefundRead(init: ts.Expression): boolean {
  let cur: ts.Node = init;
  for (;;) {
    if (
      ts.isAwaitExpression(cur) ||
      ts.isAsExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isNonNullExpression(cur)
    ) {
      cur = cur.expression;
      continue;
    }
    // `…(…).catch(() => false)` — okuma hata verdiğinde varsayılana düşen hâli.
    if (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression) &&
      cur.expression.name.text === "catch"
    ) {
      cur = cur.expression.expression;
      continue;
    }
    break;
  }
  return isRefundReadCall(cur);
}

/**
 * Names that hold the refund state: `refunded` (also as `result.refunded`) and
 * every variable initialised from a refund read.
 */
function refundNames(sf: ts.SourceFile): Set<string> {
  const names = new Set(["refunded"]);
  forEachNode(sf, (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      !!n.initializer &&
      initializerIsRefundRead(n.initializer)
    ) {
      names.add(n.name.text);
    }
  });
  return names;
}

const mentionsRefund = (n: ts.Node, names: Set<string>) =>
  anyNode(n, (m) => isRefundReadCall(m) || (ts.isIdentifier(m) && names.has(m.text)));

/** Conditions of the `if`s whose then-branch holds `node`, up to its function. */
function thenConditions(node: ts.Node): ts.Expression[] {
  const out: ts.Expression[] = [];
  for (let p: ts.Node = node; p.parent && !isFunctionLike(p); p = p.parent) {
    if (ts.isIfStatement(p.parent) && p.parent.thenStatement === p) out.push(p.parent.expression);
  }
  return out;
}

/**
 * Returns decided by the refund state: the returned value mentions it, or an
 * `if` around the return (either branch, up to its function) tests it.
 */
function refundKeyedReturns(sf: ts.SourceFile): ts.ReturnStatement[] {
  const names = refundNames(sf);
  const out: ts.ReturnStatement[] = [];
  forEachNode(sf, (n) => {
    if (!ts.isReturnStatement(n)) return;
    let keyed = !!n.expression && mentionsRefund(n.expression, names);
    for (let p: ts.Node = n; !keyed && p.parent && !isFunctionLike(p); p = p.parent) {
      const up = p.parent;
      if (ts.isIfStatement(up) && up.expression !== p && mentionsRefund(up.expression, names)) keyed = true;
    }
    if (keyed) out.push(n);
  });
  return out;
}

/**
 * İade durumuna bağlı bir `return` RET mi, yoksa RAPOR mu?
 *
 * Temizlik rotasının CEVABI da dürüst olmak zorunda: "sipariş iade edilmişti, iş
 * kapandı, ceza yazılmadı" demek reddetmek DEĞİLDİR — kuralın istediği şeydir.
 * Eski hâl iade durumuna bağlı HER `return`'ü ret sayıyordu ve iki şeyi birden
 * imkânsız kılıyordu: partnere ne olduğunu söylemeyi, ve koparmayı kilitli bir
 * işleme almayı (işlemin geri çağrısı iade durumunu dışarı taşır:
 * `return { code: "ok", refunded }`).
 *
 * RET İŞARETLERİ dar ve somut: `error` alanı, 400+ bir `status`, `ok: false`,
 * ya da hiç nesne DEĞİŞMEZİ içermeyen okunamaz bir dönüş (`return no();`) —
 * okunamayan bir dönüş, kuralın arkasına saklanılacak yer olmamalı. Geri kalan
 * her şey rapordur.
 */
function refusesInReturn(r: ts.ReturnStatement): boolean {
  if (!r.expression) return true;
  let hasObject = false;
  let refusal = false;
  forEachNode(r.expression, (n) => {
    if (ts.isObjectLiteralExpression(n)) hasObject = true;
    if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name)) return;
    const value = unwrapAs(n.initializer);
    if (n.name.text === "error") refusal = true;
    if (n.name.text === "ok" && value.kind === ts.SyntaxKind.FalseKeyword) refusal = true;
    if (n.name.text === "status" && ts.isNumericLiteral(value) && Number(value.text) >= 400) {
      refusal = true;
    }
  });
  return refusal || !hasObject;
}

/** Why a cleanup route would refuse a refunded order; empty when it never does. */
function cleanupRefusals(src: string): string[] {
  const ids = codeIdentifiers(src);
  const out = REFUSAL_ONLY_IDS.filter((id) => ids.has(id));
  const keyed = refundKeyedReturns(parse(src)).filter(refusesInReturn);
  if (keyed.length > 0) out.push("a return decided by the refund state");
  return out;
}

/** `return { ..., reason: "refunded" }`, in source order. */
function refundedReasonReturns(sf: ts.SourceFile): ts.ReturnStatement[] {
  const out: ts.ReturnStatement[] = [];
  forEachNode(sf, (n) => {
    if (!ts.isReturnStatement(n) || !n.expression) return;
    const v = unwrapAs(n.expression);
    if (
      ts.isObjectLiteralExpression(v) &&
      v.properties.some((p) => {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || p.name.text !== "reason") return false;
        const init = unwrapAs(p.initializer);
        return ts.isStringLiteralLike(init) && init.text === "refunded";
      })
    ) {
      out.push(n);
    }
  });
  return out;
}

/** The WHERE's arguments refer to `orders.<col>`. */
const whereRefersTo = (w: ts.CallExpression, col: string) =>
  w.arguments.some((a) =>
    anyNode(
      a,
      (n) =>
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "orders" &&
        n.name.text === col
    )
  );

/** A string literal equal to `text` under `n`. */
const hasLiteral = (n: ts.Node, text: string) =>
  anyNode(n, (m) => ts.isStringLiteralLike(m) && m.text === text);

/** `text` inside a string or `sql` template chunk under `n`. */
const mentionsText = (n: ts.Node, text: string) =>
  anyNode(
    n,
    (m) =>
      (ts.isStringLiteralLike(m) || ts.isTemplateHead(m) || ts.isTemplateMiddle(m) || ts.isTemplateTail(m)) &&
      m.text.includes(text)
  );

const CLEANUP_SELF_TESTS: Array<[string, string, boolean]> = [
  [
    "a refund read that only picks the copy",
    "async function f(){ const [o] = await db.update(orders).set({ a: 1 }).where(eq(orders.id, id)).returning({ paymentStatus: orders.paymentStatus }); if (!o) return bad(); const refunded = isRefunded(o); await notify({ body: refunded ? 'a' : 'b' }); return ok(); }",
    true,
  ],
  [
    "an early return on isRefunded",
    "async function f(){ if (isRefunded(o)) return NextResponse.json({ error: 'x' }, { status: 409 }); return ok(); }",
    false,
  ],
  [
    "an early return on a variable holding a refund read",
    "async function f(){ const r = await isPartnerOrderRefunded(id, p); if (r) { return no(); } return ok(); }",
    false,
  ],
  [
    "a return value chosen by the refund state",
    "async function f(){ const refunded = isRefunded(o); return refunded ? no() : ok(); }",
    false,
  ],
  [
    "the refusal copy",
    "async function f(){ log(REFUNDED_ORDER_ERROR); return ok(); }",
    false,
  ],
  [
    // Ne olduğunu SÖYLEMEK ret değildir: açık başarı cevabı serbest.
    "a refund-keyed SUCCESS body that names what happened",
    "async function f(){ const refunded = isRefunded(o); return NextResponse.json({ success: true, ...(refunded ? { reason: 'refunded' } : {}) }); }",
    true,
  ],
  [
    // Ama "başarı" etiketi bir reddi aklamaz.
    "a refund-keyed body that says success and still carries an error",
    "async function f(){ const refunded = isRefunded(o); return NextResponse.json({ success: true, error: refunded ? 'x' : null }); }",
    false,
  ],
  [
    // 4xx da reddir, `success: true` yazsa bile.
    "a refund-keyed body that says success with a 4xx status",
    "async function f(){ const refunded = isRefunded(o); if (refunded) return NextResponse.json({ success: true }, { status: 409 }); return ok(); }",
    false,
  ],
  [
    // Koparma artık kilitli bir işlemin içinde: işlemin SONUCU iade adı
    // değildir, yoksa rotanın olağan retleri iadeye bağlı sanılırdı.
    "a transaction result whose body happens to read the refund state",
    "async function f(){ const outcome = await db.transaction(async (tx) => { const refunded = isRefunded(o); return { code: 'ok', refunded }; }); if (outcome.code === 'not_found') return NextResponse.json({ error: 'x' }, { status: 404 }); return NextResponse.json({ success: true }); }",
    true,
  ],
];
for (const [name, src, want] of CLEANUP_SELF_TESTS) {
  ok(`checker: cleanup, ${name} → ${want ? "accepted" : "rejected"}`, (cleanupRefusals(src).length === 0) === want);
}

// ─── Partner ve QC ileri işlemleri ──────────────────────────────────────────
// İade partnerleri koparır, ama iadeden önce koparma yoktu (eski satırlar) ve
// iade bir partner tıklamasıyla yarışabilir. Bu yüzden partnerin ve QC'nin her
// ileri adımı korumayı KENDİ yazmasında taşır, ıskada da 409 döner.
const PARTNER_QC_FORWARD = [
  "src/app/api/manufacturer/orders/[id]/accept/route.ts",
  "src/app/api/manufacturer/orders/[id]/start-printing/route.ts",
  "src/app/api/manufacturer/orders/[id]/finish-printing/route.ts",
  "src/app/api/manufacturer/orders/[id]/submit-qc/route.ts",
  "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts",
  "src/app/api/manufacturer/orders/[id]/ship/route.ts",
  "src/app/api/painter/orders/[id]/accept/route.ts",
  "src/app/api/painter/orders/[id]/received/route.ts",
  "src/app/api/painter/orders/[id]/painted/route.ts",
  "src/app/api/painter/orders/[id]/submit-qc/route.ts",
  "src/app/api/painter/orders/[id]/ship/route.ts",
  "src/app/api/admin/orders/[id]/qc-approve/route.ts",
  "src/app/api/admin/orders/[id]/qc-reject/route.ts",
  "src/app/api/admin/painter-qc/[id]/approve/route.ts",
  "src/app/api/admin/painter-qc/[id]/reject/route.ts",
];
const REFUND_MISS_CHECKS = ["isOrderRefunded", "isPartnerOrderRefunded"];
for (const rel of PARTNER_QC_FORWARD) {
  const src = read(rel);
  ok(`${rel}: every UPDATE of orders carries the refund guard`, everyUpdateGuarded(src));
  ok(`${rel}: no 'succeeded' requirement`, !hasSucceededRequirement(src));
  const ids = codeIdentifiers(src);
  ok(
    `${rel}: answers 409 REFUNDED_ORDER_ERROR when a refund caused the miss`,
    ids.has("REFUNDED_ORDER_ERROR") && REFUND_MISS_CHECKS.some((c) => ids.has(c))
  );
}

// Temizlik serbest: partnerin reddi/iptali işi ileri taşımaz, siparişi bırakır.
// İade durumunu okuyabilir (bildirim metni için), ama ne yazmasına koruma koyar
// ne reddin adlarını kullanır ne de bir `return`'ü iade durumuna bağlar.
const PARTNER_CLEANUP = [
  "src/app/api/manufacturer/orders/[id]/cancel/route.ts",
  "src/app/api/painter/orders/[id]/decline/route.ts",
];
for (const rel of [...PARTNER_CLEANUP, "src/app/api/manufacturer/orders/[id]/decline/route.ts"]) {
  const src = read(rel);
  const chains = updateChains(parse(src)).filter((c) => !!c.where);
  ok(`${rel}: no UPDATE where carries the refund guard`, !chains.some((c) => whereCarries(c.where!, isGuardCall)));
  const problems = cleanupRefusals(src);
  ok(`${rel}: never refuses a refunded order`, problems.length === 0, problems);
}

// Yeni bir partner/QC rotası siparişi yazıyorsa sınıflandırılmış olmalı: ya
// ileri (korumalı) listede ya temizlik listesinde. Korumasız yeni rota kırılır.
const CLASSIFIED = new Set([...PARTNER_QC_FORWARD, ...PARTNER_CLEANUP]);
for (const dir of [
  "src/app/api/manufacturer/orders/[id]",
  "src/app/api/painter/orders/[id]",
  "src/app/api/admin/painter-qc",
]) {
  for (const rel of sourceFiles(dir)) {
    if (updateChains(parseFile(rel, read(rel))).length === 0) continue;
    ok(`${rel}: its order write is classified as forward (guarded) or cleanup`, CLASSIFIED.has(rel));
  }
}

// ─── Geçiş, GEREKÇESİNİ yazan işlemin DIŞINDA durum yazamaz ────────────────
// Ölçülen kusur (Faz 2 QA, canlı): qc_reviews okunamazken admin'in QC onayı
// YARIM uygulandı — sipariş kalıcı olarak qc_approved'a geçti (kargo açıldı,
// hakediş yolu başladı) ama karar satırı da denetim kaydı da hiç yazılmadı ve uç
// "işlem tamamlanamadı" dedi. Geriye onayın NEYE dayandığını söyleyen tek bir
// kaydı olmayan "onaylanmış" bir sipariş kaldı; üstelik aynı onayı tekrar
// denemek durum kapısına takıldığı için (400) eksik kayıt ekrandan
// tamamlanamıyordu bile.
//
// KURAL: bir geçişin DURUM yazması ile onu HAKLI ÇIKARAN kaydın yazması TEK
// işlemdir — ikisi birlikte olur ya da hiçbiri olmaz. Bu yüzden `update(orders)`
// işlemin tutamacıyla (`tx`) yazılmak zorunda VE aynı geri çağrı, gerekçe
// tablosuna yine o tutamaçla INSERT etmek zorunda. `db` ile yazılan bir INSERT
// başka bir bağlantıda, işlemin dışında koşar: tam da ölçülen hâl.
//
// Fotoğraf satırlarının damgalanması bilerek DIŞARIDA kalır: o satırlar kararın
// GEREKÇESİ değil görünümüdür (kanıt onay yolunda ayrıca okunur), ve okunamayan
// bir fotoğraf tablosu yüzünden kararı geri sarmak, kanıtı görülmüş bir turu
// boşuna reddetmek olurdu.

/** `<x>.update(orders)` çağrılarının KENDİSİ (zinciri değil, çağrı düğümü). */
function updateOrdersCalls(root: ts.Node): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(root, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "update" &&
      n.arguments.length === 1 &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === "orders"
    ) {
      out.push(n);
    }
  });
  return out;
}

/** Çağrının alıcısı: `tx` in `tx.update(orders)`. */
function callReceiver(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  return ts.isIdentifier(callee.expression) ? callee.expression.text : null;
}

/**
 * Durumu yazan her UPDATE, gerekçe tablosuna AYNI işlem tutamacıyla yazan bir
 * INSERT ile aynı geri çağrıda mı? Boş dizi = kural sağlanıyor.
 */
function unjustifiedTransitions(src: string, tables: readonly string[]): string[] {
  const sf = parse(src);
  const calls = updateOrdersCalls(sf);
  if (calls.length === 0) return ["hiç update(orders) bulunamadı"];
  const problems: string[] = [];
  for (const call of calls) {
    const recv = callReceiver(call);
    if (!recv) {
      problems.push("update(orders) alıcısı okunamadı");
      continue;
    }
    let owner: ts.Node | undefined = call.parent;
    while (owner && !isFunctionLike(owner)) owner = owner.parent;
    if (!owner || !isTransactionCallback(owner)) {
      problems.push(`${recv}.update(orders) bir işlem geri çağrısının içinde değil`);
      continue;
    }
    const param = (owner as ts.FunctionLikeDeclaration).parameters[0];
    if (!param || !ts.isIdentifier(param.name) || param.name.text !== recv) {
      problems.push("UPDATE, işlemin tutamacıyla yazılmıyor");
      continue;
    }
    const scope = owner;
    const justified = tables.some((t) =>
      insertsInto(scope, t).some((ins) => callReceiver(ins) === recv)
    );
    if (!justified) {
      problems.push(`gerekçe kaydı (${tables.join(" | ")}) aynı işlemde yazılmıyor`);
    }
  }
  return problems;
}

// Denetleyicinin kendisi: ölçülen şekli REDDETMELİ, düzeltilmiş şekli kabul.
const JUSTIFIED_SELF_TESTS: Array<[string, string, readonly string[], boolean]> = [
  [
    // TAM OLARAK canlıda ölçülen hâl: durum ayrı, kayıt ayrı.
    "durum işlem dışında yazılıyor, kayıt ayrı bir çağrıda",
    "async function f(){ const [u] = await db.update(orders).set({ manufacturerStatus: next }).where(and(eq(orders.id, id), notRefundedGuard())).returning(); if (!u) return; await db.insert(qcReviews).values({ orderId: id }); }",
    ["qcReviews"],
    false,
  ],
  [
    "durum ve gerekçe kaydı aynı işlemde",
    "async function f(){ await db.transaction(async (tx) => { const [u] = await tx.update(orders).set({ manufacturerStatus: next }).where(and(eq(orders.id, id), notRefundedGuard())).returning(); if (!u) return null; await tx.insert(qcReviews).values({ orderId: id }); return u; }); }",
    ["qcReviews"],
    true,
  ],
  [
    // İşlem açılmış ama kayıt DIŞARIDAKİ bağlantıyla yazılıyor: geri sarma onu
    // kapsamaz, yani garanti yoktur.
    "kayıt işlem tutamacıyla değil `db` ile yazılıyor",
    "async function f(){ await db.transaction(async (tx) => { const [u] = await tx.update(orders).set({ painterStatus: next }).where(and(eq(orders.id, id), notRefundedGuard())).returning(); if (!u) return null; await db.insert(painterQcReviews).values({ orderId: id }); return u; }); }",
    ["painterQcReviews"],
    false,
  ],
  [
    "işlem içinde ama gerekçe tablosu hiç yazılmıyor",
    "async function f(){ await db.transaction(async (tx) => { await tx.update(orders).set({ manufacturerStatus: next }).where(and(eq(orders.id, id), notRefundedGuard())); }); }",
    ["manufacturerActions"],
    false,
  ],
];
for (const [name, src, tables, want] of JUSTIFIED_SELF_TESTS) {
  ok(
    `checker: gerekçeli geçiş, ${name} → ${want ? "kabul" : "red"}`,
    (unjustifiedTransitions(src, tables).length === 0) === want,
    unjustifiedTransitions(src, tables)
  );
}

/**
 * Bir geçiş ile onu haklı çıkaran kayıt. Yeni bir QC/geçiş ucu buraya
 * yazılmazsa kural onu kapsamaz; listeye eklemek tek satırdır, unutmanın
 * bedeli ise kaydı olmayan bir ilerlemedir.
 */
const JUSTIFIED_TRANSITIONS: Array<[string, readonly string[]]> = [
  ["src/app/api/admin/orders/[id]/qc-approve/route.ts", ["qcReviews"]],
  ["src/app/api/admin/orders/[id]/qc-reject/route.ts", ["qcReviews"]],
  ["src/app/api/admin/painter-qc/[id]/approve/route.ts", ["painterQcReviews"]],
  ["src/app/api/admin/painter-qc/[id]/reject/route.ts", ["painterQcReviews"]],
  ["src/app/api/manufacturer/orders/[id]/submit-qc/route.ts", ["manufacturerActions"]],
  ["src/app/api/painter/orders/[id]/submit-qc/route.ts", ["painterActions"]],
];
for (const [rel, tables] of JUSTIFIED_TRANSITIONS) {
  const problems = unjustifiedTransitions(read(rel), tables);
  ok(`${rel}: durum ve gerekçe kaydı TEK işlemde`, problems.length === 0, problems);
}

// ─── Kapıyı besleyen SAYIM, okunamadığında sıfır sayılamaz ─────────────────
// Tur fotoğraflarının sayısı iki kapıyı besliyor: yükleme tavanı (tur başına en
// fazla 6) ve incelemeye gönderme barajı (en az 4). Okunamayan sayıyı sıfır
// saymak, birincisinde sınırı sessizce kaldırır, ikincisinde partnere OLMAYAN
// bir eksiği ("fotoğraf yükleyin") anlatırdı. Kural: okuma kendi yakalamasını
// taşır ve o yakalama, arızayı adıyla söyleyen kodu döndürür.
const PHOTO_COUNT_GATES: Array<[string, string]> = [
  ["src/app/api/manufacturer/orders/[id]/qc-photos/route.ts", "qcPhotos"],
  ["src/app/api/manufacturer/orders/[id]/submit-qc/route.ts", "qcPhotos"],
  ["src/app/api/painter/orders/[id]/submit-qc/route.ts", "painterQcPhotos"],
  ["src/app/api/painter/orders/[id]/qc-photos/route.ts", "painterQcPhotos"],
];
const PHOTO_COUNT_CODE = "qc_photo_count_unavailable";

/** Sayım okuması, arızayı ADIYLA cevaplayan bir yakalamanın içinde mi? */
function countReadAnswers(src: string, table: string, code: string): boolean {
  const sf = parse(src);
  const reads: ts.CallExpression[] = [];
  forEachNode(sf, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "from" &&
      n.arguments.length === 1 &&
      ts.isIdentifier(n.arguments[0]) &&
      n.arguments[0].text === table
    ) {
      reads.push(n);
    }
  });
  if (reads.length === 0) return false;
  return reads.every((r) => {
    // EN YAKIN saran try: rotanın en dıştaki try'ı her okumayı kapsar, o yüzden
    // "bir try'ın içinde" demek yetmez — arızayı adıyla söyleyen yakalama aranır.
    let p: ts.Node | undefined = r.parent;
    while (p) {
      if (ts.isTryStatement(p) && p.catchClause && within(p.tryBlock, r)) {
        return anyNode(
          p.catchClause.block,
          (n) => ts.isStringLiteralLike(n) && n.text === code
        );
      }
      p = p.parent;
    }
    return false;
  });
}
ok(
  "checker: sayım kendi yakalamasını taşımıyorsa reddedilir",
  !countReadAnswers(
    'async function f(){ try { const [r] = await db.select({ value: count() }).from(qcPhotos).where(w); return NextResponse.json({ n: r.value }); } catch (e) { return handleRouteFailure(e, "x", M); } }',
    "qcPhotos",
    PHOTO_COUNT_CODE
  )
);
ok(
  "checker: arızayı adıyla cevaplayan sayım kabul edilir",
  countReadAnswers(
    'async function f(){ try { const [r] = await db.select({ value: count() }).from(qcPhotos).where(w); n = Number(r?.value ?? 0); } catch (e) { return NextResponse.json({ error: M, code: "qc_photo_count_unavailable" }, { status: 503 }); } }',
    "qcPhotos",
    PHOTO_COUNT_CODE
  )
);
for (const [rel, table] of PHOTO_COUNT_GATES) {
  ok(
    `${rel}: fotoğraf sayımı okunamadığında kapı kapalı kalır ve sebebini söyler`,
    countReadAnswers(read(rel), table, PHOTO_COUNT_CODE)
  );
}

// ─── Müşteri model onayı ve onay SLA'sı ─────────────────────────────────────
const MODEL_APPROVAL = "src/lib/services/model-approval.ts";
{
  const src = read(MODEL_APPROVAL);
  ok(`${MODEL_APPROVAL}: every status write carries the refund guard`, statusWritesGuarded(src));
  ok(`${MODEL_APPROVAL}: no 'succeeded' requirement`, !hasSucceededRequirement(src));
}
const SLA_WORKER = "src/lib/queue/workers/model-approval-sla.worker.ts";
{
  const src = read(SLA_WORKER);
  const sf = parse(src);
  ok(`${SLA_WORKER}: every read of orders leaves refunded orders out`, everyOrdersSelectGuarded(src));
  ok(
    `${SLA_WORKER}: never writes orders.status itself`,
    !updateChains(sf).some((c) => !!c.set && setWrites(c.set, "status"))
  );
  ok(
    `${SLA_WORKER}: transitions only through decideModelApproval`,
    anyNode(sf, (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "decideModelApproval")
  );
}

// ─── Para: tek tahakkuk noktası ─────────────────────────────────────────────
// Partner hakedişini YALNIZ bu iki modül yazar; ikisi de iade kontrolünü aynı
// işlemde, kilitli okumayla yapar. Atölye toplu sevki, boyacıya devir, admin
// devri ve geri-alma sonrası yeniden tahakkuk bu fonksiyonlardan geçer.
const ACCRUAL_MODULES = ["src/lib/services/payouts.ts", "src/lib/services/painter-payouts.ts"];
const inserters = sourceFiles("src")
  .filter((rel) => {
    const src = read(rel);
    return src.includes("Earnings") && earningInserts(parseFile(rel, src)).length > 0;
  })
  .sort();
ok(
  "only the accrual modules insert partner earnings",
  JSON.stringify(inserters) === JSON.stringify([...ACCRUAL_MODULES].sort()),
  inserters
);
for (const rel of ACCRUAL_MODULES) {
  const src = read(rel);
  ok(`${rel}: every earning insert is refund-guarded under a row lock in its transaction`, accrualsGuarded(src));
  ok(`${rel}: reports a 'skipped_refunded' outcome`, hasStringLiteral(src, "skipped_refunded"));
}
const WORKSHOP_SHIP = "src/app/api/admin/workshops/sessions/[id]/ship/route.ts";
{
  const src = read(WORKSHOP_SHIP);
  ok(
    `${WORKSHOP_SHIP}: workshop batch accrual goes through accrueEarning`,
    codeIdentifiers(src).has("accrueEarning") && earningInserts(parse(src)).length === 0
  );
}

// ─── Üretici atamasını geri alma ────────────────────────────────────────────
// Düz geri alma temizliktir ve serbesttir; başka üreticiye devir ileri işlemdir.
// Ret, geri almadan ÖNCE gelmeli: önce geri alıp sonra devri reddetmek admin'i
// yarım bir işlemle ve yarışı suçlayan bir mesajla bırakıyordu.
const REVOKE = "src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts";
{
  const src = read(REVOKE);
  const sf = parse(src);
  const firstCall = (name: string) => {
    let pos = -1;
    forEachNode(sf, (n) => {
      if (pos < 0 && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
        pos = n.getStart();
      }
    });
    return pos;
  };
  const refundCheck = firstCall("isRefunded");
  const revoke = firstCall("revokeManufacturerAssignment");
  ok(`${REVOKE}: a refunded hand-off is refused before the revoke runs`, refundCheck >= 0 && revoke >= 0 && refundCheck < revoke);
  ok(`${REVOKE}: refusal copy`, hasStringLiteral(src, "İade edilen sipariş başka bir üreticiye devredilemez."));
  let reasonRefunded = 0;
  forEachNode(sf, (n) => {
    if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name) || n.name.text !== "reason") return;
    const v = unwrapAs(n.initializer);
    if (ts.isStringLiteralLike(v) && v.text === "refunded") reasonRefunded++;
  });
  ok(`${REVOKE}: both the 409 and the success body say reason: "refunded"`, reasonRefunded >= 2, reasonRefunded);

  // Düz geri alma, iade edilmiş siparişte HER alt durumda serbest. Olağan geri
  // alma alt durum sınırında reddederse (wrong_status / already_shipped), yalnız
  // iade edilmiş satıra eşleşen ve alt durum sınırı olmayan koparmaya düşülür.
  // Sınır iade edilmemiş siparişte kalır; devir hedefli istek buraya hiç gelmez.
  const refundedOnly = (w: ts.CallExpression) =>
    w.arguments.some((a) =>
      anyNode(
        a,
        (n) =>
          isCallTo(n, "eq") &&
          (n as ts.CallExpression).arguments.length === 2 &&
          isPaymentStatusRef((n as ts.CallExpression).arguments[0]) &&
          (() => {
            const v = (n as ts.CallExpression).arguments[1];
            return (
              (ts.isIdentifier(v) && v.text === "REFUNDED_PAYMENT_STATUS") ||
              (ts.isStringLiteralLike(v) && v.text === REFUNDED_PAYMENT_STATUS)
            );
          })()
      )
    );
  const cleanup = updateChains(sf).find(
    (c) => !!c.set && setWrites(c.set, "manufacturerId") && !!c.where && refundedOnly(c.where)
  );
  ok(`${REVOKE}: a detach that matches only a refunded row exists`, !!cleanup);
  ok(
    `${REVOKE}: that detach has no sub-status or shipped limit`,
    !!cleanup?.where &&
      !whereRefersTo(cleanup.where, "manufacturerStatus") &&
      !whereRefersTo(cleanup.where, "shippedAt")
  );
  let owner: ts.Node | undefined = cleanup?.set ?? undefined;
  while (owner && !(ts.isFunctionDeclaration(owner) && owner.name)) owner = owner.parent;
  const ownerName = owner && ts.isFunctionDeclaration(owner) ? owner.name!.text : null;
  const detachFn = owner && ts.isFunctionDeclaration(owner) ? owner : null;
  const detaches = ownerName ? callsTo(sf, ownerName) : [];
  ok(`${REVOKE}: koparma gerçekten çağrılıyor`, detaches.length > 0, ownerName);

  // İADE EDİLMİŞ SİPARİŞTE KOPARMA ÖNCE GELİR.
  //
  // Buradaki iddia eskiden tam TERSİNİ pinliyordu ("olağan geri alma önce
  // koşsun, koparmaya yalnız o alt durumdan reddederse düşülsün") ve canlı bir
  // hatayı yeşil gösteriyordu: iade edilmiş sipariş geri alınabilir bir alt
  // durumdaysa (assigned…qc_approved) olağan servis "ok" diyor, sipariş
  // `approved`e geri sarılıyor, QC turu artıyor ve atölye siparişin kara
  // listesine yazılıyordu — koparma yolu ancak KARGOLANMIŞ siparişte açılıyordu.
  // Yazma bir kez olur, geri alınmaz; o yüzden ayrım çağrıdan ÖNCE yapılmalı.
  ok(
    `${REVOKE}: iade edilmiş sipariş geri saran servise HİÇ girmez (ayrım çağrıdan önce)`,
    callsTo(sf, "revokeManufacturerAssignment").length > 0 &&
      callsTo(sf, "revokeManufacturerAssignment").every((c) =>
        refundGated(c, refundNames(sf))
      )
  );
  ok(
    `${REVOKE}: güvenilirlik cezası iade edilmiş siparişte uygulanmaz`,
    callsTo(sf, "applyStrike").length > 0 &&
      callsTo(sf, "applyStrike").every((c) => refundGated(c, refundNames(sf)))
  );

  // Tek DOĞRU yol bile atölyeyi kara listeye yazıyordu: uç `blocklist`i
  // varsayılan TRUE alır ve admin ekranı iade edilmiş siparişte kutuyu gizlese
  // bile o varsayılanı göndermeye devam eder. Kural bu yüzden parametrede
  // değil KOPARMANIN KENDİNDE durur: bu yol bayrağı hiç almaz, yazmaz.
  ok(
    `${REVOKE}: koparma kara liste YAZMAZ`,
    !!cleanup?.set && !setWrites(cleanup.set, "declinedManufacturerIds")
  );
  ok(
    `${REVOKE}: koparma bir kara liste bayrağı ALMAZ (çağıran istese bile)`,
    !!detachFn &&
      !anyNode(
        detachFn,
        (n) =>
          ts.isIdentifier(n) &&
          (n.text === "blocklist" || n.text === "declinedManufacturerIds")
      )
  );
}

// ─── Geri saran servisler iade edilmiş siparişi HİÇ işlemez ─────────────────
// Rotadaki yol ayrımı doğru olsa bile bir ÖN OKUMADIR: okuma ile yazma arasına
// düşen iade servisi yine çalıştırırdı. O yüzden sınır servisin KENDİ içinde,
// iki kere durur: okuduğu anda hiçbir şey yazmadan çekilir (`code: "refunded"`)
// ve yazmasının WHERE'i iade korumasını taşır. İkisi de gerekli — ilki sipariş
// ile parayı el değmemiş bırakır, ikincisi yarışı kapatır.
const refundedCodeReturns = (sf: ts.SourceFile): ts.ReturnStatement[] => {
  const out: ts.ReturnStatement[] = [];
  forEachNode(sf, (n) => {
    if (!ts.isReturnStatement(n) || !n.expression) return;
    const v = unwrapAs(n.expression);
    if (
      ts.isObjectLiteralExpression(v) &&
      v.properties.some((pr) => {
        if (!ts.isPropertyAssignment(pr) || !ts.isIdentifier(pr.name)) return false;
        if (pr.name.text !== "code") return false;
        const init = unwrapAs(pr.initializer);
        return ts.isStringLiteralLike(init) && init.text === "refunded";
      })
    ) {
      out.push(n);
    }
  });
  return out;
};

const REWIND_SERVICES: Array<{ rel: string; risky: string[]; before: string[] }> = [
  {
    rel: "src/lib/services/manufacturer-revoke.ts",
    risky: ["status", "declinedManufacturerIds"],
    before: [],
  },
  {
    rel: "src/lib/services/revoke-after-painter.ts",
    risky: ["status", "declinedManufacturerIds", "declinedPainterIds"],
    // Hakediş çevirme bu servisin İLK yan etkisi: iade kontrolü ondan da önce
    // durmalı, yoksa iade edilmiş siparişte para çevrilip sipariş bırakılırdı.
    before: ["reverseEarning"],
  },
];
/**
 * `setWrites` YÜZEYSELDİR: yalnız doğrudan özellikleri görür. Bu iki servis
 * riskli alanlarını KOŞULLU YAYILMA ile yazıyor
 * (`...(needsStatusReset ? { status } : {})`), yani yüzeysel arama onları
 * bulamaz ve "yazma kalmamış" diye yanlış alarm verir. cleanupAccrual'ın kendi
 * taraması da aynı sebeple ağaca iner.
 */
const setWritesDeep = (set: ts.ObjectLiteralExpression, prop: string) =>
  anyNode(
    set,
    (n) =>
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ts.isIdentifier(n.name) &&
      n.name.text === prop
  );

for (const svc of REWIND_SERVICES) {
  const src = read(svc.rel);
  const sf = parse(src);
  const refusal = refundedCodeReturns(sf)[0] ?? null;
  ok(
    `${svc.rel}: iade edilmiş siparişte hiçbir şey yazmadan çekilir (code: "refunded")`,
    !!refusal
  );
  const chains = updateChains(sf);
  const firstWrite = Math.min(
    ...chains.map((c) => (c.setArg ?? c.where)?.getStart() ?? Number.MAX_SAFE_INTEGER)
  );
  ok(
    `${svc.rel}: iade kontrolü siparişi yazan UPDATE'ten ÖNCE`,
    !!refusal && chains.length > 0 && refusal.getStart() < firstWrite
  );
  for (const fn of svc.before) {
    const pos = callsTo(sf, fn)[0]?.getStart() ?? -1;
    ok(
      `${svc.rel}: iade kontrolü ${fn}() çağrısından da önce`,
      pos > 0 && !!refusal && refusal.getStart() < pos
    );
  }
  ok(`${svc.rel}: yazmanın WHERE'i iade korumasını taşır`, everyUpdateGuarded(src));
  // Tarama körelmesin: korunan yazma gerçekten geri sarıyor olmalı.
  ok(
    `${svc.rel}: korunan yazma hâlâ riskli alan taşıyor`,
    chains.some((c) => !!c.set && svc.risky.some((prop) => setWritesDeep(c.set!, prop))),
    svc.risky
  );
}

// Boyacıdan geri almada yarış kaybedildiğinde hakediş YENİDEN yazılır — ama
// iade edilmiş siparişte asla: orada yeniden tahakkuk, parası müşteriye geri
// gitmiş siparişin üstüne ÖDENEBİLİR bir hakediş koymak olurdu (ödeme talebi
// bekleyen her hakedişi toplu ödemeye alıyor).
{
  const rel = "src/lib/services/revoke-after-painter.ts";
  const sf = parse(read(rel));
  const names = refundNames(sf);
  const accruals = callsTo(sf, "accrueEarning");
  ok(`${rel}: yeniden tahakkuk hâlâ var`, accruals.length > 0);
  ok(
    `${rel}: yeniden tahakkuk iade durumuna bağlı`,
    accruals.every((c) => refundGated(c, names))
  );
}

// ─── Temizlik iade edilmiş siparişte de işini bitirir ───────────────────────
// İade partnerleri koparır; ondan önceki iadeler (eski satırlar) partneri bağlı
// bıraktı. Bu siparişleri yalnız temizlik yolları toparlar: iade edilmiş
// siparişte ne reddedilmeli ne de siparişi ileri taşıyan bir adıma geçmeli.

// Üretici reddi: koparma her durumda yapılır. İade edilmiş siparişte ardından
// sıralayıcı (manufacturer_assignment_evaluations satırı yazar), otomatik atama
// ve "manuel atama gerekli" e-postaları ÇALIŞMAZ, sebep 'refunded' döner.
// Koparmanın commit'inden sonra gelen iade de atama reddinde 'refunded' diye
// adlandırılır, olmayan bir yarış suçlanmaz.
const DECLINE_SERVICE = "src/lib/services/manufacturer-decline.ts";
{
  const sf = parse(read(DECLINE_SERVICE));
  const detach = updateChains(sf).find((c) => !!c.set && setWrites(c.set, "manufacturerId"));
  const detachAt = detach?.set?.getStart() ?? -1;
  ok(
    `${DECLINE_SERVICE}: the detach is never refused (no refund guard in its WHERE)`,
    !!detach?.where && !whereCarries(detach.where, isGuardCall)
  );
  const keyed = refundKeyedReturns(sf);
  ok(
    `${DECLINE_SERVICE}: no return decided by the refund state comes before the detach`,
    detachAt >= 0 && keyed.every((r) => r.getStart() > detachAt)
  );
  ok(
    `${DECLINE_SERVICE}: the refund state is read inside the detach's transaction (its row lock)`,
    callsTo(sf, "isRefunded").some((c) => {
      let fn: ts.Node | undefined = c.parent;
      while (fn && !isFunctionLike(fn)) fn = fn.parent;
      return !!fn && isTransactionCallback(fn);
    })
  );
  const reasons = refundedReasonReturns(sf);
  const firstStart = (name: string) => callsTo(sf, name)[0]?.getStart() ?? -1;
  const forward = ["rankForOrderWithShadow", "assignManufacturerToOrder", "notifyAdminManualAssignment"].map(
    firstStart
  );
  const shortCircuit = reasons.find((r) => r.getStart() > detachAt && keyed.includes(r));
  ok(
    `${DECLINE_SERVICE}: a refunded order returns reason 'refunded' before the ranker, the auto-assign and the admin e-mails`,
    !!shortCircuit && forward.every((pos) => pos > 0 && shortCircuit.getStart() < pos),
    forward
  );
  const assignAt = firstStart("assignManufacturerToOrder");
  ok(
    `${DECLINE_SERVICE}: an assign refused by a later refund is named 'refunded', not a lost race`,
    reasons.some(
      (r) =>
        assignAt > 0 &&
        r.getStart() > assignAt &&
        thenConditions(r).some((c) => anyNode(c, (n) => isCallTo(n, "isOrderRefunded")))
    )
  );
}

// Ret: önceden iade edilmiş, partneri hâlâ bağlı sipariş de koparılır. İadenin
// yan etkileri (hakediş geri alma, hediye kartı, gelir kaydı, müşteri e-postası)
// yalnız çevirmeyi kendisi yapan istekte, bir kez koşar.
const REJECT = "src/app/api/admin/orders/[id]/reject/route.ts";
{
  const sf = parse(read(REJECT));
  const isBareRefundedNow = (c: ts.Expression) => {
    const u = unwrapAs(c);
    return ts.isIdentifier(u) && u.text === "refundedNow";
  };
  const detaches = updateChains(sf).filter(
    (c) =>
      !!c.set &&
      setWrites(c.set, "manufacturerId") &&
      setWrites(c.set, "painterId") &&
      !setWrites(c.set, "paymentStatus") &&
      !!c.where &&
      !c.where.arguments.some((a) => anyNode(a, isPaymentStatusRef))
  );
  // The gate may skip the detach only when the flip already did it
  // (`!refundedNow`) or nothing is attached; it may not look at the payment
  // state, which is exactly what left an already-refunded order attached.
  const isNotRefundedNow = (n: ts.Node) =>
    ts.isPrefixUnaryExpression(n) &&
    n.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(n.operand) &&
    n.operand.text === "refundedNow";
  const gateRunsOnRefunded = (cond: ts.Expression) =>
    !isBareRefundedNow(cond) &&
    !hasLiteral(cond, "succeeded") &&
    !anyNode(cond, (n) => ts.isPropertyAccessExpression(n) && n.name.text === "paymentStatus") &&
    !anyNode(cond, (n) => n.kind === ts.SyntaxKind.FalseKeyword) &&
    (!anyNode(cond, (n) => ts.isIdentifier(n) && n.text === "refundedNow") || anyNode(cond, isNotRefundedNow));
  ok(
    `${REJECT}: partners are detached whatever the payment state (an already-refunded order too)`,
    detaches.some((c) => thenConditions(c.set!).every(gateRunsOnRefunded)),
    detaches.length
  );
  const SIDE_EFFECTS = ["reverseEarning", "reversePainterEarning", "refundGiftCardForOrder", "recordRefund"];
  const effects: ts.Node[] = SIDE_EFFECTS.flatMap((name) => callsTo(sf, name));
  forEachNode(sf, (n) => {
    if (
      ts.isPropertyAssignment(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === "type" &&
      ts.isStringLiteralLike(n.initializer) &&
      n.initializer.text === "order_refunded"
    ) {
      effects.push(n);
    }
  });
  ok(
    `${REJECT}: every refund side effect is still there`,
    SIDE_EFFECTS.every((name) => callsTo(sf, name).length > 0) && effects.some(ts.isPropertyAssignment)
  );
  ok(
    `${REJECT}: refund side effects run only under if (refundedNow)`,
    effects.every((n) => thenConditions(n).some(isBareRefundedNow))
  );
}

// Boyacıya devir, yazmada da "henüz boyacı yok" şartını arar: ön okuma ile
// yazma arasına giren bir admin ataması ikinci bir boyacıyla ezilmesin.
for (const rel of [
  "src/app/api/manufacturer/orders/[id]/send-to-painter/route.ts",
  "src/app/api/admin/orders/[id]/assign-painter/route.ts",
]) {
  const handoffs = updateChains(parse(read(rel))).filter((c) => !!c.set && setWrites(c.set, "painterId"));
  ok(
    `${rel}: the painter hand-off lands only while no painter is set`,
    handoffs.length > 0 &&
      handoffs.every(
        (c) => !!c.where && whereRefersTo(c.where, "painterStatus") && mentionsText(c.where, "unassigned")
      )
  );
}

// ─── Admin rotaları: durumu yazan HER UPDATE korumalı ───────────────────────
// Yukarıdaki listeler rotaları ADIYLA sayar ve tam olarak bu yüzden ikisini
// kaçırdı: force-review (paid|generating|processing_mesh → review, yani ONAY
// düğmesinin açıldığı durak) ve unstart-printing (printing → approved, üstelik
// iadenin BIRAKTIĞI şekle — üreticisiz bir basım siparişi — birebir uyan bir
// koşulla). İkisi de iade edilmiş siparişi kımıldatıyordu, biri panelden tek
// tıkla, ve hiçbir test onları adıyla anmıyordu.
//
// Bu yüzden kural artık LİSTEYE değil YAPIYA bakar: src/app/api/admin altında
// siparişin `status` sütununu yazan her `update(orders)`, iade korumasını KENDİ
// WHERE'inde taşımak zorundadır. Yeni bir admin rotası için kimsenin bir listeye
// ad eklemesi gerekmez — korumayı unutması yeter, test kırılır.
//
// Yön SORULMAZ: iade edilmiş sipariş hiçbir yöne kımıldamaz. Geri adımlar
// (teslimi geri alma) da bu kurala tabidir.
//
// Muafiyet mümkün ama BEDAVA DEĞİL: dosya aşağıdaki kısa listede GEREKÇESİYLE
// anılmak zorunda ve her muafiyetin altında, korumanın yerini tutan şeyin
// GERÇEKTEN orada durduğunu doğrulayan ayrı bir iddia var.

const isStatusProperty = (n: ts.Node) =>
  (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
  ts.isIdentifier(n.name) &&
  n.name.text === "status";

/** `<name>.status = ...` ya da `<name>["status"] = ...` ataması. */
function isStatusAssignmentTo(n: ts.Node, name: string): boolean {
  if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const lhs = n.left;
  if (ts.isPropertyAccessExpression(lhs)) {
    return (
      ts.isIdentifier(lhs.expression) && lhs.expression.text === name && lhs.name.text === "status"
    );
  }
  if (ts.isElementAccessExpression(lhs)) {
    return (
      ts.isIdentifier(lhs.expression) &&
      lhs.expression.text === name &&
      ts.isStringLiteralLike(lhs.argumentExpression) &&
      lhs.argumentExpression.text === "status"
    );
  }
  return false;
}

/**
 * Bu UPDATE siparişin DURUMUNU yazıyor mu?
 *
 * Nesne değişmezi doğrudan okunur — koşullu yayılma (`...(x ? { status } : {})`)
 * dahil. Yük bir DEĞİŞKENSE (`.set(updates)`) bildirimi ve `updates.status = ...`
 * atamaları okunur: düzenleme rotası yükünü böyle kurar ve durumu HİÇ yazmaz,
 * ona koruma dayatmak yanlış olurdu (adres/telefon düzeltmesi siparişi
 * kımıldatmaz). Okunamayan her yük — başka bir çağrıdan gelen nesne, `.set`in
 * hiç bulunamaması — durum yazıyor SAYILIR: okunamayan bir yük, kuralın
 * arkasına saklanılacak yer olmamalı.
 */
function writesOrderStatus(c: UpdateChain, sf: ts.SourceFile): boolean {
  const arg = c.setArg;
  if (!arg) return true;
  if (ts.isObjectLiteralExpression(arg)) return anyNode(arg, isStatusProperty);
  if (!ts.isIdentifier(arg)) return true;
  const decls: ts.VariableDeclaration[] = [];
  forEachNode(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === arg.text) {
      decls.push(n);
    }
  });
  const init = decls.length === 1 ? decls[0].initializer : undefined;
  if (!init || !ts.isObjectLiteralExpression(init)) return true;
  if (anyNode(init, isStatusProperty)) return true;
  return anyNode(sf, (n) => isStatusAssignmentTo(n, arg.text));
}

/** Durumu yazan ama korumayı WHERE'inde taşımayan `update(orders)` zincirleri. */
function unguardedStatusWrites(sf: ts.SourceFile): UpdateChain[] {
  return updateChains(sf).filter(
    (c) => writesOrderStatus(c, sf) && (!c.where || !whereCarries(c.where, isGuardCall))
  );
}

const adminStatusWritesGuarded = (src: string) => unguardedStatusWrites(parse(src)).length === 0;

// Denetleyicinin kendisi: korumasız durum yazmasını REDDETMELİ, durum
// yazmayanı serbest bırakmalı.
const ADMIN_STATUS_SELF_TESTS: Array<[string, string, boolean]> = [
  [
    "korumasız bir durum yazması",
    "async function f(){ await db.update(orders).set({ status: 'review', updatedAt: new Date() }).where(and(eq(orders.id, id), inArray(orders.status, r))); }",
    false,
  ],
  [
    "korumalı durum yazması",
    "async function f(){ await db.update(orders).set({ status: 'review' }).where(and(eq(orders.id, id), notRefundedGuard())); }",
    true,
  ],
  [
    "koruma dizi yayılmasıyla geliyorsa",
    "async function f(){ const conditions = [eq(orders.id, id), notRefundedGuard()]; await db.update(orders).set({ status: 'printing' }).where(and(...conditions)); }",
    true,
  ],
  [
    "durum yazmayan UPDATE'e koruma dayatılmaz",
    "async function f(){ await db.update(orders).set({ trackingNumber: t, carrier: c }).where(eq(orders.id, id)); }",
    true,
  ],
  [
    "değişkenle kurulan yük durumu yazmıyorsa",
    "async function f(){ const updates: Record<string, unknown> = { updatedAt: new Date() }; updates.phone = p; await db.update(orders).set(updates).where(eq(orders.id, id)); }",
    true,
  ],
  [
    "değişkenle kurulan yük durumu yazıyorsa",
    "async function f(){ const updates: Record<string, unknown> = { updatedAt: new Date() }; updates.status = 'shipped'; await db.update(orders).set(updates).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "okunamayan yük koruma ister",
    "async function f(){ await db.update(orders).set(buildPayload(o)).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "koşullu yayılmanın içindeki durum görülür",
    "async function f(){ await db.update(orders).set({ ...(done ? { status: 'delivered' } : {}) }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "geri adım da kapsam içinde (yön sorulmaz)",
    "async function f(){ await db.update(orders).set({ status: 'shipped', deliveredAt: null }).where(and(eq(orders.id, id), eq(orders.status, 'delivered'))); }",
    false,
  ],
];
for (const [name, src, want] of ADMIN_STATUS_SELF_TESTS) {
  ok(
    `checker: admin durum yazması, ${name} → ${want ? "kabul" : "red"}`,
    adminStatusWritesGuarded(src) === want
  );
}

/**
 * Gerekçeli muafiyetler. KISA kalmalı: her satır, korumanın NEDEN oraya
 * konmadığını ve yerini NEYİN tuttuğunu söyler. Aşağıda her biri için ayrıca
 * o "yerini tutan şey"in gerçekten orada olduğu doğrulanır.
 */
const ADMIN_STATUS_WRITE_EXEMPTIONS: Record<string, string> = {
  "src/app/api/admin/orders/[id]/reject/route.ts":
    "Ret siparişi KAPATIR, hiçbir yöne taşımaz: iade edilmiş sipariş de reddedilebilmeli. Bu dosyanın üst bölümü rotanın iadeyi hiç reddetmediğini ayrıca pinliyor.",
  "src/app/api/admin/orders/[id]/ship-kargo/route.ts":
    "Yalnız TELAFİ yazmaları korumasız: SOAP çağrısı patlayınca rotanın KENDİ yazdığı 'shipped' damgasını geri alır. Koruma oraya konsaydı, araya giren bir iade siparişi hiç var olmayan bir kargoyla 'shipped' bırakırdı. Gerçek kargolama yazması FORWARD_WRITES'ta ve korumalı.",
  "src/app/api/admin/workshops/sessions/[id]/ship/route.ts":
    "Toplu (parti) yazma: iade süzgeci satır satır değil partinin TANIMINDA durur — batchShipPending → batchOrderFilter iade edilmiş siparişi partiden düşürür (workshop-session.ts).",
  "src/app/api/admin/workshops/sessions/[id]/deliver/route.ts":
    "Toplu (parti) yazma: aynı süzgeç (batchOrderFilter / batchDeliverPending) iade edilmiş siparişi partiden düşürür.",
};

const ADMIN_ROUTE_DIR = "src/app/api/admin";
const adminWithUnguarded: string[] = [];
let adminScanned = 0;
for (const rel of sourceFiles(ADMIN_ROUTE_DIR)) {
  const src = read(rel);
  if (!src.includes("update(orders)")) continue;
  adminScanned++;
  const sf = parseFile(rel, src);
  const unguarded = unguardedStatusWrites(sf);
  if (unguarded.length > 0) adminWithUnguarded.push(rel);
  if (ADMIN_STATUS_WRITE_EXEMPTIONS[rel]) continue;
  ok(
    `${rel}: durumu yazan her UPDATE iade korumasını WHERE'inde taşır`,
    unguarded.length === 0,
    unguarded.map(
      (c) => `satır ${sf.getLineAndCharacterOfPosition((c.setArg ?? c.where!).getStart()).line + 1}`
    )
  );
}

// Tarama boş geçmesin: dosya taşınırsa ya da desen değişirse sessizce yeşile
// dönmemeli.
ok(`${ADMIN_ROUTE_DIR}: tarama gerçekten dosya buluyor`, adminScanned >= 10, adminScanned);
for (const rel of [
  "src/app/api/admin/orders/[id]/force-review/route.ts",
  "src/app/api/admin/orders/[id]/unstart-printing/route.ts",
  "src/app/api/admin/orders/[id]/deliver/route.ts",
]) {
  ok(`${rel}: taramanın kapsamında`, sourceFiles(ADMIN_ROUTE_DIR).includes(rel));
}

// Muafiyet listesi çürümesin: gereksizleşen satır silinmeli, gerekçe yazılı
// olmalı, liste kısa kalmalı.
ok(
  "muafiyet listesi kısa kalır",
  Object.keys(ADMIN_STATUS_WRITE_EXEMPTIONS).length <= 4,
  Object.keys(ADMIN_STATUS_WRITE_EXEMPTIONS).length
);
for (const [rel, reason] of Object.entries(ADMIN_STATUS_WRITE_EXEMPTIONS)) {
  ok(`${rel}: muafiyetin gerekçesi yazılı`, reason.trim().length >= 60);
  ok(
    `${rel}: muafiyet hâlâ gerekli (korumasız bir durum yazması var)`,
    adminWithUnguarded.includes(rel)
  );
}

// Muafiyetin BEDELİ: korumanın yerini tutan şey gerçekten orada mı?
//
// ship-kargo: korumasız her durum yazması bir TELAFİ olmalı — 'printing'e
// döner ve kendi attığı `shippedAt` damgasını siler.
{
  const rel = "src/app/api/admin/orders/[id]/ship-kargo/route.ts";
  const sf = parseFile(rel, read(rel));
  const unguarded = unguardedStatusWrites(sf);
  ok(
    `${rel}: korumasız durum yazmalarının hepsi kendi kargo damgasını geri alan telafi`,
    unguarded.length > 0 &&
      unguarded.every(
        (c) =>
          !!c.set &&
          c.set.properties.some(
            (pr) =>
              ts.isPropertyAssignment(pr) &&
              ts.isIdentifier(pr.name) &&
              pr.name.text === "status" &&
              ts.isStringLiteralLike(pr.initializer) &&
              pr.initializer.text === "printing"
          ) &&
          setNullsRollbackMarker(c.set)
      ),
    unguarded.length
  );
}

// Atölye uçları: korumasız her durum yazması partinin TANIMINI (batch süzgeci)
// WHERE'inde taşımalı. Süzgecin iade edilmiş siparişi düşürdüğü, bu dosyanın
// sonundaki WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES iddiasıyla pinli.
const BATCH_FILTERS = new Set([
  "batchOrderFilter",
  "batchPending",
  "batchShipPending",
  "batchDeliverPending",
  "deliverPending",
]);
for (const rel of [
  "src/app/api/admin/workshops/sessions/[id]/ship/route.ts",
  "src/app/api/admin/workshops/sessions/[id]/deliver/route.ts",
]) {
  const sf = parseFile(rel, read(rel));
  const unguarded = unguardedStatusWrites(sf);
  ok(
    `${rel}: korumasız durum yazmalarının hepsi parti süzgecini WHERE'inde taşır`,
    unguarded.length > 0 &&
      unguarded.every(
        (c) =>
          !!c.where &&
          whereCarries(
            c.where,
            (n) =>
              ts.isCallExpression(n) &&
              ts.isIdentifier(n.expression) &&
              BATCH_FILTERS.has(n.expression.text)
          )
      ),
    unguarded.length
  );
}

// ─── Temizlik BİRİKTİRMEZ: iade edilmiş siparişte ceza/kara liste/geri sarma ─
//
// Yukarıdaki bölüm temizliğin REDDEDİLMEDİĞİNİ pinliyor. Bu bölüm tersini
// pinler: temizlik iade edilmiş siparişte KOPARIR VE BİTİRİR. Kural (bağlayıcı
// karar, order-status-policy.ts'te de yazılı): iade edilmiş siparişte bir
// temizlik eylemi
//   • siparişin durumunu GERİ SARMAZ (iade edilen sipariş durumunu korur),
//   • güvenilirlik cezası YAZMAZ — ne `applyStrike` ne de puana giren bir
//     `manufacturer_actions` satırı (manufacturer-assignment.ts BAD_ACTIONS),
//   • kara listeye (declinedManufacturerIds / declinedPainterIds) kayıt DÜŞMEZ,
//   • siparişi atama aşamasına döndüren servisi ÇAĞIRMAZ.
// Ret bunun dışındadır ve olmaya da devam eder: siparişi terminal bir duruma
// taşır, yani hiçbir şey biriktirmez.
//
// Denetim YAPISAL: riskli yazma/çağrı, kendisini saran bir `if` ya da üçlü
// operatörün koşulunda iade durumu sorulduğunda "bağlı" sayılır. Koşulsuz
// bırakılan her biri kırmızı yanar — aşağıdaki denetleyici kendi kendini de
// sınıyor (gerçek bir rotanın korumasını SÖKÜP geçirdiğimizde kırmızı yandığı
// ayrıca, paylaşılan ağacın dışında bir kopyada doğrulandı).
const CLEANUP_RISKY_PROPS = new Set([
  "status",
  "declinedManufacturerIds",
  "declinedPainterIds",
]);
/** Siparişi yeniden dolaşıma sokan ya da partneri cezalandıran çağrılar. */
const CLEANUP_MOVERS = [
  "applyStrike",
  "revokeAfterPainterHandoff",
  // Üretici tarafının aynısı ve listede OLMAMASI canlı bir hatayı yeşil
  // gösteriyordu: rota bu servisi KOŞULSUZ ve İLK çağırıyordu, servis de iade
  // edilmiş siparişi geri alınabilir bir alt durumda bulunca siparişi geri
  // sarıyor, QC turunu artırıyor ve atölyeyi kara listeye yazıyordu.
  "revokeManufacturerAssignment",
];
/** Güvenilirlik puanını DÜŞÜREN eylem adları; aşağıda puanlayıcıyla eşlenir. */
const SCORED_BAD_ACTIONS = ["decline", "cancel_after_accept"];

/** Düğümü saran bir `if`/üçlü operatörün koşulu iade durumunu soruyor mu? */
function refundGated(node: ts.Node, names: Set<string>): boolean {
  for (let p: ts.Node = node; p.parent; p = p.parent) {
    const up = p.parent;
    if (ts.isIfStatement(up) && up.expression !== p && mentionsRefund(up.expression, names)) {
      return true;
    }
    if (
      ts.isConditionalExpression(up) &&
      up.condition !== p &&
      mentionsRefund(up.condition, names)
    ) {
      return true;
    }
  }
  return false;
}

/** `<x>.insert(<tablo>)` çağrıları (düz ad ya da `schema.x`). */
function insertsInto(root: ts.Node, table: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  forEachNode(root, (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "insert" ||
      n.arguments.length !== 1
    ) {
      return;
    }
    const a = n.arguments[0];
    const name = ts.isIdentifier(a)
      ? a.text
      : ts.isPropertyAccessExpression(a)
        ? a.name.text
        : null;
    if (name === table) out.push(n);
  });
  return out;
}

/** `.values({ action: "…" })` içindeki eylem adı. */
function insertedAction(call: ts.CallExpression): string | null {
  const values = chainedCalls(call).find((c) => c.name === "values");
  const arg = values?.call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  for (const p of arg.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "action") {
      const v = unwrapAs(p.initializer);
      if (ts.isStringLiteralLike(v)) return v.text;
    }
  }
  return null;
}

/**
 * Bir temizlik dosyasındaki iade durumuna BAĞLANMAMIŞ riskli yazma/çağrılar ve
 * bağlanmış olanların sayısı (tarama körelirse `gated` sıfıra düşer).
 */
function cleanupAccrual(src: string): { problems: string[]; gated: number } {
  const sf = parse(src);
  const names = refundNames(sf);
  const problems: string[] = [];
  let gated = 0;
  const check = (node: ts.Node, what: string) => {
    if (refundGated(node, names)) gated++;
    else problems.push(what);
  };
  for (const c of updateChains(sf)) {
    // Okunamayan yükü admin taraması ayrıca koruma altına alıyor.
    if (!c.set) continue;
    forEachNode(c.set, (n) => {
      if (
        (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
        ts.isIdentifier(n.name) &&
        CLEANUP_RISKY_PROPS.has(n.name.text)
      ) {
        check(n, `${n.name.text} yazması iade durumuna bağlı değil`);
      }
    });
  }
  for (const name of CLEANUP_MOVERS) {
    for (const call of callsTo(sf, name)) {
      check(call, `${name}() çağrısı iade durumuna bağlı değil`);
    }
  }
  for (const ins of insertsInto(sf, "manufacturerActions")) {
    const action = insertedAction(ins);
    if (action && SCORED_BAD_ACTIONS.includes(action)) {
      check(ins, `puana giren '${action}' eylem satırı iade durumuna bağlı değil`);
    }
  }
  return { problems, gated };
}

/** Puanlayıcının KENDİ ceza listesi: buradaki kopya onunla eşleşmek zorunda. */
function scorerBadActions(src: string): string[] {
  const found: string[][] = [];
  forEachNode(parse(src), (n) => {
    if (
      !ts.isVariableDeclaration(n) ||
      !ts.isIdentifier(n.name) ||
      n.name.text !== "BAD_ACTIONS" ||
      !n.initializer ||
      !ts.isNewExpression(n.initializer)
    ) {
      return;
    }
    const arg = n.initializer.arguments?.[0];
    if (!arg || !ts.isArrayLiteralExpression(arg)) return;
    found.push(arg.elements.filter(ts.isStringLiteralLike).map((e) => e.text));
  });
  return found[0] ?? [];
}

const SCORER = "src/lib/services/manufacturer-assignment.ts";
ok(
  `${SCORER}: ceza sayılan eylem adları buradaki listeyle birebir`,
  JSON.stringify([...SCORED_BAD_ACTIONS].sort()) ===
    JSON.stringify(scorerBadActions(read(SCORER)).sort()),
  scorerBadActions(read(SCORER))
);

// Denetleyicinin kendisi: korumasız hâli REDDETMELİ, korunmuş hâli kabul.
const CLEANUP_ACCRUAL_SELF_TESTS: Array<[string, string, boolean]> = [
  [
    "koşulsuz durum geri sarma",
    "async function f(){ await db.update(orders).set({ painterId: null, status: 'quality_check' }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "aynı geri sarma, iade durumuna bağlı",
    "async function f(){ const refunded = isRefunded(o); await db.update(orders).set({ painterId: null, ...(refunded ? {} : { status: 'quality_check' }) }).where(eq(orders.id, id)); }",
    true,
  ],
  [
    "koşulsuz kara liste yazması",
    "async function f(){ await db.update(orders).set({ painterId: null, declinedPainterIds: declined }).where(eq(orders.id, id)); }",
    false,
  ],
  [
    "kara liste yazması iade durumuna bağlı",
    "async function f(){ const refunded = isRefunded(o); await db.update(orders).set({ manufacturerId: null, ...(refunded ? {} : { declinedManufacturerIds: next }) }).where(eq(orders.id, id)); }",
    true,
  ],
  [
    "koşulsuz güvenilirlik cezası",
    "async function f(){ await applyStrike(manufacturerId); }",
    false,
  ],
  [
    "ceza yalnız iade EDİLMEMİŞ siparişte",
    "async function f(){ const refunded = isRefunded(o); if (!refunded) { await applyStrike(manufacturerId); } }",
    true,
  ],
  [
    "koşulsuz, puana giren eylem satırı",
    "async function f(){ await db.insert(manufacturerActions).values({ orderId, manufacturerId, action: 'cancel_after_accept' }); }",
    false,
  ],
  [
    "puana giren satır iade durumuna bağlı",
    "async function f(){ const refunded = isRefunded(o); if (!refunded) { await tx.insert(manufacturerActions).values({ orderId, manufacturerId, action: 'decline' }); } }",
    true,
  ],
  [
    // Puana girmeyen denetim satırı (admin_revoked) koşul istemez: ceza değil.
    "puana girmeyen denetim satırı koşulsuz yazılabilir",
    "async function f(){ await tx.insert(manufacturerActions).values({ orderId, manufacturerId, action: 'admin_revoked' }); }",
    true,
  ],
  [
    "siparişi geri saran üretici servisi koşulsuz çağrılıyor",
    "async function f(){ const r = await revokeManufacturerAssignment({ orderId: id, adminEmail, reason }); }",
    false,
  ],
  [
    "üretici servisi yalnız iade EDİLMEMİŞ dalda çağrılıyor",
    "async function f(){ const r = !!current && isRefunded(current) ? await detachFromRefundedOrder({ orderId: id }) : await revokeManufacturerAssignment({ orderId: id }); }",
    true,
  ],
  [
    "siparişi kuyruğa döndüren servis koşulsuz çağrılıyor",
    "async function f(){ const r = await revokeAfterPainterHandoff({ orderId: id, adminEmail, reason }); }",
    false,
  ],
  [
    "servis yalnız iade EDİLMEMİŞ dalda çağrılıyor",
    "async function f(){ const refunded = await isOrderRefunded(id).catch(() => false); const r = refunded ? await detachRefundedFromPainter({ orderId: id }) : await revokeAfterPainterHandoff({ orderId: id }); }",
    true,
  ],
  [
    // Salt koparma: riskli alan yok, sorulacak bir şey de yok.
    "riskli alan taşımayan koparma serbest",
    "async function f(){ await db.update(orders).set({ painterId: null, painterStatus: 'unassigned', sentToPainterAt: null }).where(eq(orders.id, id)); }",
    true,
  ],
];
for (const [name, src, want] of CLEANUP_ACCRUAL_SELF_TESTS) {
  ok(
    `checker: temizlik birikimi, ${name} → ${want ? "kabul" : "red"}`,
    (cleanupAccrual(src).problems.length === 0) === want,
    cleanupAccrual(src).problems
  );
}

// İade edilmiş siparişte iş görebilen HER temizlik yolu. Üreticinin ret rotası
// listede değil çünkü yazmanın tamamını servise devrediyor; servis listede.
const CLEANUP_ACCRUAL_FILES = [
  "src/app/api/manufacturer/orders/[id]/cancel/route.ts",
  "src/lib/services/manufacturer-decline.ts",
  "src/app/api/painter/orders/[id]/decline/route.ts",
  "src/app/api/admin/orders/[id]/revoke-painter/route.ts",
  // Boyacı ikizi listedeyken üretici geri alması DEĞİLDİ; tarama tam da canlı
  // hatanın olduğu dosyayı atlıyordu (geri saran servisin koşulsuz çağrısı ve
  // iade sorulmayan güvenilirlik cezası).
  "src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts",
];
for (const rel of CLEANUP_ACCRUAL_FILES) {
  const { problems, gated } = cleanupAccrual(read(rel));
  ok(
    `${rel}: iade edilmiş siparişte geri sarma / ceza / kara liste yok`,
    problems.length === 0,
    problems
  );
  // Tarama körelmesin: koruma sökülürse `problems` dolar, yazma tamamen
  // kaldırılırsa `gated` sıfırlanır. İkisi birden pinli.
  ok(
    `${rel}: iade durumuna bağlanmış en az bir riskli yazma/çağrı bulundu`,
    gated >= 1,
    gated
  );
}

// Temizliğin ANLATTIĞI şey de doğru olmak zorunda. İade edilmiş iptalde admin'e
// giden e-postanın şablon cümlesi SABİT ve olanın tam tersi: "Sipariş yeniden
// atama için yönetici kuyruğuna döndü" (email.ts → manufacturer_cancelled).
// Sipariş kuyruğa dönmedi; o e-posta admin'i var olmayan bir kuyruk satırını
// aramaya yollar, üstelik rotanın kendi [İPTAL] notu tersini yazmışken. Kural:
// ya doğrusu söylenir ya hiç gönderilmez.
{
  const rel = "src/app/api/manufacturer/orders/[id]/cancel/route.ts";
  const sf = parse(read(rel));
  const names = refundNames(sf);
  const jobs: ts.PropertyAssignment[] = [];
  forEachNode(sf, (n) => {
    if (!ts.isPropertyAssignment(n) || !ts.isIdentifier(n.name) || n.name.text !== "type") return;
    const v = unwrapAs(n.initializer);
    if (ts.isStringLiteralLike(v) && v.text === "manufacturer_cancelled") jobs.push(n);
  });
  ok(`${rel}: "kuyruğa döndü" diyen admin e-postası hâlâ kuruluyor`, jobs.length === 1, jobs.length);
  ok(
    `${rel}: o e-posta iade edilmiş siparişte kuyruğa GİRMEZ`,
    jobs.length > 0 && jobs.every((j) => refundGated(j, names))
  );
}

// ─── Admin rotası: beklenmeyen hatada BOŞ GÖVDE yok ────────────────────────
// Bağlayıcı kural: kanıtını okuyamayan kapı kapanır, BUNU SÖYLER ve asla boş
// gövdeyle cevaplamaz. QA'da tam tersi görüldü: denetim tablosu okunamazken
// geri alma işlemi patladı, Next'in varsayılan 500'üne düşüldü ve admin
// ekranına sıfır baytlık bir gövde gitti — güvenli taraf doğruydu (işlem geri
// sarıldı, sipariş ve hakediş el değmedi) ama ekranda tek kelime yoktu.
//
// Pin YAPISALDIR, metin araması değil: dışa açık yöntemin içinde `await` edilen
// her çağrı ya kendi `.catch(...)`ini taşır ya da GÖVDELİ bir cevap dönen
// `catch` bloğunun try'ı içindedir. Yakalamayı söken, gövdesiz cevaba çeviren
// ya da try'ın dışına bir okuma ekleyen değişiklik burada kırılır.

/**
 * Türkçe sözlük (tek etkin yerel). Rotaların bir kısmı hata cümlesini düz metin
 * değil `d["api.order.notFound"]` gibi bir ANAHTARLA döner; anahtarı çözmeden
 * bakan bir denetleyici o cevabı "İngilizce" sanır ve çalışan bir cümleyi
 * gereksiz yere yeniden yazdırırdı. Anahtar çözülür, yargı asıl METNE bakar.
 */
const TR_DICTIONARY: Map<string, string> = (() => {
  const sf = parse(read("src/lib/i18n/dictionaries/tr.ts"));
  const out = new Map<string, string>();
  forEachNode(sf, (n) => {
    if (!ts.isPropertyAssignment(n) || !ts.isStringLiteralLike(n.name)) return;
    const v = unwrapAs(n.initializer);
    if (ts.isStringLiteralLike(v) && v.text.trim()) out.set(n.name.text, v.text.trim());
  });
  return out;
})();

/** `NextResponse.json({ error: … })` çağrısındaki boş olmayan metinler. */
function jsonErrorTexts(node: ts.Node): string[] {
  if (!ts.isCallExpression(node)) return [];
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "json") return [];
  if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "NextResponse") return [];
  const body = node.arguments[0] ? unwrapAs(node.arguments[0]) : undefined;
  if (!body || !ts.isObjectLiteralExpression(body)) return [];
  const err = body.properties.find(
    (pr): pr is ts.PropertyAssignment =>
      ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === "error"
  );
  if (!err) return [];
  const texts: string[] = [];
  // Önce sözlük erişimleri (`d["anahtar"]`) çözülür; çözülen anahtarın KENDİSİ
  // metin sayılmaz, yoksa "api.order.notFound" Türkçe değilmiş gibi görünürdü.
  const resolved = new Set<ts.Node>();
  forEachNode(err.initializer, (m) => {
    if (!ts.isElementAccessExpression(m)) return;
    const arg = m.argumentExpression ? unwrapAs(m.argumentExpression) : undefined;
    if (!arg || !ts.isStringLiteralLike(arg)) return;
    const hit = TR_DICTIONARY.get(arg.text);
    if (hit) {
      texts.push(hit);
      resolved.add(arg);
    }
  });
  forEachNode(err.initializer, (m) => {
    if (resolved.has(m)) return;
    if (
      (ts.isStringLiteralLike(m) || ts.isTemplateHead(m) || ts.isTemplateMiddle(m) || ts.isTemplateTail(m)) &&
      m.text.trim().length > 0
    ) {
      texts.push(m.text.trim());
    }
  });
  return texts;
}

/**
 * Ortak cümle deposundaki (src/lib/api/route-error.ts) dışa açık metinler.
 *
 * Cümleyi her rotaya tek tek yazmak yerine tek kaynaktan almak, aynı arızanın
 * panelden panele farklı (ya da İngilizce) anlatılmasını imkânsız kılar.
 * Denetleyici bu sabitleri ÇÖZER: bir yakalama `handleRouteFailure(e, "…",
 * PARTNER_ACTION_FAILED_ERROR)` diyorsa, gerçekten hangi cümlenin gideceğini
 * burada okur ve Türkçe olup olmadığını ona göre söyler.
 */
const ROUTE_ERROR_MODULE = "src/lib/api/route-error.ts";
const ROUTE_ERROR_MESSAGES: Map<string, string> = (() => {
  const sf = parse(read(ROUTE_ERROR_MODULE));
  const out = new Map<string, string>();
  forEachNode(sf, (n) => {
    if (!ts.isVariableStatement(n)) return;
    if (!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return;
    for (const d of n.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = unwrapAs(d.initializer);
      if (ts.isStringLiteralLike(init) && init.text.trim()) out.set(d.name.text, init.text.trim());
    }
  });
  return out;
})();

/**
 * Ortak yardımcıyla verilen cevabın METNİ. Anahtar ayrıntı: mesaj hangi
 * argümandaysa YALNIZ o sayılır — `handleRouteFailure`ın ikinci argümanı
 * günlük etiketidir ("POST /api/…"), partnere gösterilen cümle değil. Etiketi
 * mesaj sanmak, Türkçe denetimini İngilizce bir yol adıyla "geçirirdi".
 */
const ROUTE_ERROR_HELPERS = new Map<string, number>([
  ["handleRouteFailure", 2],
  ["routeFailureResponse", 0],
]);

function helperErrorTexts(node: ts.Node): string[] {
  if (!ts.isCallExpression(node)) return [];
  const callee = node.expression;
  if (!ts.isIdentifier(callee)) return [];
  const idx = ROUTE_ERROR_HELPERS.get(callee.text);
  if (idx === undefined) return [];
  const arg = node.arguments[idx] ? unwrapAs(node.arguments[idx]) : undefined;
  if (!arg) return [];
  if (ts.isStringLiteralLike(arg)) return arg.text.trim() ? [arg.text.trim()] : [];
  // Çözülemeyen bir tanımlayıcı "garanti yok" demektir: gövdenin ne olduğunu
  // bilmeden cevabı sayılı kabul etmek, pinin tamamını delerdi.
  if (ts.isIdentifier(arg)) {
    const known = ROUTE_ERROR_MESSAGES.get(arg.text);
    return known ? [known] : [];
  }
  return [];
}

/**
 * Bu `catch` admin'in OKUYABİLECEĞİ bir cevabı garanti ediyor mu? Dönen dizi
 * bloğun cevaplayabildiği boş olmayan metinlerdir; BOŞ dizi "garanti etmiyor"
 * demektir: yeniden fırlatan, gövdesiz cevap dönen ya da hiç dönmeden gövdeden
 * düşen (yani hatayı yine Next'e bırakan) bir yakalama sayılmaz.
 */
function catchAnswers(clause: ts.CatchClause): string[] {
  const msgs: string[] = [];
  let broken = false;
  forEachNode(clause.block, (n) => {
    if (ts.isThrowStatement(n)) broken = true;
    if (!ts.isReturnStatement(n) || !n.expression) return;
    const answer = unwrapAs(n.expression);
    const texts = [...jsonErrorTexts(answer), ...helperErrorTexts(answer)];
    if (texts.length === 0) broken = true;
    else msgs.push(...texts);
  });
  const last = clause.block.statements[clause.block.statements.length - 1];
  if (!last || !ts.isReturnStatement(last)) broken = true;
  return broken ? [] : msgs;
}

/** Hatasını kendi yutmayan ve gövdeli bir yakalamanın içinde DURMAYAN çağrılar. */
function unguardedAwaits(fn: RouteHandlerFn): string[] {
  const guarded: ts.Block[] = [];
  forEachNode(fn, (n) => {
    if (ts.isTryStatement(n) && n.catchClause && catchAnswers(n.catchClause).length > 0) {
      guarded.push(n.tryBlock);
    }
  });
  const loose: string[] = [];
  forEachNode(fn, (n) => {
    if (!ts.isAwaitExpression(n)) return;
    const e = unwrapAs(n.expression);
    // Kendi `.catch(...)`i olan çağrı çağıranı patlatmaz.
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === "catch"
    ) {
      return;
    }
    // ÇAĞRI OLMAYAN await de sayılır. Eski kural yalnız `await f()` şeklini
    // görüyordu; oysa Next'in `params`ı bir SÖZDÜR ve `const { id } = await
    // params;` reddedildiğinde de rota fırlar. /media/products ucunun ÖLÇÜLEN
    // arızası tam olarak buydu: kapı, korumanın dışında duran bir `await
    // params`ın arkasındaydı ve denetleyici onu göremiyordu. Depodaki 290 ucun
    // tamamı tarandı: bu sıkılaştırma YENİ bir ihlal üretmiyor, yalnız açık
    // kapıyı kapatıyor.
    if (guarded.some((b) => within(b, n))) return;
    loose.push(n.getText().split("\n")[0].trim().slice(0, 80));
  });
  return loose;
}

function emptyBodyRisks(src: string, method = "POST"): { problems: string[]; messages: string[] } {
  const sf = parse(src);
  const hits: ts.FunctionDeclaration[] = [];
  forEachNode(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === method) hits.push(n);
  });
  const handler = hits[0];
  if (!handler) return { problems: [`${method} bulunamadı`], messages: [] };
  const messages: string[] = [];
  forEachNode(handler, (n) => {
    if (ts.isTryStatement(n) && n.catchClause) messages.push(...catchAnswers(n.catchClause));
  });
  return { problems: unguardedAwaits(handler), messages };
}

// Denetleyicinin kendisi: korumasız hâli REDDETMELİ, korunmuş hâli kabul.
const EMPTY_BODY_SELF_TESTS: Array<[string, string, boolean]> = [
  [
    "işi try'sız yapan yöntem",
    "export async function POST(){ const r = await work(); return NextResponse.json(r); }",
    false,
  ],
  [
    "işi gövdeli yakalamanın içine alan yöntem",
    "export async function POST(){ try { return await work(); } catch (e) { return NextResponse.json({ error: 'Beklenmeyen hata.' }, { status: 500 }); } }",
    true,
  ],
  [
    // Tam da canlıda olan: 500 var, gövde yok.
    "yakalama gövdesiz cevap dönüyor",
    "export async function POST(){ try { return await work(); } catch (e) { return new NextResponse(null, { status: 500 }); } }",
    false,
  ],
  [
    "yakalama boş nesne dönüyor",
    "export async function POST(){ try { return await work(); } catch (e) { return NextResponse.json({}, { status: 500 }); } }",
    false,
  ],
  [
    "yakalamanın metni boş",
    "export async function POST(){ try { return await work(); } catch (e) { return NextResponse.json({ error: '' }, { status: 500 }); } }",
    false,
  ],
  [
    "yakalama yeniden fırlatıyor",
    "export async function POST(){ try { return await work(); } catch (e) { throw e; } }",
    false,
  ],
  [
    "yakalama bazı dallarda hiç dönmüyor",
    "export async function POST(){ try { return await work(); } catch (e) { if (x) return NextResponse.json({ error: 'a' }, { status: 500 }); } }",
    false,
  ],
  [
    // Try'ın dışında kalan TEK okuma bile boş gövdeli 500'e açık kapıdır.
    "ön okuma try'ın dışında kalmış",
    "export async function POST(){ const pre = await read(); try { return await work(pre); } catch (e) { return NextResponse.json({ error: 'Beklenmeyen hata.' }, { status: 500 }); } }",
    false,
  ],
  [
    // Hatasını kendi yutan çağrı zaten çağıranı patlatmaz.
    "kendi .catch()'i olan çağrı try istemez",
    "export async function POST(){ const x = await read().catch(() => null); return NextResponse.json({ ok: !!x }); }",
    true,
  ],
  [
    // Ortak yardımcı da GÖVDELİ bir cevaptır: cümle tek kaynaktan gelir.
    "yakalama ortak yardımcıyla cevaplıyor",
    'export async function POST(){ try { return await work(); } catch (e) { return handleRouteFailure(e, "POST /api/x", PARTNER_ACTION_FAILED_ERROR); } }',
    true,
  ],
  [
    // Tanımadığı bir sabitle çağrılan yardımcı "garanti" sayılmaz.
    "yardımcının mesajı çözülemiyor",
    'export async function POST(){ try { return await work(); } catch (e) { return handleRouteFailure(e, "POST /api/x", SOME_UNKNOWN_MESSAGE); } }',
    false,
  ],
  [
    // TAM OLARAK onay uçlarının düzeltme ÖNCESİ hâli: ön okumalar try'ın
    // dışında ve tanımadığı arızayı yeniden fırlatan bir iç yakalama. Partnere
    // giden şey sıfır bayttı; pin bu şekli reddetmezse düzeltme geri alınabilir.
    "onay ucunun düzeltme öncesi hâli (ön okuma dışarıda + yeniden fırlatma)",
    'export async function POST(request, { params }){ const session = await getManufacturerSession(); const { id } = await params; let result; try { result = await recordPartnerModelAck({ orderId: id }); } catch (e) { const refusal = ackWriteFailureRefusal(e); if (!refusal) throw e; return NextResponse.json({ error: refusal.error }, { status: refusal.status }); } return NextResponse.json({ success: true, revision: result.revision }); }',
    false,
  ],
];
for (const [name, src, want] of EMPTY_BODY_SELF_TESTS) {
  ok(
    `checker: boş gövde, ${name} → ${want ? "kabul" : "red"}`,
    (emptyBodyRisks(src).problems.length === 0) === want,
    emptyBodyRisks(src).problems
  );
}

// Kural TEK BİR ROTANIN değil, işi yapan HER ucun kuralı. Pin önce yalnız admin
// geri alma ucundaydı; QA aynı boş gövdeyi üreticinin kabul ve iptal uçlarında
// ÖLÇTÜ (0 bayt, panel kendi yedek cümlesini gösteriyor) — yani listenin
// kendisi eksikti, kural değil. Buraya bir uç eklemek onu da aynı kurala sokar.
const EMPTY_BODY_ROUTES = [
  "src/app/api/admin/orders/[id]/revoke-manufacturer/route.ts",
  "src/app/api/manufacturer/orders/[id]/accept/route.ts",
  "src/app/api/manufacturer/orders/[id]/cancel/route.ts",
  "src/app/api/manufacturer/orders/[id]/decline/route.ts",
  "src/app/api/painter/orders/[id]/decline/route.ts",
  // Model onayı: kapının dürüst 503'ünün partnere gösterdiği TEK düğme. Burada
  // boş gövde, partneri çıkışsız bir döngüde bırakır (503 "tekrar deneyin" der,
  // düğme sıfır bayt döner), o yüzden iki hâli ayıran cümle şartı burada da
  // geçerlidir.
  "src/app/api/manufacturer/orders/[id]/ack-model/route.ts",
  "src/app/api/painter/orders/[id]/ack-model/route.ts",
];

/** Cümle gerçekten TÜRKÇE mi (İngilizce bir yedeğe kaymasın)? */
const looksTurkish = (m: string) => /[çğıöşüÇĞİÖŞÜ]/.test(m);

for (const rel of EMPTY_BODY_ROUTES) {
  const { problems, messages } = emptyBodyRisks(read(rel));
  ok(
    `${rel}: POST'ta korumasız await yok (beklenmeyen hata boş gövdeye düşemez)`,
    problems.length === 0,
    problems
  );
  ok(
    `${rel}: yakalama boş olmayan TÜRKÇE bir gövdeyle cevaplıyor`,
    messages.length >= 1 && messages.every(looksTurkish),
    messages
  );
}

// Tek bir genel cümle, İKİ HÂLİ ayırabilen uçlarda yetmez: partnerin (ya da
// admin'in) ne yapacağı yazmanın YAZILIP yazılmadığına bağlıdır — yazılmadıysa
// tekrar denemek güvenlidir, yazıldıysa aynı öğüt olmuş bir işi ikinci kez
// yaptırmaya çalışmak olur. Üreticinin ret ucu bilerek dışarıda: ret servisin
// kilitli işleminde yazılıyor ve rota, hatanın o işlemden önce mi sonra mı
// geldiğini BİLEMEZ; orada uydurulmuş bir kesinlik yerine "listeye bakın"
// cümlesi doğrudur (tek cümle kuralı yukarıda zaten pinli).
const TWO_STATE_ROUTES = EMPTY_BODY_ROUTES.filter(
  (rel) => rel !== "src/app/api/manufacturer/orders/[id]/decline/route.ts"
);
for (const rel of TWO_STATE_ROUTES) {
  const { messages } = emptyBodyRisks(read(rel));
  ok(
    `${rel}: yakalama iki hâli ayıran, boş olmayan Türkçe gövdeyle cevaplıyor`,
    new Set(messages).size >= 2,
    messages
  );
}

// Liste körelmesin: iade/arıza sırasında partnerin ya da admin'in
// basabileceği bir iş ucu eklenip buraya yazılmazsa, boş gövdeli 500 sessizce
// geri gelir. Aşağıdaki tarama, temizlik uçlarının (koparma yazan rotalar)
// hepsinin listede olmasını şart koşar.
for (const rel of [...PARTNER_CLEANUP, REVOKE]) {
  ok(
    `${rel}: boş gövde pininin listesinde`,
    EMPTY_BODY_ROUTES.includes(rel),
    EMPTY_BODY_ROUTES
  );
}

// ─── Süpürme: API YÜZEYİNİN TAMAMI gövdesiz cevap veremez ──────────────────
//
// Yukarıdaki liste ADLARI sayar ve her turda aynı şekilde körelir: kural
// konulur, birkaç rota düzeltilir, sonraki tur aynı hatayı LİSTEDE OLMAYAN bir
// rotada bulur.
//
// Süpürme bir önceki turda üç panel klasörüyle sınırlıydı ve bu sınır KURALIN
// değil, o turda düzeltilen yerin sınırıydı. Ölçüm bunu doğruladı: paneller
// yeşilken panel DIŞINDA 59 uç hâlâ sıfır baytlık bir 500 dönebiliyordu ve
// listenin başı müşterinin gördüğü uçlardı (önizleme, sepet, ödeme, yükleme) —
// yani kuralın en çok gerektiği yer, kuralın dışında kalmıştı. Artık süpürme
// src/app/api'nin TAMAMINI dolaşır: yeni bir uç eklendiğinde kimsenin bir
// listeye ekleme yapması gerekmez, ilk çalıştırmada görülür.
// Kök, ADI da dahil olmak üzere düzeltildi: sabit "API_SURFACE_ROOT" adını
// taşıyordu ama API yüzeyinin BİR PARÇASINI dışarıda bırakıyordu. Rota
// işleyicileri src/app/api ALTINDA olmak zorunda değil ve ölçüm tam orada iki
// tane buldu (media/products/[...key] ve indexnow-key.txt): ikisi de sıfır
// baytlık 500 dönebiliyordu, çünkü denetleyici o klasörlere hiç bakmıyordu.
// Bu, fixer'ın eski "üç panel klasörü" sınırında doğru teşhis ettiği hatanın
// aynısıydı — sınır kuralın değil, o turda düzeltilen YERİN sınırıydı.
const ROUTE_SURFACE_ROOT = "src/app";
const API_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

/**
 * src/app/api DIŞINDA yaşayan, bilinen rota işleyicileri.
 *
 * Liste bir İZİN listesi değil, KAPSAM İSPATIDIR: süpürme köke daraltılırsa
 * (ya da biri "zaten hepsi api altında" diye kökü geri alırsa) bu satırlar
 * kırmızıya döner. Yeni bir uç eklemek için buraya yazmak GEREKMEZ — süpürme
 * kökün altındaki her route.ts'i kendiliğinden bulur.
 */
const ROUTE_HANDLERS_OUTSIDE_API = [
  "src/app/indexnow-key.txt/route.ts",
  "src/app/media/products/[...key]/route.ts",
];

function routeFilesUnder(dirRel: string): string[] {
  const out: string[] = [];
  const walk = (cur: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, cur), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${cur}/${entry.name}`);
      else if (entry.name === "route.ts") out.push(`${cur}/${entry.name}`);
    }
  };
  walk(dirRel);
  return out.sort();
}

/** Bir rota işleyicisi: `export async function POST` YA DA `export const POST = …`. */
type RouteHandlerFn = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const isExportedNode = (n: ts.FunctionDeclaration | ts.VariableStatement) =>
  !!n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/**
 * Dosyadaki DIŞA AÇIK rota işleyicilerinin HEPSİ.
 *
 * NEDEN İKİ YAZIM: denetleyici yalnız `function` bildirimlerini tanıyordu, yani
 * `export const GET = async () => {}` yazımı onun için GÖRÜNMEZDİ — kuralın
 * arka kapısı. Bugün depoda o yazımdan bir örnek yok; ama bir denetleyici
 * "bugün örneği yok" üzerine kurulamaz: ilk örnek sessizce muaf olurdu.
 */
function exportedHandlers(src: string): Array<{ method: string; fn: RouteHandlerFn }> {
  const sf = parse(src);
  const out: Array<{ method: string; fn: RouteHandlerFn }> = [];
  forEachNode(sf, (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && isExportedNode(n)) {
      if (API_HTTP_METHODS.includes(n.name.text)) out.push({ method: n.name.text, fn: n });
      return;
    }
    if (ts.isVariableStatement(n) && isExportedNode(n)) {
      for (const decl of n.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !API_HTTP_METHODS.includes(decl.name.text)) continue;
        const init = decl.initializer ? unwrapAs(decl.initializer) : undefined;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          out.push({ method: decl.name.text, fn: init });
        }
      }
    }
  });
  return out;
}

/**
 * Dosyadaki DIŞA AÇIK her yöntem için risk raporu.
 *
 * `lastResort`, gövdenin EN ÜST seviyesindeki try'ın yakalamasıdır — yani
 * beklenmeyen bir hatayı gerçekten cevaplayan yer. Ayrım önemli: içerideki
 * yakalamalar BİLİNEN hâllerin cevabıdır ("Dosya bulunamadı", "Invalid JSON")
 * ve bir kısmının sözü hâlâ İngilizcedir; onların metnini bu pin yargılamaz
 * (ayrı bir iş). Yargıladığı şey, hiç beklenmeyen bir arızada kullanıcının
 * ekranında ne çıkacağıdır: orada boş gövde de İngilizce de olamaz.
 */
function handlerRisks(
  src: string
): Array<{ method: string; problems: string[]; lastResort: string[] }> {
  const out: Array<{ method: string; problems: string[]; lastResort: string[] }> = [];
  for (const { method, fn } of exportedHandlers(src)) {
    const body = fn.body;
    const lastResort: string[] = [];
    // Gövdesi blok OLMAYAN ok işlevi (`export const GET = () => …`) hiç `try`
    // taşıyamaz: lastResort boş kalır ve süpürme onu zaten sessiz sayar.
    if (body && ts.isBlock(body)) {
      for (const st of body.statements) {
        if (ts.isTryStatement(st) && st.catchClause) lastResort.push(...catchAnswers(st.catchClause));
      }
    }
    out.push({ method, problems: unguardedAwaits(fn), lastResort });
  }
  return out;
}

/* ── Karşısında EKRAN olmayan uçlar ─────────────────────────────────────────
 *
 * Birkaç ucun cevabını okuyan şey bir sayfa değil bir MAKİNEDİR (ödeme
 * sağlayıcısı, tarayıcı gezinmesi, ölçüm işareti) ve gövdesi JSON olamaz.
 * Onlara Türkçe cümle şartı koymak, cümleyi kimsenin okumadığı bir yere yazıp
 * sözleşmeyi bozmak olurdu. Muafiyet DAR: hâlâ "boş gövdeli 500'e düşemez"
 * kuralına tabiler — yalnız cevabın ŞEKLİ farklıdır, varlığı değil.
 *
 * Listeye girmek gerekçe ister; gerekçe burada, testin çıktısında görünür.
 */
const NON_SCREEN_CONTRACT = new Map<string, string>([
  [
    "src/app/api/webhooks/paytr/route.ts POST",
    "PayTR düz metin bekler: 500 + 'PAYTR internal' = teslimatı tekrar dene",
  ],
  [
    "src/app/api/payment/paytr/callback/route.ts POST",
    "aynı webhook'un takma adı — aynı düz metin sözleşmesi",
  ],
  [
    "src/app/api/analytics/collect/route.ts POST",
    "ölçüm işareti: her hâlde 204, hata istemciye hiç yansıtılmaz",
  ],
  [
    "src/app/api/auth/google/route.ts GET",
    "tarayıcı gezinmesi: cevap, cümleyi gösteren ekrana yönlendirmedir",
  ],
  [
    "src/app/api/auth/google/callback/route.ts GET",
    "tarayıcı gezinmesi: cevap, cümleyi gösteren ekrana yönlendirmedir",
  ],
]);

/** İfade, akışı bir CEVAPLA bitiriyor mu (dönüş, ya da iki dalı da dönen try)? */
function endsWithAnswer(st: ts.Statement | undefined): boolean {
  if (!st) return false;
  if (ts.isReturnStatement(st)) return true;
  if (ts.isTryStatement(st)) {
    const t = st.tryBlock.statements[st.tryBlock.statements.length - 1];
    const c = st.catchClause?.block.statements[st.catchClause.block.statements.length - 1];
    return endsWithAnswer(t) && endsWithAnswer(c);
  }
  return false;
}

/**
 * Muaf uçlar için kural: gövde JSON olmasa da BİR CEVAP garanti olmalı.
 * Yakalama hatayı yukarı bırakmayacak (fırlatma yok) ve gövdenin akışı
 * cevapsız bitmeyecek. Bu ikisi sağlanmadan Next'in boş 500'ü yine mümkündür.
 */
function contractAlwaysAnswers(fn: RouteHandlerFn): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  const tries: ts.TryStatement[] = [];
  forEachNode(fn, (n) => {
    if (ts.isTryStatement(n) && n.catchClause) tries.push(n);
  });
  if (tries.length === 0) return false;
  let escapes = false;
  for (const t of tries) {
    forEachNode(t.catchClause!.block, (n) => {
      // `unstable_rethrow(e)` bilerek muaf: Next'in kendi akış denetimini
      // yukarı bırakır, GERÇEK arızayı değil.
      if (ts.isThrowStatement(n)) escapes = true;
    });
  }
  // Muaf uçta da try DIŞINDA korumasız await kalamaz; guard ölçütü burada
  // "yakalama fırlatmıyor"dur (gövde JSON olmadığı için catchAnswers boş döner).
  const guarded = tries.filter((t) => {
    let throws = false;
    forEachNode(t.catchClause!.block, (n) => {
      if (ts.isThrowStatement(n)) throws = true;
    });
    return !throws;
  });
  let loose = 0;
  forEachNode(fn, (n) => {
    if (!ts.isAwaitExpression(n)) return;
    const e = unwrapAs(n.expression);
    if (
      ts.isCallExpression(e) &&
      ts.isPropertyAccessExpression(e.expression) &&
      e.expression.name.text === "catch"
    ) {
      return;
    }
    if (guarded.some((t) => within(t.tryBlock, n))) return;
    loose++;
  });
  return !escapes && loose === 0 && endsWithAnswer(body.statements[body.statements.length - 1]);
}

function exportedHandler(src: string, method: string): RouteHandlerFn | null {
  return exportedHandlers(src).find((h) => h.method === method)?.fn ?? null;
}

const sweepUnguarded: string[] = [];
const sweepSilent: string[] = [];
const sweepContract: string[] = [];
let sweptHandlers = 0;
const sweptFiles = routeFilesUnder(ROUTE_SURFACE_ROOT);
for (const rel of sweptFiles) {
  const src = read(rel);
  for (const r of handlerRisks(src)) {
    sweptHandlers++;
    const key = `${rel} ${r.method}`;
    if (NON_SCREEN_CONTRACT.has(key)) {
      const fn = exportedHandler(src, r.method);
      if (!fn || !contractAlwaysAnswers(fn)) sweepContract.push(key);
      continue;
    }
    if (r.problems.length > 0) sweepUnguarded.push(`${key}: ${r.problems[0]}`);
    if (!(r.lastResort.length >= 1 && r.lastResort.every(looksTurkish))) {
      sweepSilent.push(`${key}: ${JSON.stringify(r.lastResort.slice(0, 2))}`);
    }
  }
}
ok(
  "API yüzeyinin hiçbir ucunda korumasız await yok (boş gövdeli 500 imkânsız)",
  sweepUnguarded.length === 0,
  sweepUnguarded.slice(0, 8)
);
ok(
  "API yüzeyinin hepsi beklenmeyen hatada TÜRKÇE bir gövdeyle cevaplıyor",
  sweepSilent.length === 0,
  sweepSilent.slice(0, 8)
);
ok(
  "makine sözleşmeli uçlar da cevapsız kalamaz (fırlatma yok, akış cevapla biter)",
  sweepContract.length === 0,
  sweepContract
);
// Süpürmenin kendisi boşa düşmesin: yol yanlış yazılırsa 0 uç taranır ve
// şartların hepsi "geçer" görünürdü.
ok("süpürme uçları gerçekten gördü", sweptHandlers >= 285, sweptHandlers);
// KAPSAM İSPATI: kural klasörün değil UCUN kuralı. src/app/api dışındaki bilinen
// işleyiciler süpürmenin içinde mi? Kök bir gün "src/app/api"ye daraltılırsa bu
// iki satır kırmızıya döner — ölçümün bulduğu iki sıfır baytlık 500 tam da o
// daraltma yüzünden yıllarca görünmemişti.
for (const rel of ROUTE_HANDLERS_OUTSIDE_API) {
  ok(`süpürme src/app/api DIŞINDAKİ ucu da görüyor: ${rel}`, sweptFiles.includes(rel), sweptFiles.length);
}
// Muafiyet listesi de körelmesin: adı yazılıp dosyası silinen (ya da yöntemi
// değişen) bir giriş, sessizce "kimseyi muaf tutmayan" bir satıra dönüşürdü.
for (const key of NON_SCREEN_CONTRACT.keys()) {
  const [rel, method] = key.split(" ");
  ok(`muafiyet gerçek bir ucu gösteriyor: ${key}`, !!exportedHandler(read(rel), method));
}

// Tarayıcıya yönlendirmeyle cevap veren iki uç için cümle EKRANDA durur; o
// yüzden asıl şart, yönlendirmenin taşıdığı kodun giriş ekranında TÜRKÇE bir
// karşılığı olmasıdır. Olmasaydı kullanıcı sessiz bir /login sayfasına düşerdi.
{
  const login = read("src/app/login/page.tsx");
  for (const rel of [
    "src/app/api/auth/google/route.ts",
    "src/app/api/auth/google/callback/route.ts",
  ]) {
    const codes = [...read(rel).matchAll(/error=([a-z_]+)/g)].map((m) => m[1]);
    ok(`${rel}: yönlendirme bir hata kodu taşıyor`, codes.length > 0);
    for (const code of new Set(codes)) {
      const at = login.indexOf(`"${code}"`);
      const key = at < 0 ? null : /d\["([^"]+)"\]/.exec(login.slice(at, at + 200))?.[1] ?? null;
      const text = key ? TR_DICTIONARY.get(key) ?? null : null;
      ok(
        `giriş ekranı '${code}' kodunu TÜRKÇE bir cümleye çeviriyor`,
        !!text && looksTurkish(text),
        text
      );
    }
  }
}

// Denetleyici gerçekten KIRILIYOR mu: düzeltme ÖNCESİ şekil reddedilmeli.
// Aşağıdaki kaynak, /api/preview/[id]/regenerate ucunun düzeltmeden önceki
// halidir — try'ın DIŞINDA kalan okumalar ve rezervasyonu geri verip hatayı
// YENİDEN FIRLATAN bir yakalama. Canlıda bu, müşterinin ekranına sıfır bayt
// gönderiyordu. Süpürme bu şekli kabul ederse düzeltme sessizce geri alınabilir.
const PRE_FIX_SHAPE = `export async function POST(request, { params }) {
  const { id } = await params;
  const session = await getSessionUser();
  const reservation = await reserveSpend("fal", 8, { kind: "order", id });
  try {
    await db.update(previews).set({ status: "generating" }).where(eq(previews.id, id));
    await getPreviewGenerationQueue().add("generate-variations", { previewId: id });
  } catch (err) {
    await releaseSpend(reservation.reservationId);
    throw err;
  }
  return NextResponse.json({ status: "generating" });
}`;
{
  const [risk] = handlerRisks(PRE_FIX_SHAPE);
  ok(
    "süpürme, düzeltme ÖNCESİ şekli reddeder (try dışı okuma + yeniden fırlatan yakalama)",
    !!risk && risk.problems.length > 0 && risk.lastResort.length === 0,
    risk
  );
}
{
  // Olumlu kontrol: düzeltilmiş şekil kabul edilmeli, yoksa denetleyici "her
  // şeye hayır diyen" bir kapı olur ve hiçbir şey ispatlamazdı.
  const [risk] = handlerRisks(
    `export async function POST(request, ctx) {
  try {
    return await handlePOST(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "POST /api/x", CUSTOMER_ACTION_FAILED_ERROR);
  }
}`
  );
  ok(
    "süpürme, düzeltilmiş şekli kabul eder",
    !!risk && risk.problems.length === 0 && risk.lastResort.every(looksTurkish) && risk.lastResort.length > 0,
    risk
  );
}

// Kapsam genişledi: denetleyici, src/app/api DIŞINDAKİ bir ucun düzeltme ÖNCESİ
// şeklini de reddetmeli. Aşağıdaki kaynak /media/products/[...key] ucunun
// gerçek eski halidir: `await params` ve anahtar kapısı her türlü korumanın
// DIŞINDA, en dışta hiç yakalama yok ve gövdeler İngilizce. Canlıda bu,
// mağazanın herkese açık ürün görseli yolunda sıfır bayt demekti.
const PRE_FIX_OUTSIDE_API_SHAPE = `export async function GET(_request, { params }) {
  const { key: segments } = await params;
  const relativePath = \`products/\${segments.join("/")}\`;
  if (!isPublicUnsignedKey(relativePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let buffer;
  try {
    buffer = await getFileBuffer(relativePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buffer), { status: 200 });
}`;
{
  const [risk] = handlerRisks(PRE_FIX_OUTSIDE_API_SHAPE);
  ok(
    "süpürme, api DIŞINDAKİ ucun düzeltme ÖNCESİ şeklini reddeder (korumasız okuma + İngilizce gövde)",
    !!risk &&
      risk.problems.length > 0 &&
      !(risk.lastResort.length >= 1 && risk.lastResort.every(looksTurkish)),
    risk
  );
}

// İkinci arka kapı: `export const GET = async () => {}`. Denetleyici bu yazımı
// HİÇ görmüyordu, yani böyle yazılmış korumasız bir uç "sorun yok" diye
// geçerdi. Aşağıdaki şekil reddedilmeli; reddedilmiyorsa muafiyet geri gelmiş
// demektir.
{
  const [risk] = handlerRisks(
    `export const GET = async () => {
  const key = await getIndexNowKey();
  return new NextResponse(key, { status: 200 });
};`
  );
  ok(
    "süpürme, ok işlevi yazımındaki korumasız ucu GÖRÜR ve reddeder",
    !!risk && risk.method === "GET" && risk.problems.length > 0 && risk.lastResort.length === 0,
    risk
  );
}
{
  // Olumlu kontrol: aynı yazımın DÜZELTİLMİŞ hali kabul edilmeli, yoksa
  // denetleyici ok işlevlerine topluca "hayır" diyen bir kapı olurdu.
  const [risk] = handlerRisks(
    `export const GET = async (request, ctx) => {
  try {
    return await handleGET(request, ctx);
  } catch (e) {
    return handleRouteFailure(e, "GET /x", CUSTOMER_READ_FAILED_ERROR);
  }
};`
  );
  ok(
    "süpürme, ok işlevi yazımındaki DÜZELTİLMİŞ ucu kabul eder",
    !!risk &&
      risk.problems.length === 0 &&
      risk.lastResort.length > 0 &&
      risk.lastResort.every(looksTurkish),
    risk
  );
}

// ─── Ortak cümle deposu: mekanizmanın kendisi ──────────────────────────────
// Süpürme, yakalamaların bu modüle işaret etmesine güveniyor; öyleyse modülün
// kendisi de pinli olmalı — yoksa cümleler tek tek İngilizceye ya da boşa
// çevrilebilir ve her çağıran sessizce onunla birlikte bozulurdu.
ok("ortak cümle deposu en az dört mesaj taşıyor", ROUTE_ERROR_MESSAGES.size >= 4, [
  ...ROUTE_ERROR_MESSAGES.keys(),
]);
const englishMessages = [...ROUTE_ERROR_MESSAGES].filter(([, text]) => !looksTurkish(text));
ok(
  "ortak cümlelerin hepsi TÜRKÇE",
  englishMessages.length === 0,
  englishMessages.map(([name]) => name)
);
{
  const sf = parse(read(ROUTE_ERROR_MODULE));
  let answers = false;
  let rethrowsFirst = false;
  forEachNode(sf, (n) => {
    if (!ts.isFunctionDeclaration(n) || !n.name || !n.body) return;
    if (n.name.text === "routeFailureResponse") {
      forEachNode(n, (k) => {
        if (ts.isReturnStatement(k) && k.expression) {
          const texts = jsonErrorTexts(unwrapAs(k.expression));
          // Metin çağırandan gelir; aranan şey `error` alanının VARLIĞI.
          if (
            ts.isCallExpression(unwrapAs(k.expression)) &&
            /NextResponse\.json\([\s\S]*error/.test(k.getText())
          ) {
            answers = true;
          }
          void texts;
        }
      });
    }
    if (n.name.text === "handleRouteFailure") {
      // İLK ifade olmalı: Next kendi akış denetimini (redirect/notFound,
      // dinamik render'a düşme) hata fırlatarak yapar; onları yutan bir
      // yakalama rotayı sessizce yanlış çalıştırır.
      const first = n.body.statements[0];
      rethrowsFirst =
        !!first &&
        ts.isExpressionStatement(first) &&
        /^unstable_rethrow\(/.test(first.expression.getText());
    }
  });
  ok("routeFailureResponse gövdesinde `error` alanı var", answers);
  ok("handleRouteFailure Next'in akış hatalarını ÖNCE yukarı bırakır", rethrowsFirst);
}

// ─── Panel KABUKLARI: yalnız GÖSTERİLEN bir sayı paneli düşüremez ──────────
//
// Bir kabuktaki okuma tek bir kartı değil, o panelin HER sayfasını düşürür ve
// sayfaların kendi "okunamadı" korumaları hiç çalışamaz — kabuk onlardan önce
// ölür. Ölçüm: `products` okunamazken taranan 24 admin sayfasının 24'ü 500
// verdi. Aynı şekil üretici ve boyacı kabuklarında da duruyordu; "admin
// düzeltildi" demek kuralı değil, o turda düzeltilen YERİ anlatıyordu.
console.log("\npanel kabukları: rozet okumaları");

const parseTsx = (src: string): ts.SourceFile =>
  ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * Kabuktaki KORUMASIZ tablo okumaları.
 *
 * `identity`: panelin KAPISINI besleyen kimlik okuması (üretici/boyacı kaydının
 * onay durumu). O bilerek korumasızdır — okunamadığında "aktif" varsayıp paneli
 * açmak, kapıyı arızaya dayanarak açmak olurdu. Rozet sayıları ise yalnızca
 * GÖSTERİLİR ve hiçbir kapı açmaz.
 */
function unguardedShellReads(src: string, identity: string[]): string[] {
  const sf = parseTsx(src);
  const guarded: ts.Node[] = [];
  forEachNode(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "displayRead") {
      guarded.push(n);
    }
  });
  const loose: string[] = [];
  forEachNode(sf, (n) => {
    // Sorgu zinciri METİNLE aranmaz: ilk yazımda `/\bdb\./` deneyip biçimlendirmeye
    // takıldık — Prettier `await db\n  .select(...)` diye sardığında "db." hiç
    // geçmiyor ve tarama HER ŞEYİ temiz sanıyordu (üç yeşil satır boşa geçiyordu).
    // O yüzden `db` TANIMLAYICISI bulunur ve zincirin kökü ondan türetilir.
    if (!ts.isIdentifier(n) || n.text !== "db") return;
    // İçe aktarma satırındaki `db` bir okuma değildir.
    let inImport = false;
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isImportDeclaration(p)) inImport = true;
    }
    if (inImport) return;
    // Zincirin KÖKÜ: db.query.x.findFirst({…}) / db.select(…).from(…).where(…)
    let chain: ts.Node = n;
    while (
      chain.parent &&
      (ts.isPropertyAccessExpression(chain.parent) ||
        (ts.isCallExpression(chain.parent) && chain.parent.expression === chain))
    ) {
      chain = chain.parent;
    }
    if (guarded.some((g) => within(g, chain))) return;
    const text = chain.getText();
    if (identity.some((t) => text.includes(t))) return;
    loose.push(text.split("\n")[0].trim().slice(0, 80));
  });
  return loose;
}

const PANEL_SHELLS: Array<{ rel: string; sidebar: string; identity: string[] }> = [
  { rel: "src/app/admin/layout.tsx", sidebar: "src/app/admin/sidebar.tsx", identity: [] },
  {
    rel: "src/app/manufacturer/layout.tsx",
    sidebar: "src/app/manufacturer/sidebar.tsx",
    identity: ["manufacturers.id"],
  },
  {
    rel: "src/app/painter/layout.tsx",
    sidebar: "src/app/painter/sidebar.tsx",
    identity: ["painters.id"],
  },
];

for (const shell of PANEL_SHELLS) {
  const src = read(shell.rel);
  const loose = unguardedShellReads(src, shell.identity);
  ok(`${shell.rel}: rozet sayıları KORUMALI okunuyor (arıza paneli düşüremez)`, loose.length === 0, loose);
  ok(
    `${shell.rel}: okunamayan rozet İÇERİĞİN üstünde yazıyor`,
    /<PanelReadNotice areas={unreadableAreas} \/>/.test(src)
  );
  ok(
    `${shell.sidebar}: rozet sayı yerine "?" gösterebiliyor (badge: number | null)`,
    /badge: number \| null/.test(read(shell.sidebar))
  );
}

// Denetleyici gerçekten KIRILIYOR mu: düzeltme ÖNCESİ kabuk şekli reddedilmeli.
// Aşağıdaki kaynak üretici kabuğunun eski halidir — kimlik okuması korumalı
// sayılır, rozet sayımı ise korumasızdır ve tam da panelin tamamını düşüren
// satırdır.
{
  const PRE_FIX_SHELL_SHAPE = `export default async function ManufacturerLayout({ children }) {
  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
  });
  const [assignedCount] = await db
    .select({ count: sql\`count(*)::int\` })
    .from(orders)
    .where(sql\`x\`);
  return <PanelShell sidebar={<ManufacturerSidebar newAssignmentCount={assignedCount.count} />}>{children}</PanelShell>;
}`;
  const loose = unguardedShellReads(PRE_FIX_SHELL_SHAPE, ["manufacturers.id"]);
  ok("kabuk denetimi, düzeltme ÖNCESİ şekli reddeder (korumasız rozet sayımı)", loose.length === 1, loose);
}

// ─── Atölye partisi: iade değeri tek kaynaktan ──────────────────────────────
ok(
  "workshop batch excludes exactly REFUNDED_PAYMENT_STATUS",
  JSON.stringify([...WORKSHOP_BATCH_EXCLUDED_PAYMENT_STATUSES]) === JSON.stringify([REFUNDED_PAYMENT_STATUS])
);
ok(
  "workshop.ts spells no 'refunded' literal of its own",
  !hasStringLiteral(read("src/lib/config/workshop.ts"), REFUNDED_PAYMENT_STATUS)
);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exitCode = failed ? 1 : 0;
