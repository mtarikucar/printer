/** AST integration pins: comments cannot impersonate calls or the card lock. */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function nodes(root: ts.Node): ts.Node[] {
  const result: ts.Node[] = [];
  function visit(n: ts.Node) { result.push(n); ts.forEachChild(n, visit); }
  visit(root); return result;
}
function isCall(n: ts.Node, name: string): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name;
}
function memberCall(n: ts.Node, member: string): n is ts.CallExpression {
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === member;
}
function identifier(n: ts.Node | undefined, value: string): boolean { return !!n && ts.isIdentifier(n) && n.text === value; }
function property(n: ts.Node | undefined, owner: string, key: string): boolean {
  return !!n && ts.isPropertyAccessExpression(n) && identifier(n.expression, owner) && n.name.text === key;
}
/** Where the `tx` comes from: the file opens the transaction, or inherits the caller's. */
type TxBoundary = "transaction" | "caller-tx";
function verify(source: string, reader: "db" | "tx", boundary: TxBoundary = "transaction") {
  const sf = ts.createSourceFile("caller.ts", source, ts.ScriptTarget.Latest, true);
  const all = nodes(sf);
  const calls = all.filter(n => isCall(n, "countLiveGiftCardUses")) as ts.CallExpression[];
  assert.equal(calls.length, 1, "one real shared counter call");
  const call = calls[0];
  assert.ok(ts.isAwaitExpression(call.parent), "count must be awaited");
  assert.ok(identifier(call.arguments[0], reader) && property(call.arguments[1], "card", "id"), "count uses current reader and locked card identity");
  const decl = call.parent.parent;
  assert.ok(ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name), "count bound to a variable");
  const resultName = decl.name.text;
  assert.ok(all.some(n => ts.isBinaryExpression(n) && identifier(n.left, resultName)
    && n.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken && property(n.right, "card", "maxRedemptions")), "shared result enforces limit");
  assert.equal(all.some(n => memberCall(n, "from") && identifier(n.arguments[0], "giftCardRedemptions")), false, "no private redemption count remains");
  if (reader === "tx") {
    let block: ts.Node = decl;
    while (block.parent && !ts.isBlock(block)) block = block.parent;
    // The limit branch sits inside the card branch; the card lock must precede
    // it in that SAME block, inside the SAME transaction callback.
    let cardBranch: ts.Node | undefined = block.parent;
    while (cardBranch && !ts.isBlock(cardBranch)) cardBranch = cardBranch.parent;
    assert.ok(cardBranch && ts.isBlock(cardBranch));
    const lock = cardBranch.statements.find(s => s.end < call.pos && nodes(s).some(n =>
      memberCall(n, "for") && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "update"
      && nodes(n).some(c => memberCall(c, "from") && identifier(c.arguments[0], "giftCards"))
      && nodes(n).some(c => memberCall(c, "select") && ts.isPropertyAccessExpression(c.expression) && identifier(c.expression.expression, "tx"))));
    assert.ok(lock, "existing card UPDATE lock precedes enforcement in the same scope");
    if (boundary === "transaction") {
      let callback: ts.Node | undefined = cardBranch;
      while (callback && !ts.isArrowFunction(callback)) callback = callback.parent;
      assert.ok(callback && ts.isArrowFunction(callback) && callback.parameters.some(p => identifier(p.name, "tx")));
      assert.ok(memberCall(callback.parent, "transaction"), "lock and count share transaction callback");
    } else {
      // Shared reservation service: the lock and the count run on the CALLER's
      // transaction, so the balance decrement and the draft insert commit or
      // roll back together. Its own `db.transaction` would split them — money
      // spent on a draft that never existed.
      let fn: ts.Node | undefined = cardBranch;
      while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
      assert.ok(fn && ts.isFunctionLike(fn) && fn.parameters.some(p => identifier(p.name, "tx")),
        "lock and count share the caller's tx parameter");
      assert.equal(all.some(n => memberCall(n, "transaction")), false, "reservation opens no transaction of its own");
    }
  }
}
let checks = 0;
function test(label: string, run: () => void) { run(); checks++; console.log(`PASS ${label}`); }
const validation = fs.readFileSync("src/lib/services/gift-card.ts", "utf8");
const checkout = fs.readFileSync("src/app/api/orders/route.ts", "utf8");
test("validation delegates to shared counter and enforces result", () => verify(validation, "db"));
test("checkout delegates under its existing card UPDATE lock", () => verify(checkout, "tx"));
test("commented delegation does not fool pin", () => assert.throws(() => verify(validation.replace("await countLiveGiftCardUses(db, card.id)", "0 /* countLiveGiftCardUses(db, card.id) */"), "db")));
test("commented or downgraded lock does not fool pin", () => {
  const weakened = checkout.replaceAll('.for("update")', '.for("share") /* .for("update") */');
  assert.notEqual(weakened, checkout); assert.throws(() => verify(weakened, "tx"));
});
test("db lookup inside transaction cannot substitute for locked-reader count", () => assert.throws(() => verify(checkout.replace("countLiveGiftCardUses(tx, card.id)", "countLiveGiftCardUses(db, card.id)"), "tx")));
// Quote checkout reserves through the shared service instead of a third inline
// copy. Same shape as the route's block — lock, then count under that lock —
// but the transaction belongs to the caller (the draft insert is in it).
const reservation = fs.readFileSync("src/lib/services/gift-card-reservation.ts", "utf8");
test("reservation service counts under its own card lock, in the caller's tx", () => verify(reservation, "tx", "caller-tx"));
test("reservation service downgraded lock does not fool pin", () => {
  const weakened = reservation.replaceAll('.for("update")', '.for("share") /* .for("update") */');
  assert.notEqual(weakened, reservation); assert.throws(() => verify(weakened, "tx", "caller-tx"));
});
test("reservation service cannot count off an unlocked reader", () => assert.throws(() => verify(reservation.replace("countLiveGiftCardUses(tx, card.id)", "countLiveGiftCardUses(db, card.id)"), "tx", "caller-tx")));
test("reservation service opening its own transaction does not fool pin", () => {
  const split = `${reservation}\nasync function rogue() { await db.transaction(async (tx) => { void tx; }); }\n`;
  assert.throws(() => verify(split, "tx", "caller-tx"), /no transaction of its own/);
});
// ── Drift pin: the draft reservation refund has TWO bodies today ─────────────
// `order-draft.ts` · `refundGiftCardForDraft` (draft expiry / failed payment)
// and `gift-credit-return.ts` · `releaseDraftGiftReservationTx` (customer
// cancels a quote checkout) are the SAME money routine, line for line. The
// duplication is deliberate — the design mandates it because `order-draft.ts`
// belongs to another session (DO-NOT-EDIT), and collapsing the two is a
// follow-up PR. This pin keeps that debt from growing silently: touch one copy
// (the half-returned history gate, the `refundedAt` filter, the lock call) and
// `test:unit` turns red, because otherwise the two paths would start behaving
// differently on the SAME draft. Comments are stripped before comparing, so
// re-wording a comment on either side is free — and a comment can neither
// equalise a drifted copy nor impersonate the delegation below.
// When the follow-up PR lands (private copy deleted, or delegating to the
// shared body) the pin stays green on its own.
type PinnedBody = { node: ts.Node; text: string };
function declaredBody(source: string, name: string): PinnedBody | null {
  const sf = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
  let body: ts.Node | undefined;
  for (const n of nodes(sf)) {
    if (ts.isFunctionDeclaration(n) && identifier(n.name, name) && n.body) body = n.body;
    else if (ts.isVariableDeclaration(n) && identifier(n.name, name) && n.initializer
      && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) body = n.initializer.body;
  }
  if (!body) return null;
  return { node: body, text: ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, body, sf).replace(/\s+/g, " ").trim() };
}
function refundBodiesAgree(draftSource: string, returnSource: string) {
  const shared = declaredBody(returnSource, "releaseDraftGiftReservationTx");
  assert.ok(shared, "gift-credit-return.ts still declares releaseDraftGiftReservationTx");
  const copy = declaredBody(draftSource, "refundGiftCardForDraft");
  if (!copy) {
    // Follow-up PR's target state: the private copy is gone, so the expiry path
    // MUST reach the shared body — otherwise the reservation never returns.
    assert.ok(nodes(ts.createSourceFile("draft.ts", draftSource, ts.ScriptTarget.Latest, true)).some(n => isCall(n, "releaseDraftGiftReservationTx")),
      "private refund copy removed: order-draft.ts must delegate to releaseDraftGiftReservationTx");
    return;
  }
  if (nodes(copy.node).some(n => isCall(n, "releaseDraftGiftReservationTx"))) return; // delegated; no second body left
  assert.equal(copy.text, shared.text,
    "order-draft.ts · refundGiftCardForDraft drifted from gift-credit-return.ts · releaseDraftGiftReservationTx — same money routine, two bodies: change BOTH, or delete the copy and delegate to releaseDraftGiftReservationTx");
}
const draftRefund = fs.readFileSync("src/lib/services/order-draft.ts", "utf8");
const creditReturn = fs.readFileSync("src/lib/services/gift-credit-return.ts", "utf8");
test("draft reservation refund: both bodies still identical", () => refundBodiesAgree(draftRefund, creditReturn));
test("drift on either side breaks the pin", () => {
  const draftDrift = draftRefund.replace("restored >= r.amountKurus", "restored > r.amountKurus");
  assert.notEqual(draftDrift, draftRefund);
  assert.throws(() => refundBodiesAgree(draftDrift, creditReturn), /two bodies/);
  const returnDrift = creditReturn.replace("if (!candidates.length) return;", "if (!candidates.length) return; void 0;");
  assert.notEqual(returnDrift, creditReturn);
  assert.throws(() => refundBodiesAgree(draftRefund, returnDrift), /two bodies/);
});
test("commented delegation does not excuse a drifted copy", () => {
  const faked = draftRefund
    .replace("restored >= r.amountKurus", "restored > r.amountKurus")
    .replace("  const candidates = await tx.select", "  // releaseDraftGiftReservationTx(tx, draftId)\n  const candidates = await tx.select");
  assert.throws(() => refundBodiesAgree(faked, creditReturn), /two bodies/);
});
test("comment-only edits on either side keep the pin green", () => {
  refundBodiesAgree(draftRefund.replace("  if (!candidates.length) return;", "  // promoted usage is the refund engine's business\n  if (!candidates.length) return;"), creditReturn);
});
test("deleting the copy in favour of the shared body keeps the pin green", () => {
  refundBodiesAgree("async function refundGiftCardForDraft(tx: GiftTx, draftId: string): Promise<void> { await releaseDraftGiftReservationTx(tx, draftId); }\n", creditReturn);
  refundBodiesAgree("async function expireDraft(tx: GiftTx, id: string) { await releaseDraftGiftReservationTx(tx, id); }\n", creditReturn);
});
test("losing the refund body altogether breaks the pin", () => {
  assert.throws(() => refundBodiesAgree("export const nothing = 1;\n", creditReturn), /must delegate/);
  assert.throws(() => refundBodiesAgree(draftRefund, "export const nothing = 1;\n"), /still declares/);
});
console.log(`${checks} gift usage integration checks passed; no DB`);
