/**
 * AI spend ceilings, in US cents. Every ceiling is enforced BEFORE the provider
 * call, never after — a runaway loop should hit the ceiling while the money is
 * still ours, not when the invoice arrives. Env overrides exist so a ceiling
 * can be raised during an incident without a deploy.
 *
 * NOTE: no `import "server-only"` here — BullMQ workers reach this module.
 */
function envCents(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const SPEND_CAPS = {
  /** All providers, rolling 24h. ~$50/day. */
  global: envCents("AI_SPEND_DAILY_CAP_CENTS", 5000),
  /** One WhatsApp conversation, rolling 24h. */
  conversation: envCents("AI_SPEND_CONVERSATION_CAP_CENTS", 60),
  /** Total AI cost of one order, all time. */
  order: envCents("AI_SPEND_ORDER_CAP_CENTS", 150),
  /** One phone number, rolling 24h — shared or abused numbers. */
  phone: envCents("AI_SPEND_PHONE_DAILY_CAP_CENTS", 100),
} as const;

/** Fraction of a cap at which we alert but still allow the spend. */
export const SPEND_ALERT_RATIO = 0.8;

export type SpendProvider = "fal" | "meshy" | "anthropic" | "whatsapp";
export type SpendScopeKind = "order" | "conversation" | "phone" | "global";

export interface SpendScope {
  kind: SpendScopeKind;
  id: string;
}

export function capForScope(scope: SpendScope): number {
  return SPEND_CAPS[scope.kind];
}

/** Rolling window per scope kind. `order` is all-time (0 = no window). */
export function windowMsForScope(kind: SpendScopeKind): number {
  return kind === "order" ? 0 : 24 * 60 * 60 * 1000;
}

/** A reservation counts at its estimate until the real cost is known. */
export function effectiveCents(row: {
  reservedCents: number;
  settledCents: number | null;
}): number {
  return row.settledCents ?? row.reservedCents;
}
