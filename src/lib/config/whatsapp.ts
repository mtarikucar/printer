/**
 * WhatsApp Cloud API constants, verified against the official docs (2026-08).
 *
 * NOTE: no `import "server-only"` — BullMQ workers reach this module.
 */

/**
 * Pinned Graph API version. Never call unversioned: v25.0 is what the current
 * docs' examples use and it expires 2028-07-29, so an unpinned call would
 * silently move under us.
 */
export const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Free-form messages are only allowed inside this window after the customer writes. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Meta caps: text body 4096 chars, ≤3 reply buttons, button title ≤20 chars. */
export const MAX_TEXT_LENGTH = 4096;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;

/** Inbound customer photos. Meta's own limit for image/jpeg and image/png. */
export const MAX_INBOUND_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_INBOUND_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;

/** Outbound video (the 360° turntable). */
export const MAX_OUTBOUND_VIDEO_BYTES = 16 * 1024 * 1024;

/**
 * Error codes we branch on rather than log. The first two decide behaviour.
 */
export const WA_ERRORS = {
  /** Outside the 24h window — the ONLY correct response is to send a template. */
  outsideWindow: 131047,
  /** Too many messages to the same recipient too fast. Back off, do not retry. */
  pairRateLimit: 131056,
  notDeliverable: 131026,
  throughputExceeded: 130429,
  wabaRestricted: 368,
  tokenExpired: 190,
  wabaRateLimit: 80007,
} as const;

/**
 * Approved UTILITY templates. MARKETING templates are deliberately absent: a
 * conversation-reopening promotional template is a ticari elektronik ileti
 * under ETK 6563 art. 6 and cannot be sent without an İYS record, which this
 * platform does not have.
 */
export const WA_TEMPLATES = {
  modelApproval: process.env.WHATSAPP_TEMPLATE_MODEL_APPROVAL ?? "figur_model_onay_v1",
  payLink: process.env.WHATSAPP_TEMPLATE_PAY_LINK ?? "figur_odeme_linki_v1",
  shipping: process.env.WHATSAPP_TEMPLATE_SHIPPING ?? "figur_kargo_bildirim_v1",
} as const;

/**
 * Button ids for the model-approval turn. Closed set, matched in the
 * deterministic inbound router BEFORE any model sees the message — the
 * approval that starts production is the basis of the withdrawal-right
 * exclusion and cannot be left to a language model's inference.
 *
 * Titles are asserted at build time: Meta caps them at 20 characters and the
 * docs do not say whether that is bytes or characters for non-ASCII, so these
 * stay comfortably short.
 */
export const APPROVAL_BUTTONS = [
  { id: "model:ok", title: "Onaylıyorum" },
  { id: "model:revise", title: "Değişiklik iste" },
  // The distance-selling contract (md. 117) gives a free cancellation right
  // before approval and before production starts, and this turn IS that window.
  // Leaving the button out would turn a contractual right into a support ticket.
  { id: "model:cancel", title: "Vazgeç" },
] as const;

for (const button of APPROVAL_BUTTONS) {
  if (button.title.length > MAX_BUTTON_TITLE) {
    throw new Error(
      `WhatsApp button title too long: "${button.title}" (${button.title.length} > ${MAX_BUTTON_TITLE})`
    );
  }
}
