# Manufacturer Tax-ID — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Collect VKN/TCKN at manufacturer registration; flag accounts with no tax certificate for manual admin review.

**Architecture:** Add 3 columns to `manufacturers` (`tax_id`, `tax_id_type`, `requires_manual_tax_review`). Pure validation module (VKN + TCKN checksums) gates the register API. Manufacturer-facing UI masks TCKN; admin sees full value and a filter tab for the manual-review queue.

**Tech Stack:** Next.js 16 App Router · Drizzle ORM · Postgres · Zod · Tailwind 4 · TypeScript

**Spec:** `docs/superpowers/specs/2026-05-11-manufacturer-tax-id-design.md`

**Constraint:** Working tree contains unrelated in-progress changes. Every commit stages only the files this plan touches — no `git add -A`.

---

## Task 1 — Schema + migration

**Files:**
- Modify: `src/lib/db/schema.ts:259-273`
- Create: `drizzle/0011_*.sql` (auto-generated)

- [ ] Add columns inside `manufacturers` table definition:
  ```ts
  taxId: text("tax_id"),
  taxIdType: text("tax_id_type"),
  requiresManualTaxReview: boolean("requires_manual_tax_review").notNull().default(false),
  ```
- [ ] Run `npx drizzle-kit generate` to produce the migration SQL.
- [ ] Inspect the generated SQL file matches: 3 `ALTER TABLE manufacturers ADD COLUMN ...` statements.
- [ ] Commit: schema + migration only.

## Task 2 — Validation module + ad-hoc test script

**Files:**
- Create: `src/lib/services/tax-id.ts`
- Create: `scripts/test-tax-id.ts`

- [ ] Implement `parseTaxId` with `normalize`, `validateVkn`, `validateTckn` (algorithms in spec).
- [ ] Write `scripts/test-tax-id.ts` using `node:assert/strict` with these cases:
  - empty / whitespace → `{ ok: false, reason: "empty" }`
  - 9 digits → `invalid_length`
  - 12 digits → `invalid_length`
  - Known valid VKN `4540036018` → `{ ok: true, type: "vkn" }` (publicly known test vector)
  - VKN with wrong checksum → `invalid_checksum`
  - Synthetic valid TCKN (compute one with the algorithm) → `{ ok: true, type: "tckn" }`
  - TCKN starting with `0` → `invalid_checksum`
  - Input with spaces/dashes → normalized + valid
- [ ] Run `npx tsx scripts/test-tax-id.ts` — must exit 0.
- [ ] Commit.

## Task 3 — i18n keys

**Files:**
- Modify: `src/lib/i18n/dictionaries/tr.ts`
- Modify: `src/lib/i18n/dictionaries/en.ts`

- [ ] Add the 14 keys listed in the spec's i18n table to both dictionaries.
- [ ] Run `npx tsc --noEmit` — types may be `Record<string,string>` style; if dictionary types are strict (each key listed), add to the type as well.
- [ ] Commit.

## Task 4 — Register API

**Files:**
- Modify: `src/app/api/manufacturer/auth/register/route.ts`

- [ ] Add `taxId: z.string().optional().nullable()` to the Zod schema.
- [ ] Import `parseTaxId` from `@/lib/services/tax-id`.
- [ ] After Zod parse: if `validated.taxId` is non-empty, call `parseTaxId`. On `!ok` return 400. On `ok`, capture `normalized` + `type`.
- [ ] Pass to `db.insert(manufacturers).values({...})`:
  - If valid: `taxId: normalized, taxIdType: type, requiresManualTaxReview: false`
  - Else: `taxId: null, taxIdType: null, requiresManualTaxReview: true`
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit.

## Task 5 — Register form UI

**Files:**
- Modify: `src/app/manufacturer/register/page.tsx`

- [ ] Add `const [taxId, setTaxId] = useState("");` and `const [taxIdError, setTaxIdError] = useState<string | null>(null);`.
- [ ] In submit handler, before fetch: if `taxId.trim() !== ""` and length not in {10, 11}, set local error and return.
- [ ] In payload: include `taxId: taxId.trim() || null`.
- [ ] Insert new input block after the phone field with the amber help box and `mailto:admin@figurunica.com` link (full markup per spec).
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit.

## Task 6 — /auth/me + profile page

**Files:**
- Modify: `src/app/api/manufacturer/auth/me/route.ts`
- Modify: `src/app/manufacturer/profile/page.tsx`

- [ ] In `/auth/me`, add `taxId`, `taxIdType`, `requiresManualTaxReview` to the response payload.
- [ ] In profile page interface, add the same three fields (`taxId: string | null`, `taxIdType: "vkn" | "tckn" | null`, `requiresManualTaxReview: boolean`).
- [ ] Add a "Vergi Kimlik No" row:
  - If `taxIdType === "vkn"`: show `VKN: <digits>`.
  - If `taxIdType === "tckn"`: show `TCKN: ${digits.slice(0,5)}****${digits.slice(-2)}`.
  - If null: show `—` and sub-line `manufacturer.profile.taxId.missing` followed by `mailto:admin@figurunica.com`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit.

## Task 7 — Admin list + filter

**Files:**
- Modify: `src/app/admin/manufacturers/page.tsx`
- Modify: `src/app/admin/manufacturers/manufacturers-client.tsx`
- Modify: `src/app/api/admin/manufacturers/route.ts`

- [ ] Add `taxId`, `taxIdType`, `requiresManualTaxReview` to `serialized` payload in `page.tsx` and to the API route.
- [ ] In `manufacturers-client.tsx`:
  - Extend `Manufacturer` interface with the three fields.
  - Extend `FilterTab` union with `"manual_review"`.
  - Add a tab entry `{ key: "manual_review", label: d["admin.manufacturers.filterManualReview"] }` and matching filter logic (`m.requiresManualTaxReview && m.status !== "suspended"`).
  - Add a new `<th>` "Vergi No" between status and active orders, and matching `<td>`:
    - If `m.taxId`: show `${m.taxIdType.toUpperCase()}: ${m.taxId}` (full, no masking).
    - Else: amber badge "Vergi levhası yok" (`d["admin.manufacturers.badgeManualReview"]`).
- [ ] Run `npx tsc --noEmit`.
- [ ] Commit.

## Task 8 — Type-check + validation script

- [ ] `npx tsc --noEmit` — zero errors.
- [ ] `npx tsx scripts/test-tax-id.ts` — exit 0.

## Task 9 — Commit policy

Every commit must:
- `git add` only the files this plan touches (no `git add -A`).
- Have a message of form `feat(manufacturer): <task>` or `chore(db): <task>`.
- Include the Co-Authored-By line.

---

## Self-Review

**Spec coverage:**
- Schema (`taxId`, `taxIdType`, `requiresManualTaxReview`) → Task 1 ✓
- Validation (`parseTaxId`, VKN/TCKN checksums, normalize) → Task 2 ✓
- Register API → Task 4 ✓
- Register UI + amber help + mailto → Task 5 ✓
- Profile read-only with TCKN masking + mailto when missing → Task 6 ✓
- Admin column → Task 7 ✓
- Admin filter (manual_review tab) → Task 7 ✓
- i18n keys (14 keys) → Task 3 ✓
- TDD for tax-id → Task 2 (ad-hoc script, no test framework in repo) ✓

**Placeholder scan:** No TBD/TODO/"appropriate handling" language.

**Type consistency:** `taxIdType` is `"vkn" | "tckn" | null` everywhere. `requiresManualTaxReview` is `boolean` everywhere. `parseTaxId` return shape consistent.
