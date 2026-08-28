/**
 * The agent's safety properties are structural, not prompted. These tests
 * assert the structure, so that weakening it requires deleting a test rather
 * than quietly editing a schema.
 */
import assert from "node:assert/strict";
import {
  AGENT_TOOLS,
  DELIBERATELY_ABSENT_TOOLS,
  TOOL_NAMES,
  FAQ_TOPICS,
} from "../src/lib/agent/tools";
import { guardOutboundText, deterministicFallback } from "../src/lib/agent/output-guard";
import { FAQ_ANSWERS, renderUiBlock } from "../src/lib/config/wa-flow";
import { APPROVAL_BUTTONS, MAX_BUTTONS, MAX_BUTTON_TITLE } from "../src/lib/config/whatsapp";

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

function tool(name: string) {
  const found = AGENT_TOOLS.find((t) => t.name === name);
  assert.ok(found, `tool ${name} missing`);
  return found!;
}

function schemaOf(name: string) {
  return tool(name).input_schema as {
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

console.log("structural guarantees");

test("every tool is strict with additionalProperties false and a full required list", () => {
  for (const t of AGENT_TOOLS) {
    assert.equal((t as { strict?: boolean }).strict, true, `${t.name} is not strict`);
    const schema = t.input_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    assert.equal(
      schema.additionalProperties,
      false,
      `${t.name} allows additional properties — a hallucinated field would be accepted`
    );
    const props = Object.keys(schema.properties ?? {});
    assert.deepEqual(
      [...(schema.required ?? [])].sort(),
      props.sort(),
      `${t.name}: every property must be required, or the model can omit one silently`
    );
  }
});

test("create_draft takes ZERO arguments — this is how pricing stays server-side", () => {
  const schema = schemaOf("create_draft");
  assert.deepEqual(Object.keys(schema.properties ?? {}), []);
  assert.deepEqual(schema.required ?? [], []);
});

test("no tool anywhere accepts a money or discount argument", () => {
  const forbidden = [
    "price", "amount", "amountkurus", "discount", "coupon", "couponcode",
    "giftcardcode", "total", "currency", "paymentmethod", "override",
  ];
  for (const t of AGENT_TOOLS) {
    const schema = t.input_schema as { properties?: Record<string, unknown> };
    for (const key of Object.keys(schema.properties ?? {})) {
      assert.ok(
        !forbidden.includes(key.toLowerCase()),
        `${t.name} exposes "${key}" — the model could set its own price`
      );
    }
  }
});

test("conversationId is not an argument of any tool", () => {
  for (const t of AGENT_TOOLS) {
    const schema = t.input_schema as { properties?: Record<string, unknown> };
    for (const key of Object.keys(schema.properties ?? {})) {
      assert.ok(
        !/conversation/i.test(key),
        `${t.name} exposes "${key}" — the model could address another person's chat`
      );
    }
  }
});

test("the dangerous tools do not exist", () => {
  for (const absent of DELIBERATELY_ABSENT_TOOLS) {
    assert.ok(!TOOL_NAMES.includes(absent), `${absent} must not be a tool`);
  }
});

test("approve_model in particular does not exist", () => {
  // The approval that starts production is the basis of the withdrawal-right
  // exclusion. It comes from a button id in a deterministic router.
  assert.ok(!TOOL_NAMES.includes("approve_model"));
});

test("record_consent in particular does not exist", () => {
  // KVKK açık rıza is the versioned, IP-stamped checkbox on /pay. A model
  // reading "tamam" as consent is not a consent record.
  assert.ok(!TOOL_NAMES.includes("record_consent"));
});

test("emit_reply cannot produce button labels or media", () => {
  const props = Object.keys(schemaOf("emit_reply").properties ?? {});
  assert.deepEqual(props.sort(), ["text", "ui"]);
});

test("send_faq is a closed set, not free text", () => {
  const topic = (schemaOf("send_faq").properties as { topic: { enum?: string[] } }).topic;
  assert.ok(Array.isArray(topic.enum) && topic.enum.length === FAQ_TOPICS.length);
  for (const t of FAQ_TOPICS) {
    assert.ok(FAQ_ANSWERS[t], `no canonical answer for "${t}"`);
    assert.ok(FAQ_ANSWERS[t].sourcePage, `"${t}" has no source page recorded`);
  }
});

test("handoff is always available and carries a reason", () => {
  const props = Object.keys(schemaOf("request_human_handoff").properties ?? {});
  assert.deepEqual(props.sort(), ["reason", "summary"]);
});

console.log("outbound guard");

test("a price the agent did not look up is rejected", () => {
  const res = guardOutboundText("Figürünüz ₺1.999 olur.", ["₺3.499"]);
  assert.equal(res.ok, false);
  assert.ok(res.failures.includes("unquoted_price"));
});

test("the quoted price passes, in either notation", () => {
  assert.equal(guardOutboundText("Fiyat ₺3.499.", ["₺3.499"]).ok, true);
  assert.equal(guardOutboundText("Fiyat 3499 TL.", ["₺3.499"]).ok, true);
});

test("discount language is refused", () => {
  assert.equal(guardOutboundText("Size özel indirim yapabilirim.", []).ok, false);
});

test("an IBAN never leaves the bot", () => {
  assert.equal(guardOutboundText("TR33 0006 1005 1978 6457 8413 26", []).ok, false);
});

test("links outside our own origins are refused", () => {
  assert.equal(guardOutboundText("https://evil.example.com/x", []).ok, false);
  assert.equal(
    guardOutboundText("https://figurunica.com/pay/FIG-ABC12345", []).ok,
    true
  );
});

test("the fallback still tells the customer the real price", () => {
  assert.match(deterministicFallback(["₺3.499"]), /3\.499/);
  assert.match(deterministicFallback([]), /temsilci/);
});

console.log("ui blocks");

test("every UI block Meta renders fits its caps", () => {
  for (const ui of ["variation_choice", "address_confirm", "model_approval"]) {
    const block = renderUiBlock(ui);
    assert.ok(block.buttons, `${ui} should render buttons`);
    assert.ok(block.buttons!.length <= MAX_BUTTONS, `${ui} has too many buttons`);
    for (const button of block.buttons!) {
      assert.ok(
        button.title.length <= MAX_BUTTON_TITLE,
        `${ui}: "${button.title}" is ${button.title.length} chars`
      );
    }
  }
});

test("the model approval block is the canonical one, not a copy", () => {
  assert.deepEqual(renderUiBlock("model_approval").buttons, [...APPROVAL_BUTTONS]);
});

console.log(
  failures === 0
    ? "\n✅ agent-contract: all checks passed"
    : `\n❌ agent-contract: ${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
