# Manufacturer Tax-ID Collection — Design

**Date:** 2026-05-11
**Status:** Approved (pending implementation plan)

## Motivation

Figurine Studio pays its production partners (manufacturers) for printed orders. Under Turkish tax law we must apply withholding tax (stopaj) on these payments and report the recipient by their tax identifier. Today the `manufacturers` table stores no tax identifier, so payouts cannot be reconciled cleanly with tax filings.

Some manufacturers — especially individual hobbyists or unregistered small operations — may not have an active tax certificate (*vergi levhası*) at registration time. We do not want to block them at the door; instead, we accept them with a "manual review" flag so admin can run a bespoke onboarding (contract, alternative tax arrangement).

## Goals

- Collect VKN (10-digit company tax number) or TCKN (11-digit Turkish national ID) at manufacturer registration.
- Allow the field to be empty; flag such accounts so admin handles them out-of-band.
- Validate tax IDs with proper checksums (no garbage in the DB).
- Surface tax status clearly in the admin manufacturers list, with a filter for the manual-review queue.
- Mask TCKN on the manufacturer's own profile page (KVKK; manufacturer sees their own ID partially), but show the full value to admin.

## Non-goals

- Uploading a scan of the *vergi levhası* PDF or image.
- Sending automated emails when an account is flagged for manual review (admin watches the dashboard).
- Generating contract PDFs.
- Editing tax ID from the manufacturer profile UI (read-only, like the rest of the profile today).
- Enforcing tax-ID uniqueness across manufacturers (shell companies, subsidiaries — admin's judgment call).

## Design Decisions

### Why a separate boolean, not a new status enum value

The existing `manufacturer_status` enum tracks approval lifecycle (`pending_approval` / `active` / `suspended`). Tax compliance is an orthogonal axis: an `active` manufacturer can still need manual tax review (e.g. switched legal form), and a `pending_approval` one may already have a clean VKN. Folding both into a single enum forces a combinatorial explosion of states.

**Decision:** add `requires_manual_tax_review` boolean (default `false`). The approval flow stays untouched.

### Why accept TCKN as well as VKN

The user (founder) confirmed that some production partners are individuals. Turkish withholding rules apply to both. We accept either; the type is inferred from the digit count (10 → VKN, 11 → TCKN) and stored explicitly so admin doesn't have to re-derive it.

### Why TCKN masking only on the manufacturer-facing profile

TCKN is personal data under KVKK. The manufacturer's profile page is read-only and the manufacturer already knows their own ID — masking it (`12345*****01`) reduces shoulder-surfing/screenshot risk. The admin panel is behind admin auth, so the full value is visible there.

## Architecture

### Schema (`src/lib/db/schema.ts`)

Add three columns to the `manufacturers` table (around line 268):

```ts
taxId: text("tax_id"),                                                  // nullable, normalized digits only
taxIdType: text("tax_id_type"),                                         // "vkn" | "tckn" | null
requiresManualTaxReview: boolean("requires_manual_tax_review")
  .notNull()
  .default(false),
```

`taxIdType` is `text` (not a Postgres enum) to avoid a second enum migration; values are constrained by application code. Migration auto-generated via `drizzle-kit generate` into `drizzle/0XXX_manufacturer_tax_id.sql`.

No unique constraint on `taxId` — duplicates are admin-judged.

### Validation module — `src/lib/services/tax-id.ts`

Pure functions, no I/O:

```ts
export type TaxIdType = "vkn" | "tckn";

export type ParseResult =
  | { ok: true; type: TaxIdType; normalized: string }
  | { ok: false; reason: "empty" | "invalid_length" | "invalid_checksum" };

export function parseTaxId(raw: string | null | undefined): ParseResult;
```

Internal helpers (not exported):
- `normalize(input: string): string` — strips all non-digit characters.
- `validateVkn(digits: string): boolean` — official VKN algorithm: for each of the first 9 digits at position i (0-indexed from left), compute `(digit + (9 - i)) mod 10`; if zero, value is zero; else `((digit + (9 - i)) mod 10) * 2^(9 - i) mod 9`, with the special case that if the multiplicand is non-zero and the result is 0, use 9. Sum the nine values, then `(10 - (sum mod 10)) mod 10` must equal the 10th digit.
- `validateTckn(digits: string): boolean` — first digit non-zero; `((sum of odd-position digits 1,3,5,7,9) * 7 - sum of even-position digits 2,4,6,8) mod 10` must equal the 10th digit; `(sum of first 10 digits) mod 10` must equal the 11th.

`parseTaxId` empty input → `{ ok: false, reason: "empty" }`. Caller decides whether empty is acceptable.

### Unit tests — `src/lib/services/__tests__/tax-id.test.ts`

TDD-first. Cases:
- Empty string, whitespace-only → `empty`.
- 9 / 12 digits → `invalid_length`.
- Known-valid VKN (test vectors from public sources) → `{ ok: true, type: "vkn", normalized }`.
- Known-valid TCKN (synthetic with correct checksums, never real) → `{ ok: true, type: "tckn", normalized }`.
- Known-invalid checksums → `invalid_checksum`.
- Input with spaces/dashes → normalized, still validates.

## User-facing changes

### Manufacturer registration form (`src/app/manufacturer/register/page.tsx`)

After the phone field, add a new block:

- Label: **"Vergi Kimlik No / TCKN"** with small "(opsiyonel)" tag.
- Input: `type="text" inputMode="numeric" maxLength={11}`, placeholder "10 veya 11 haneli".
- Help box below the input (amber background, info icon): "Vergi levhanız yoksa boş bırakabilirsiniz. Hesabınız manuel inceleme için işaretlenir. Bilgi için:" followed by a `mailto:admin@figurunica.com` link.
- Client-side validation on submit: if non-empty and length not in {10, 11}, show inline error "Geçersiz vergi kimlik numarası". Server runs the full checksum.
- Submit payload sends `taxId` only if non-empty.

The contact email `admin@figurunica.com` is a hard-coded constant for now. If it changes often, migrate to `NEXT_PUBLIC_MANUFACTURER_CONTACT_EMAIL` later.

### Manufacturer profile page (`src/app/manufacturer/profile/page.tsx`)

Read-only. New row "Vergi Kimlik No":
- If `taxIdType === "vkn"`: show full digits, prefixed with `VKN:`.
- If `taxIdType === "tckn"`: show `TCKN: 12345****01` (first 5 digits + 4 masked + last 2 = 11 total).
- If null: show "—" and a sub-line "Eksik. Tamamlamak için: admin@figurunica.com" (mailto link).

## Admin changes

### List page (`src/app/admin/manufacturers/manufacturers-client.tsx`)

- New column **"Vergi No"** between existing columns. Renders:
  - If present: `VKN: <digits>` or `TCKN: <digits>` (unmasked — admin auth required).
  - If absent: amber badge "Vergi levhası yok — manuel inceleme".
- Tab/filter strip at the top of the table: **Tümü** · **Onay bekleyen** · **Manuel inceleme bekleyen** · **Aktif** · **Askıda**.
  - Active filter reflected in URL query (`?filter=manual_review`) so the view is shareable and survives reload.
  - "Manuel inceleme bekleyen" matches `requiresManualTaxReview = true AND status != 'suspended'`.
  - "Onay bekleyen" matches `status = 'pending_approval'` (existing behavior).
  - "Tümü" is the default (no filter).

### API changes

- `POST /api/manufacturer/auth/register`:
  - Zod schema gains `taxId: z.string().optional().nullable()`.
  - Server: if `taxId` provided non-empty, run `parseTaxId`. On `ok: false` (any reason other than `empty`) return 400 with message "Geçersiz vergi kimlik numarası".
  - On `ok: true`, store normalized digits + type, set `requiresManualTaxReview = false`.
  - On empty/missing, store nulls + `requiresManualTaxReview = true`.

- `GET /api/admin/manufacturers`: include `taxId`, `taxIdType`, `requiresManualTaxReview` in the response. Add optional `?filter=manual_review|pending|active|suspended` query handling.

- `GET /api/manufacturer/auth/me`: include the three new fields. Client masks TCKN.

## i18n keys

Add to `src/lib/i18n/dictionaries/tr.ts` and `en.ts`:

| Key | tr | en |
|---|---|---|
| `manufacturer.register.taxId` | Vergi Kimlik No / TCKN | Tax ID / National ID |
| `manufacturer.register.taxId.placeholder` | 10 veya 11 haneli | 10 or 11 digits |
| `manufacturer.register.taxId.optional` | Opsiyonel | Optional |
| `manufacturer.register.taxId.help` | Vergi levhanız yoksa boş bırakabilirsiniz. Hesabınız manuel inceleme için işaretlenir. Bilgi için: | If you don't have a tax certificate you can leave this blank. Your account will be flagged for manual review. Contact: |
| `manufacturer.register.taxId.invalid` | Geçersiz vergi kimlik numarası | Invalid tax ID |
| `manufacturer.profile.taxId` | Vergi Kimlik No | Tax ID |
| `manufacturer.profile.taxId.missing` | Eksik. Tamamlamak için: | Missing. To complete: |
| `admin.manufacturers.col.taxId` | Vergi No | Tax ID |
| `admin.manufacturers.badge.manualReview` | Vergi levhası yok | No tax certificate |
| `admin.manufacturers.filter.manualReview` | Manuel inceleme | Manual review |
| `admin.manufacturers.filter.all` | Tümü | All |
| `admin.manufacturers.filter.pending` | Onay bekleyen | Pending approval |
| `admin.manufacturers.filter.active` | Aktif | Active |
| `admin.manufacturers.filter.suspended` | Askıda | Suspended |

## Testing

- **Unit:** `tax-id.test.ts` covers checksum logic exhaustively.
- **Manual UI verification:**
  1. Register with valid VKN → account created, `requires_manual_tax_review = false`, tax row shows VKN in profile.
  2. Register with valid TCKN → same, profile shows masked.
  3. Register with empty tax ID → account created with flag = true, profile shows "Eksik".
  4. Register with garbage ("1234567") → 400, inline error shown.
  5. Admin list: column populated correctly; amber badge appears for flagged accounts; filter tabs each show the expected subset.

No new E2E framework is introduced — none exists today and this feature doesn't justify the cost of standing one up.

## Out of scope (deferred)

- File upload for tax certificate scan.
- Email notifications when a manufacturer is flagged.
- Editing tax ID from the manufacturer profile UI.
- Tax-ID uniqueness enforcement.
- Multi-country tax ID support (this is Turkey-only today).

## Risks

- **VKN/TCKN checksum algorithm bugs.** Mitigation: TDD, public test vectors.
- **PII exposure.** Mitigation: TCKN masking on the manufacturer's own profile, full visibility only behind admin auth.
- **Duplicate registrations under one VKN.** Mitigation: admin reviews; no DB constraint.
