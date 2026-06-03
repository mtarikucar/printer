# Manufacturer Verification Flow + System-wide Phone Country Codes — Design

Date: 2026-06-03
Status: Approved (user delegated open decisions; "make it professional")

This spec covers two related pieces of work delivered together:

- **A. Manufacturer Verification Flow** (GitHub issue #2) — a staged trust/quality
  onboarding: identity vetting → conditional approval → 3D-printer photo upload →
  final approval, with branded emails at each transition.
- **B. System-wide phone country codes** — a shared country-code phone input
  (default 🇹🇷 Türkiye +90), E.164 storage, and consistent validation everywhere a
  phone number is entered. This also fixes the manufacturer-register bug where the
  current validation rejects the very format the form asks for.

---

## A. Manufacturer Verification Flow

### Goal

Replace the single `pending_approval → active` admin toggle with a staged flow that
lets us (1) vet that an applicant is a real person/business, (2) collect a photo of
their 3D printer(s) as a trust signal, and (3) only then grant full access — with the
manufacturer kept informed by email at every step.

### Status model

Extend `manufacturerStatusEnum` (currently `pending_approval | active | suspended`)
with two values:

- `conditionally_approved`
- `rejected`

Lifecycle:

```
register ─────────────► pending_approval
                              │  (admin reviews submitted identity/tax/IBAN info)
              genuine ┌───────┴────────┐ not genuine
                      ▼                 ▼
          conditionally_approved     rejected ──► rejection email
                      │                            (manual WhatsApp follow-up — out of app)
                      │  welcome email: "upload a photo of your 3D printer(s)"
                      ▼
        manufacturer logs in → sees ONLY the upload gate → uploads printer photo
                      │  (printerPhotoUploadedAt set; admin notified via badge)
                      ▼  admin reviews photo
            approve ┌─┴─┐ reject
                    ▼   ▼
                 active  rejected ──► rejection email
                    │
                    └► approval email; full manufacturer panel unlocked

suspended ──(admin un-suspend)──► active     (unchanged existing behavior)
```

Notes:
- `active` is the only status that grants full manufacturer-panel access and order
  assignment eligibility (unchanged).
- `rejected` is terminal inside the app; re-engagement happens manually over WhatsApp.

### Data model changes (`src/lib/db/schema.ts`)

- `manufacturerStatusEnum`: add `conditionally_approved`, `rejected`.
- `docTypeEnum`: add `printer_photo` (printer photo reuses the existing
  `manufacturerDocuments` table + `storage` service + magic-byte validation, exactly
  like the KYC document upload route).
- `manufacturers`: add
  - `rejectionReason text` (nullable) — admin note shown in the rejection email.
  - `printerPhotoUploadedAt timestamp` (nullable) — set when the photo is uploaded;
    drives the admin "ready for photo review" signal and the manufacturer
    "under review" gate state.

A single Drizzle migration is generated for all of the above and committed per the
project migration workflow (generate → commit → deploy; never `push`).

### API — admin (`src/app/api/admin/manufacturers/[id]/...`)

Clean, separately-named endpoints (we intentionally do **not** overload `activate`):

- `POST .../conditionally-approve` — guard `status = pending_approval`. Sets
  `status = conditionally_approved`. Sends `manufacturer_welcome` email. Publishes the
  admin/manufacturer realtime badge events used elsewhere.
- `POST .../approve` — guard `status = conditionally_approved` **and**
  `printerPhotoUploadedAt is not null`. Sets `status = active`. Sends
  `manufacturer_approved` email.
- `POST .../reject` — body `{ reason: string }`. Guard
  `status in (pending_approval, conditionally_approved)`. Sets `status = rejected`,
  stores `rejectionReason`. Sends `manufacturer_rejected` email.
- `activate` (existing) — scope narrowed to **un-suspend only** (`suspended → active`),
  keeping the reactivation path. (Legacy `pending_approval → active` direct path is
  removed; the staged flow replaces it.)

All admin endpoints use `requireAdmin()` and follow the existing realtime-publish
pattern. Email sends are non-fatal (wrapped so a transport failure does not roll back
the status transition — matches the project's existing "non-fatal post-commit
notifications" convention).

### API — manufacturer

- `POST /api/manufacturer/printer-photo` — multipart upload. Guard
  `status = conditionally_approved`. Reuses `saveFile` + `validateImageMagicBytes`
  (JPEG/PNG only, 10MB cap), inserts a `manufacturerDocuments` row with
  `type = printer_photo`, sets `manufacturers.printerPhotoUploadedAt = now()`.
  Publishes the admin badge so the photo surfaces for review. Idempotent-ish: a
  re-upload replaces/adds and refreshes the timestamp.
- `GET /api/manufacturer/auth/me` already returns `status`; the panel uses it to decide
  gating. (Extend the returned shape with `printerPhotoUploadedAt` if needed by the
  gate UI.)

### Login / access control (`src/app/api/manufacturer/auth/login/route.ts`)

Explicit allow/deny:
- `suspended` → 403 "suspended".
- `pending_approval` → 403 "pending approval".
- `rejected` → 403 with a polite message (contact support / team will reach out).
- `conditionally_approved` and `active` → allowed to log in.

### Manufacturer panel gating

When the logged-in manufacturer's status is `conditionally_approved`, the panel renders
**only** a verification gate (no orders/earnings nav):
- If `printerPhotoUploadedAt is null`: the upload UI ("As a last step, upload a photo of
  the 3D printer(s) you use"), matching the issue mockup tone.
- If set: an "under review — we'll get back to you within 24 hours" confirmation, with
  the option to replace the photo.

Implemented in the manufacturer layout/shell so every manufacturer route is gated, with
a dedicated gate component/page. `active` → normal panel. This is a deliberately polished,
on-brand screen (not a bare form).

### Emails (`src/lib/services/email.ts` + `dictionaries/{tr,en}.ts`)

Three new template types, recipient = `manufacturerEmail`, added to the template
registry and `recipientResolvers`, fully bilingual (TR primary, EN secondary):

- `manufacturer_welcome` — "conditionally approved", explains the trust/quality program,
  CTA button → `${NEXT_PUBLIC_APP_URL}/manufacturer/login` (then the gate prompts upload).
- `manufacturer_approved` — final approval; CTA → manufacturer panel.
- `manufacturer_rejected` — application not approved; mentions the team may follow up;
  includes the admin `rejectionReason` when present.

Branded to match existing templates (same header/footer/button styling).

### Admin UI (`src/app/admin/manufacturers/manufacturers-client.tsx`)

- New status chips + colors for `conditionally_approved` (amber/info) and `rejected`
  (gray/red), plus matching filter tabs.
- Action buttons by status:
  - `pending_approval`: **Conditionally Approve**, **Reject**.
  - `conditionally_approved`: show the uploaded printer photo (thumbnail/link via
    `getPublicUrl`) when present, **Approve** (disabled until a photo exists), **Reject**.
  - `active`: **Suspend** (unchanged). `suspended`: **Activate** (un-suspend).
- Reject opens a small reason prompt (sent as `{reason}`).
- All dictionary strings added to `tr`/`en`.

---

## B. System-wide phone country codes

### Goal

Every phone number entered in the app uses a consistent country-code picker (default
🇹🇷 +90), is validated with a real phone library, and is stored normalized as E.164.
This also fixes the register bug: the current regex `/^(?:\+?90)?[2-5]\d{9}$/` rejects
the `05XX XXX XXXX` value (leading `0`, spaces, 11 digits) that the form's own
placeholder asks the user to type.

### Library + shared utility (`src/lib/phone.ts`)

- Add dependency `libphonenumber-js`.
- `COUNTRIES`: a curated list of `{ iso, name, dialCode, flag }` (Türkiye first/default,
  plus the common set we expect — e.g. US, GB, DE, NL, FR, etc.). Names localized via
  dictionaries where shown.
- `normalizePhone(input: string, country: CountryCode): string | null` — returns E.164
  (`+905321234567`) or `null` if invalid, via `parsePhoneNumberFromString`.
- `isValidPhone(input, country): boolean`.
- `formatPhoneDisplay(e164: string): string` — human-friendly national/international
  formatting for display.
- `phoneSchema` (zod) / a `phone()` refine helper for server routes, parameterized by a
  default country (TR) and accepting already-E.164 input.

### Shared component (`PhoneInput`)

A reusable controlled component: a country `<select>` (flag + dial code, default TR)
next to a national-number text input. Emits the composed **E.164** value (and exposes the
selected country + raw national part for re-render). Dictionary-aware labels/placeholder.
Styled to match the existing input classes used across the app.

### Wiring — all phone-input surfaces

Replace the raw `type="tel"` inputs and submit E.164:
- **Customer:** register, checkout/create (shipping address), account, contact form.
- **Manufacturer:** register (fixes the bug) + profile. Note both the top-level
  `phone`/`whatsappPhone` and the nested `address.telefon` go through E.164.
- **Admin:** phone fields admin can edit (drafts/orders shipping address, manufacturer
  edits).

### Server validation

- Replace the duplicated, broken `trPhoneRegex` in
  `api/manufacturer/auth/register/route.ts` and `api/manufacturer/auth/profile/route.ts`
  with the shared `phoneSchema`/`isValidPhone` (default country TR, accepts E.164).
- Update `src/lib/validators/order.ts` phone rule (currently a bare `min(10)`) to use the
  shared validator.
- Store E.164 in all phone columns going forward.

### Existing data

Historical DB rows are **left as-is** and normalized opportunistically the next time the
record is edited. No bulk data migration. Downstream consumers (WhatsApp links, SMS,
Yurtiçi Kargo) tolerate the legacy values they already receive today.

---

## Testing & verification

- `tsc --noEmit` is the correctness gate (must stay clean).
- `tsx scripts/test-phone.ts` — unit smoke for `normalizePhone`/`isValidPhone`/
  `formatPhoneDisplay` across TR mobile, TR landline, US, and clearly-invalid inputs.
- Manual run on an **alternate local port** (per local-run-isolation memory): register a
  manufacturer with a TR mobile (verifies the bug fix), then drive the full verification
  flow — conditionally approve → upload printer photo → approve — and confirm the three
  emails render and the gate UI behaves.
- Migration applied via the standard deploy path; generated SQL committed.

## Out of scope

- Bulk normalization of existing phone numbers.
- Automated WhatsApp messaging for rejected applicants (stays manual).
- Playwright e2e for the new flow (can be added later).
- SMS/OTP phone verification (only format validation here).
