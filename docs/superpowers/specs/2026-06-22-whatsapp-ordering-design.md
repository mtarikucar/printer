# WhatsApp Ordering + Admin Payment-Link — Design

**Date:** 2026-06-22
**Branch:** `feat/whatsapp-ordering`
**Status:** Approved (design)

## Background & scope decision

The original request was two features: (1) guest checkout, (2) WhatsApp ordering.

Exploration found that **guest checkout is already fully implemented** end to end
(`src/app/api/orders/route.ts:252-338` creates an `isGuest=true` user from
`guestEmail`+`guestName`; cart, `/checkout`, `/api/orders` have no auth guard; PayTR + havale
both work for guests). The only mandatory login gate in the customer journey is **AI
generation** (`src/app/api/preview/generate/route.ts`), which is a deliberate
anti-abuse/cost control and the user chose to **leave it unchanged**.

→ **Guest checkout: no work.** This spec covers **WhatsApp ordering only**, in two halves:

1. **Customer-facing click-to-chat** WhatsApp entry points (no backend; `wa.me` deep links
   with context-prefilled messages).
2. **Admin tool** to create an order on a customer's behalf and produce a **payment link**
   (PayTR card or havale) to paste into WhatsApp — reusing the existing draft→promote pipeline.

**Out of scope (separate future phase):** automated WhatsApp Cloud API / inbound webhook bot;
any change to the generation/login gates; multi-seller (manufacturer fan-out) manual orders.

## Approach (chosen: A)

- **A (chosen):** Admin creates an `orderDrafts` row; customer pays via a new **public
  `/pay/[reference]`** page; existing PayTR webhook / havale OCR-admin promotes the draft via
  `promoteDraftToOrder()`. Maximal reuse, idempotent, card+havale, lands in the normal order
  pipeline (incl. confirmation + guest-claim email).
- **B (rejected as primary, kept as fallback):** admin marks order paid offline (no link).
  Retained only as a small "manuel ödendi işaretle" action for already-settled deals.
- **C (rejected):** prefilled web-checkout deep link — admin can't set a negotiated price;
  customer re-enters everything; doesn't deliver "admin creates the order".

## Part 1 — Customer-facing click-to-chat (no backend)

**Config** — `src/lib/config/contact.ts`:
- Add `WHATSAPP_NUMBER` (digits only, default derived from the existing support number
  `905466780495`) and `buildWhatsAppUrl(message: string)` → `https://wa.me/<num>?text=<encoded>`.
  Hardcoded like the other contact constants (must be usable in client components).

**Components** (new, `src/components/whatsapp/`):
- `WhatsAppButton` — shared green/branded `<a>` taking a `message` prop. Inline + link variants.
- `WhatsAppFab` — floating action button; client component; `usePathname()` hides it on
  `/admin*` and `/manufacturer*`.

**Placements & prefilled messages (Turkish):**
- **Product** — `src/app/shop/[slug]/detail-client.tsx`, near `AddToCartButton`:
  "Bu ürünü WhatsApp'tan sipariş et" → *"Merhaba! Şu ürünü sipariş etmek istiyorum: {title} — {url}"*
  (`url` = `${NEXT_PUBLIC_APP_URL||"https://figurunica.com"}/shop/${slug}`).
- **Cart** — `src/app/cart/cart-client.tsx`, near the checkout button (line ~143):
  "Siparişi WhatsApp'tan tamamla" → message built client-side from cart items
  (`- {ad} x{adet}` lines + total).
- **Floating FAB** — mounted in root layout `src/app/layout.tsx`; generic greeting message.
- **Footer** — `FigFooter` in `src/components/figurunica/sections.tsx` (~line 591).
- **Contact** — `src/app/contact/page.tsx` (WhatsApp card alongside phone/email).

## Part 2 — Admin manual order creation

**Guest helper refactor** — extract `src/app/api/orders/route.ts:252-338` into
`resolveOrCreateGuestUser({ email, name, phone, marketingConsent })` returning
`{ ok: true, user } | { ok: false, error, code }`, preserving the **409 `email_registered`**
guard and the `onConflictDoNothing` race handling. New file (e.g.
`src/lib/services/guest-user.ts`). `/api/orders` is refactored to call it (behavior unchanged).

**Admin UI** — new `src/app/admin/orders/new/` (`page.tsx` + `new-order-client.tsx`),
modeled on `src/app/admin/products/new/`. Add a "WhatsApp Siparişi Oluştur" button in the
orders-list header (`src/app/admin/orders/orders-client.tsx`). Form fields:
- Customer: name, **phone** (required — it's a WhatsApp order), email (required: `users.email`
  + PayTR need it).
- Shipping address (TurkishAddress) — required (fulfillment + PayTR `user_address`/`user_phone`).
- **Line items:** one or more free-form lines (description + unit price + qty). Their sum is the
  draft total and the PayTR basket. (Free-form is primary — WhatsApp orders are often negotiated
  custom-figurine quotes. Catalog product search is optional / a later add.)
- Payment method: `card` | `bank_transfer`. Optional note.

**Admin API** — new `POST /api/admin/orders/create`:
- `requireAdmin()` (pattern: `const a = await requireAdmin(); if ("response" in a) return a.response;`).
- Zod-validate body.
- `resolveOrCreateGuestUser()`.
- Insert **one** `orderDrafts` row: `orderType: "custom"`, `status: "pending"`,
  `amountKurus` = line-item total, description → `productTitleSnapshot`, `shippingAddress`,
  chosen `paymentMethod`, and origin tag `attributionChannel: "whatsapp"` (**migration-free** —
  column already exists; verify it propagates to `orders` on promote, else add a tiny migration).
- Log to `adminActions` (`action: "create_manual_whatsapp_order"`).
- Return `reference` + ready-to-paste `/pay/<reference>` link (+ a one-click
  "WhatsApp'ta gönder" that opens `wa.me` to the customer's number with the link prefilled).

## Part 3 — Public payment page `/pay/[reference]`

New `src/app/pay/[reference]/page.tsx` — **no login**; keyed only on `reference`
(`FIG-<nanoid(8)>` ≈ 62^8, safe as a public payment key). Loads the draft and:
- If not `pending` / expired / already promoted → show appropriate state
  (ödendi / iptal / süresi doldu).
- **Card:** mint a PayTR token with the **visitor's current IP** (retry's `merchantOidSuffix`
  pattern, `src/app/api/customer/orders/[orderNumber]/retry-payment/route.ts`) → render
  iframe / redirect to `iframeUrl`.
- **Havale:** reuse `BankTransferInstructions` (IBAN + final amount + 72h deadline + dekont
  upload) in a public context.

Payment success flows through the **existing** PayTR webhook (`/api/webhooks/paytr`) / havale
OCR-admin → `promoteDraftToOrder()` (idempotent). The session-gated `/havale/[reference]` stays
as-is for logged-in customers; `/pay/[reference]` is the shareable public variant.

## Data / config summary

- No required migration. Origin tracking via existing `attributionChannel` (`orderDrafts`);
  confirm/extend propagation to `orders` during implementation (tiny additive migration only if
  the mirror column is missing).
- WhatsApp number: hardcoded constant in `contact.ts` (single source of truth), changeable in
  one place.

## Testing

- `tsc --noEmit` is the correctness gate (must pass).
- Unit: WhatsApp URL/message builder; `resolveOrCreateGuestUser` (new guest, returning guest,
  409 email_registered, race) via `tsx scripts/test-*.ts`.
- Smoke: admin create → `/pay/<reference>` state machine (pending/expired/paid) reasoning;
  PayTR token mint path mirrors retry route.
- Manual: click-to-chat links open WhatsApp with correct prefilled text on the 5 surfaces;
  FAB hidden on `/admin` + `/manufacturer`.

## Risks / notes

- `/pay/[reference]` must not leak PII beyond amount + short description; minimal display.
- `shippingAddress.telefon` is free-text — normalize phone before any future WhatsApp API use
  (not needed for click-to-chat / wa.me).
- Admin-created orders bypass generation gates by design (no AI generation involved).
