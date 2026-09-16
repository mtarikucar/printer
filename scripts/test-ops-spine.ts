/**
 * Pure-logic tests for the ops spine: no DB, no Redis. Everything DB-backed is
 * exercised by the migration round-trip and by usage, not here.
 */
import assert from "node:assert/strict";
import {
  AI_SPEND_FLAG_KEYS,
  AUTO_ASSIGN_FLAG_KEYS,
  FLAG_KEYS,
  FLAG_DEFAULTS,
  flagForcedOffByKillSwitch,
  isFlagKey,
} from "../src/lib/config/flags";
import {
  SPEND_CAPS,
  capForScope,
  effectiveCents,
  windowMsForScope,
} from "../src/lib/config/spend";
import { deriveIdempotencyKey } from "../src/lib/services/idempotency";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

console.log("flags");
test("eleven flags, closed set", () => {
  assert.deepEqual([...FLAG_KEYS].sort(), [
    "auto_assign_cart_platform",
    "auto_assign_custom",
    "auto_assign_manual",
    // Faz 4'ün tek boyacı anahtarı. Kapalı kümenin varlık sebebi tam olarak
    // budur: yeni bir bayrak, adı buraya elle yazılmadan sisteme giremez.
    "auto_assign_painter",
    "auto_assign_upload",
    "auto_assign_whatsapp_ai",
    "auto_model_enabled",
    "fal_enabled",
    "meshy_enabled",
    "wa_agent_enabled",
    "wa_bot_enabled",
  ]);
});
test("everything that spends NEW money defaults off", () => {
  // The spend set is spelled out here rather than derived from the source, so a
  // new money-spending flag cannot escape the rule by being filed under
  // routing: the closed-set test above already forces every new key to be
  // named, and this list forces it to be classified honestly.
  assert.deepEqual([...AI_SPEND_FLAG_KEYS].sort(), [
    "auto_model_enabled",
    "fal_enabled",
    "meshy_enabled",
    "wa_agent_enabled",
    "wa_bot_enabled",
  ]);
  assert.equal(FLAG_DEFAULTS.fal_enabled, true, "fal is already live today");
  for (const key of AI_SPEND_FLAG_KEYS) {
    if (key !== "fal_enabled") {
      assert.equal(FLAG_DEFAULTS[key], false, `${key} must ship disabled`);
    }
  }
  // No key may dodge the rule by belonging to neither group.
  for (const key of FLAG_KEYS) {
    const spend = (AI_SPEND_FLAG_KEYS as readonly string[]).includes(key);
    const routing = (AUTO_ASSIGN_FLAG_KEYS as readonly string[]).includes(key);
    assert.ok(spend !== routing, `${key} must sit in exactly one group`);
  }
  // Routing switches spend nothing new — they do by themselves what the admin
  // does by hand today — so they legitimately ship ON.
  for (const key of AUTO_ASSIGN_FLAG_KEYS) {
    assert.equal(FLAG_DEFAULTS[key], true, `${key} ships enabled`);
  }
});
test("AI_KILL_ALL stops the spending, not the manufacturer routing", () => {
  const previous = process.env.AI_KILL_ALL;
  try {
    process.env.AI_KILL_ALL = "1";
    for (const key of AI_SPEND_FLAG_KEYS) {
      assert.equal(flagForcedOffByKillSwitch(key), true, `${key} must be killed`);
    }
    for (const key of AUTO_ASSIGN_FLAG_KEYS) {
      assert.equal(
        flagForcedOffByKillSwitch(key),
        false,
        `${key} must keep routing orders — it spends no money`
      );
    }
    delete process.env.AI_KILL_ALL;
    for (const key of FLAG_KEYS) {
      assert.equal(flagForcedOffByKillSwitch(key), false, `${key} off-switch leaked`);
    }
  } finally {
    if (previous === undefined) delete process.env.AI_KILL_ALL;
    else process.env.AI_KILL_ALL = previous;
  }
});
test("isFlagKey rejects anything outside the set", () => {
  assert.equal(isFlagKey("meshy_enabled"), true);
  assert.equal(isFlagKey("drop_table"), false);
  assert.equal(isFlagKey(null), false);
});

console.log("spend caps");
test("caps match the spec", () => {
  assert.equal(SPEND_CAPS.global, 5000);
  assert.equal(SPEND_CAPS.conversation, 60);
  assert.equal(SPEND_CAPS.order, 150);
  assert.equal(SPEND_CAPS.phone, 100);
});
test("capForScope resolves every scope kind", () => {
  assert.equal(capForScope({ kind: "order", id: "x" }), 150);
  assert.equal(capForScope({ kind: "conversation", id: "x" }), 60);
  assert.equal(capForScope({ kind: "phone", id: "x" }), 100);
  assert.equal(capForScope({ kind: "global", id: "all" }), 5000);
});
test("order scope is all-time, the rest roll over 24h", () => {
  assert.equal(windowMsForScope("order"), 0);
  assert.equal(windowMsForScope("global"), 86_400_000);
  assert.equal(windowMsForScope("conversation"), 86_400_000);
  assert.equal(windowMsForScope("phone"), 86_400_000);
});
test("a reservation counts at its estimate until it settles", () => {
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: null }), 40);
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: 22 }), 22);
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: 0 }), 0);
});

console.log("idempotency");
const body = {
  orderType: "custom",
  previewId: "p1",
  size: "standart",
  material: "resin",
  finish: "hand_painted",
};
test("same payload and actor collapse onto one key", () => {
  assert.equal(deriveIdempotencyKey(body, "u1"), deriveIdempotencyKey(body, "u1"));
});
test("a different actor is a different key", () => {
  assert.notEqual(deriveIdempotencyKey(body, "u1"), deriveIdempotencyKey(body, "u2"));
});
test("one changed field is a different key", () => {
  assert.notEqual(
    deriveIdempotencyKey(body, "u1"),
    deriveIdempotencyKey({ ...body, size: "orta" }, "u1")
  );
});
test("key order does not matter", () => {
  const shuffled = {
    finish: "hand_painted",
    material: "resin",
    size: "standart",
    previewId: "p1",
    orderType: "custom",
  };
  assert.equal(deriveIdempotencyKey(body, "u1"), deriveIdempotencyKey(shuffled, "u1"));
});
test("nested objects and arrays are canonicalised too", () => {
  const a = { items: [{ id: 1, qty: 2 }], addr: { il: "İstanbul", ilce: "Kadıköy" } };
  const b = { addr: { ilce: "Kadıköy", il: "İstanbul" }, items: [{ qty: 2, id: 1 }] };
  assert.equal(deriveIdempotencyKey(a, "u1"), deriveIdempotencyKey(b, "u1"));
});
test("the key is a 64-char hex digest", () => {
  assert.match(deriveIdempotencyKey(body, "u1"), /^[0-9a-f]{64}$/);
});

console.log(
  failures === 0 ? "\n✅ ops-spine: all checks passed" : `\n❌ ops-spine: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
