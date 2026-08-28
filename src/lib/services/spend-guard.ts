import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiSpendLedger } from "@/lib/db/schema";
import { setFlag } from "./flags";
import type { FlagKey } from "@/lib/config/flags";
import {
  SPEND_ALERT_RATIO,
  capForScope,
  effectiveCents,
  windowMsForScope,
  type SpendProvider,
  type SpendScope,
} from "@/lib/config/spend";

/** Flag disabled automatically when a provider blows the daily ceiling. */
const PROVIDER_FLAG: Record<SpendProvider, FlagKey> = {
  fal: "fal_enabled",
  meshy: "meshy_enabled",
  anthropic: "wa_agent_enabled",
  whatsapp: "wa_bot_enabled",
};

async function spentInScope(scope: SpendScope): Promise<number> {
  const windowMs = windowMsForScope(scope.kind);
  const conditions = [
    eq(aiSpendLedger.scopeKind, scope.kind),
    eq(aiSpendLedger.scopeId, scope.id),
    sql`${aiSpendLedger.status} <> 'released'`,
  ];
  if (windowMs > 0) {
    conditions.push(gte(aiSpendLedger.createdAt, new Date(Date.now() - windowMs)));
  }
  const rows = await db
    .select({
      reservedCents: aiSpendLedger.reservedCents,
      settledCents: aiSpendLedger.settledCents,
    })
    .from(aiSpendLedger)
    .where(and(...conditions));
  return rows.reduce((sum, row) => sum + effectiveCents(row), 0);
}

/**
 * Reserve `cents` against both the caller's scope and the global 24h ceiling.
 * A refusal is returned, never thrown: a blown ceiling is a business outcome
 * (fall back to the manual path), not an exception.
 */
export async function reserveSpend(
  provider: SpendProvider,
  cents: number,
  scope: SpendScope
): Promise<{ ok: true; reservationId: string } | { ok: false; reason: string }> {
  const globalScope: SpendScope = { kind: "global", id: "all" };
  const [scopeSpent, globalSpent] = await Promise.all([
    spentInScope(scope),
    spentInScope(globalScope),
  ]);

  if (scope.kind !== "global" && scopeSpent + cents > capForScope(scope)) {
    return { ok: false, reason: `${scope.kind}_cap_exceeded` };
  }

  const globalCap = capForScope(globalScope);
  if (globalSpent + cents > globalCap) {
    // Blowing the daily ceiling disables the provider until a human re-enables it.
    await setFlag(PROVIDER_FLAG[provider], false, "spend-guard:global_cap");
    console.error(
      `[spend-guard] daily cap hit (${globalSpent}+${cents} > ${globalCap}); ${provider} disabled`
    );
    return { ok: false, reason: "global_cap_exceeded" };
  }
  if (globalSpent + cents > globalCap * SPEND_ALERT_RATIO) {
    const pct = Math.round(((globalSpent + cents) / globalCap) * 100);
    console.warn(`[spend-guard] ${pct}% of the daily AI budget used`);
  }

  const [row] = await db
    .insert(aiSpendLedger)
    .values({
      provider,
      scopeKind: scope.kind,
      scopeId: scope.id,
      reservedCents: cents,
      status: "reserved",
    })
    .returning({ id: aiSpendLedger.id });

  return { ok: true, reservationId: row.id };
}

/** Record what the provider actually charged. */
export async function settleSpend(
  reservationId: string,
  actualCents: number
): Promise<void> {
  await db
    .update(aiSpendLedger)
    .set({ settledCents: actualCents, status: "settled", settledAt: new Date() })
    .where(eq(aiSpendLedger.id, reservationId));
}

/** The call never happened (provider refused, or we bailed) — give it back. */
export async function releaseSpend(reservationId: string): Promise<void> {
  await db
    .update(aiSpendLedger)
    .set({ settledCents: 0, status: "released", settledAt: new Date() })
    .where(eq(aiSpendLedger.id, reservationId));
}

/** Spend in the last `sinceMs` ms, for /api/health and the ops page. */
export async function spentCentsSince(
  provider: SpendProvider | null,
  sinceMs: number
): Promise<number> {
  const conditions = [
    gte(aiSpendLedger.createdAt, new Date(Date.now() - sinceMs)),
    sql`${aiSpendLedger.status} <> 'released'`,
  ];
  if (provider) conditions.push(eq(aiSpendLedger.provider, provider));
  const rows = await db
    .select({
      reservedCents: aiSpendLedger.reservedCents,
      settledCents: aiSpendLedger.settledCents,
    })
    .from(aiSpendLedger)
    .where(and(...conditions));
  return rows.reduce((sum, row) => sum + effectiveCents(row), 0);
}
