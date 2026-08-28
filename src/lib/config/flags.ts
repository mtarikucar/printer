/**
 * Runtime kill switches. The values live in the `platform_flags` table; this
 * module is only the closed key set and the defaults, so both the Next.js app
 * and the standalone Node worker can import it without touching the DB.
 *
 * NOTE: no `import "server-only"` here — BullMQ workers reach this module.
 */
export const FLAG_KEYS = [
  "auto_model_enabled",
  "meshy_enabled",
  "wa_bot_enabled",
  "wa_agent_enabled",
  "fal_enabled",
] as const;

export type FlagKey = (typeof FLAG_KEYS)[number];

/**
 * Used when the table has no row yet. Everything that spends NEW money starts
 * OFF: shipping the code must never be the same event as enabling the spend.
 */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  auto_model_enabled: false,
  meshy_enabled: false,
  wa_bot_enabled: false,
  wa_agent_enabled: false,
  fal_enabled: true,
};

export const FLAG_LABELS_TR: Record<FlagKey, string> = {
  auto_model_enabled: "Otomatik 3D model üretimi",
  meshy_enabled: "Meshy sağlayıcısı",
  wa_bot_enabled: "WhatsApp kanalı",
  wa_agent_enabled: "WhatsApp yapay zekâ asistanı",
  fal_enabled: "fal.ai görsel üretimi",
};

export function isFlagKey(value: unknown): value is FlagKey {
  return typeof value === "string" && (FLAG_KEYS as readonly string[]).includes(value);
}

/** Break-glass: AI_KILL_ALL=1 forces every flag off without a DB write. */
export function killAllEngaged(): boolean {
  return process.env.AI_KILL_ALL === "1";
}
