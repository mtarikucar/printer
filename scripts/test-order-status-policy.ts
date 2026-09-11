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
    const chain: UpdateChain = { where: null, set: null, returning: false };
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
      if (name === "set" && call.arguments[0] && ts.isObjectLiteralExpression(call.arguments[0])) {
        chain.set = call.arguments[0];
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
  ok(`${rel}: refund guard inside the UPDATE's where`, guardInUpdateWhere(src));
  ok(`${rel}: no 'succeeded' requirement`, !hasSucceededRequirement(src));
}

// Teslim ve ret iade edilmiş siparişte serbest kalır: teslim yola çıkmış paketin
// kaydıdır, ret siparişi kapatır. Tarama boş geçmesin diye önce rotanın
// gerçekten bir `update(orders)...where(...)` yazdığı doğrulanır; sonra ne o
// yazmalar iade korumasını taşır ne de kod (yorum değil) iade reddine başvurur.
const REFUSAL_IDS = [
  "notRefundedGuard",
  "isOrderRefunded",
  "isPartnerOrderRefunded",
  "isRefunded",
  "REFUNDED_ORDER_ERROR",
];
for (const rel of [
  "src/app/api/admin/orders/[id]/deliver/route.ts",
  "src/app/api/admin/orders/[id]/reject/route.ts",
]) {
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
      anyNode(n.initializer, isRefundReadCall)
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

/** Why a cleanup route would refuse a refunded order; empty when it never does. */
function cleanupRefusals(src: string): string[] {
  const ids = codeIdentifiers(src);
  const out = REFUSAL_ONLY_IDS.filter((id) => ids.has(id));
  if (refundKeyedReturns(parse(src)).length > 0) out.push("a return decided by the refund state");
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
  const fallbacks = ownerName ? callsTo(sf, ownerName) : [];
  const gatedAsFallback = (call: ts.Node) =>
    thenConditions(call).some(
      (c) =>
        hasLiteral(c, "wrong_status") &&
        hasLiteral(c, "already_shipped") &&
        anyNode(c, (n) => isCallTo(n, "isRefunded")) &&
        anyNode(
          c,
          (n) =>
            ts.isPrefixUnaryExpression(n) &&
            n.operator === ts.SyntaxKind.ExclamationToken &&
            ts.isIdentifier(n.operand) &&
            n.operand.text === "targetManufacturerId"
        )
    );
  ok(
    `${REVOKE}: the refunded detach runs only for a plain revoke the ordinary one refused on sub-status`,
    fallbacks.length > 0 && fallbacks.every(gatedAsFallback),
    ownerName
  );
  ok(
    `${REVOKE}: the ordinary revoke runs first, so a live order keeps its limits`,
    fallbacks.length > 0 && fallbacks.every((c) => c.getStart() > revoke)
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
