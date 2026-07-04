# fal.ai image-first figure flow — Implementation Plan

> **For agentic workers:** implement task-by-task; steps use `- [ ]` tracking.
> Spec: `docs/superpowers/specs/2026-07-04-fal-image-figure-flow-design.md`.

**Goal:** Replace Meshy/auto-3D with fal.ai 2D image variations the customer
approves before purchase; admin manually uploads the finished 3D model.

**Architecture:** Swap the Stage-A image generator (Meshy→fal.ai), delete Stage-B
(auto-3D) and the whole Meshy service/worker layer, add an `awaiting_model` order
state + admin model-upload, repurpose existing image columns. Additive schema.

**Tech Stack:** Next.js 16, Drizzle/Postgres, BullMQ/Redis, fal.ai queue API.

**Verify gate (run after each task group):** `npx tsc --noEmit` (ignore stale
`.next` validator + pre-existing errors), `npx eslint <changed>`, and at the end
`npm run build` + `npm run test:unit`.

---

## PHASE 1 — main `/create` flow

### Task 1: Schema + migration (foundation)
**Files:** Modify `src/lib/db/schema.ts`; Create `drizzle/0026_fal_image_flow.sql`.
- [ ] Add `awaiting_model` to `orderStatusEnum` (append; keep legacy values).
- [ ] Add `upload_model` to `adminActionTypeEnum`.
- [ ] Add to `orders`: `modelGlbKey text`, `modelGlbUrl text`, `modelStlKey text`,
      `modelStlUrl text`, `modelUploadedAt timestamp`.
- [ ] Write migration SQL: `ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting_model';`
      `ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'upload_model';`
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS model_glb_key text` (×5).
      (Enum `ADD VALUE` cannot run in a txn with its use — keep enum adds in their
      own statements; drizzle raw SQL applied over ssh+psql per prod constraint.)
- [ ] Verify: `npx tsc --noEmit` clean for schema.ts.

### Task 2: fal.ai image service
**Files:** Create `src/lib/services/fal-image.ts`; Test `scripts/test-fal-image.ts`.
- [ ] `falNanoBananaEdit(imageUrls: string[], prompt: string)` → `{imageUrl, requestId, costCents}`.
      POST `https://queue.fal.run/fal-ai/nano-banana/edit` `{prompt, image_urls}`,
      `Authorization: Key ${FAL_API_KEY}`; poll `/requests/{id}/status`→`/requests/{id}`,
      `images[0].url`; 120s budget; `costCents=4`. Pattern mirrors `tripo.ts`.
- [ ] Move `VARIATION_NUDGES` here (from meshy-image). No `backViewPrompt`.
- [ ] Add `test:fal-image` npm script; smoke test hits fal with a sample URL (guarded by FAL_API_KEY).
- [ ] Verify: tsc + eslint on the new file.

### Task 3: design-templates prompts (image, not mesh)
**Files:** Modify `src/lib/create/design-templates.ts`.
- [ ] `buildTemplatePrompt`: describe a *figurine-style image* (clean solid
      background, full figure, style-specific look). Drop `PRINT_READINESS_CLAUSE`,
      `poseModeForStyle`, `POSE_FROM_PHOTO` (Meshy-only). Make every template
      `stylize: true` (remove the raw-photo→3D short-circuit concept).
- [ ] Verify: tsc + eslint.

### Task 4: preview worker — Stage A only
**Files:** Modify `src/lib/queue/workers/preview-generation.worker.ts`.
- [ ] `generateVariations`: call `falNanoBananaEdit([primaryUrl,...extra], nudgedPrompt)`
      `VARIATION_COUNT` times → save PNGs → `previews.status='styled'`, `styledImageUrls`.
- [ ] DELETE `buildFromSelection`, back-view, `generateWithMeshy`, `toMeshyInput`
      Meshy imports. Remove the `build-from-selection` job handler.
- [ ] Verify: tsc + eslint.

### Task 5: preview API routes
**Files:** Modify `src/app/api/preview/[id]/select/route.ts`,
`src/app/api/preview/[id]/route.ts`; keep `regenerate`, `generate`.
- [ ] `select`: set `selectedStyledImageUrl` + `status='approved'`. Do NOT enqueue
      any build job. (This is the customer's image approval.)
- [ ] poll `route.ts`: return `{status, styledImageUrls, selectedStyledImageUrl}`;
      drop `glbUrl` exposure.
- [ ] `generate`/`regenerate` unchanged except they now feed Stage-A-only worker.
- [ ] Verify: tsc + eslint.

### Task 6: post-payment (order-confirm)
**Files:** Modify `src/lib/services/order-confirm.ts`.
- [ ] Custom order with an approved preview → set `orders.status='awaiting_model'`;
      remove the reuse-GLB / enqueue-ai-generation / enqueue-mesh branches.
- [ ] Marketplace + upload order paths unchanged.
- [ ] Verify: tsc + eslint.

### Task 7: customer create UI
**Files:** Modify `src/app/create/page.tsx`,
`src/components/create/design-to-product-flow.tsx`,
`src/components/create/variation-picker.tsx` (kept).
- [ ] Step 2 renders the **selected image** (`<img>`), not `ModelViewer`. Poll keys
      on `status==='styled'` (show picker) then `'approved'` (show approved image +
      "Devam / Onayla"). Remove GLB polling + ModelViewer usage in the create flow.
- [ ] Verify: tsc + eslint + (later) build.

### Task 8: admin — model upload + lifecycle
**Files:** Create `src/app/api/admin/orders/[id]/upload-model/route.ts`;
Modify `src/app/admin/orders/[id]/client.tsx`, `src/app/admin/orders/page.tsx`,
`src/app/admin/sidebar.tsx`; Delete `src/app/api/admin/orders/[id]/regenerate/route.ts`.
- [ ] `upload-model`: multipart GLB(+STL), validate magic bytes+50MB (reuse
      save-sculpted-mesh helpers), save `models/{orderId}/`, set `orders.model*` +
      `modelUploadedAt`, transition `awaiting_model→approved`, log `upload_model`
      adminAction, `emitOrderChanged`.
- [ ] client.tsx: `awaiting_model` action panel = model dropzone; Summary shows the
      approved customer image + original photo; after upload show ModelViewer of
      `modelGlbUrl` + GLB/STL download. Stepper: `paid→awaiting_model→approved→…`.
      Remove regenerate button.
- [ ] page.tsx buckets: `needsAction=['awaiting_model']`; problems drop
      failed_generation/failed_mesh (keep 'rejected'). sidebar badge → awaiting_model count.
- [ ] digital_files download (customer order page) gates on `modelStlKey`.
- [ ] Verify: tsc + eslint.

### Task 9: removals + config
**Files:** Delete `src/lib/services/meshy.ts`, `meshy-image.ts`,
`src/lib/queue/workers/ai-generation.worker.ts`, `mesh-processing.worker.ts`,
`scripts/test-meshy-*.ts`, `scripts/gen-style-previews.ts`. Modify
`src/lib/queue/queues.ts`, `workers/start.ts`, `.env.example`,
`src/app/privacy/page.tsx`, `src/lib/config/generation.ts` (comment wording).
- [ ] Remove `ai-generation`, `mesh-processing` queues + job types + worker starts.
- [ ] Remove any remaining Meshy imports/callsites (grep `meshy`/`MESHY` → 0 in src,
      excluding historical comments). Remove `admin/orders/[id]/regenerate` UI ref.
- [ ] `.env.example`: drop `MESHY_API_KEY`, ensure `FAL_API_KEY` documented.
- [ ] privacy: replace Meshy subprocessor line with fal.ai (image processing).
- [ ] Verify: tsc + eslint + `npm run build` + `npm run test:unit` all green.

### Task 10: verify + deploy Phase 1
- [ ] Apply migration to prod DB (raw SQL over ssh+psql).
- [ ] Local run: `FAL_API_KEY` set, migrate local DB, `/create` generate→approve→
      checkout, admin upload-model advances order.
- [ ] Merge `feat/fal-image-figure-flow` → `main` (auto-deploy). Watch CI green + live smoke.

---

## PHASE 2 — Creative Lab (`/urunler`) onto the same rails

### Task 11: pricing for keychain/magnet/lamp
**Files:** Modify `src/lib/config/prices.ts`.
- [ ] Extend `ItemKind` with `keychain|magnet|lamp`; add base table (defaults,
      clearly marked configurable) + `itemPriceKurus` branch.
- [ ] Verify: tsc + unit test the new kinds.

### Task 12: Creative Lab → image + real checkout + manual 3D
**Files:** Modify `src/lib/services/creative-lab.ts`→fal image,
`src/lib/queue/workers/creative-lab.worker.ts`, `src/app/api/creative-lab/*`,
`src/app/urunler/page.tsx`, `src/lib/db/schema.ts` (repurpose creative_lab_jobs
image columns), migration `drizzle/0027_creative_lab_image.sql`.
- [ ] Generate fal.ai image (product prompt), customer approves, → **real checkout**
      creating an order (product-type dimension) → `awaiting_model` → admin upload.
- [ ] Replace ModelViewer with image preview on `/urunler`. Keep WhatsApp as
      secondary contact only.
- [ ] Verify: tsc + eslint + build.

### Task 13: verify + deploy Phase 2
- [ ] Apply migration to prod; local run of the keychain/magnet/lamp checkout.
- [ ] Merge to `main`; CI green + live smoke.

---

## Self-review notes
- Every spec section maps to a task (fal service→T2, worker→T4, routes→T5,
  post-pay→T6, customer UI→T7, admin/upload→T8, removals→T9, schema→T1,
  Creative Lab→T11-12, digital_files→T8, caps→unchanged/T9 comment).
- No placeholders: signatures (`falNanoBananaEdit`), column names (`modelGlbKey`),
  enum values (`awaiting_model`, `upload_model`) are fixed and reused consistently.
- Ordering is dependency-safe: schema first (others reference new columns/status),
  service before worker, worker before routes/UI, removals last, verify+deploy gated.
