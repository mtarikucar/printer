# Manufacturer Verification Flow + System-wide Phone Country Codes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the staged manufacturer verification flow from issue #2 (pending → conditionally_approved → printer-photo upload → active, with branded emails + a rejection path) and a shared E.164 phone-with-country-code input used across every phone field (which also fixes the manufacturer-register phone-validation bug).

**Architecture:** Two parallel-ish workstreams on one branch (`feat/manufacturer-verification-and-phone`). **Phase A (phones)** adds `libphonenumber-js`, a pure `src/lib/phone.ts` util (TDD'd), a reusable `PhoneInput` client component, and rewires all phone inputs + server validators to normalize/store E.164. **Phase B (verification)** extends the manufacturer status enum, adds a printer-photo upload (reusing the existing `manufacturerDocuments` + `storage` infra), three branded emails, three admin endpoints, login/gating changes, and admin UI. Phones land first because they include the user's reported bug.

**Tech Stack:** Next.js 16 App Router (TS strict), Drizzle ORM + PostgreSQL, Zod, nodemailer, libphonenumber-js, Tailwind 4. Correctness gate is `npx tsc --noEmit`; pure logic is smoke-tested via `tsx scripts/test-*.ts`.

**Key facts the implementer must know:**
- Dictionary is flat key→string. The `Dictionary` **type is derived from `src/lib/i18n/dictionaries/en.ts`**, and `tr.ts` must satisfy it. So **every new key must be added to BOTH `en.ts` and `tr.ts`** or `tsc` fails.
- Migrations: edit `src/lib/db/schema.ts`, then `npm run db:generate` (drizzle-kit) to emit SQL under `/drizzle`. **Commit the generated SQL + meta snapshots. Never `db:push`.** Applied on deploy. The local/dev DB is frequently out of sync — do not assume the column exists at runtime until migrated.
- Local runs must use an alternate port and must not disturb the user's dev server (see local-run-isolation memory).
- File uploads: `saveFile(buffer, subdir, filename)` returns a relative storage key; `getPublicUrl(key)` returns a signed URL; `validateImageMagicBytes(buffer)` returns a mime string or null.
- `SendEmailParams` requires `to`, `orderNumber`, `customerName` (strings) even for non-order emails — pass `orderNumber: ""`, `customerName: ""` and use the dedicated fields (`manufacturerEmail`, `companyName`, etc.), mirroring `manufacturer_notification`.

---

## PHASE A — Phones

### Task A1: Add libphonenumber-js dependency

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install the library**

Run:
```bash
npm install libphonenumber-js
```
Expected: `libphonenumber-js` appears under `dependencies` in `package.json`; `package-lock.json` updated.

- [ ] **Step 2: Verify it imports**

Run:
```bash
npx tsx -e "import {parsePhoneNumberFromString} from 'libphonenumber-js'; console.log(parsePhoneNumberFromString('05321234567','TR')?.number)"
```
Expected: prints `+905321234567`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add libphonenumber-js for phone normalization/validation"
```

---

### Task A2: Phone utility module (TDD)

**Files:**
- Create: `src/lib/phone.ts`
- Test: `scripts/test-phone.ts`
- Modify: `package.json` (add `test:phone` script)

- [ ] **Step 1: Write the failing test**

Create `scripts/test-phone.ts`:
```ts
import assert from "node:assert";
import {
  normalizePhone,
  isValidPhone,
  formatPhoneDisplay,
  COUNTRIES,
  DEFAULT_COUNTRY,
} from "../src/lib/phone";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// TR mobile in the exact format the register form asks for ("05XX XXX XXXX")
check("TR mobile with leading 0 and spaces → E.164", () => {
  assert.strictEqual(normalizePhone("0532 123 45 67", "TR"), "+905321234567");
});
check("TR mobile already +90 → E.164", () => {
  assert.strictEqual(normalizePhone("+90 532 123 45 67", "TR"), "+905321234567");
});
check("TR landline (Ankara) → E.164", () => {
  assert.strictEqual(normalizePhone("0312 123 45 67", "TR"), "+903121234567");
});
check("US number with explicit country → E.164", () => {
  assert.strictEqual(normalizePhone("(202) 555-0182", "US"), "+12025550182");
});
check("garbage → null", () => {
  assert.strictEqual(normalizePhone("not-a-phone", "TR"), null);
});
check("too short → null", () => {
  assert.strictEqual(normalizePhone("12345", "TR"), null);
});
check("isValidPhone agrees with normalizePhone", () => {
  assert.strictEqual(isValidPhone("0532 123 45 67", "TR"), true);
  assert.strictEqual(isValidPhone("nope", "TR"), false);
});
check("formatPhoneDisplay returns international form", () => {
  assert.strictEqual(formatPhoneDisplay("+905321234567"), "+90 532 123 45 67");
});
check("Türkiye is the default country and first in list", () => {
  assert.strictEqual(DEFAULT_COUNTRY, "TR");
  assert.strictEqual(COUNTRIES[0].iso, "TR");
});

console.log(`\nphone: ${passed} checks passed`);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx scripts/test-phone.ts`
Expected: FAIL — `Cannot find module '../src/lib/phone'`.

- [ ] **Step 3: Implement the module**

Create `src/lib/phone.ts`:
```ts
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export type { CountryCode };

export const DEFAULT_COUNTRY: CountryCode = "TR";

export interface Country {
  iso: CountryCode;
  /** English/Turkish-agnostic display name; localize at the call site if needed. */
  name: string;
  dialCode: string;
  flag: string;
}

// Curated list — Türkiye first (default), then the markets we realistically see.
// Keep short; libphonenumber validates the actual number for the chosen country.
export const COUNTRIES: Country[] = [
  { iso: "TR", name: "Türkiye", dialCode: "+90", flag: "🇹🇷" },
  { iso: "US", name: "United States", dialCode: "+1", flag: "🇺🇸" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { iso: "DE", name: "Deutschland", dialCode: "+49", flag: "🇩🇪" },
  { iso: "NL", name: "Nederland", dialCode: "+31", flag: "🇳🇱" },
  { iso: "FR", name: "France", dialCode: "+33", flag: "🇫🇷" },
  { iso: "AZ", name: "Azərbaycan", dialCode: "+994", flag: "🇦🇿" },
  { iso: "SA", name: "السعودية", dialCode: "+966", flag: "🇸🇦" },
  { iso: "AE", name: "الإمارات", dialCode: "+971", flag: "🇦🇪" },
];

/**
 * Parse a user-typed phone (with or without leading 0, spaces, or +CC) for the
 * given country and return canonical E.164 (e.g. "+905321234567"), or null if
 * the value is not a valid number for that country.
 */
export function normalizePhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY
): string | null {
  if (!input || !input.trim()) return null;
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}

export function isValidPhone(
  input: string,
  country: CountryCode = DEFAULT_COUNTRY
): boolean {
  return normalizePhone(input, country) !== null;
}

/** Human-friendly international formatting for display, e.g. "+90 532 123 45 67". */
export function formatPhoneDisplay(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

/** Best-effort: detect which curated country an E.164 belongs to (for re-render). */
export function detectCountry(e164: string | null | undefined): CountryCode {
  if (!e164) return DEFAULT_COUNTRY;
  const parsed = parsePhoneNumberFromString(e164);
  return (parsed?.country as CountryCode) ?? DEFAULT_COUNTRY;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx scripts/test-phone.ts`
Expected: PASS — `phone: 9 checks passed`.

- [ ] **Step 5: Add the npm script**

In `package.json` scripts, add after `"test:prices"`:
```json
    "test:phone": "tsx scripts/test-phone.ts",
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/phone.ts scripts/test-phone.ts package.json
git commit -m "feat(phone): add libphonenumber-based phone util with E.164 normalization + tests"
```

---

### Task A3: Zod phone schema helper (TDD)

**Files:**
- Modify: `src/lib/phone.ts`
- Modify: `scripts/test-phone.ts`

- [ ] **Step 1: Extend the test**

Append to `scripts/test-phone.ts` (before the final `console.log`):
```ts
import { z } from "zod";
import { phoneField } from "../src/lib/phone";

check("phoneField accepts E.164 and passes through", () => {
  const schema = z.object({ phone: phoneField() });
  const r = schema.parse({ phone: "+905321234567" });
  assert.strictEqual(r.phone, "+905321234567");
});
check("phoneField normalizes a national TR number", () => {
  const schema = z.object({ phone: phoneField() });
  const r = schema.parse({ phone: "0532 123 45 67" });
  assert.strictEqual(r.phone, "+905321234567");
});
check("phoneField rejects garbage", () => {
  const schema = z.object({ phone: phoneField() });
  assert.throws(() => schema.parse({ phone: "nope" }));
});
check("phoneField().optional().nullable() allows null", () => {
  const schema = z.object({ phone: phoneField().nullable().optional() });
  assert.strictEqual(schema.parse({ phone: null }).phone, null);
  assert.strictEqual(schema.parse({}).phone, undefined);
});
```
Also bump the count in the final log line to reflect the new checks (or leave the message generic — the per-check `✓` lines are the real signal).

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/test-phone.ts`
Expected: FAIL — `phoneField` is not exported.

- [ ] **Step 3: Implement `phoneField`**

Append to `src/lib/phone.ts`:
```ts
import { z } from "zod";

/**
 * Zod field for a phone number. Accepts a user-typed or already-E.164 string,
 * validates it against `country` (default TR), and transforms to E.164.
 * Compose with `.optional()` / `.nullable()` at the call site.
 */
export function phoneField(
  country: CountryCode = DEFAULT_COUNTRY,
  message = "Invalid phone number"
) {
  return z
    .string()
    .transform((v, ctx) => {
      const e164 = normalizePhone(v, country);
      if (!e164) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return e164;
    });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx scripts/test-phone.ts`
Expected: PASS — all `✓` lines including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone.ts scripts/test-phone.ts
git commit -m "feat(phone): add reusable zod phoneField that normalizes to E.164"
```

---

### Task A4: Shared PhoneInput component

**Files:**
- Create: `src/components/PhoneInput.tsx`

> Confirm the directory: most shared components live under `src/components/` — verify with `ls src/components 2>/dev/null` and, if the project instead colocates under `src/app/components`, create it there and adjust import paths in later tasks accordingly.

- [ ] **Step 1: Create the component**

Create `src/components/PhoneInput.tsx`:
```tsx
"use client";

import { useMemo } from "react";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  detectCountry,
  normalizePhone,
  type CountryCode,
} from "@/lib/phone";

export interface PhoneInputProps {
  /** Selected country ISO (controlled). */
  country: CountryCode;
  /** Raw national-part text the user typed (controlled). */
  nationalNumber: string;
  onCountryChange: (c: CountryCode) => void;
  onNationalNumberChange: (v: string) => void;
  required?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
}

/**
 * Country-code dropdown (default 🇹🇷 +90) + national-number field. Purely
 * controlled: the parent owns `country` + `nationalNumber` and derives the
 * E.164 value via `phoneInputToE164` on submit.
 */
export function PhoneInput({
  country,
  nationalNumber,
  onCountryChange,
  onNationalNumberChange,
  required,
  id,
  className,
  placeholder,
}: PhoneInputProps) {
  const inputCls =
    className ??
    "w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent";
  return (
    <div className="flex gap-2">
      <select
        aria-label="Country code"
        value={country}
        onChange={(e) => onCountryChange(e.target.value as CountryCode)}
        className="px-2 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.iso} value={c.iso}>
            {c.flag} {c.dialCode}
          </option>
        ))}
      </select>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        required={required}
        value={nationalNumber}
        onChange={(e) => onNationalNumberChange(e.target.value)}
        placeholder={placeholder ?? "5XX XXX XX XX"}
        className={inputCls}
      />
    </div>
  );
}

/** Derive canonical E.164 from the controlled component state, or null if invalid. */
export function phoneInputToE164(
  country: CountryCode,
  nationalNumber: string
): string | null {
  return normalizePhone(nationalNumber, country);
}

/** Seed component state from an existing E.164 value (for edit forms). */
export function e164ToPhoneInput(e164: string | null | undefined): {
  country: CountryCode;
  nationalNumber: string;
} {
  if (!e164) return { country: DEFAULT_COUNTRY, nationalNumber: "" };
  // Strip the dial code so the national part shows in the text field.
  const c = detectCountry(e164);
  const dial = COUNTRIES.find((x) => x.iso === c)?.dialCode.replace("+", "");
  const national = dial && e164.startsWith(`+${dial}`)
    ? e164.slice(dial.length + 1)
    : e164.replace(/^\+/, "");
  return { country: c, nationalNumber: national };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add src/components/PhoneInput.tsx
git commit -m "feat(phone): add shared PhoneInput (country dropdown, default TR) + E.164 helpers"
```

---

### Task A5: Fix server validation in manufacturer register + profile routes

**Files:**
- Modify: `src/app/api/manufacturer/auth/register/route.ts:13` (remove `trPhoneRegex`), `:31`, `:39-44`
- Modify: `src/app/api/manufacturer/auth/profile/route.ts:13` (remove `trPhoneRegex`), `:21`, `:26-31`

This is the core bug fix: the regex rejected `05XX...`. We replace it with `phoneField()` which normalizes to E.164.

- [ ] **Step 1: register route — swap the validators**

In `src/app/api/manufacturer/auth/register/route.ts`:
- Delete lines 12-13 (the `trPhoneRegex` comment + const).
- Add to imports: `import { phoneField } from "@/lib/phone";`
- In `addressSchema`, replace the `telefon` field:
```ts
    telefon: phoneField(),
```
- In `registerSchema`, replace `phone` and `whatsappPhone`:
```ts
    phone: phoneField(),
    whatsappPhone: phoneField().optional().nullable(),
```

(Because `phoneField` transforms to E.164, the values inserted into the DB at lines ~117-118 and the `address.telefon` at ~107 are now already normalized — no further change needed there.)

- [ ] **Step 2: profile route — swap the validators**

In `src/app/api/manufacturer/auth/profile/route.ts`:
- Delete lines 11-13 (comment + `trPhoneRegex`).
- Add to imports: `import { phoneField } from "@/lib/phone";`
- In `addressSchema`, replace `telefon`:
```ts
  telefon: phoneField(),
```
- In `profileSchema`, replace `phone` and `whatsappPhone`:
```ts
  phone: phoneField().optional(),
  whatsappPhone: phoneField().nullable().optional(),
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Smoke-test the schema accepts the form's format**

Run:
```bash
npx tsx -e "import {phoneField} from './src/lib/phone'; import {z} from 'zod'; console.log(z.object({p:phoneField()}).parse({p:'0532 123 45 67'}))"
```
Expected: `{ p: '+905321234567' }` (previously this exact value was rejected).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/manufacturer/auth/register/route.ts src/app/api/manufacturer/auth/profile/route.ts
git commit -m "fix(manufacturer): accept '05XX'/spaced phone formats by normalizing to E.164 (was rejected by trPhoneRegex)"
```

---

### Task A6: Order validator phone rule → E.164

**Files:**
- Modify: `src/lib/validators/order.ts:17-19`

- [ ] **Step 1: Swap the telefon rule**

In `src/lib/validators/order.ts`:
- Add import at top: `import { phoneField } from "@/lib/phone";`
- In `createTurkishAddressSchema`, replace lines 17-19:
```ts
    telefon: phoneField(defaultCountryForLocale(locale), d["validator.phone.min"]),
```
- Add a tiny helper above `createTurkishAddressSchema` (keeps TR default but lets EN locale default to TR too, since this is a Turkey-shipping app):
```ts
function defaultCountryForLocale(_locale: Locale) {
  // Shipping is Turkey-only today; default the parser to TR regardless of UI locale.
  return "TR" as const;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validators/order.ts
git commit -m "feat(checkout): validate shipping phone via E.164 normalizer"
```

---

### Task A7: Wire PhoneInput into the manufacturer register form

**Files:**
- Modify: `src/app/manufacturer/register/page.tsx`

This is the surface the user explicitly reported. Replace the two `type="tel"` inputs (`phone` at :265-267, `whatsappPhone` at :269-271) with `PhoneInput`, track country state, and submit E.164.

- [ ] **Step 1: Add imports + state**

At top imports add:
```tsx
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
```
Replace the `phone`/`whatsappPhone` string state (lines 47-48) with:
```tsx
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [waCountry, setWaCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [whatsappPhone, setWhatsappPhone] = useState("");
```

- [ ] **Step 2: Validate + normalize in handleSubmit**

In `handleSubmit`, after the IBAN check (~line 121) and before `setLoading(true)`, add:
```tsx
    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin");
      return;
    }
    let whatsappE164: string | null = null;
    if (whatsappPhone.trim()) {
      whatsappE164 = phoneInputToE164(waCountry, whatsappPhone);
      if (!whatsappE164) {
        setError("Geçerli bir WhatsApp numarası girin");
        return;
      }
    }
```
Then in the `fetch` body, replace `phone`, `whatsappPhone`, and `address.telefon`:
```tsx
          phone: phoneE164,
          whatsappPhone: whatsappE164,
```
and in the `address` object replace `telefon: phone,` with `telefon: phoneE164,`.

- [ ] **Step 3: Replace the inputs in the JSX**

Replace the Telefon input block (lines 264-267) with:
```tsx
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Telefon *</label>
                <PhoneInput
                  required
                  country={phoneCountry}
                  nationalNumber={phone}
                  onCountryChange={setPhoneCountry}
                  onNationalNumberChange={setPhone}
                />
              </div>
```
Replace the WhatsApp input block (lines 268-271) with:
```tsx
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">WhatsApp (opsiyonel, admin iletişimi için)</label>
                <PhoneInput
                  country={waCountry}
                  nationalNumber={whatsappPhone}
                  onCountryChange={setWaCountry}
                  onNationalNumberChange={setWhatsappPhone}
                />
              </div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/manufacturer/register/page.tsx
git commit -m "feat(manufacturer): country-code phone picker on register form (default TR)"
```

---

### Task A8: Wire PhoneInput into remaining surfaces

**Files (one per surface — same swap pattern as Task A7):**
- Modify: `src/app/manufacturer/profile/page.tsx` (phone, whatsappPhone, address.telefon)
- Modify: `src/app/register/page.tsx` (customer register `phone` → submit E.164)
- Modify: `src/app/create/page.tsx` (checkout shipping `telefon`, state at ~:63, input at ~:1308-1310)
- Modify: `src/app/account/page.tsx` (address book phone)
- Modify: `src/app/contact/page.tsx` (contact phone)
- Modify: admin address/phone edit inputs: `src/app/admin/drafts/[id]/client.tsx`, `src/app/admin/orders/[id]/client.tsx`

For each surface, repeat the Task A7 pattern: (a) import `PhoneInput`, `phoneInputToE164`, `e164ToPhoneInput`, `DEFAULT_COUNTRY`, `CountryCode`; (b) hold `country` + national `string` state (seed edit forms from existing values via `e164ToPhoneInput`); (c) replace the `type="tel"` `<input>` with `<PhoneInput .../>`; (d) on submit, compute E.164 with `phoneInputToE164` and block submit with an inline error if it returns null; (e) send the E.164 string in the request body field that previously carried the raw phone.

- [ ] **Step 1: Manufacturer profile** — apply the pattern; seed initial state from the `me` payload (`e164ToPhoneInput(manufacturer.phone)` etc.). Type-check, commit:
```bash
git add src/app/manufacturer/profile/page.tsx
git commit -m "feat(manufacturer): country-code phone picker on profile form"
```

- [ ] **Step 2: Customer register** — apply the pattern. The register POST body field is `phone` (see `src/app/register/page.tsx:53`). Verify the customer register API validates/stores it (grep the route; if it has its own phone validation, switch it to `phoneField()` too). Type-check, commit:
```bash
git add src/app/register/page.tsx src/app/api/auth/register/route.ts
git commit -m "feat(auth): country-code phone picker on customer register"
```

- [ ] **Step 3: Checkout (create page)** — the shipping address object uses `telefon`; the form state object initializes `telefon: ""` (~:63) and the input is at ~:1308-1310. Apply the pattern, mapping the national+country to E.164 into `addr.telefon` / `form.telefon` before the order POST. Type-check, commit:
```bash
git add src/app/create/page.tsx
git commit -m "feat(checkout): country-code phone picker on shipping address"
```

- [ ] **Step 4: Account address book** — apply the pattern; the addresses API is `src/app/api/customer/addresses/route.ts` (and `[id]/route.ts`). If those routes validate phone, switch to `phoneField()`. Type-check, commit:
```bash
git add src/app/account/page.tsx src/app/api/customer/addresses/route.ts src/app/api/customer/addresses/[id]/route.ts
git commit -m "feat(account): country-code phone picker on saved addresses"
```

- [ ] **Step 5: Contact form** — apply the pattern. Type-check, commit:
```bash
git add src/app/contact/page.tsx
git commit -m "feat(contact): country-code phone picker on contact form"
```

- [ ] **Step 6: Admin draft/order phone edits** — apply the pattern to any editable phone fields in `src/app/admin/drafts/[id]/client.tsx` and `src/app/admin/orders/[id]/client.tsx`. These edit shipping addresses; on save send E.164. Type-check, commit:
```bash
git add src/app/admin/drafts/[id]/client.tsx src/app/admin/orders/[id]/client.tsx
git commit -m "feat(admin): country-code phone picker on address edits"
```

> NOTE: `src/app/privacy/page.tsx` matched the phone grep but is static legal copy — do NOT add a picker there. Verify before editing each file that the match is an actual input, not display text.

- [ ] **Step 7: Full type-check across all surfaces**

Run: `npx tsc --noEmit`
Expected: PASS.

---

## PHASE B — Verification Flow

### Task B1: Schema — statuses, doc type, columns + migration

**Files:**
- Modify: `src/lib/db/schema.ts:162-166` (status enum), `:593-599` (doc type enum), manufacturers table (~after `onboardingAcceptedAt`/`status`)
- Generated: `/drizzle/*.sql` + meta snapshot

- [ ] **Step 1: Extend the enums**

In `src/lib/db/schema.ts`, change `manufacturerStatusEnum`:
```ts
export const manufacturerStatusEnum = pgEnum("manufacturer_status", [
  "pending_approval",
  "conditionally_approved",
  "active",
  "suspended",
  "rejected",
]);
```
Change `docTypeEnum`:
```ts
export const docTypeEnum = pgEnum("manufacturer_doc_type", [
  "vergi_levhasi",
  "ticaret_sicil",
  "imza_sirkuleri",
  "kimlik",
  "printer_photo",
  "other",
]);
```

- [ ] **Step 2: Add manufacturer columns**

In the `manufacturers` table, after the `status` line, add:
```ts
  // Verification flow (issue #2): rejection note shown to the applicant, and the
  // timestamp the conditionally-approved manufacturer uploaded their 3D-printer
  // photo (gates the admin "Approve" action + the manufacturer upload screen).
  rejectionReason: text("rejection_reason"),
  printerPhotoUploadedAt: timestamp("printer_photo_uploaded_at"),
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `/drizzle/` containing `ALTER TYPE ... ADD VALUE` for both enums and `ALTER TABLE manufacturers ADD COLUMN rejection_reason ...` / `add column printer_photo_uploaded_at ...`. 

> Postgres note: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction with other statements in some setups. If `db:migrate` later errors on that, split the generated SQL so enum additions run in their own statement/file. Verify the generated SQL looks sane before committing.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts drizzle/
git commit -m "feat(db): add conditionally_approved/rejected statuses, printer_photo doc type, verification columns"
```

---

### Task B2: Verification emails

**Files:**
- Modify: `src/lib/services/email.ts` (type union ~:30-52, optional params ~:54-64, templates registry, `RECIPIENT_OVERRIDES` ~:522-530)
- Modify: `src/lib/i18n/dictionaries/en.ts` and `src/lib/i18n/dictionaries/tr.ts` (new keys in BOTH)

- [ ] **Step 1: Add dictionary keys (en.ts then tr.ts)**

Add these keys to `src/lib/i18n/dictionaries/en.ts` (and the SAME keys with Turkish values to `tr.ts`):
```
"email.mfrWelcome.subject"      EN: "Welcome to Figurine Studio — one last step"   TR: "Figurine Studio'ya hoş geldiniz — son bir adım"
"email.mfrWelcome.heading"      EN: "Congratulations, {companyName}!"               TR: "Tebrikler, {companyName}!"
"email.mfrWelcome.body"         EN: "Your manufacturer application has been conditionally approved. As part of our trust & quality program, we'd like to learn more about your production capabilities. As a last step, please upload a photo of the 3D printer(s) you currently use." TR: "Üretici başvurunuz koşullu olarak onaylandı. Güven ve kalite programımız kapsamında üretim kapasitenizi daha yakından tanımak istiyoruz. Son adım olarak, hâlihazırda kullandığınız 3D yazıcı(lar)ın bir fotoğrafını yükleyin."
"email.mfrWelcome.button"       EN: "Upload printer photo"                          TR: "Yazıcı fotoğrafını yükle"
"email.mfrWelcome.footer"       EN: "After uploading, your account will be reviewed within 24 hours." TR: "Yükledikten sonra hesabınız 24 saat içinde incelenecektir."
"email.mfrApproved.subject"     EN: "Your Figurine Studio manufacturer account is approved" TR: "Figurine Studio üretici hesabınız onaylandı"
"email.mfrApproved.heading"     EN: "You're approved, {companyName}!"               TR: "Onaylandınız, {companyName}!"
"email.mfrApproved.body"        EN: "Your account is now fully active. You can log in and start receiving order assignments." TR: "Hesabınız artık tamamen aktif. Giriş yapıp sipariş atamaları almaya başlayabilirsiniz."
"email.mfrApproved.button"      EN: "Open manufacturer panel"                       TR: "Üretici panelini aç"
"email.mfrRejected.subject"     EN: "Update on your Figurine Studio application"     TR: "Figurine Studio başvurunuz hakkında"
"email.mfrRejected.heading"     EN: "About your application"                         TR: "Başvurunuz hakkında"
"email.mfrRejected.body"        EN: "Thank you for your interest. We're unable to approve your manufacturer application at this time." TR: "İlginiz için teşekkür ederiz. Üretici başvurunuzu şu anda onaylayamıyoruz."
"email.mfrRejected.reasonLabel" EN: "Reason"                                        TR: "Sebep"
```

- [ ] **Step 2: Extend SendEmailParams**

In `src/lib/services/email.ts`, add to the `type` union (around :48):
```ts
    | "manufacturer_welcome"
    | "manufacturer_approved"
    | "manufacturer_rejected"
```
Add an optional field near the other optionals (~:60):
```ts
  rejectionReason?: string;
```

- [ ] **Step 3: Add the three templates**

In the `templates` object (before the closing `};` at ~:515), add (TR/EN handled by the `d` dictionary; `loginUrl`/`panelUrl` built inline):
```ts
    manufacturer_welcome: (p) => ({
      subject: d["email.mfrWelcome.subject"],
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">
          <h1 style="color:#1a1a1a;">${d["email.mfrWelcome.heading"].replace("{companyName}", escHtml(p.companyName || ""))}</h1>
          <p>${d["email.mfrWelcome.body"]}</p>
          <p style="margin:24px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/manufacturer/login"
               style="display:inline-block;background:#4f46e5;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
              ${d["email.mfrWelcome.button"]}
            </a>
          </p>
          <p style="font-size:13px;color:#6b7280;">${d["email.mfrWelcome.footer"]}</p>
          <p style="margin-top:24px;color:#999;font-size:12px;">Figurine Studio</p>
        </div>
      `,
    }),

    manufacturer_approved: (p) => ({
      subject: d["email.mfrApproved.subject"],
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">
          <h1 style="color:#1a1a1a;">${d["email.mfrApproved.heading"].replace("{companyName}", escHtml(p.companyName || ""))}</h1>
          <p>${d["email.mfrApproved.body"]}</p>
          <p style="margin:24px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/manufacturer/orders"
               style="display:inline-block;background:#10b981;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
              ${d["email.mfrApproved.button"]}
            </a>
          </p>
          <p style="margin-top:24px;color:#999;font-size:12px;">Figurine Studio</p>
        </div>
      `,
    }),

    manufacturer_rejected: (p) => ({
      subject: d["email.mfrRejected.subject"],
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color:#1f2937;">
          <h1 style="color:#1a1a1a;">${d["email.mfrRejected.heading"]}</h1>
          <p>${d["email.mfrRejected.body"]}</p>
          ${p.rejectionReason ? `<p style="color:#6b7280;"><strong>${d["email.mfrRejected.reasonLabel"]}:</strong> ${escHtml(p.rejectionReason)}</p>` : ""}
          <p style="margin-top:24px;color:#999;font-size:12px;">Figurine Studio</p>
        </div>
      `,
    }),
```

- [ ] **Step 4: Route all three to the manufacturer email**

In `RECIPIENT_OVERRIDES` (~:524) add:
```ts
  manufacturer_welcome: (p) => p.manufacturerEmail,
  manufacturer_approved: (p) => p.manufacturerEmail,
  manufacturer_rejected: (p) => p.manufacturerEmail,
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (proves both dictionaries have all new keys — a missing key in `tr.ts` fails here).

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/email.ts src/lib/i18n/dictionaries/en.ts src/lib/i18n/dictionaries/tr.ts
git commit -m "feat(email): manufacturer welcome/approved/rejected templates (bilingual)"
```

---

### Task B3: Admin endpoint — conditionally-approve

**Files:**
- Create: `src/app/api/admin/manufacturers/[id]/conditionally-approve/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { sendEmail } from "@/lib/services/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  const [m] = await db
    .update(manufacturers)
    .set({ status: "conditionally_approved", updatedAt: new Date() })
    .where(and(eq(manufacturers.id, id), eq(manufacturers.status, "pending_approval")))
    .returning();

  if (!m) {
    return NextResponse.json(
      { error: "Manufacturer not found or not in pending_approval" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  // Non-fatal: a mail transport hiccup must not undo the status transition.
  try {
    await sendEmail({
      type: "manufacturer_welcome",
      to: m.email,
      manufacturerEmail: m.email,
      companyName: m.companyName,
      orderNumber: "",
      customerName: m.contactPerson,
    });
  } catch (err) {
    console.error("manufacturer_welcome email failed:", err);
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

> If `requireAdmin`/`topics`/`publishRealtime` import paths differ, copy them verbatim from `src/app/api/admin/manufacturers/[id]/activate/route.ts` which already uses all three.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/manufacturers/[id]/conditionally-approve/route.ts
git commit -m "feat(admin): conditionally-approve manufacturer endpoint + welcome email"
```

---

### Task B4: Admin endpoint — final approve

**Files:**
- Create: `src/app/api/admin/manufacturers/[id]/approve/route.ts`
- Modify: `src/app/api/admin/manufacturers/[id]/activate/route.ts:25` (narrow to suspended-only)

- [ ] **Step 1: Create the approve route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNotNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { sendEmail } from "@/lib/services/email";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  // Guard: only conditionally_approved manufacturers WITH a printer photo on
  // file can be finally approved.
  const [m] = await db
    .update(manufacturers)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        eq(manufacturers.status, "conditionally_approved"),
        isNotNull(manufacturers.printerPhotoUploadedAt)
      )
    )
    .returning();

  if (!m) {
    return NextResponse.json(
      { error: "Manufacturer must be conditionally approved with an uploaded printer photo" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  try {
    await sendEmail({
      type: "manufacturer_approved",
      to: m.email,
      manufacturerEmail: m.email,
      companyName: m.companyName,
      orderNumber: "",
      customerName: m.contactPerson,
    });
  } catch (err) {
    console.error("manufacturer_approved email failed:", err);
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Narrow the legacy activate route to un-suspend only**

In `src/app/api/admin/manufacturers/[id]/activate/route.ts`, change the `inArray(...)` guard (line 25) to:
```ts
        eq(manufacturers.status, "suspended")
```
and remove the now-unused `inArray` import (keep `and`, `eq`). Update the error string at :32 to `"Manufacturer not found or not suspended"`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/manufacturers/[id]/approve/route.ts src/app/api/admin/manufacturers/[id]/activate/route.ts
git commit -m "feat(admin): final-approve endpoint (active+email); activate now un-suspend only"
```

---

### Task B5: Admin endpoint — reject

**Files:**
- Create: `src/app/api/admin/manufacturers/[id]/reject/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";
import { sendEmail } from "@/lib/services/email";

const bodySchema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;
  const { id } = await params;

  let reason: string | undefined;
  try {
    reason = bodySchema.parse(await request.json().catch(() => ({}))).reason;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const [m] = await db
    .update(manufacturers)
    .set({ status: "rejected", rejectionReason: reason ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(manufacturers.id, id),
        inArray(manufacturers.status, ["pending_approval", "conditionally_approved"])
      )
    )
    .returning();

  if (!m) {
    return NextResponse.json(
      { error: "Manufacturer not found or not in a rejectable state" },
      { status: 400 }
    );
  }

  await publishRealtime([topics.admin()], { kind: "badge" });

  try {
    await sendEmail({
      type: "manufacturer_rejected",
      to: m.email,
      manufacturerEmail: m.email,
      companyName: m.companyName,
      rejectionReason: reason,
      orderNumber: "",
      customerName: m.contactPerson,
    });
  } catch (err) {
    console.error("manufacturer_rejected email failed:", err);
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (Expected: PASS), then:
```bash
git add src/app/api/admin/manufacturers/[id]/reject/route.ts
git commit -m "feat(admin): reject manufacturer endpoint + rejection email"
```

---

### Task B6: Manufacturer printer-photo upload endpoint

**Files:**
- Create: `src/app/api/manufacturer/printer-photo/route.ts`

Mirrors `src/app/api/manufacturer/documents/route.ts` (reuse its `requireManufacturer`, `validateImageMagicBytes`, `saveFile` pattern) but gated to `conditionally_approved`, images only, and stamps `printerPhotoUploadedAt`.

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { manufacturers, manufacturerDocuments } from "@/lib/db/schema";
import { getManufacturerSession } from "@/lib/services/manufacturer-auth";
import { saveFile } from "@/lib/services/storage";
import { validateImageMagicBytes } from "@/lib/services/file-validation";
import { publishRealtime } from "@/lib/realtime/bus";
import { topics } from "@/lib/realtime/events";

export async function POST(request: NextRequest) {
  const session = await getManufacturerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const manufacturer = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, session.manufacturerId),
    columns: { id: true, status: true },
  });
  if (!manufacturer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (manufacturer.status !== "conditionally_approved") {
    return NextResponse.json(
      { error: "Printer photo upload is only available for conditionally approved accounts" },
      { status: 403 }
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const img = validateImageMagicBytes(buffer);
  if (!img || !["image/jpeg", "image/png"].includes(img)) {
    return NextResponse.json({ error: "Only JPEG or PNG" }, { status: 400 });
  }
  const ext = img === "image/png" ? "png" : "jpg";
  const storageKey = await saveFile(buffer, "printer-photos", `${nanoid()}.${ext}`);

  await db.insert(manufacturerDocuments).values({
    manufacturerId: session.manufacturerId,
    type: "printer_photo",
    storageKey,
  });
  await db
    .update(manufacturers)
    .set({ printerPhotoUploadedAt: new Date(), updatedAt: new Date() })
    .where(eq(manufacturers.id, session.manufacturerId));

  await publishRealtime([topics.admin()], { kind: "badge" });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit` (Expected: PASS), then:
```bash
git add src/app/api/manufacturer/printer-photo/route.ts
git commit -m "feat(manufacturer): printer-photo upload endpoint (gated to conditionally_approved)"
```

---

### Task B7: Login + /me — allow conditionally_approved, block rejected

**Files:**
- Modify: `src/app/api/manufacturer/auth/login/route.ts:56-68`
- Modify: `src/app/api/manufacturer/auth/me/route.ts:27-49` (expose `printerPhotoUploadedAt`)

- [ ] **Step 1: login — add the rejected block (conditionally_approved already passes)**

In `src/app/api/manufacturer/auth/login/route.ts`, after the existing `pending_approval` block (line 68), add:
```ts
    if (manufacturer.status === "rejected") {
      return NextResponse.json(
        { error: "Your application was not approved. Our team will contact you regarding next steps." },
        { status: 403 }
      );
    }
```
(`conditionally_approved` and `active` fall through to token issuance — correct.)

- [ ] **Step 2: /me — expose the gate signal**

In `src/app/api/manufacturer/auth/me/route.ts`, add to the returned `manufacturer` object (after `status`):
```ts
      printerPhotoUploadedAt: manufacturer.printerPhotoUploadedAt,
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (Expected: PASS), then:
```bash
git add src/app/api/manufacturer/auth/login/route.ts src/app/api/manufacturer/auth/me/route.ts
git commit -m "feat(manufacturer-auth): allow conditionally_approved login, block rejected, expose printerPhotoUploadedAt"
```

---

### Task B8: Manufacturer panel verification gate UI

**Files:**
- Create: `src/app/manufacturer/verification-gate.tsx`
- Modify: `src/app/manufacturer/layout.tsx:41-54`

When status is `conditionally_approved`, the layout renders ONLY the gate (no sidebar/children).

- [ ] **Step 1: Create the gate component**

Create `src/app/manufacturer/verification-gate.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function VerificationGate({
  companyName,
  alreadyUploaded,
}: {
  companyName: string;
  alreadyUploaded: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyUploaded);

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/manufacturer/printer-photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Yükleme başarısız");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Bir hata oluştu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-200 p-8 text-center">
        <div className="text-3xl mb-3">🖨️</div>
        <h1 className="text-2xl font-serif text-gray-900">
          Tebrikler, {companyName}!
        </h1>
        {done ? (
          <>
            <p className="mt-3 text-gray-600">
              Yazıcı fotoğrafınız alındı. Hesabınız 24 saat içinde incelenip
              onaylanacaktır. Onaylandığında e-posta ile bilgilendirileceksiniz.
            </p>
            <span className="mt-6 inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              İnceleme bekleniyor
            </span>
            <label className="mt-6 block text-sm text-indigo-600 cursor-pointer hover:text-indigo-500">
              Fotoğrafı değiştir
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
          </>
        ) : (
          <>
            <p className="mt-3 text-gray-600">
              Başvurunuz koşullu olarak onaylandı. Son adım olarak, üretimde
              kullandığınız 3D yazıcı(lar)ın net bir fotoğrafını yükleyin. Bu,
              topluluk içinde güven oluşturmamıza yardımcı olur.
            </p>
            <label className="mt-6 inline-block px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium cursor-pointer hover:bg-indigo-700">
              {uploading ? "Yükleniyor..." : "Yazıcı fotoğrafını yükle"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>
            <p className="mt-3 text-xs text-gray-400">JPEG veya PNG, en fazla 10MB</p>
          </>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Render the gate from the layout**

In `src/app/manufacturer/layout.tsx`, replace the `if (manufacturer.status !== "active")` block (lines 41-54) with a conditional that special-cases `conditionally_approved`:
```tsx
  if (manufacturer.status === "conditionally_approved") {
    return (
      <LocaleProvider locale={locale}>
        <VerificationGate
          companyName={manufacturer.companyName}
          alreadyUploaded={manufacturer.printerPhotoUploadedAt != null}
        />
      </LocaleProvider>
    );
  }

  // Other non-active statuses keep the bare shell (no order data).
  if (manufacturer.status !== "active") {
    return (
      <LocaleProvider locale={locale}>
        <ManufacturerRealtimeShell>
          <div className="min-h-screen bg-gray-50 flex">
            <ManufacturerSidebar newAssignmentCount={0} />
            <main className="flex-1 overflow-auto text-gray-900">
              {children}
            </main>
          </div>
        </ManufacturerRealtimeShell>
      </LocaleProvider>
    );
  }
```
Add the import at the top:
```tsx
import { VerificationGate } from "./verification-gate";
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit` (Expected: PASS), then:
```bash
git add src/app/manufacturer/verification-gate.tsx src/app/manufacturer/layout.tsx
git commit -m "feat(manufacturer): printer-photo verification gate for conditionally_approved accounts"
```

---

### Task B9: Admin UI — verification actions + statuses

**Files:**
- Modify: `src/app/admin/manufacturers/page.tsx:35-47` (serialize new fields)
- Modify: `src/app/admin/manufacturers/manufacturers-client.tsx` (interface, badges, labels, filters, actions, photo link)
- Modify: `src/lib/i18n/dictionaries/en.ts` + `tr.ts` (new admin keys in BOTH)

- [ ] **Step 1: Serialize the new fields from the server page**

In `src/app/admin/manufacturers/page.tsx`, add to the `serialized` map object:
```ts
    rejectionReason: m.rejectionReason,
    printerPhotoUploadedAt: m.printerPhotoUploadedAt ? m.printerPhotoUploadedAt.toISOString() : null,
```
Also fetch the latest printer photo URL per manufacturer for review. After `allManufacturers`, add:
```ts
  const { manufacturerDocuments } = await import("@/lib/db/schema");
  const { getPublicUrl } = await import("@/lib/services/storage");
  const photos = await db.query.manufacturerDocuments.findMany({
    where: (t, { eq: e }) => e(t.type, "printer_photo"),
    orderBy: (t, { desc: dsc }) => [dsc(t.createdAt)],
  });
  const photoMap = new Map<string, string>();
  for (const p of photos) {
    if (!photoMap.has(p.manufacturerId)) photoMap.set(p.manufacturerId, getPublicUrl(p.storageKey));
  }
```
and add to `serialized`:
```ts
    printerPhotoUrl: photoMap.get(m.id) ?? null,
```
> Prefer top-of-file imports over dynamic `await import` if the file's style uses static imports — move `manufacturerDocuments`/`getPublicUrl` up to the existing import block.

- [ ] **Step 2: Extend the client interface + badges/labels/filters**

In `src/app/admin/manufacturers/manufacturers-client.tsx`:
- Add to the `Manufacturer` interface:
```ts
  rejectionReason: string | null;
  printerPhotoUploadedAt: string | null;
  printerPhotoUrl: string | null;
```
- Extend `STATUS_BADGE`:
```ts
  conditionally_approved: "bg-blue-100 text-blue-700",
  rejected: "bg-gray-200 text-gray-600",
```
- Extend `STATUS_LABEL_KEY`:
```ts
  conditionally_approved: "admin.manufacturers.statusConditional",
  rejected: "admin.manufacturers.statusRejected",
```
- Extend `FilterTab` type and `tabs` with `conditionally_approved` and `rejected`:
```ts
type FilterTab =
  | "all"
  | "pending_approval"
  | "conditionally_approved"
  | "manual_review"
  | "active"
  | "suspended"
  | "rejected";
```
and add to the `tabs` array:
```ts
    { key: "conditionally_approved", label: d["admin.manufacturers.filterConditional"] },
    { key: "rejected", label: d["admin.manufacturers.filterRejected"] },
```

- [ ] **Step 3: Extend performAction + add reject handler**

Change the `performAction` signature/body to cover the new actions and the reject reason:
```ts
  const performAction = async (
    id: string,
    action: "activate" | "suspend" | "conditionally-approve" | "approve" | "reject"
  ) => {
    let body: string | undefined;
    if (action === "reject") {
      const reason = window.prompt("Reddetme sebebi (opsiyonel, üreticiye e-posta ile iletilir):") ?? undefined;
      body = JSON.stringify({ reason });
    }
    setLoading(`${action}-${id}`);
    try {
      const res = await fetch(`/api/admin/manufacturers/${id}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || `${action} failed`);
        return;
      }
      router.refresh();
    } finally {
      setLoading(null);
    }
  };
```

- [ ] **Step 4: Render the new action buttons + photo link**

Replace the actions cell (`<td>` at lines 197-223) so each status shows the right buttons:
```tsx
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end items-center">
                      {m.status === "pending_approval" && (
                        <>
                          <button
                            onClick={() => performAction(m.id, "conditionally-approve")}
                            disabled={loading === `conditionally-approve-${m.id}`}
                            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.conditionallyApprove"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "conditionally_approved" && (
                        <>
                          {m.printerPhotoUrl ? (
                            <a
                              href={m.printerPhotoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50"
                            >
                              {d["admin.manufacturers.viewPrinterPhoto"]}
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">{d["admin.manufacturers.awaitingPhoto"]}</span>
                          )}
                          <button
                            onClick={() => performAction(m.id, "approve")}
                            disabled={!m.printerPhotoUploadedAt || loading === `approve-${m.id}`}
                            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                          >
                            {d["admin.manufacturers.approve"]}
                          </button>
                          <button
                            onClick={() => performAction(m.id, "reject")}
                            disabled={loading === `reject-${m.id}`}
                            className="px-3 py-1.5 bg-gray-600 text-white text-xs font-medium rounded-lg hover:bg-gray-700 disabled:bg-gray-400 transition-colors"
                          >
                            {d["admin.manufacturers.reject"]}
                          </button>
                        </>
                      )}
                      {m.status === "suspended" && (
                        <button
                          onClick={() => performAction(m.id, "activate")}
                          disabled={loading === `activate-${m.id}`}
                          className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `activate-${m.id}` ? d["admin.manufacturers.activating"] : d["admin.manufacturers.activate"]}
                        </button>
                      )}
                      {m.status === "active" && (
                        <button
                          onClick={() => performAction(m.id, "suspend")}
                          disabled={loading === `suspend-${m.id}`}
                          className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
                        >
                          {loading === `suspend-${m.id}` ? d["admin.manufacturers.suspending"] : d["admin.manufacturers.suspend"]}
                        </button>
                      )}
                    </div>
                  </td>
```

- [ ] **Step 5: Add the admin dictionary keys (en.ts AND tr.ts)**

Add to both dictionaries:
```
"admin.manufacturers.statusConditional"   EN: "Conditionally approved"  TR: "Koşullu onaylı"
"admin.manufacturers.statusRejected"      EN: "Rejected"                TR: "Reddedildi"
"admin.manufacturers.filterConditional"   EN: "Conditional"             TR: "Koşullu"
"admin.manufacturers.filterRejected"      EN: "Rejected"                TR: "Reddedildi"
"admin.manufacturers.conditionallyApprove" EN: "Conditionally approve"  TR: "Koşullu onayla"
"admin.manufacturers.approve"             EN: "Approve"                 TR: "Onayla"
"admin.manufacturers.reject"              EN: "Reject"                  TR: "Reddet"
"admin.manufacturers.viewPrinterPhoto"    EN: "View printer photo"      TR: "Yazıcı fotoğrafı"
"admin.manufacturers.awaitingPhoto"       EN: "Awaiting photo"          TR: "Fotoğraf bekleniyor"
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` (Expected: PASS — confirms all new dict keys exist in both files), then:
```bash
git add src/app/admin/manufacturers/page.tsx src/app/admin/manufacturers/manufacturers-client.tsx src/lib/i18n/dictionaries/en.ts src/lib/i18n/dictionaries/tr.ts
git commit -m "feat(admin): verification actions (conditionally-approve/approve/reject) + statuses + printer-photo review"
```

---

## PHASE C — Verification & wrap-up

### Task C1: Full type-check + unit smoke

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors.

- [ ] **Step 2: Phone unit tests**

Run: `npx tsx scripts/test-phone.ts`
Expected: all `✓` checks pass.

### Task C2: Manual end-to-end on an alternate port

Per local-run-isolation memory, run on a non-default port and do not disturb the user's dev server.

- [ ] **Step 1: Apply the migration to a dev DB**

Run: `npm run db:migrate` (against the dev database). Expected: the enum/column migration applies cleanly. (If `ALTER TYPE ... ADD VALUE` errors inside a txn, see the note in Task B1 Step 3.)

- [ ] **Step 2: Start the app on an alternate port**

Run: `PORT=3055 npm run dev` (or the project's equivalent). Confirm it boots.

- [ ] **Step 3: Verify the phone bug fix**

Register a manufacturer at `/manufacturer/register` using a TR mobile typed as `0532 123 45 67` with the default 🇹🇷 picker. Expected: registration succeeds (no "Invalid phone number"); the stored `phone` is `+905321234567`.

- [ ] **Step 4: Drive the verification flow**

In `/admin/manufacturers`: Conditionally Approve the new applicant → confirm the welcome email is logged/sent. Log in as the manufacturer → confirm only the upload gate shows → upload a JPEG/PNG → confirm "under review". Back in admin → confirm the printer photo link opens and **Approve** is now enabled → Approve → confirm approval email and that the manufacturer can now see the full panel. Separately, Reject a different pending applicant with a reason → confirm rejection email contains the reason and that login is blocked with the rejected message.

### Task C3: Finish the branch

- [ ] **Step 1:** Use the `superpowers:finishing-a-development-branch` skill to choose merge/PR/cleanup. Reference issue #2 in the PR/commit so it auto-closes.

---

## Self-Review (completed during authoring)

- **Spec coverage:** Statuses (B1) ✓; printer-photo storage reusing manufacturerDocuments (B1/B6) ✓; rejectionReason + printerPhotoUploadedAt columns (B1) ✓; admin conditionally-approve/approve/reject endpoints + activate narrowed (B3–B5) ✓; manufacturer upload endpoint (B6) ✓; login allows conditionally_approved, blocks rejected + /me signal (B7) ✓; panel gating UI (B8) ✓; three bilingual emails (B2) ✓; admin UI chips/filters/actions/photo review (B9) ✓. Phone: libphonenumber dep (A1) ✓; phone util + tests (A2/A3) ✓; PhoneInput component (A4) ✓; server validators register/profile/order (A5/A6) ✓; all UI surfaces (A7/A8) ✓; E.164 storage (via phoneField transform) ✓; existing rows untouched (no migration of data) ✓; migration generated/committed (B1) ✓; tsc + tsx test + manual run (C1/C2) ✓.
- **Placeholder scan:** No TBD/TODO; every code step shows concrete code.
- **Type consistency:** `normalizePhone`/`isValidPhone`/`formatPhoneDisplay`/`detectCountry`/`phoneField`/`COUNTRIES`/`DEFAULT_COUNTRY` used consistently across A2–A8; `phoneInputToE164`/`e164ToPhoneInput`/`PhoneInput` props consistent A4→A7/A8; status string literals (`conditionally_approved`, `rejected`) consistent B1→B3–B9; new email types + `rejectionReason` param consistent B2→B3–B5; new columns `printerPhotoUploadedAt`/`rejectionReason` consistent B1→B6–B9.
- **Open verification points flagged for the implementer:** shared-components directory location (A4), whether customer-register/address APIs have their own phone validation to swap (A8 Steps 2/4), and the `ALTER TYPE ADD VALUE` transaction caveat (B1).
