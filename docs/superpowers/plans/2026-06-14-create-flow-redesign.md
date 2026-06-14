# "Özel Üret" Flow Redesign — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Verification in this repo = `npm run typecheck`, `npm run lint`, ad-hoc `tsx` smoke scripts,
> and a local dev run (alt port) — NOT pytest. Commit after each coherent task.

**Goal:** Restructure `/create` into 3 input-based paths and make "styles" a single-registry,
data-driven set of "design templates" that are trivial to extend.

**Architecture:** Introduce `src/lib/create/design-templates.ts` as the single source of truth.
Derive Zod validation, prompt/pose, pricing kind, finish set, and the UI grid from it. Relax the
DB `style` column from a pg enum to `text`. Merge `figure`+`object` entry into one photo path.

**Tech Stack:** Next.js App Router, Drizzle (Postgres), Zod, BullMQ worker, Replicate (FLUX-Kontext)
+ Meshy, local FLUX for preview images.

Spec: `docs/superpowers/specs/2026-06-14-create-flow-redesign-design.md`

---

### Task 1: Design-template registry (source of truth)

**Files:** Create `src/lib/create/design-templates.ts`

- [ ] Define `DesignTemplate` interface: `slug, labelKey, descKey, preview, stylize, subject('person'|'object'), posePhrase?, poseMode('' | 't-pose'), prompt?, priceKind('figure'|'object'), enabled, order`.
- [ ] Add `PRINT_READINESS_CLAUSE` (move from style-transfer.ts) and build the 5 templates carrying the EXACT existing prompts/poses:
  - `gercekci` (slug `realistic`): stylize false, subject person, priceKind figure, no prompt.
  - `masalsi` (slug `storybook`): stylize true, T-pose, the storybook prompt, priceKind figure. **default**.
  - `anime` (slug `anime`): stylize true, standing pose, anime prompt, priceKind figure.
  - `chibi` (slug `chibi`): stylize true, T-pose, chibi prompt, priceKind figure.
  - `obje` (slug `object`): stylize false, subject object, priceKind object.
- [ ] Export `TEMPLATE_SLUGS = DESIGN_TEMPLATES.map(t=>t.slug)`, `DEFAULT_TEMPLATE_SLUG='storybook'`, `getTemplate(slug)`, `MODIFIER_PROMPTS` (moved from style-transfer.ts), and `buildTemplatePrompt(slug, modifiers)` (the registry-driven version of `buildPrompt`).
- [ ] Keep `slug` values identical to today's DB strings (`realistic/storybook/anime/chibi/object`) so no data rewrite is needed; only the *labels* rename.
- [ ] Verify: `npx tsc --noEmit` (file compiles, no consumers yet).
- [ ] Commit: `feat(create): design-template registry (single source of truth)`.

### Task 2: Point generation prompt/pose at the registry

**Files:** Modify `src/lib/services/style-transfer.ts`, `src/lib/services/meshy.ts`

- [ ] `style-transfer.ts`: replace `STYLE_PROMPTS`/`POSE_PHRASE`/`buildPrompt` with a thin wrapper that calls `buildTemplatePrompt` from the registry. Keep `applyStyleTransfer` signature (`style: FigurineStyle`) and the Replicate call unchanged. Keep `FigurineStyle`/`StyleModifier` exported types (now `FigurineStyle = string` or derived from slugs).
- [ ] `meshy.ts`: `poseModeForStyle(style)` returns `getTemplate(style)?.poseMode ?? ''`.
- [ ] Verify: `npx tsc --noEmit`; `tsx` smoke — for each slug assert `buildTemplatePrompt(slug, [])` matches the previous `buildPrompt` output (snapshot the 5 strings before refactor, compare after).
- [ ] Commit: `refactor(create): prompt/pose derive from template registry`.

### Task 3: Point validation + gallery filter at the registry

**Files:** Modify `src/app/api/preview/generate/route.ts`, `src/lib/validators/order.ts`, `src/app/api/gallery/route.ts`

- [ ] In all three, replace the hardcoded `z.enum([...])` / `includes([...])` style allowlist with `z.string().refine(s => TEMPLATE_SLUGS.includes(s), 'invalid template')` (default `DEFAULT_TEMPLATE_SLUG`) and `TEMPLATE_SLUGS.includes(...)`.
- [ ] Verify: `npx tsc --noEmit`; `tsx` smoke — POST schema parse accepts every `TEMPLATE_SLUGS` value and rejects `'bogus'`.
- [ ] Commit: `refactor(create): style validation derives from registry`.

### Task 4: Pricing kind from the registry

**Files:** Modify `src/app/api/orders/route.ts` (~line 318-323), `src/app/create/page.tsx` (`isObjectStyle` ~line 186, finish-set selection ~200-213)

- [ ] `orders/route.ts`: `kind = getTemplate(customInput.style)?.priceKind ?? 'figure'`.
- [ ] `page.tsx`: `const priceKind = getTemplate(selectedStyle)?.priceKind ?? 'figure'; const isObjectStyle = priceKind === 'object';` — keep the rest of the branch logic (price table, finish set) keyed off `isObjectStyle`.
- [ ] Verify: `npx tsc --noEmit`; `tsx` smoke — assert `getTemplate('object').priceKind==='object'` and the other 4 are `'figure'`.
- [ ] Commit: `refactor(create): pricing kind derives from registry`.

### Task 5: DB `style` enum → text

**Files:** Modify `src/lib/db/schema.ts` (previews.style ~338, orders.style ~373/479, any other `figurineStyleEnum` column), add migration under `drizzle/`

- [ ] Change each `figurineStyleEnum('style')...` column to `text('style').notNull().default('storybook')` (match existing default/notNull). Remove the `figurineStyleEnum` export only if no longer referenced.
- [ ] Run `npx drizzle-kit generate` → produces an `ALTER COLUMN ... TYPE text` migration. Inspect the SQL; ensure it preserves existing values (`USING style::text`).
- [ ] Verify: `npx tsc --noEmit`; review the generated `.sql` + meta snapshot are committed (per repo convention `_journal.json` MUST be committed).
- [ ] Commit: `feat(create): relax style column to text for extensible templates (migration)`.

### Task 6: Restructure the entry (3 paths) + template grid

**Files:** Modify `src/components/create/path-selector.tsx`, `src/app/create/page.tsx` (CreateRouter ~1874-1886, style-prefill effect ~342-350, STYLES grid ~215-220/970-989)

- [ ] `path-selector.tsx`: `PATHS` → 3 cards: `photo` (href `/create?path=photo`), `design` (`/create?path=design`), `upload` (`/create?path=upload`). Remove `soon` from upload+design. New icons/copy keys (Task 7).
- [ ] `page.tsx` CreateRouter: `path=upload`→UploadModelFlow, `path=design`→DesignToProductFlow, `path` in `{photo, figure, object}` (or style/previewId/fromOrder present) → CustomCreateFlow. Keep `?path=object` preselect = `object` template; `?path=figure`/`photo` keep default. `hasContext` includes `path=photo`.
- [ ] Replace the inline `STYLES` array with `DESIGN_TEMPLATES.filter(t=>t.enabled).sort(order)`; render `t.preview`, `d[t.labelKey]`, `d[t.descKey]`. Heading "Stil Seçimi" → `create.templateSelection` ("Tasarım Deseni").
- [ ] Verify: `npx tsc --noEmit`; dev run (alt port) — cold `/create` shows 3 cards; photo flow shows 5 templates incl. obje; `?path=object` preselects obje; `?path=figure` still works.
- [ ] Commit: `feat(create): 3 input paths + registry-driven template grid`.

### Task 7: Copy (i18n)

**Files:** Modify `src/lib/i18n/dictionaries/tr.ts` (and `en.ts` to keep the Dictionary type in sync)

- [ ] Add template label/desc keys: `create.template.realistic`="Gerçekçi"/desc, `.storybook`="Masalsı"/…, `.anime`, `.chibi`, `.object`="Obje" (reuse existing `create.style.*` values where present). Add `create.templateSelection`="Tasarım Deseni".
- [ ] Path-selector copy: `create.path.title`="Ne üretmek istersin?"; photo card "Fotoğraftan üret" / "Kişiden, evcil hayvandan ya da objeden 3D üret — desen seç."; design "2D Tasarım → Ürün" (unchanged); upload "Kendi 3D Dosyam" / "Zaten bir 3D modelin (STL/OBJ) varsa burada bastır. Yoksa Fotoğraftan üret'i kullan."
- [ ] Upload-flow plain-language: soften the watertight/print-envelope copy (`upload.*` keys) — "Model tek parça ve kapalı olmalı" + "maks. ~22×22×25 cm", keep technical detail as a secondary hint.
- [ ] Remove now-unused `create.soon.*` usage from path-selector (keep keys or delete if unreferenced).
- [ ] Verify: `npx tsc --noEmit` (en.ts is the Dictionary type source — keys must exist in both).
- [ ] Commit: `feat(create): copy for templates + 3-path entry + plain-language upload`.

### Task 8: Preview images (local FLUX)

**Files:** `public/examples/pixel-object.png` (+ optional entry-card images under `public/examples/`)

- [ ] Generate `pixel-object.png` (object + pixel_art currently 404s) with the local FLUX pipeline (`~/ComfyUI/flux2_edit.py` or `generate.py`), sized to match existing examples (~768–1024px).
- [ ] (Optional polish) generate 3 representative entry-card images; wire them into path-selector if added.
- [ ] Verify: files exist; `curl` the dev server returns 200 for the new paths.
- [ ] Commit: `assets(create): pixel-object preview (+ entry-card art)`.

### Task 9: Full verification

- [ ] `npm run typecheck` green; `npm run lint` 0 errors.
- [ ] `tsx scripts/_smoke-templates.ts` — registry ↔ Zod ↔ priceKind ↔ preview-path consistency for every slug.
- [ ] Dev run (alt port): walk all 3 paths; confirm obje pricing/finish flip; `?path=figure`/`?path=object` aliases land correctly; no console errors.
- [ ] `/code-review` (ultra optional) on the diff.
- [ ] Final commit + (on user's word) deploy.

## Self-Review notes
- Spec coverage: every spec section maps to a task (registry T1; prompt/pose T2; validation T3; pricing T4; DB T5; entry+grid T6; copy T7; images T8; verify T9). ✓
- Slugs unchanged (realistic/storybook/anime/chibi/object) → no data migration, only column type + labels. ✓
- `buildTemplatePrompt` name used consistently in T1/T2. ✓
