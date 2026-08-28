/**
 * Webhook authentication tests.
 *
 * Two mechanisms, two secrets, and getting either wrong is the difference
 * between "Meta refuses to save our callback URL" and "anyone on the internet
 * can inject orders into our queue".
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyWebhookHandshake,
  verifyWebhookSignature,
} from "../src/lib/services/whatsapp-verify";
import {
  APPROVAL_BUTTONS,
  MAX_BUTTONS,
  MAX_BUTTON_TITLE,
  WA_ERRORS,
} from "../src/lib/config/whatsapp";

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

const APP_SECRET = "test-app-secret-abc123";
const VERIFY_TOKEN = "test-verify-token-xyz789";

function sign(body: string, secret = APP_SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

console.log("handshake (GET)");
process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

test("echoes the raw challenge when mode and token are right", () => {
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.challenge": "1158201444",
    "hub.verify_token": VERIFY_TOKEN,
  });
  assert.equal(verifyWebhookHandshake(params), "1158201444");
});

test("rejects a wrong verify token", () => {
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.challenge": "1158201444",
    "hub.verify_token": "wrong",
  });
  assert.equal(verifyWebhookHandshake(params), null);
});

test("rejects a mode that is not 'subscribe'", () => {
  const params = new URLSearchParams({
    "hub.mode": "unsubscribe",
    "hub.challenge": "1158201444",
    "hub.verify_token": VERIFY_TOKEN,
  });
  assert.equal(verifyWebhookHandshake(params), null);
});

test("rejects a missing challenge", () => {
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": VERIFY_TOKEN,
  });
  assert.equal(verifyWebhookHandshake(params), null);
});

test("refuses everything when no verify token is configured", () => {
  const saved = process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.challenge": "1",
    "hub.verify_token": "anything",
  });
  assert.equal(verifyWebhookHandshake(params), null);
  process.env.WHATSAPP_VERIFY_TOKEN = saved;
});

console.log("signature (POST)");
const BODY = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ id: "102290129340398", changes: [] }],
});

test("accepts a correctly signed body", () => {
  assert.equal(verifyWebhookSignature(BODY, sign(BODY), APP_SECRET), true);
});

test("rejects a body that changed by one byte", () => {
  assert.equal(verifyWebhookSignature(BODY + " ", sign(BODY), APP_SECRET), false);
});

test("rejects a signature made with a different secret", () => {
  assert.equal(verifyWebhookSignature(BODY, sign(BODY, "other-secret"), APP_SECRET), false);
});

test("rejects the legacy sha1 header shape", () => {
  assert.equal(verifyWebhookSignature(BODY, "sha1=deadbeef", APP_SECRET), false);
});

test("rejects a missing header", () => {
  assert.equal(verifyWebhookSignature(BODY, null, APP_SECRET), false);
});

test("rejects an unprefixed digest", () => {
  const digest = createHmac("sha256", APP_SECRET).update(BODY, "utf8").digest("hex");
  assert.equal(verifyWebhookSignature(BODY, digest, APP_SECRET), false);
});

test("refuses everything when no app secret is configured", () => {
  assert.equal(verifyWebhookSignature(BODY, sign(BODY), undefined), false);
});

test("a length-mismatched header does not throw (timingSafeEqual would)", () => {
  assert.doesNotThrow(() => verifyWebhookSignature(BODY, "sha256=ab", APP_SECRET));
  assert.equal(verifyWebhookSignature(BODY, "sha256=ab", APP_SECRET), false);
});

test("re-serialised JSON does NOT verify — the raw bytes are what is signed", () => {
  // This is the whole reason the route reads request.text() first.
  const reSerialised = JSON.stringify(JSON.parse(BODY.replace(/"entry"/, ' "entry"')));
  assert.notEqual(reSerialised, BODY.replace(/"entry"/, ' "entry"'));
  assert.equal(
    verifyWebhookSignature(reSerialised, sign(BODY.replace(/"entry"/, ' "entry"')), APP_SECRET),
    false
  );
});

console.log("outbound limits");
test("approval buttons fit Meta's caps", () => {
  assert.ok(APPROVAL_BUTTONS.length <= MAX_BUTTONS, "at most 3 reply buttons");
  for (const button of APPROVAL_BUTTONS) {
    assert.ok(
      button.title.length <= MAX_BUTTON_TITLE,
      `"${button.title}" is ${button.title.length} chars`
    );
  }
});

test("the free-cancellation button exists", () => {
  // The distance-selling contract gives a free cancellation right in exactly
  // this window; removing this button turns a right into a support ticket.
  assert.ok(APPROVAL_BUTTONS.some((b) => b.id === "model:cancel"));
});

test("the error codes we branch on are the documented ones", () => {
  assert.equal(WA_ERRORS.outsideWindow, 131047);
  assert.equal(WA_ERRORS.pairRateLimit, 131056);
});

console.log(
  failures === 0
    ? "\n✅ whatsapp-verify: all checks passed"
    : `\n❌ whatsapp-verify: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
