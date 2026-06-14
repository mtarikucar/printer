# "Özel Üret" (/create) Flow Redesign — Design Spec

**Date:** 2026-06-14
**Status:** Approved (structure + DB enum→text + restore "Gerçekçi")

## Problem

The `/create` ("özel üret") section has three concrete problems the user raised:

1. **Redundant entry points.** `?path=figure` ("Fotoğraftan Figür") and `?path=object`
   ("Objeden Ürün") both open the *same* `CustomCreateFlow` component. The only runtime
   difference is which style chip is pre-highlighted (`object` vs default `storybook`). The
   style grid (object/storybook/anime/chibi) is shown in both, so they feel identical.
2. **"Kendi Modelin" (STL/OBJ upload) is unclear.** It is flagged "Yakında" despite being
   fully wired, its copy assumes 3D-printing literacy (watertight, baskı zarfı 220×220×250mm),
   and it never states its audience (people who *already own* a 3D mesh file).
3. **"Styles" are not extensible.** Adding a style today means editing ~8–9 independent places
   (DB enum + migration, two Zod enums, gallery filter, prefill allowlist, the `STYLES` UI
   array, the prompt/pose tables in `style-transfer.ts`, i18n labels, landing config). There is
   no single source of truth. The user wants styles reframed as **"hazır tasarım desenleri"**
   (ready-made design templates) that are trivial to add to.

## Goals

- Collapse the redundant `figure`/`object` entry into one **"Fotoğraftan üret"** path; the
  figure-vs-object distinction becomes a **template** choice inside that flow (object is just a
  template).
- Reframe "styles" as **design templates** driven by a **single registry**, so adding a template
  is a one-entry change (+ one preview image) — no migration, no scattered edits.
- Reframe + un-hide **"Kendi 3D dosyam"** (STL/OBJ) and **"2D Tasarım"** with plain-language,
  audience-clear copy.
- Generate any missing/needed preview images locally (FLUX).

## Non-goals (YAGNI)

- No change to the generation pipeline itself (FLUX-Kontext stylize → Meshy stays).
- No per-template provider/model selection (Tripo stays dead; out of scope).
- No new pricing tiers beyond the existing figure/object split.
- No change to login/anti-abuse gating or server-trusted pricing.
- Not removing the `model3dUrl` data plumbing already touched elsewhere.

## Design

### 1. Top-level structure — 3 paths by input type

The cold-landing `CreatePathSelector` becomes **3 cards** keyed by *what the user starts from*:

| Path (`?path=`) | Card | Routes to |
|---|---|---|
| `photo` (was `figure`+`object`) | 📷 **Fotoğraftan üret** — kişi/evcil hayvan veya obje | `CustomCreateFlow`, template step |
| `design` | ✏️ **2D Tasarım → ürün** — logo/çizim/düz görsel | `DesignToProductFlow` |
| `upload` | 📦 **Kendi 3D dosyam** — STL/OBJ | `UploadModelFlow` |

- `?path=figure` and `?path=object` are **kept as backward-compatible aliases** that redirect into
  `path=photo` (object additionally preselects the `object` template) so existing links/QR/emails
  don't break.
- The `soon: true` flags on `upload` and `design` are **removed** (both flows already work).
- Inside the photo flow the heading "Stil Seçimi" becomes **"Tasarım Deseni"**.

### 2. Design-template registry (single source of truth)

New file: `src/lib/create/design-templates.ts`

```ts
export interface DesignTemplate {
  slug: string;            // stable key, persisted on previews/orders (text)
  labelKey: string;       // i18n key, e.g. "create.template.gercekci"
  descKey: string;        // i18n key for the short description
  preview: string;        // /examples/<slug>.png
  stylize: boolean;       // false = skip FLUX restyle, raw photo → Meshy (object/realistic)
  subject: "person" | "object"; // noun used in modifier prompts
  posePhrase?: string;    // optional pose wording for the prompt
  poseMode?: "" | "t-pose"; // Meshy pose hint
  prompt?: string;        // FLUX-Kontext stylization prompt (when stylize=true)
  priceKind: "figure" | "object"; // selects price table + finish set
  enabled: boolean;       // show in the picker
  order: number;          // sort order in the grid
}

export const DESIGN_TEMPLATES: DesignTemplate[] = [ /* gerçekçi, masalsı, anime, chibi, obje */ ];
export const TEMPLATE_SLUGS = DESIGN_TEMPLATES.map(t => t.slug);
export const getTemplate = (slug: string) => DESIGN_TEMPLATES.find(t => t.slug === slug);
```

Everything derives from this registry:
- **UI grid** (`page.tsx`) maps `DESIGN_TEMPLATES.filter(enabled)`.
- **Zod enums** (`api/preview/generate/route.ts`, `validators/order.ts`) use
  `z.string().refine(s => TEMPLATE_SLUGS.includes(s))` instead of hardcoded `z.enum(...)`.
- **Gallery filter** (`api/gallery/route.ts`) uses `TEMPLATE_SLUGS`.
- **Prompt/pose** (`style-transfer.ts`, `meshy.ts`) read `getTemplate(slug)` instead of the
  per-style `STYLE_PROMPTS`/`POSE_PHRASE`/`poseModeForStyle` tables.
- **Pricing** (`page.tsx` `isObjectStyle`, `api/orders/route.ts` kind) becomes
  `getTemplate(slug)?.priceKind` (`"object"` vs `"figure"`).
- **Finish set** (`page.tsx`) chosen by `priceKind`.

Initial templates: `gercekci` (realistic, restored), `masalsi` (storybook, default),
`anime`, `chibi`, `obje` (object). Existing persisted values `realistic/storybook/object`
map to these slugs — see Migration. (We keep existing slugs `realistic`, `storybook`, `anime`,
`chibi`, `object` to avoid data rewrites; labels handle the rename to "Gerçekçi/Masalsı/…".)

### 3. DB change — `style` enum → text

- `previews.style` and `orders.style` (and any other column on `figurineStyleEnum`) change from
  the pg enum to **`text`** (varchar), defaulting to the canonical default template slug.
- Validation moves to the app layer (Zod refine against `TEMPLATE_SLUGS`), so a new template is a
  registry entry with **no migration**.
- Drizzle: redefine the columns as `text(...)`, `drizzle-kit generate` → one migration
  (`ALTER COLUMN ... TYPE text`), keep `figurineStyleEnum` defined only if still referenced
  elsewhere (else drop). Existing rows preserve their string values. Commit the migration; it
  applies via the standard `drizzle-kit migrate` deploy step. (Mind the known prod/dev drift —
  verify the baseline before relying on auto-apply.)

### 4. "Kendi 3D dosyam" + "2D Tasarım" clarity

- Selector cards: remove `soon`. Upload card copy →
  *"Zaten bir 3D modelin (STL/OBJ) varsa burada bastır. Yoksa 'Fotoğraftan üret'i kullan."*
- In-flow upload copy: replace jargon with plain language + keep the technical detail as a
  secondary hint (e.g. "Model tek parça/kapalı olmalı" with a short tooltip; print-envelope shown
  as "maks. ~22×22×25 cm").
- 2D design card copy stays but is no longer "soon".

### 5. Images

- Generate the missing **`/examples/pixel-object.png`** (object + pixel_art modifier currently 404s).
- Generate representative preview imagery for the **3 entry cards** (mascot-themed, optional polish;
  transparent or framed) so the paths are visually distinct — using the local FLUX + cutout pipeline.
- Any future template ships with one `/examples/<slug>.png`.

### 6. Behavior preserved

- Generation: `applyStyleTransfer` (FLUX-Kontext-Pro) → `generateWithMeshy` (meshy-6) unchanged;
  only the *source* of per-template prompt/pose changes (registry vs scattered tables).
- Login + email-verify + anti-abuse caps unchanged.
- Pricing remains server-trusted in `/api/orders` (now via `priceKind`).

## Affected files

- New: `src/lib/create/design-templates.ts` (registry).
- `src/components/create/path-selector.tsx` — 3 cards, drop `soon`, new copy.
- `src/app/create/page.tsx` — `?path` dispatch + aliases, template grid from registry, pricing via
  `priceKind`, "Tasarım Deseni" heading, finish set from `priceKind`.
- `src/app/api/preview/generate/route.ts`, `src/lib/validators/order.ts`,
  `src/app/api/gallery/route.ts` — Zod/allowlist from `TEMPLATE_SLUGS`.
- `src/lib/services/style-transfer.ts`, `src/lib/services/meshy.ts` — prompt/pose from registry.
- `src/app/api/orders/route.ts` — `kind` from `priceKind`.
- `src/lib/db/schema.ts` + new migration — `style` columns enum→text.
- `src/lib/i18n/dictionaries/tr.ts` (+ `en.ts`) — template labels ("Gerçekçi"/"Masalsı"…),
  "Tasarım Deseni", path-selector copy, upload plain-language copy.
- `src/lib/styles/landing-content.ts` — optionally derive from registry (or leave; out of critical
  path).
- `public/examples/pixel-object.png` (+ entry-card images).

## Testing / verification

- `npm run typecheck` + `npm run lint` green.
- `tsx` smoke: assert registry ↔ Zod ↔ price-kind consistency (every `TEMPLATE_SLUGS` entry resolves
  a `priceKind` and a preview path).
- Local dev run (alt port): cold `/create` shows 3 cards; photo flow shows templates incl. obje;
  picking "Obje" flips price table + finishes; `?path=figure`/`?path=object` still land correctly.
- Confirm a generation still completes end-to-end (needs Meshy + worker) OR at least that the
  payload `style` slug is accepted by the Zod refine.

## Rollout

- Single PR/commit set on `main` → existing deploy pipeline (quality gate → image → VPS + migrate).
- DB migration applies the enum→text change; verify against the prod baseline first.
