import type Anthropic from "@anthropic-ai/sdk";

/**
 * The agent's tool surface.
 *
 * Read the absences, not just the presences. Three things are enforced by the
 * SHAPE of this file rather than by anything written in a prompt:
 *
 *  1. PRICE. `create_draft` takes ZERO arguments. `quote_item` has no `price`,
 *     `discount`, `amount` or `coupon` field, and every tool is `strict: true`
 *     with `additionalProperties: false`, so a hallucinated field is rejected
 *     by the API before our code ever sees it. The order total is recomputed
 *     server-side from stored state. Server-authoritative pricing here is not
 *     a prompt instruction; it is a missing argument.
 *  2. STATUS. No tool writes `orders.status`. The only WhatsApp path to a
 *     status change is the deterministic button router, which runs before the
 *     model sees anything.
 *  3. IDENTITY. `conversationId` is not an argument of any tool. It comes from
 *     the runner's context, so the model cannot structurally address another
 *     person's conversation.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */

/** UI blocks the agent may ask for. Closed set; the copy lives in wa-flow.ts. */
export const UI_BLOCKS = [
  "none",
  "style_picker",
  "variation_choice",
  "address_confirm",
  "pay_prompt",
  "model_approval",
  "photo_retry",
  "multi_subject",
] as const;

export const FAQ_TOPICS = [
  "kargo",
  "sure",
  "iade",
  "malzeme",
  "boyut",
  "fiyat_genel",
  "hediye",
  "boyama",
  "kvkk",
  "toptan",
  "atolye",
  "odeme",
] as const;

export const HANDOFF_REASONS = [
  "customer_asked",
  "complaint",
  "refund",
  "pricing_edge",
  "unpriced",
  "repeated_failure",
  "tool_budget",
  "unsafe",
  "other",
] as const;

function strictObject(
  properties: Record<string, unknown>,
  required: string[]
): Anthropic.Tool["input_schema"] {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  } as Anthropic.Tool["input_schema"];
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "emit_reply",
    description:
      "Send the customer a message and end your turn. This is the ONLY way to " +
      "say anything to the customer. You cannot write button labels or attach " +
      "media: pick a `ui` block instead and the server renders the fixed " +
      "Turkish copy and buttons for it. Every price you mention must have come " +
      "from quote_item in this same turn.",
    strict: true,
    input_schema: strictObject(
      {
        text: {
          type: "string",
          maxLength: 700,
          description: "Turkish, warm, concise. No prices you did not look up.",
        },
        ui: {
          type: "string",
          enum: [...UI_BLOCKS],
          description: "Which fixed UI block to append. 'none' for plain text.",
        },
      },
      ["text", "ui"]
    ),
  },
  {
    name: "get_catalog",
    description:
      "List the design templates, sizes, materials, finishes and add-ons that " +
      "are currently for sale. Returns NO prices — prices come only from " +
      "quote_item, so there is exactly one place a number can originate.",
    strict: true,
    input_schema: strictObject({}, []),
  },
  {
    name: "quote_item",
    description:
      "The ONLY source of a price. Returns the server-computed amount for a " +
      "configuration, already formatted in Turkish lira. If the size cannot be " +
      "priced automatically the result is {error:'needs_admin_quote'} and your " +
      "only legitimate move is request_human_handoff — never invent a number " +
      "and never fall back to zero.",
    strict: true,
    input_schema: strictObject(
      {
        style: { type: "string", description: "A template slug from get_catalog." },
        size: { type: "string", description: "A size key from get_catalog." },
        material: { type: "string", enum: ["resin", "filament"] },
        finish: { type: "string", description: "A finish key from get_catalog." },
        upsells: {
          type: "array",
          items: { type: "string" },
          description: "Add-on keys from get_catalog. Empty array for none.",
        },
      },
      ["style", "size", "material", "finish", "upsells"]
    ),
  },
  {
    name: "save_photo",
    description:
      "Store a photo the customer just sent. Returns only an index, never a " +
      "path or a link. At most 4 photos per conversation.",
    strict: true,
    input_schema: strictObject(
      { waMediaId: { type: "string", description: "The media id from the customer's message." } },
      ["waMediaId"]
    ),
  },
  {
    name: "start_preview",
    description:
      "Begin generating two stylised image variations from the stored photos. " +
      "Returns a preview id and a realistic ETA derived from the actual queue " +
      "depth — do not promise a fixed number of seconds yourself.",
    strict: true,
    input_schema: strictObject(
      { styleSlug: { type: "string", description: "A template slug from get_catalog." } },
      ["styleSlug"]
    ),
  },
  {
    name: "select_variation",
    description:
      "Record which of the two generated variations the customer chose. " +
      "Index 0 is the first image shown, 1 is the second.",
    strict: true,
    input_schema: strictObject(
      { index: { type: "integer", minimum: 0, maximum: 1 } },
      ["index"]
    ),
  },
  {
    name: "parse_address",
    description:
      "Turn a free-text Turkish address into structured fields. Writes NOTHING " +
      "— it only parses, and tells you which fields are still missing. Use " +
      "save_customer once the customer has confirmed the parsed result.",
    strict: true,
    input_schema: strictObject(
      { raw: { type: "string", maxLength: 1000 } },
      ["raw"]
    ),
  },
  {
    name: "save_customer",
    description:
      "Store the buyer's name, e-mail and delivery address after they have " +
      "confirmed them. If the e-mail already belongs to a registered account " +
      "this returns {error:'email_registered'} — ask for a different address " +
      "or hand over to a human; you cannot override that.",
    strict: true,
    input_schema: strictObject(
      {
        fullName: { type: "string", minLength: 2, maxLength: 120 },
        email: { type: "string", maxLength: 200 },
        address: {
          type: "object",
          additionalProperties: false,
          properties: {
            adres: { type: "string", maxLength: 400 },
            mahalle: { type: "string", maxLength: 120 },
            ilce: { type: "string", maxLength: 120 },
            il: { type: "string", maxLength: 120 },
            postaKodu: { type: "string", pattern: "^\\d{5}$" },
            telefon: { type: "string", maxLength: 32 },
          },
          required: ["adres", "mahalle", "ilce", "il", "postaKodu", "telefon"],
        },
      },
      ["fullName", "email", "address"]
    ),
  },
  {
    name: "create_draft",
    description:
      "Create the order and return its payment link. Takes NO arguments on " +
      "purpose: the whole order is read from what has already been saved on " +
      "the server, and the amount is recomputed there. If something is still " +
      "missing you get {error:'incomplete', missing:[...]}. Calling it twice " +
      "returns the same link.",
    strict: true,
    input_schema: strictObject({}, []),
  },
  {
    name: "get_order_status",
    description:
      "Look up an order that belongs to THIS conversation. Any other reference " +
      "returns not_found. Returns a Turkish status label and, once shipped, the " +
      "tracking number — never an address, amount, e-mail or file link.",
    strict: true,
    input_schema: strictObject(
      { reference: { type: "string", maxLength: 32 } },
      ["reference"]
    ),
  },
  {
    name: "send_faq",
    description:
      "Send the canonical answer for a common question. The text is fixed and " +
      "links to the authoritative page. Use this for anything legal — refunds, " +
      "withdrawal rights, KVKK — instead of writing your own wording; the " +
      "version the customer screenshots has to be the binding one.",
    strict: true,
    input_schema: strictObject(
      { topic: { type: "string", enum: [...FAQ_TOPICS] } },
      ["topic"]
    ),
  },
  {
    name: "request_human_handoff",
    description:
      "Hand the conversation to a person and stop. Always available, never " +
      "rate-limited, never blocked by a budget. Use it for complaints, refunds, " +
      "anything you are unsure about, and any request you cannot price.",
    strict: true,
    input_schema: strictObject(
      {
        reason: { type: "string", enum: [...HANDOFF_REASONS] },
        summary: { type: "string", maxLength: 300, description: "What the agent should know." },
      },
      ["reason", "summary"]
    ),
  },
];

/**
 * Tools that deliberately DO NOT exist, and why. Kept as a list so that adding
 * one is a conscious act with a code review attached, not an oversight.
 *
 *  approve_model      the approval that starts production is the basis of the
 *                     withdrawal-right exclusion; it comes from a button id in
 *                     a deterministic router, never from an inference.
 *  record_consent     KVKK consent comes from the versioned, IP-stamped
 *                     checkbox on /pay. A model reading "tamam" as consent is
 *                     not an açık rıza record.
 *  apply_discount / set_price / refund_order / cancel_order /
 *  change_order_status / assign_manufacturer / issue_gift_card /
 *  send_raw_message / upload_model / sql / http
 */
export const DELIBERATELY_ABSENT_TOOLS = [
  "approve_model",
  "record_consent",
  "apply_discount",
  "set_price",
  "refund_order",
  "cancel_order",
  "change_order_status",
  "assign_manufacturer",
  "issue_gift_card",
  "send_raw_message",
  "upload_model",
  "sql",
  "http",
] as const;

export const TOOL_NAMES = AGENT_TOOLS.map((t) => t.name);
