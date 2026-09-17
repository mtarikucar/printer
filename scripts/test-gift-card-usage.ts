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
function verify(source: string, reader: "db" | "tx") {
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
    let callback: ts.Node | undefined = cardBranch;
    while (callback && !ts.isArrowFunction(callback)) callback = callback.parent;
    assert.ok(callback && ts.isArrowFunction(callback) && callback.parameters.some(p => identifier(p.name, "tx")));
    assert.ok(memberCall(callback.parent, "transaction"), "lock and count share transaction callback");
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
console.log(`${checks} gift usage integration checks passed; no DB`);
