# Faz 0 — Zemin (dayanıklılık, gözlemlenebilirlik, para muslukları) + Yeniden Fiyatlandırma

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sonraki üç fazın dayanacağı üç şeyi kurmak — yeniden başlatmayı atlatan bir kuyruk, worker'da hata görünürlüğü, ve bir sağlayıcıya para harcamayı reddedebilen bir kapı — ve figürü tek ürüne indirmek.

**Architecture:** Üç bağımsız katman. (A) Yeniden fiyatlandırma: saf uygulama katmanı, migration yok, mevcut planın 1-6. task'ı. (B) Ops omurgası: üç yeni tablo (`platform_flags`, `ai_spend_ledger`, `idempotency_keys`) + üç servis, hepsi mevcut `rate-limit.ts` / `connection.ts` raylarında. (C) Altyapı sertleştirme: compose, Sentry, health, `lockDuration`, deploy sırları. Hiçbiri bir iş davranışını değiştirmez; hepsi tek başına deploy edilebilir ve geri alınabilir.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Drizzle ORM, PostgreSQL, BullMQ + ioredis, Sentry. Test: `npx tsx scripts/test-*.ts` (`npm run test:unit` hepsini koşar), `npx tsc --noEmit` de facto doğruluk kapısı.

**Spec:** `docs/superpowers/specs/2026-08-27-whatsapp-ai-otomatik-siparis-design.md`

## Global Constraints

- **Migration'lar up/down ÇİFTİ.** Akış: `schema.ts` düzenle → `npx drizzle-kit generate --name <x>` → üretilen `drizzle/00NN_*.sql` + snapshot + `_journal.json` commit et → **elle** `drizzle/00NN_*.down.sql` yaz. Round-trip (up→down→up) lokalde doğrulanır. Sıradaki numara **0043**.
- **`ALTER TYPE ... ADD VALUE` transaction içinde çalışmaz** — Faz 0'da enum eklemesi YOK, ama `invoice_status` için gerekiyorsa ayrı statement olarak yazılır.
- **`src/lib/config/*` ve worker'ın ulaştığı hiçbir modülde `import "server-only"` YASAK** — BullMQ worker'ları `order-draft.ts` üzerinden bu modüllere ulaşıyor, standalone Node worker crash-loop'a girer (2026-06-13, fix `470bf22`).
- **Sözlük senkronu:** `tr.ts`'e eklenen her anahtar `en.ts`'e de eklenir (`en.ts` `Dictionary` tipinin kaynağı; eksik anahtar `tsc` hatası).
- **Commit mesajları:** düz conventional commit. **Hiçbir AI/Claude izi, `Co-Authored-By` trailer'ı veya "Generated with" satırı EKLENMEZ.**
- **Para:** her şey kuruş, `integer`. `MAX_AMOUNT_KURUS = 200_000_000`.
- **Bayrak varsayılanları:** `fal_enabled` hariç TÜM `platform_flags` satırları `false` tohumlanır. Faz 0 hiçbir yeni davranışı açmaz.
- **Yeni env değişkeni eklendiğinde** `.env.example` VE `.github/workflows/deploy.yml`'in `upsert_env` listesi birlikte güncellenir — aksi hâlde sır VPS'e hiç ulaşmaz (`upsert_env` boş değerde `return 0` yapıyor; listede olmayan anahtar ezilmiyor, senkronize de edilmiyor).

---

### Task A: Yeniden fiyatlandırma (mevcut planın 1-6. task'ı)

**Files:** `docs/superpowers/plans/2026-08-24-figur-yeniden-fiyatlandirma-ve-ai-crawler-erisimi.md` içindeki Task 1-6.

**Interfaces:**
- Produces: `SIZE_PRESETS` = tek `standart`/150mm · `LEGACY_SIZE_PRESETS` · `isLegacySizePreset()` · `presetHeightMm(key: string): number | null` (**imza değişiyor**) · `FIGURINE_PRICE_KURUS = 349900` · `PAINTING_PORTION_KURUS = 100000`.
- Consumes: yok.

- [ ] **Step A1:** O planın **Task 1-6**'sını sırayla uygula. Her task kendi TDD döngüsünü ve commit'ini taşıyor; oradaki adımları birebir izle.
- [ ] **Step A2:** **Task 7-9 (AI crawler: robots/media/sitemap) BU FAZIN KAPSAMINDA DEĞİL** — atla. Task 10 (bütünsel doğrulama) da atlanır; yerine bu planın Task F'i geçer.
- [ ] **Step A3:** `npx tsc --noEmit && npm run lint && npm run test:unit` — üçü de temiz.

---

### Task B: `platform_flags` — kill switch

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/services/flags.ts`
- Create: `scripts/test-flags.ts`
- Create: `drizzle/0043_ops_spine.sql` (generate) + `drizzle/0043_ops_spine.down.sql` (elle)

**Interfaces:**
- Consumes: `getRedisConnection()` from `src/lib/queue/connection.ts`, `db` from `src/lib/db`.
- Produces:
  - `export type FlagKey = "auto_model_enabled" | "meshy_enabled" | "wa_bot_enabled" | "wa_agent_enabled" | "fal_enabled"`
  - `export const FLAG_KEYS: readonly FlagKey[]`
  - `export async function isFlagEnabled(key: FlagKey): Promise<boolean>`
  - `export async function setFlag(key: FlagKey, enabled: boolean, updatedBy: string): Promise<void>`
  - `export async function getAllFlags(): Promise<Record<FlagKey, boolean>>`

- [ ] **Step B1: Şemayı ekle**

`src/lib/db/schema.ts` sonuna:

```ts
// ─── Platform flags (kill switch) ───────────────────────────────────────────
// Runtime on/off switches for anything that spends money or talks to a third
// party. DB-backed (not env) so flipping one is a single click with an audit
// trail and takes effect in <=10s across app + worker without a redeploy.
// Editing .env and redeploying is NOT an emergency lever.
export const platformFlags = pgTable("platform_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});
```

- [ ] **Step B2: Testi yaz (önce başarısız olacak)**

`scripts/test-flags.ts`:

```ts
import assert from "node:assert/strict";
import { FLAG_KEYS, type FlagKey } from "../src/lib/config/flags";

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

test("bes bayrak tanimli", () => {
  assert.deepEqual([...FLAG_KEYS].sort(), [
    "auto_model_enabled", "fal_enabled", "meshy_enabled",
    "wa_agent_enabled", "wa_bot_enabled",
  ]);
});

test("varsayilanlar: fal disinda hepsi kapali", () => {
  const { FLAG_DEFAULTS } = require("../src/lib/config/flags") as {
    FLAG_DEFAULTS: Record<FlagKey, boolean>;
  };
  assert.equal(FLAG_DEFAULTS.fal_enabled, true);
  for (const k of FLAG_KEYS) {
    if (k !== "fal_enabled") assert.equal(FLAG_DEFAULTS[k], false, `${k} kapali olmali`);
  }
});

console.log(failures === 0 ? "\ntest-flags: PASS" : `\ntest-flags: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step B3: Testi çalıştır, başarısız olduğunu gör**

Run: `npx tsx scripts/test-flags.ts`
Expected: FAIL — `Cannot find module '../src/lib/config/flags'`

- [ ] **Step B4: Config'i yaz** — `src/lib/config/flags.ts` (saf sabitler; worker'ın da import edeceği katman, `server-only` YOK):

```ts
/**
 * Runtime kill switches. Values live in the `platform_flags` table; this module
 * is only the closed key set + defaults, so both the app and the standalone
 * Node worker can import it without touching the DB.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
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
 * Seeded on first read. Everything that spends NEW money starts OFF: shipping
 * the code must never be the same event as enabling the spend.
 */
export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  auto_model_enabled: false,
  meshy_enabled: false,
  wa_bot_enabled: false,
  wa_agent_enabled: false,
  fal_enabled: true,
};

/** Break-glass: set AI_KILL_ALL=1 to force every flag off without a DB write. */
export function killAllEngaged(): boolean {
  return process.env.AI_KILL_ALL === "1";
}
```

- [ ] **Step B5: Servisi yaz** — `src/lib/services/flags.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformFlags } from "@/lib/db/schema";
import { getRedisConnection } from "@/lib/queue/connection";
import {
  FLAG_DEFAULTS, FLAG_KEYS, killAllEngaged, type FlagKey,
} from "@/lib/config/flags";

const CACHE_TTL_SECONDS = 10;
const cacheKey = (key: FlagKey) => `flag:${key}`;

async function redisOrNull() {
  if (!process.env.REDIS_URL) return null;
  try { return getRedisConnection(); } catch { return null; }
}

/**
 * 10s Redis TTL cache in front of the DB. A flipped flag reaches every process
 * within 10 seconds; a Redis outage degrades to a DB read, never to "enabled".
 */
export async function isFlagEnabled(key: FlagKey): Promise<boolean> {
  if (killAllEngaged()) return false;

  const redis = await redisOrNull();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(key));
      if (cached === "1") return true;
      if (cached === "0") return false;
    } catch { /* fall through to DB */ }
  }

  let enabled = FLAG_DEFAULTS[key];
  try {
    const [row] = await db
      .select({ enabled: platformFlags.enabled })
      .from(platformFlags)
      .where(eq(platformFlags.key, key))
      .limit(1);
    if (row) enabled = row.enabled;
  } catch (err) {
    // A DB failure must not silently ENABLE a money-spending path.
    console.error(`[flags] read failed for ${key}, falling back to default`, err);
    enabled = FLAG_DEFAULTS[key];
  }

  if (redis) {
    try { await redis.set(cacheKey(key), enabled ? "1" : "0", "EX", CACHE_TTL_SECONDS); }
    catch { /* cache is best-effort */ }
  }
  return enabled;
}

export async function setFlag(key: FlagKey, enabled: boolean, updatedBy: string): Promise<void> {
  await db
    .insert(platformFlags)
    .values({ key, enabled, updatedBy })
    .onConflictDoUpdate({
      target: platformFlags.key,
      set: { enabled, updatedBy, updatedAt: new Date() },
    });
  const redis = await redisOrNull();
  if (redis) { try { await redis.del(cacheKey(key)); } catch { /* best-effort */ } }
}

export async function getAllFlags(): Promise<Record<FlagKey, boolean>> {
  const rows = await db.select().from(platformFlags);
  const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
  const out = {} as Record<FlagKey, boolean>;
  for (const k of FLAG_KEYS) out[k] = byKey.get(k) ?? FLAG_DEFAULTS[k];
  if (killAllEngaged()) for (const k of FLAG_KEYS) out[k] = false;
  return out;
}
```

- [ ] **Step B6: Testi çalıştır, geçtiğini gör**

Run: `npx tsx scripts/test-flags.ts`
Expected: PASS

- [ ] **Step B7: Commit**

```bash
git add src/lib/config/flags.ts src/lib/services/flags.ts src/lib/db/schema.ts scripts/test-flags.ts
git commit -m "feat(ops): DB-backed platform flags with 10s cache and AI_KILL_ALL break-glass"
```

---

### Task C: `ai_spend_ledger` — harcama tavanı

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/config/spend.ts`, `src/lib/services/spend-guard.ts`, `scripts/test-spend-guard.ts`

**Interfaces:**
- Consumes: `db`, `isFlagEnabled`/`setFlag` (Task B).
- Produces:
  - `export type SpendProvider = "fal" | "meshy" | "anthropic" | "whatsapp"`
  - `export interface SpendScope { kind: "order" | "conversation" | "phone" | "global"; id: string }`
  - `export async function reserveSpend(provider: SpendProvider, cents: number, scope: SpendScope): Promise<{ ok: true; reservationId: string } | { ok: false; reason: string }>`
  - `export async function settleSpend(reservationId: string, actualCents: number): Promise<void>`
  - `export async function releaseSpend(reservationId: string): Promise<void>`
  - `export async function spentCentsSince(provider: SpendProvider | null, sinceMs: number): Promise<number>`

- [ ] **Step C1: Şemayı ekle** — `src/lib/db/schema.ts` sonuna:

```ts
// ─── AI spend ledger ────────────────────────────────────────────────────────
// Every paid provider call reserves BEFORE the call and settles AFTER it, so a
// runaway loop hits the ceiling before the money leaves, not when the invoice
// arrives. `reserved_cents` is the pessimistic estimate; `settled_cents` is the
// truth once the provider answers.
export const spendStatusEnum = pgEnum("spend_status", ["reserved", "settled", "released"]);

export const aiSpendLedger = pgTable(
  "ai_spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    scopeKind: text("scope_kind").notNull(),
    scopeId: text("scope_id").notNull(),
    reservedCents: integer("reserved_cents").notNull(),
    settledCents: integer("settled_cents"),
    status: spendStatusEnum("status").notNull().default("reserved"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    settledAt: timestamp("settled_at"),
  },
  (t) => [
    index("ai_spend_ledger_created_idx").on(t.createdAt),
    index("ai_spend_ledger_scope_idx").on(t.scopeKind, t.scopeId),
  ]
);
```

- [ ] **Step C2: Testi yaz** — `scripts/test-spend-guard.ts` (saf tavan matematiğini test eder, DB'siz):

```ts
import assert from "node:assert/strict";
import { SPEND_CAPS, capForScope, effectiveCents } from "../src/lib/config/spend";

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

test("tavanlar spec'teki degerlerde", () => {
  assert.equal(SPEND_CAPS.global, 5000);
  assert.equal(SPEND_CAPS.conversation, 60);
  assert.equal(SPEND_CAPS.order, 150);
  assert.equal(SPEND_CAPS.phone, 100);
});

test("capForScope her kapsam icin dogru tavani verir", () => {
  assert.equal(capForScope({ kind: "order", id: "x" }), 150);
  assert.equal(capForScope({ kind: "conversation", id: "x" }), 60);
  assert.equal(capForScope({ kind: "phone", id: "x" }), 100);
  assert.equal(capForScope({ kind: "global", id: "all" }), 5000);
});

test("effectiveCents settled varsa onu, yoksa reserved'i sayar", () => {
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: null }), 40);
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: 22 }), 22);
  assert.equal(effectiveCents({ reservedCents: 40, settledCents: 0 }), 0);
});

console.log(failures === 0 ? "\ntest-spend-guard: PASS" : `\ntest-spend-guard: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step C3: Testi çalıştır, başarısız olduğunu gör**

Run: `npx tsx scripts/test-spend-guard.ts`
Expected: FAIL — `Cannot find module '../src/lib/config/spend'`

- [ ] **Step C4: Config'i yaz** — `src/lib/config/spend.ts`:

```ts
/**
 * AI spend ceilings, in US cents. Every ceiling is enforced BEFORE the provider
 * call, never after. Env overrides exist so a ceiling can be raised in an
 * incident without a deploy.
 *
 * NOTE: no `import "server-only"` — the BullMQ worker reaches this module.
 */
function envCents(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const SPEND_CAPS = {
  /** All providers, rolling 24h. ~$50/day. */
  global: envCents("AI_SPEND_DAILY_CAP_CENTS", 5000),
  /** One WhatsApp conversation, rolling 24h. */
  conversation: envCents("AI_SPEND_CONVERSATION_CAP_CENTS", 60),
  /** Total AI cost of one order, all time. */
  order: envCents("AI_SPEND_ORDER_CAP_CENTS", 150),
  /** One phone number, rolling 24h — shared/abused numbers. */
  phone: envCents("AI_SPEND_PHONE_DAILY_CAP_CENTS", 100),
} as const;

/** Fraction of a cap at which we alert (but still allow the spend). */
export const SPEND_ALERT_RATIO = 0.8;

export type SpendProvider = "fal" | "meshy" | "anthropic" | "whatsapp";
export type SpendScopeKind = "order" | "conversation" | "phone" | "global";
export interface SpendScope { kind: SpendScopeKind; id: string }

export function capForScope(scope: SpendScope): number {
  return SPEND_CAPS[scope.kind];
}

/** Rolling window per scope kind. `order` is all-time (0 = no window). */
export function windowMsForScope(kind: SpendScopeKind): number {
  switch (kind) {
    case "order": return 0;
    case "global":
    case "conversation":
    case "phone":
    default: return 24 * 60 * 60 * 1000;
  }
}

/** A reservation counts at its estimate until the real cost is known. */
export function effectiveCents(row: { reservedCents: number; settledCents: number | null }): number {
  return row.settledCents ?? row.reservedCents;
}
```

- [ ] **Step C5: Servisi yaz** — `src/lib/services/spend-guard.ts`:

```ts
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiSpendLedger } from "@/lib/db/schema";
import { setFlag } from "./flags";
import {
  SPEND_ALERT_RATIO, capForScope, effectiveCents, windowMsForScope,
  type SpendProvider, type SpendScope,
} from "@/lib/config/spend";

/** Flag that is auto-disabled when a provider blows the global ceiling. */
const PROVIDER_FLAG = {
  fal: "fal_enabled",
  meshy: "meshy_enabled",
  anthropic: "wa_agent_enabled",
  whatsapp: "wa_bot_enabled",
} as const;

async function spentInScope(scope: SpendScope): Promise<number> {
  const windowMs = windowMsForScope(scope.kind);
  const conds = [
    eq(aiSpendLedger.scopeKind, scope.kind),
    eq(aiSpendLedger.scopeId, scope.id),
    sql`${aiSpendLedger.status} <> 'released'`,
  ];
  if (windowMs > 0) {
    conds.push(gte(aiSpendLedger.createdAt, new Date(Date.now() - windowMs)));
  }
  const rows = await db
    .select({ reservedCents: aiSpendLedger.reservedCents, settledCents: aiSpendLedger.settledCents })
    .from(aiSpendLedger)
    .where(and(...conds));
  return rows.reduce((sum, r) => sum + effectiveCents(r), 0);
}

/**
 * Reserve `cents` against BOTH the caller's scope and the global 24h ceiling.
 * Returns a decision, never throws on a refusal — a blown ceiling is a business
 * outcome (fall back to the manual path), not an exception.
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

  const scopeCap = capForScope(scope);
  if (scopeSpent + cents > scopeCap) {
    return { ok: false, reason: `${scope.kind}_cap_exceeded` };
  }

  const globalCap = capForScope(globalScope);
  if (globalSpent + cents > globalCap) {
    // Blowing the daily ceiling disables the provider until a human re-enables it.
    await setFlag(PROVIDER_FLAG[provider], false, "spend-guard:global_cap");
    console.error(`[spend-guard] GLOBAL CAP hit (${globalSpent}+${cents} > ${globalCap}); ${provider} disabled`);
    return { ok: false, reason: "global_cap_exceeded" };
  }
  if (globalSpent + cents > globalCap * SPEND_ALERT_RATIO) {
    console.warn(`[spend-guard] ${Math.round(((globalSpent + cents) / globalCap) * 100)}% of daily cap used`);
  }

  const [row] = await db
    .insert(aiSpendLedger)
    .values({
      provider, scopeKind: scope.kind, scopeId: scope.id,
      reservedCents: cents, status: "reserved",
    })
    .returning({ id: aiSpendLedger.id });

  return { ok: true, reservationId: row.id };
}

/** Record what the provider actually charged. */
export async function settleSpend(reservationId: string, actualCents: number): Promise<void> {
  await db
    .update(aiSpendLedger)
    .set({ settledCents: actualCents, status: "settled", settledAt: new Date() })
    .where(eq(aiSpendLedger.id, reservationId));
}

/** The call never happened (provider refused / we bailed) — give the money back. */
export async function releaseSpend(reservationId: string): Promise<void> {
  await db
    .update(aiSpendLedger)
    .set({ settledCents: 0, status: "released", settledAt: new Date() })
    .where(eq(aiSpendLedger.id, reservationId));
}

/** Spend in the last `sinceMs` milliseconds, for /admin/ops and /api/health. */
export async function spentCentsSince(
  provider: SpendProvider | null,
  sinceMs: number
): Promise<number> {
  const conds = [
    gte(aiSpendLedger.createdAt, new Date(Date.now() - sinceMs)),
    sql`${aiSpendLedger.status} <> 'released'`,
  ];
  if (provider) conds.push(eq(aiSpendLedger.provider, provider));
  const rows = await db
    .select({ reservedCents: aiSpendLedger.reservedCents, settledCents: aiSpendLedger.settledCents })
    .from(aiSpendLedger)
    .where(and(...conds));
  return rows.reduce((sum, r) => sum + effectiveCents(r), 0);
}
```

- [ ] **Step C6: Testi çalıştır, geçtiğini gör**

Run: `npx tsx scripts/test-spend-guard.ts`
Expected: PASS

- [ ] **Step C7: Commit**

```bash
git add src/lib/config/spend.ts src/lib/services/spend-guard.ts src/lib/db/schema.ts scripts/test-spend-guard.ts
git commit -m "feat(ops): reserve-before-call AI spend ledger with per-scope and global ceilings"
```

---

### Task D: `idempotency_keys` + `POST /api/orders` sertleştirmesi

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/app/api/orders/route.ts`, `src/app/api/preview/[id]/regenerate/route.ts`
- Create: `src/lib/services/idempotency.ts`, `scripts/test-idempotency.ts`

**Interfaces:**
- Consumes: `db`, `rateLimitAsync` from `src/lib/services/rate-limit.ts`, `reserveSpend` (Task C).
- Produces:
  - `export async function withIdempotency<T>(args: { scope: string; key: string; ttlSeconds?: number; run: () => Promise<T> }): Promise<{ status: "fresh" | "replayed"; value: T } | { status: "in_progress" }>`
  - `export function deriveOrderIdempotencyKey(body: unknown, userId: string | null): string`

- [ ] **Step D1: Şemayı ekle** — `src/lib/db/schema.ts` sonuna:

```ts
// ─── Idempotency keys ───────────────────────────────────────────────────────
// A double-tapped checkout must not create two drafts (and two PayTR tokens).
// `in_flight` is claimed before the work runs; a concurrent caller sees it and
// is told to retry rather than racing.
export const idempotencyStatusEnum = pgEnum("idempotency_status", ["in_flight", "done"]);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    status: idempotencyStatusEnum("status").notNull().default("in_flight"),
    responseJson: jsonb("response_json"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ]
);
```

`primaryKey` `drizzle-orm/pg-core` importuna eklenir (zaten import ediliyorsa dokunma).

- [ ] **Step D2: Testi yaz** — `scripts/test-idempotency.ts`:

```ts
import assert from "node:assert/strict";
import { deriveOrderIdempotencyKey } from "../src/lib/services/idempotency";

let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.error(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

const body = {
  orderType: "custom", previewId: "p1", size: "standart",
  material: "resin", finish: "hand_painted",
  shippingAddress: { adres: "a", mahalle: "m", ilce: "i", il: "İstanbul", postaKodu: "34000", telefon: "+905321234567" },
};

test("ayni govde ayni anahtari uretir", () => {
  assert.equal(deriveOrderIdempotencyKey(body, "u1"), deriveOrderIdempotencyKey(body, "u1"));
});

test("farkli kullanici farkli anahtar", () => {
  assert.notEqual(deriveOrderIdempotencyKey(body, "u1"), deriveOrderIdempotencyKey(body, "u2"));
});

test("govdedeki tek alan degisimi anahtari degistirir", () => {
  const other = { ...body, size: "orta" };
  assert.notEqual(deriveOrderIdempotencyKey(body, "u1"), deriveOrderIdempotencyKey(other, "u1"));
});

test("anahtar sirasi onemsiz (kanonik siralama)", () => {
  const shuffled = { finish: "hand_painted", material: "resin", size: "standart", previewId: "p1", orderType: "custom", shippingAddress: body.shippingAddress };
  assert.equal(deriveOrderIdempotencyKey(body, "u1"), deriveOrderIdempotencyKey(shuffled, "u1"));
});

test("anahtar 64 karakterlik hex", () => {
  assert.match(deriveOrderIdempotencyKey(body, "u1"), /^[0-9a-f]{64}$/);
});

console.log(failures === 0 ? "\ntest-idempotency: PASS" : `\ntest-idempotency: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step D3: Testi çalıştır, başarısız olduğunu gör**

Run: `npx tsx scripts/test-idempotency.ts`
Expected: FAIL — `Cannot find module '../src/lib/services/idempotency'`

- [ ] **Step D4: Servisi yaz** — `src/lib/services/idempotency.ts`:

```ts
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { idempotencyKeys } from "@/lib/db/schema";

const DEFAULT_TTL_SECONDS = 600; // 10 minutes

/**
 * Stable hash of the request shape. Deterministic across key order so a client
 * that serialises its JSON differently still collapses onto one key.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function deriveOrderIdempotencyKey(body: unknown, userId: string | null): string {
  return createHash("sha256").update(`${userId ?? "guest"}|${canonical(body)}`).digest("hex");
}

/**
 * Run `run` at most once per (scope, key) within the TTL.
 *  - "fresh"       → we ran it; `value` is the result (also stored for replays)
 *  - "replayed"    → a previous run's stored result
 *  - "in_progress" → another caller holds the claim; the caller should 409
 */
export async function withIdempotency<T>(args: {
  scope: string;
  key: string;
  ttlSeconds?: number;
  run: () => Promise<T>;
}): Promise<{ status: "fresh" | "replayed"; value: T } | { status: "in_progress" }> {
  const ttl = args.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // Sweep expired rows opportunistically so the table stays small.
  await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));

  // Claim. ON CONFLICT DO NOTHING + RETURNING: an empty result means someone
  // else owns the key. We never catch 23505 — drizzle 0.45 hides the pg code
  // on `.cause`, so code that catches it is latently broken.
  const claimed = await db
    .insert(idempotencyKeys)
    .values({ scope: args.scope, key: args.key, status: "in_flight", expiresAt })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });

  if (claimed.length === 0) {
    const [existing] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key)))
      .limit(1);
    if (existing?.status === "done") {
      return { status: "replayed", value: existing.responseJson as T };
    }
    return { status: "in_progress" };
  }

  try {
    const value = await args.run();
    await db
      .update(idempotencyKeys)
      .set({ status: "done", responseJson: value as never })
      .where(and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key)));
    return { status: "fresh", value };
  } catch (err) {
    // Release the claim so a retry can proceed; the failure is the caller's.
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, args.scope), eq(idempotencyKeys.key, args.key)));
    throw err;
  }
}
```

- [ ] **Step D5: Testi çalıştır, geçtiğini gör**

Run: `npx tsx scripts/test-idempotency.ts`
Expected: PASS

- [ ] **Step D6: `POST /api/orders`'a rate limit + idempotency bağla**

`src/app/api/orders/route.ts` — handler'ın gövde parse'ından hemen sonra, herhangi bir yazmadan ÖNCE:

```ts
  // Rate limit: this is the most permissive write endpoint in the codebase and
  // it creates users, drafts, gift-card reservations, jobs and outbound email.
  const ip = getClientIp(request);
  const ipLimit = await rateLimitAsync(`orders:ip:${ip}`, 10, 60 * 60 * 1000);
  if (!ipLimit.success) {
    return NextResponse.json({ error: d["api.common.tooManyRequests"], code: "rate_limited" }, { status: 429 });
  }
```

Ve sipariş oluşturma gövdesi `withIdempotency` ile sarılır; `Idempotency-Key` başlığı varsa o, yoksa `deriveOrderIdempotencyKey(body, userId)`. `in_progress` → `409 { code: "in_progress" }`.

- [ ] **Step D7: `regenerate` musluğunu kapat**

`src/app/api/preview/[id]/regenerate/route.ts`: başa müşteri oturumu şartı (preview sahibi), `rateLimitAsync(\`regen:${previewId}\`, 4, 60*60*1000)`, ve fal çağrısını kuyruğa atmadan önce `reserveSpend("fal", 8, { kind: "order", id: previewId })`.

- [ ] **Step D8: Doğrula ve commit**

```bash
npx tsc --noEmit && npm run lint
git add -A && git commit -m "feat(ops): idempotency keys + rate limits on order creation and preview regeneration"
```

---

### Task E: Altyapı sertleştirme (compose, Sentry, health, lockDuration, sırlar)

**Files:**
- Modify: `docker/docker-compose.production.yml`, `workers/start.ts`, `src/lib/queue/queues.ts`, `.github/workflows/deploy.yml`, `deploy.sh`, `.env.example`, `src/lib/config/sizes.ts`
- Create: `sentry.worker.config.ts`, `workers/instrument.ts`, `src/app/api/health/route.ts`

- [ ] **Step E1: Redis'e kalıcılık, worker'a limit**

`docker/docker-compose.production.yml`:

```yaml
  redis:
    image: redis:7-alpine
    container_name: printer_redis
    # Without a volume every container recreate wipes the delayed/scheduled
    # jobs — payment deadlines, SLA sweeps, approval reminders.
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - printer_redis:/data
```

`worker` servisine `mem_limit: 2g` ve bir healthcheck; üst düzey `volumes:` bloğuna `printer_redis:`.

- [ ] **Step E2: Worker'da Sentry**

`sentry.worker.config.ts` (yeni; `sentry.server.config.ts`'i model al) ve `workers/instrument.ts`:

```ts
import "../sentry.worker.config";
```

`workers/start.ts`'in **ilk satırı**: `import "./instrument";`

- [ ] **Step E3: `/api/health`**

`src/app/api/health/route.ts` — `{ ok, db, redis, queues, flags, gateMode, uploadsDiskFreeMb }`.
`deploy.sh` ve `.github/workflows/deploy.yml`'deki curl hedefi `http://localhost:3005` → `http://localhost:3005/api/health`.

- [ ] **Step E4: Kuyruklara `lockDuration`**

`src/lib/queue/queues.ts` — ağır kuyruklara (`preview-generation`, ileride `model-generation`/`mesh-processing`) worker tarafında `lockDuration: 600_000` + `maxStalledCount: 1`. Repoda `dekont-ocr` dışında hiç yok.

- [ ] **Step E5: `resolveTargetHeightMm`**

`src/lib/config/sizes.ts`:

```ts
/**
 * Physical print height for an order's stored size. Returns a discriminated
 * result rather than throwing: `figurineSize` has been free text since
 * migration 0036, so "17,5 cm" is a legitimate value with no preset height and
 * the auto-3D path must fall back to the manual flow, not crash.
 */
export function resolveTargetHeightMm(
  size: string | null | undefined
): { ok: true; heightMm: number } | { ok: false; reason: "unknown_size" } {
  if (!size) return { ok: false, reason: "unknown_size" };
  const mm = presetHeightMm(size);
  if (mm != null) return { ok: true, heightMm: mm };
  const m = size.match(/^(\d+(?:[.,]\d{1,2})?)\s*cm$/i);
  if (m) {
    const cm = Number.parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(cm) && cm >= 1 && cm <= 100) return { ok: true, heightMm: Math.round(cm * 10) };
  }
  return { ok: false, reason: "unknown_size" };
}
```

- [ ] **Step E6: Deploy sırları**

`.github/workflows/deploy.yml` — `env:`, `envs:` ve `upsert_env` listelerinin ÜÇÜNE de: `FAL_API_KEY`, `MESHY_API_KEY`, `ANTHROPIC_API_KEY`, `META_APP_SECRET`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`. `.env.example`'a da yorumlarıyla eklenir.

- [ ] **Step E7: Commit**

```bash
git add -A && git commit -m "chore(ops): redis persistence, worker sentry + memory limit, /api/health, queue lock durations, secret sync"
```

---

### Task F: e-Fatura asgari dürüst düzeltmesi + migration + bütünsel doğrulama

**Files:** `src/lib/db/schema.ts`, `src/lib/services/payouts.ts`, `drizzle/0043_ops_spine.sql` + `.down.sql`

- [ ] **Step F1:** `invoiceStatusEnum`'a `"pending"` eklenir: `pgEnum("invoice_status", ["draft", "pending", "issued"])`.
- [ ] **Step F2:** `src/lib/services/payouts.ts::getOrCreateInvoice` — sağlayıcı gerçek bir `providerRef` döndürmediyse (veya `STUB-` ile başlıyorsa) satır `pending` yazılır, `issued` DEĞİL.
- [ ] **Step F3:** Migration üret ve down'ı yaz:

```bash
npx drizzle-kit generate --name ops_spine
# sonra drizzle/0043_ops_spine.down.sql ELLE yazılır
```

`down.sql` içeriği: `DROP TABLE IF EXISTS idempotency_keys; DROP TABLE IF EXISTS ai_spend_ledger; DROP TABLE IF EXISTS platform_flags; DROP TYPE IF EXISTS idempotency_status; DROP TYPE IF EXISTS spend_status;` — `invoice_status` enum değeri düşürülemez, down'da `pending` satırları `draft`'a çekilir ve enum değeri ölü bırakılır (yorumla belgelenir).

- [ ] **Step F4: Round-trip doğrula**

```bash
psql "$DATABASE_URL" -f drizzle/0043_ops_spine.sql
psql "$DATABASE_URL" -f drizzle/0043_ops_spine.down.sql
psql "$DATABASE_URL" -f drizzle/0043_ops_spine.sql
```

- [ ] **Step F5: Bütünsel kapı**

```bash
npx tsc --noEmit && npm run lint && npm run test:unit && npm run build
```

Dördü de temiz olmadan Faz 0 bitmiş sayılmaz.

- [ ] **Step F6: Commit**

```bash
git add -A && git commit -m "feat(invoice): stop claiming an invoice was issued when no provider reference exists"
```
